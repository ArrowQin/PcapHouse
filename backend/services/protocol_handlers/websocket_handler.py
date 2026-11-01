"""WebSocket protocol handler.

Replays a full WebSocket session on loopback so tcpdump can capture:

    TCP SYN/SYN-ACK/ACK
      → HTTP/1.1 GET … Upgrade: websocket
      → HTTP/1.1 101 Switching Protocols
      → bidirectional WS data frames (text / binary) in user-defined order
      → Close(1000) frame from client → Close frame from server
      → TCP FIN/ACK

The client and server share one ``frames`` list stored in
``parsed.metadata``.  Each side walks the list in lock-step: frames whose
direction is ``c2s`` are sent by the client (server just awaits
``ws.receive``), frames with direction ``s2c`` are sent by the server
(client awaits ``ws.receive``).  Since only one side is active for any
given index, no extra synchronisation primitive is needed.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from aiohttp import (
    ClientSession,
    ClientTimeout,
    TCPConnector,
    WSMsgType,
    web,
)

from services.protocol_handlers.base import (
    ParsedProtocolData,
    ProtocolHandler,
    ServerHandle,
)
from services.protocol_handlers import register_handler

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ALLOWED_DIRECTIONS = {"c2s", "s2c"}
_ALLOWED_FRAME_TYPES = {"text", "binary"}

# Headers that aiohttp manages itself during the Upgrade handshake.  We
# silently drop these from user-supplied extras so we don't fight the
# library.
_RESERVED_HEADERS = {
    "upgrade",
    "connection",
    "sec-websocket-key",
    "sec-websocket-version",
    "sec-websocket-extensions",
    "sec-websocket-accept",
    "content-length",
    "transfer-encoding",
}

# Per-frame receive timeout.  Guards against mis-configured sessions (e.g.
# a c2s frame with no actual client traffic) starving the event loop.
_FRAME_RECV_TIMEOUT = 10.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _decode_frame_payload(frame: Dict[str, Any]) -> Any:
    """Return the raw payload to send for *frame*.

    Text frames return ``str``; binary frames return ``bytes`` decoded from
    the user-supplied hex string.  ``parse_input`` calls this early so bad
    hex fails loudly before the pipeline spins up tcpdump.
    """
    ftype = frame["type"]
    data = frame.get("data", "")
    if ftype == "text":
        return data or ""
    # binary
    hex_str = (data or "").replace(" ", "").replace("\n", "")
    if not hex_str:
        return b""
    try:
        return bytes.fromhex(hex_str)
    except ValueError as exc:
        raise ValueError(
            f"Invalid binary hex payload for frame: {exc}"
        ) from exc


def _normalise_headers(
    extra_headers: List[Dict[str, str]],
) -> List[tuple]:
    """Validate + filter user extra headers into a list of (k, v) tuples."""
    out: List[tuple] = []
    for item in extra_headers or []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key", "")).strip()
        value = str(item.get("value", ""))
        if not key:
            continue
        if key.lower() in _RESERVED_HEADERS:
            logger.warning(
                "Dropping reserved WebSocket header from user input: %s", key,
            )
            continue
        out.append((key, value))
    return out


# ---------------------------------------------------------------------------
# WebSocketProtocolHandler
# ---------------------------------------------------------------------------

class WebSocketProtocolHandler(ProtocolHandler):
    """Generate pcap traffic for the WebSocket protocol (ws://)."""

    @property
    def protocol_name(self) -> str:
        return "websocket"

    # ---- parse_input ----

    async def parse_input(
        self,
        raw_request: Optional[str],
        raw_response: Optional[str],
    ) -> ParsedProtocolData:
        if not raw_request or not raw_request.strip():
            raise ValueError(
                "WebSocket input (raw_request JSON) is required"
            )

        try:
            payload = json.loads(raw_request)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Invalid JSON in WebSocket input: {exc}"
            ) from exc

        path = str(payload.get("path") or "/").strip() or "/"
        if not path.startswith("/"):
            path = "/" + path

        host = str(payload.get("host") or "").strip()
        origin = str(payload.get("origin") or "").strip()
        extra_headers = _normalise_headers(payload.get("extra_headers") or [])

        raw_frames = payload.get("frames") or []
        if not isinstance(raw_frames, list) or not raw_frames:
            raise ValueError(
                "At least one WebSocket frame is required"
            )

        frames: List[Dict[str, Any]] = []
        for idx, frame in enumerate(raw_frames):
            if not isinstance(frame, dict):
                raise ValueError(f"Frame #{idx} must be an object")
            direction = str(frame.get("direction") or "").lower()
            ftype = str(frame.get("type") or "").lower()
            if direction not in _ALLOWED_DIRECTIONS:
                raise ValueError(
                    f"Frame #{idx}: direction must be one of "
                    f"{sorted(_ALLOWED_DIRECTIONS)}, got {direction!r}"
                )
            if ftype not in _ALLOWED_FRAME_TYPES:
                raise ValueError(
                    f"Frame #{idx}: type must be one of "
                    f"{sorted(_ALLOWED_FRAME_TYPES)}, got {ftype!r}"
                )
            normalised = {
                "direction": direction,
                "type": ftype,
                "data": str(frame.get("data") or ""),
            }
            # Eagerly decode to surface bad hex before tcpdump runs.
            _decode_frame_payload(normalised)
            frames.append(normalised)

        return ParsedProtocolData(
            protocol="websocket",
            server_port=80,
            metadata={
                "path": path,
                "host": host,
                "origin": origin,
                "extra_headers": extra_headers,
                "frames": frames,
            },
        )

    # ---- create_server ----

    async def create_server(
        self,
        parsed: ParsedProtocolData,
        bind_host: str,
        port: int,
    ) -> ServerHandle:
        frames: List[Dict[str, Any]] = parsed.metadata["frames"]

        async def _ws_handler(request: web.Request) -> web.WebSocketResponse:
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            logger.info("WS server: handshake completed for %s", request.path)

            try:
                for idx, frame in enumerate(frames):
                    if frame["direction"] == "s2c":
                        payload = _decode_frame_payload(frame)
                        if frame["type"] == "text":
                            await ws.send_str(payload)  # type: ignore[arg-type]
                        else:
                            await ws.send_bytes(payload)  # type: ignore[arg-type]
                        logger.info(
                            "WS server → client (frame #%d, %s, %d bytes)",
                            idx, frame["type"],
                            len(payload) if isinstance(payload, (bytes, str)) else 0,
                        )
                    else:
                        # c2s: wait for the client frame
                        try:
                            msg = await asyncio.wait_for(
                                ws.receive(), timeout=_FRAME_RECV_TIMEOUT,
                            )
                        except asyncio.TimeoutError as exc:
                            logger.error(
                                "WS server: timed out waiting for c2s frame #%d",
                                idx,
                            )
                            raise exc
                        if msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED,
                                        WSMsgType.CLOSING, WSMsgType.ERROR):
                            logger.warning(
                                "WS server: connection closed early at frame #%d (type=%s)",
                                idx, msg.type,
                            )
                            break
                        logger.info(
                            "WS server ← client (frame #%d, %s)",
                            idx, msg.type.name if hasattr(msg.type, "name") else msg.type,
                        )

                # After all scripted frames, wait for the client's Close frame
                # so aiohttp can automatically echo a Close back (completing
                # the RFC 6455 close handshake) before the TCP FIN.
                try:
                    final = await asyncio.wait_for(
                        ws.receive(), timeout=_FRAME_RECV_TIMEOUT,
                    )
                    logger.info(
                        "WS server: final message type=%s (expected CLOSE)",
                        final.type.name if hasattr(final.type, "name") else final.type,
                    )
                except asyncio.TimeoutError:
                    logger.warning("WS server: no CLOSE from client, closing anyway")

            finally:
                if not ws.closed:
                    await ws.close()
            return ws

        app = web.Application()
        app.router.add_get("/{path_info:.*}", _ws_handler)

        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, host=bind_host, port=port, reuse_address=True)
        await site.start()
        logger.info(
            "WebSocket replay server listening on %s:%d", bind_host, port,
        )

        async def _cleanup() -> None:
            await runner.cleanup()
            logger.info(
                "WebSocket replay server stopped (%s:%d)", bind_host, port,
            )

        return ServerHandle(host=bind_host, port=port, cleanup_fn=_cleanup)

    # ---- send_traffic ----

    async def send_traffic(
        self,
        parsed: ParsedProtocolData,
        target_host: str,
        port: int,
        source_host: str,
    ) -> None:
        frames: List[Dict[str, Any]] = parsed.metadata["frames"]
        path: str = parsed.metadata["path"]
        host: str = parsed.metadata["host"] or target_host
        origin: str = parsed.metadata["origin"]
        extra_headers: List[tuple] = parsed.metadata["extra_headers"]

        # Build handshake headers.  aiohttp manages the WS-specific ones
        # itself; we only need to inject Host / Origin / user extras.
        headers: Dict[str, str] = {"Host": host}
        if origin:
            headers["Origin"] = origin
        for k, v in extra_headers:
            headers[k] = v

        url = f"http://{target_host}:{port}{path}"

        # Pin source port when the pipeline pre-allocated one (used by the
        # port-remap logic for privileged ports).
        source_port = int(parsed.metadata.get("_source_port") or 0)
        connector = TCPConnector(local_addr=(source_host, source_port))
        timeout = ClientTimeout(total=30)

        async with ClientSession(connector=connector, timeout=timeout) as session:
            async with session.ws_connect(
                url,
                headers=headers,
                autoclose=False,
                autoping=False,
            ) as ws:
                logger.info("WS client: handshake completed → %s", url)

                for idx, frame in enumerate(frames):
                    if frame["direction"] == "c2s":
                        payload = _decode_frame_payload(frame)
                        if frame["type"] == "text":
                            await ws.send_str(payload)  # type: ignore[arg-type]
                        else:
                            await ws.send_bytes(payload)  # type: ignore[arg-type]
                        logger.info(
                            "WS client → server (frame #%d, %s, %d bytes)",
                            idx, frame["type"],
                            len(payload) if isinstance(payload, (bytes, str)) else 0,
                        )
                    else:
                        # s2c: wait for the server's push
                        try:
                            msg = await asyncio.wait_for(
                                ws.receive(), timeout=_FRAME_RECV_TIMEOUT,
                            )
                        except asyncio.TimeoutError as exc:
                            logger.error(
                                "WS client: timed out waiting for s2c frame #%d",
                                idx,
                            )
                            raise exc
                        if msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED,
                                        WSMsgType.CLOSING, WSMsgType.ERROR):
                            logger.warning(
                                "WS client: connection closed early at frame #%d (type=%s)",
                                idx, msg.type,
                            )
                            break
                        logger.info(
                            "WS client ← server (frame #%d, %s)",
                            idx, msg.type.name if hasattr(msg.type, "name") else msg.type,
                        )

                # Initiate the RFC 6455 close handshake.  aiohttp will send
                # Close(1000), wait for the peer Close, then close the TCP
                # socket on our behalf.
                await ws.close(code=1000)
                logger.info("WS client: sent Close(1000), session done")

        # Give the kernel a moment to flush the final ACK/FIN so tcpdump
        # doesn't miss the tail of the exchange.
        await asyncio.sleep(0.3)


# ---- self-register ----
register_handler(WebSocketProtocolHandler())

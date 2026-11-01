"""HTTP/2 (h2c, prior-knowledge) protocol handler.

Generates a clean, Wireshark-decodable HTTP/2 capture on the loopback
interface.  The transport is h2c (cleartext) with the *prior-knowledge*
start mode, i.e. the client immediately sends the 24-byte

    PRI * HTTP/2.0\\r\\n\\r\\nSM\\r\\n\\r\\n

connection preface after the TCP handshake — no HTTP/1.1 ``Upgrade: h2c``
negotiation.  The resulting pcap therefore contains, in order:

    TCP SYN/SYN-ACK/ACK
      → HTTP/2 Magic preface + SETTINGS (both directions)
      → HEADERS + DATA (END_STREAM) request on stream 1
      → HEADERS + DATA (END_STREAM) response on stream 1
      → GOAWAY (client) + GOAWAY (server)
      → TCP FIN/ACK

Implementation notes:

* ``h2`` is a sans-IO state machine; we drive it manually from asyncio
  ``StreamReader``/``StreamWriter`` (server) and a ``Protocol``
  subclass (client).  ``aiohttp`` is unusable here because it has no
  HTTP/2 *server* support.
* Raw HTTP/1-style request/response text is parsed with the existing
  :mod:`services.protocol_handlers.http_handler` helpers and then
  projected onto HTTP/2 pseudo-headers (``:method`` / ``:scheme`` /
  ``:authority`` / ``:path`` and ``:status``).  Connection-specific
  headers forbidden by RFC 7540 §8.1.2.2 are stripped.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple

import h2.config
import h2.connection
import h2.events
import h2.exceptions

from services.protocol_handlers.base import (
    ParsedProtocolData,
    ProtocolHandler,
    ServerHandle,
)
from services.protocol_handlers import register_handler
from services.protocol_handlers.http_handler import (
    _DEFAULT_REQUEST,
    _DEFAULT_RESPONSE,
    parse_http_request,
    parse_http_response,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# RFC 7540 §3.5 client connection preface.
_H2_PREFACE = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"

# Connection-specific headers that MUST NOT appear in HTTP/2
# (RFC 7540 §8.1.2.2).  ``host`` is special-cased to ``:authority``.
# ``content-length`` is dropped because h2 / hpack will not add one and
# the receiving side can derive length from the DATA frame; including a
# stale user-supplied value is at best pointless and at worst a
# malformed-header trigger.
_FORBIDDEN_REQUEST_HEADERS = {
    "host",
    "connection",
    "keep-alive",
    "proxy-connection",
    "transfer-encoding",
    "upgrade",
    "content-length",
}

_FORBIDDEN_RESPONSE_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-connection",
    "transfer-encoding",
    "upgrade",
    "content-length",
}

# Overall per-side timeout — the whole request/response exchange plus
# the GOAWAY dance must complete within this budget.  Matches the WS
# handler's generous default so slow loopback setups don't flake.
_H2_TIMEOUT = 15.0


# ---------------------------------------------------------------------------
# Helpers – header projection
# ---------------------------------------------------------------------------

def _build_request_headers(
    request_data: Dict[str, Any],
    target_host: str,
) -> List[Tuple[str, str]]:
    """Project a parsed HTTP/1 request dict onto H2 pseudo-headers + headers."""
    method = request_data.get("method", "GET").upper()
    path = request_data.get("path", "/") or "/"

    # ``:authority`` prefers the user-supplied Host header (pasted raw
    # HTTP should survive into the capture verbatim) and falls back to
    # the target IP/hostname we're connecting to.
    authority = ""
    for k, v in request_data.get("headers", []):
        if k.lower() == "host":
            authority = v.strip()
            break
    if not authority:
        authority = target_host

    headers: List[Tuple[str, str]] = [
        (":method", method),
        (":scheme", "http"),
        (":authority", authority),
        (":path", path),
    ]
    for k, v in request_data.get("headers", []):
        if k.lower() in _FORBIDDEN_REQUEST_HEADERS:
            continue
        headers.append((k.lower(), v))
    return headers


def _build_response_headers(response_data: Dict[str, Any]) -> List[Tuple[str, str]]:
    """Project a parsed HTTP/1 response dict onto H2 pseudo-headers + headers."""
    status = int(response_data.get("status_code", 200))
    headers: List[Tuple[str, str]] = [(":status", str(status))]
    for k, v in response_data.get("headers", []):
        if k.lower() in _FORBIDDEN_RESPONSE_HEADERS:
            continue
        headers.append((k.lower(), v))
    return headers


# ---------------------------------------------------------------------------
# Server-side connection handling
# ---------------------------------------------------------------------------

async def _handle_h2_connection(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    response_data: Dict[str, Any],
) -> None:
    """Serve exactly one HTTP/2 client on *reader*/*writer*.

    The coroutine returns after the peer's GOAWAY (or an error / timeout),
    at which point the caller closes the transport.
    """
    peer = writer.get_extra_info("peername")
    try:
        # --- 1. Validate the 24-byte client preface -------------------
        preface = await asyncio.wait_for(reader.readexactly(24), timeout=_H2_TIMEOUT)
        if preface != _H2_PREFACE:
            logger.warning("H2 server: bad preface from %s: %r", peer, preface)
            return

        # --- 2. Boot the h2 state machine -----------------------------
        config = h2.config.H2Configuration(
            client_side=False,
            header_encoding="utf-8",
        )
        conn = h2.connection.H2Connection(config=config)
        conn.initiate_connection()
        writer.write(conn.data_to_send())
        await writer.drain()

        response_headers = _build_response_headers(response_data)
        response_body = (response_data.get("body") or "").encode("utf-8")
        response_sent_for: set = set()

        # --- 3. Event loop -------------------------------------------
        while True:
            try:
                data = await asyncio.wait_for(
                    reader.read(65535), timeout=_H2_TIMEOUT,
                )
            except asyncio.TimeoutError:
                logger.warning("H2 server: read timeout, closing")
                break

            if not data:
                # Peer closed the TCP connection.
                break

            try:
                events = conn.receive_data(data)
            except h2.exceptions.ProtocolError as exc:
                logger.error("H2 server: protocol error: %s", exc)
                writer.write(conn.data_to_send())
                await writer.drain()
                break

            goaway = False
            for event in events:
                if isinstance(event, h2.events.RequestReceived):
                    stream_id = event.stream_id
                    path = "?"
                    for name, value in event.headers or []:
                        if name == ":path":
                            path = value
                            break
                    logger.info(
                        "H2 server: request received stream=%d :path=%s",
                        stream_id, path,
                    )
                    # Respond immediately; single-stream means we don't
                    # wait for any request body frames — if the client
                    # sends any, the h2 state machine will happily keep
                    # receiving them in parallel with our HEADERS/DATA.
                    # (For a GET-style request end_stream is already True
                    # on the request, so there are no DATA frames anyway.)
                    conn.send_headers(
                        stream_id,
                        response_headers,
                        end_stream=not response_body,
                    )
                    if response_body:
                        conn.send_data(
                            stream_id,
                            response_body,
                            end_stream=True,
                        )
                    response_sent_for.add(stream_id)

                elif isinstance(event, h2.events.DataReceived):
                    # Return flow-control credit so large bodies don't stall.
                    conn.acknowledge_received_data(
                        event.flow_controlled_length,
                        event.stream_id,
                    )

                elif isinstance(event, h2.events.StreamEnded):
                    # Nothing extra to do — response was already sent when
                    # we saw the RequestReceived event.
                    pass

                elif isinstance(event, h2.events.ConnectionTerminated):
                    logger.info(
                        "H2 server: GOAWAY received (error=%s, last_stream=%s)",
                        event.error_code, event.last_stream_id,
                    )
                    goaway = True

            # Flush any frames the state machine produced while handling
            # the event batch (SETTINGS ACK, WINDOW_UPDATE, HEADERS,
            # DATA, GOAWAY, …).  Skipping this flush is the #1 cause of
            # hangs when integrating with sans-IO h2.
            outbound = conn.data_to_send()
            if outbound:
                writer.write(outbound)
                await writer.drain()

            if goaway:
                break

        logger.info("H2 server: session with %s done", peer)

    except asyncio.IncompleteReadError:
        logger.warning("H2 server: client closed before sending preface (%s)", peer)
    except Exception:
        logger.exception("H2 server: unexpected error with %s", peer)
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Client-side protocol
# ---------------------------------------------------------------------------

class _H2ClientProtocol(asyncio.Protocol):
    """Drive a single-stream h2c request/response exchange.

    The caller awaits :attr:`done` to wait for the exchange (GOAWAY
    included) to complete, or fail.
    """

    def __init__(
        self,
        request_headers: List[Tuple[str, str]],
        request_body: bytes,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        self._request_headers = request_headers
        self._request_body = request_body
        self._loop = loop
        self._conn = h2.connection.H2Connection(
            config=h2.config.H2Configuration(
                client_side=True,
                header_encoding="utf-8",
            ),
        )
        self._transport: Optional[asyncio.BaseTransport] = None
        self._response_status: Optional[str] = None
        self._stream_ended = False
        self._goaway_seen = False
        self._closing_started = False
        self.done: asyncio.Future = loop.create_future()

    # ---- asyncio.Protocol API -----------------------------------

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        # NOTE: we intentionally do NOT ``assert isinstance(transport,
        # asyncio.Transport)`` here — uvloop's ``UVTransport`` is a
        # read/write transport but does not inherit from
        # ``asyncio.Transport`` in all Python / uvloop combinations,
        # which would raise AssertionError and silently stall the whole
        # exchange (caller then times out on ``protocol.done``).
        # Duck-typing on ``write`` is sufficient for our needs.
        self._transport = transport  # type: ignore[assignment]

        # 1. Raw preface bytes — MUST precede any SETTINGS frame.
        transport.write(_H2_PREFACE)  # type: ignore[attr-defined]

        # 2. Client SETTINGS.
        self._conn.initiate_connection()

        # 3. Open stream 1 with HEADERS (+ DATA, if any).
        try:
            self._conn.send_headers(
                1, self._request_headers,
                end_stream=not self._request_body,
            )
            if self._request_body:
                self._conn.send_data(1, self._request_body, end_stream=True)
        except h2.exceptions.ProtocolError as exc:
            self._fail(exc)
            return

        self._flush()

    def data_received(self, data: bytes) -> None:
        if self._transport is None:
            return
        try:
            events = self._conn.receive_data(data)
        except h2.exceptions.ProtocolError as exc:
            self._fail(exc)
            return

        for event in events:
            if isinstance(event, h2.events.ResponseReceived):
                for name, value in event.headers or []:
                    if name == ":status":
                        self._response_status = value
                        break
                logger.info(
                    "H2 client: response received stream=%d :status=%s",
                    event.stream_id, self._response_status,
                )
            elif isinstance(event, h2.events.DataReceived):
                self._conn.acknowledge_received_data(
                    event.flow_controlled_length, event.stream_id,
                )
            elif isinstance(event, h2.events.StreamEnded):
                self._stream_ended = True
                logger.info(
                    "H2 client: stream ended (stream=%d)", event.stream_id,
                )
            elif isinstance(event, h2.events.ConnectionTerminated):
                self._goaway_seen = True
                logger.info(
                    "H2 client: GOAWAY from server (error=%s, last_stream=%s)",
                    event.error_code, event.last_stream_id,
                )

        self._flush()

        # Once the response stream ended, initiate graceful shutdown.
        if self._stream_ended and not self._closing_started:
            self._closing_started = True
            try:
                self._conn.close_connection()
            except h2.exceptions.ProtocolError:
                pass
            self._flush()

        # After we've sent our GOAWAY AND seen the peer's GOAWAY (or
        # the peer just TCP-closed), resolve and tear down.
        if self._closing_started and (self._goaway_seen or not events):
            self._finish()

    def connection_lost(self, exc: Optional[BaseException]) -> None:
        if not self.done.done():
            if exc and not self._stream_ended:
                self.done.set_exception(exc)
            else:
                self.done.set_result(None)

    # ---- helpers -------------------------------------------------

    def _flush(self) -> None:
        if self._transport is None:
            return
        outbound = self._conn.data_to_send()
        if outbound:
            self._transport.write(outbound)  # type: ignore[attr-defined]

    def _finish(self) -> None:
        if self.done.done():
            return
        self.done.set_result(None)
        # Half-close the write side; letting the server observe our FIN
        # produces the clean 4-way teardown tcpdump expects to capture.
        if self._transport is not None:
            try:
                self._transport.close()
            except Exception:
                pass

    def _fail(self, exc: BaseException) -> None:
        if not self.done.done():
            self.done.set_exception(exc)
        if self._transport is not None:
            try:
                self._transport.close()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Http2ProtocolHandler
# ---------------------------------------------------------------------------

class Http2ProtocolHandler(ProtocolHandler):
    """Generate pcap traffic for HTTP/2 over cleartext (h2c, prior-knowledge)."""

    @property
    def protocol_name(self) -> str:
        return "http2"

    # ---- parse_input ----

    async def parse_input(
        self,
        raw_request: Optional[str],
        raw_response: Optional[str],
    ) -> ParsedProtocolData:
        request_data = None
        response_data = None

        if raw_request and raw_request.strip():
            request_data = parse_http_request(raw_request.strip())

        if raw_response and raw_response.strip():
            response_data = parse_http_response(raw_response.strip())

        if not request_data and not response_data:
            raise ValueError(
                "At least one of raw_request or raw_response must be provided"
            )

        if not request_data:
            request_data = dict(_DEFAULT_REQUEST)
        if not response_data:
            response_data = dict(_DEFAULT_RESPONSE)

        return ParsedProtocolData(
            protocol="http2",
            server_port=80,
            metadata={
                "request": request_data,
                "response": response_data,
            },
        )

    # ---- create_server ----

    async def create_server(
        self,
        parsed: ParsedProtocolData,
        bind_host: str,
        port: int,
    ) -> ServerHandle:
        response_data = parsed.metadata["response"]

        async def _client_cb(
            reader: asyncio.StreamReader,
            writer: asyncio.StreamWriter,
        ) -> None:
            await _handle_h2_connection(reader, writer, response_data)

        server = await asyncio.start_server(
            _client_cb, host=bind_host, port=port, reuse_address=True,
        )
        logger.info("H2 server ready on %s:%d", bind_host, port)

        async def _cleanup() -> None:
            server.close()
            try:
                await server.wait_closed()
            except Exception:
                pass
            logger.info("H2 server stopped (%s:%d)", bind_host, port)

        return ServerHandle(host=bind_host, port=port, cleanup_fn=_cleanup)

    # ---- send_traffic ----

    async def send_traffic(
        self,
        parsed: ParsedProtocolData,
        target_host: str,
        port: int,
        source_host: str,
    ) -> None:
        request_data = parsed.metadata["request"]

        request_headers = _build_request_headers(request_data, target_host)
        request_body_text = request_data.get("body") or ""
        request_body = request_body_text.encode("utf-8") if request_body_text else b""

        source_port = int(parsed.metadata.get("_source_port") or 0)
        loop = asyncio.get_event_loop()

        def _protocol_factory() -> _H2ClientProtocol:
            return _H2ClientProtocol(request_headers, request_body, loop)

        transport, protocol = await loop.create_connection(
            _protocol_factory,
            host=target_host,
            port=port,
            local_addr=(source_host, source_port),
        )

        try:
            await asyncio.wait_for(protocol.done, timeout=_H2_TIMEOUT)
            logger.info(
                "H2 client: exchange complete (status=%s)",
                protocol._response_status,
            )
        except asyncio.TimeoutError:
            logger.error("H2 client: exchange timed out after %.1fs", _H2_TIMEOUT)
            raise
        finally:
            try:
                transport.close()
            except Exception:
                pass

        # Give the kernel time to flush the final ACK/FIN — same trick
        # the HTTP/1 and WebSocket handlers use.
        await asyncio.sleep(0.3)


# ---- self-register ----
register_handler(Http2ProtocolHandler())

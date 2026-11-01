"""HTTP protocol handler.

Parses raw HTTP request / response text, spins up a disposable aiohttp server
that replays the expected response, then drives a real HTTP client request so
tcpdump can capture realistic TCP traffic on the loopback interface.
"""

from __future__ import annotations

import asyncio
import logging
import re
from io import BytesIO
from http.client import HTTPResponse as _HTTPResponse
from typing import Dict, List, Optional, Tuple

from aiohttp import web, ClientSession, TCPConnector, ClientTimeout

from services.protocol_handlers.base import (
    ParsedProtocolData,
    ProtocolHandler,
    ServerHandle,
)
from services.protocol_handlers import register_handler

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers – HTTP text parsing
# ---------------------------------------------------------------------------

class _FakeSocket:
    """Minimal socket wrapper so ``http.client.HTTPResponse`` can read from
    a plain bytes buffer."""

    def __init__(self, data: bytes):
        self._fp = BytesIO(data)

    def makefile(self, *args, **kwargs):
        return self._fp


def parse_http_request(raw: str) -> Dict:
    """Parse a raw HTTP request string into structured components.

    Returns dict with keys: method, path, version, headers (list of tuples), body.
    """
    # Normalise line endings
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")

    parts = raw.split("\n\n", 1)
    head = parts[0]
    body = parts[1] if len(parts) > 1 else ""
    # Strip a single trailing newline (common when users paste from a
    # text editor / browser textarea that auto-appends one). Do NOT use
    # .strip() here — it would eat intentional whitespace inside the body.
    if body.endswith("\n"):
        body = body[:-1]

    lines = head.split("\n")
    if not lines:
        raise ValueError("Empty HTTP request")

    # Request line: METHOD PATH VERSION
    request_line = lines[0].strip()
    match = re.match(r"^(\S+)\s+(\S+)(?:\s+(HTTP/\S+))?$", request_line, re.IGNORECASE)
    if not match:
        raise ValueError(f"Invalid HTTP request line: {request_line!r}")

    method = match.group(1).upper()
    path = match.group(2)
    version = match.group(3) or "HTTP/1.1"

    headers: List[Tuple[str, str]] = []
    for line in lines[1:]:
        line = line.strip()
        if not line:
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        headers.append((key.strip(), value.strip()))

    return {
        "method": method,
        "path": path,
        "version": version,
        "headers": headers,
        "body": body,
    }


def parse_http_response(raw: str) -> Dict:
    """Parse a raw HTTP response string into structured components.

    Returns dict with keys: status_code, reason, version, headers, body.
    """
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")

    parts = raw.split("\n\n", 1)
    head = parts[0]
    body = parts[1] if len(parts) > 1 else ""
    if body.endswith("\n"):
        body = body[:-1]

    lines = head.split("\n")
    if not lines:
        raise ValueError("Empty HTTP response")

    # Status line: HTTP/x.x NNN Reason
    status_line = lines[0].strip()
    match = re.match(r"^(HTTP/\S+)\s+(\d{3})(?:\s+(.*))?$", status_line, re.IGNORECASE)
    if not match:
        raise ValueError(f"Invalid HTTP status line: {status_line!r}")

    version = match.group(1)
    status_code = int(match.group(2))
    reason = (match.group(3) or "").strip()

    headers: List[Tuple[str, str]] = []
    for line in lines[1:]:
        line = line.strip()
        if not line:
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        headers.append((key.strip(), value.strip()))

    return {
        "status_code": status_code,
        "reason": reason,
        "version": version,
        "headers": headers,
        "body": body,
    }


# ---------------------------------------------------------------------------
# Default templates (used when user provides only one side)
# ---------------------------------------------------------------------------

_DEFAULT_RESPONSE_BODY = "OK"
_DEFAULT_RESPONSE = {
    "status_code": 200,
    "reason": "OK",
    "version": "HTTP/1.1",
    "headers": [("Content-Type", "text/plain"), ("Content-Length", str(len(_DEFAULT_RESPONSE_BODY)))],
    "body": _DEFAULT_RESPONSE_BODY,
}

_DEFAULT_REQUEST = {
    "method": "GET",
    "path": "/",
    "version": "HTTP/1.1",
    "headers": [("Host", "localhost"), ("User-Agent", "PcapHouse-Generator/1.0")],
    "body": "",
}


# ---------------------------------------------------------------------------
# HttpProtocolHandler
# ---------------------------------------------------------------------------

class HttpProtocolHandler(ProtocolHandler):
    """Generate pcap traffic for the HTTP/1.x protocol."""

    @property
    def protocol_name(self) -> str:
        return "http"

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
            raise ValueError("At least one of raw_request or raw_response must be provided")

        # Fill in defaults for the missing side
        if not request_data:
            request_data = dict(_DEFAULT_REQUEST)
        if not response_data:
            response_data = dict(_DEFAULT_RESPONSE)

        return ParsedProtocolData(
            protocol="http",
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
        request_data = parsed.metadata["request"]

        target_path = request_data.get("path", "/")

        async def _handler(request: web.Request) -> web.Response:
            headers_dict = {k: v for k, v in response_data["headers"]
                           if k.lower() not in ("content-length", "transfer-encoding")}
            body_bytes = response_data["body"].encode("utf-8") if response_data["body"] else b""
            return web.Response(
                status=response_data["status_code"],
                reason=response_data.get("reason", ""),
                headers=headers_dict,
                body=body_bytes,
            )

        app = web.Application()
        # Register a catch-all so the path always matches.
        app.router.add_route("*", "/{path_info:.*}", _handler)

        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, host=bind_host, port=port, reuse_address=True)
        await site.start()
        logger.info("HTTP replay server listening on %s:%d", bind_host, port)

        async def _cleanup() -> None:
            await runner.cleanup()
            logger.info("HTTP replay server stopped (%s:%d)", bind_host, port)

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

        method = request_data["method"]
        path = request_data["path"]
        # Preserve user-supplied header casing/order as best we can.
        headers_dict = {k: v for k, v in request_data["headers"]}

        # --- Body handling -----------------------------------------------
        # Compute body bytes first, then drop any user-supplied
        # Content-Length / Transfer-Encoding headers: aiohttp MUST be free
        # to set Content-Length from the actual payload size. If we let a
        # user-provided "Content-Length: 44" through while aiohttp sends
        # only 43 bytes (e.g. the user's pasted body had a trailing newline
        # that got stripped, or they miscounted), Wireshark will see a
        # truncated HTTP message on the wire, fail TCP reassembly, and
        # refuse to dissect it as HTTP — the exact symptom we hit.
        body_text: str = request_data.get("body") or ""
        body_bytes: Optional[bytes] = body_text.encode("utf-8") if body_text else None

        for k in list(headers_dict.keys()):
            if k.lower() in ("content-length", "transfer-encoding"):
                del headers_dict[k]

        url = f"http://{target_host}:{port}{path}"

        # Build a connector that binds to source_host so the SYN originates
        # from the right IP (important for tcpdump capture).
        # If the pipeline pre-allocated a specific source port (so we can
        # later remap it with tcprewrite --portmap), honour it; otherwise
        # let the kernel pick an ephemeral port.
        source_port = int(parsed.metadata.get("_source_port") or 0)
        connector = TCPConnector(local_addr=(source_host, source_port))
        timeout = ClientTimeout(total=15)

        async with ClientSession(connector=connector, timeout=timeout) as session:
            async with session.request(
                method,
                url,
                headers=headers_dict,
                data=body_bytes,
                ssl=False,
                # Don't let aiohttp overwrite an explicit Host header with
                # "<ip>:<port>" — users paste raw HTTP and expect Host to
                # survive into the capture.
                skip_auto_headers=("Host",) if any(k.lower() == "host" for k in headers_dict) else (),
            ) as resp:
                # Consume the response fully so the TCP FIN exchange happens.
                await resp.read()
                logger.info(
                    "HTTP traffic sent: %s %s → %d %s",
                    method, url, resp.status, resp.reason,
                )

        # Give the kernel a moment to flush the last ACK/FIN.
        await asyncio.sleep(0.3)


# ---- self-register ----
register_handler(HttpProtocolHandler())

"""DNS protocol handler.

Parses structured DNS query/response JSON from the frontend, spins up a
disposable UDP DNS server that replays the expected response, then drives a
real DNS query so tcpdump can capture realistic UDP traffic on the loopback
interface.

Input format (stored in ``raw_request`` as JSON):

    {
        "domain": "example.com",
        "qtype": "A",
        "answers": [
            {"type": "A", "data": "93.184.216.34", "ttl": 300},
            {"type": "CNAME", "data": "cdn.example.com", "ttl": 600}
        ]
    }

``raw_response`` is currently unused (the handler constructs the DNS reply
from the ``answers`` array), but reserved for future raw-bytes mode.
"""

from __future__ import annotations

import asyncio
import json
import logging
import socket
from typing import Any, Dict, List, Optional

from dnslib import DNSRecord, DNSHeader, DNSQuestion, RR, QTYPE, A, AAAA, CNAME, MX, TXT, NS

from services.protocol_handlers.base import (
    ParsedProtocolData,
    ProtocolHandler,
    ServerHandle,
)
from services.protocol_handlers import register_handler

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers – build dnslib objects from the structured JSON
# ---------------------------------------------------------------------------

# Map string record-type names to QTYPE integer values
_QTYPE_MAP: Dict[str, int] = {
    "A": QTYPE.A,
    "AAAA": QTYPE.AAAA,
    "CNAME": QTYPE.CNAME,
    "MX": QTYPE.MX,
    "TXT": QTYPE.TXT,
    "NS": QTYPE.NS,
}


def _make_rr(domain: str, answer: Dict[str, Any]) -> RR:
    """Build a :class:`dnslib.RR` from a single answer dict."""
    rtype = answer.get("type", "A").upper()
    data = answer.get("data", "")
    ttl = int(answer.get("ttl", 300))

    if rtype == "A":
        return RR(rname=domain, rtype=QTYPE.A, ttl=ttl, rdata=A(data))
    elif rtype == "AAAA":
        return RR(rname=domain, rtype=QTYPE.AAAA, ttl=ttl, rdata=AAAA(data))
    elif rtype == "CNAME":
        return RR(rname=domain, rtype=QTYPE.CNAME, ttl=ttl, rdata=CNAME(data))
    elif rtype == "MX":
        # MX data can be "10 mail.example.com" or just "mail.example.com"
        parts = data.split(None, 1)
        if len(parts) == 2 and parts[0].isdigit():
            preference, exchange = int(parts[0]), parts[1]
        else:
            preference, exchange = 10, data
        return RR(rname=domain, rtype=QTYPE.MX, ttl=ttl, rdata=MX(exchange, preference))
    elif rtype == "TXT":
        return RR(rname=domain, rtype=QTYPE.TXT, ttl=ttl, rdata=TXT(data))
    elif rtype == "NS":
        return RR(rname=domain, rtype=QTYPE.NS, ttl=ttl, rdata=NS(data))
    else:
        raise ValueError(f"Unsupported DNS record type: {rtype}")


def _build_query(domain: str, qtype_str: str) -> DNSRecord:
    """Build a DNS query packet."""
    qtype_val = _QTYPE_MAP.get(qtype_str.upper())
    if qtype_val is None:
        raise ValueError(f"Unsupported query type: {qtype_str}")
    q = DNSRecord.question(domain, qtype=QTYPE.reverse.get(qtype_val, "A"))
    return q


def _build_response(query: DNSRecord, domain: str, answers: List[Dict[str, Any]]) -> DNSRecord:
    """Build a DNS response packet matching the given *query*."""
    reply = query.reply()
    for ans in answers:
        reply.add_answer(_make_rr(domain, ans))
    return reply


# ---------------------------------------------------------------------------
# UDP DNS Server (asyncio DatagramProtocol)
# ---------------------------------------------------------------------------

class _DnsServerProtocol(asyncio.DatagramProtocol):
    """Minimal UDP DNS server that replies with a pre-built response."""

    def __init__(self, domain: str, answers: List[Dict[str, Any]]):
        self.domain = domain
        self.answers = answers
        self.transport: Optional[asyncio.DatagramTransport] = None

    def connection_made(self, transport: asyncio.DatagramTransport) -> None:  # type: ignore[override]
        self.transport = transport

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        try:
            query = DNSRecord.parse(data)
            reply = _build_response(query, self.domain, self.answers)
            self.transport.sendto(reply.pack(), addr)  # type: ignore[union-attr]
            logger.debug("DNS reply sent to %s for %s", addr, self.domain)
        except Exception:
            logger.warning("Failed to parse/respond to DNS query from %s", addr, exc_info=True)


# ---------------------------------------------------------------------------
# DnsProtocolHandler
# ---------------------------------------------------------------------------

class _DnsClientProtocol(asyncio.DatagramProtocol):
    """UDP client protocol that captures the first datagram into a future."""

    def __init__(self, query_bytes: bytes, target: tuple, response_future: "asyncio.Future[bytes]"):
        self._query = query_bytes
        self._target = target
        self._future = response_future
        self.transport: Optional[asyncio.DatagramTransport] = None

    def connection_made(self, transport: asyncio.DatagramTransport) -> None:  # type: ignore[override]
        self.transport = transport
        # Fire the query immediately once the socket is connected.
        try:
            transport.sendto(self._query, self._target)
        except Exception as exc:
            if not self._future.done():
                self._future.set_exception(exc)

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        if not self._future.done():
            self._future.set_result(data)

    def error_received(self, exc: Exception) -> None:
        if not self._future.done():
            self._future.set_exception(exc)


# ---------------------------------------------------------------------------
# DnsProtocolHandler
# ---------------------------------------------------------------------------

class DnsProtocolHandler(ProtocolHandler):
    """Generate pcap traffic for the DNS protocol (UDP)."""

    @property
    def protocol_name(self) -> str:
        return "dns"

    # ---- parse_input ----

    async def parse_input(
        self,
        raw_request: Optional[str],
        raw_response: Optional[str],
    ) -> ParsedProtocolData:
        if not raw_request or not raw_request.strip():
            raise ValueError("DNS input (raw_request JSON) is required")

        try:
            payload = json.loads(raw_request)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON in DNS input: {exc}") from exc

        domain = payload.get("domain", "").strip()
        if not domain:
            raise ValueError("'domain' field is required in DNS input")

        qtype = payload.get("qtype", "A").strip().upper()
        answers: List[Dict[str, Any]] = payload.get("answers", [])

        if not answers:
            raise ValueError("At least one answer record is required")

        # Validate by constructing the DNS objects (will throw on bad data)
        query = _build_query(domain, qtype)
        _build_response(query, domain, answers)

        return ParsedProtocolData(
            protocol="dns",
            server_port=53,
            metadata={
                "domain": domain,
                "qtype": qtype,
                "answers": answers,
            },
        )

    # ---- create_server ----

    async def create_server(
        self,
        parsed: ParsedProtocolData,
        bind_host: str,
        port: int,
    ) -> ServerHandle:
        domain = parsed.metadata["domain"]
        answers = parsed.metadata["answers"]

        loop = asyncio.get_running_loop()
        transport, _protocol = await loop.create_datagram_endpoint(
            lambda: _DnsServerProtocol(domain, answers),
            local_addr=(bind_host, port),
            family=socket.AF_INET,
        )
        logger.info("DNS replay server listening on %s:%d (UDP)", bind_host, port)

        async def _cleanup() -> None:
            transport.close()
            logger.info("DNS replay server stopped (%s:%d)", bind_host, port)

        return ServerHandle(host=bind_host, port=port, cleanup_fn=_cleanup)

    # ---- send_traffic ----

    async def send_traffic(
        self,
        parsed: ParsedProtocolData,
        target_host: str,
        port: int,
        source_host: str,
    ) -> None:
        domain = parsed.metadata["domain"]
        qtype = parsed.metadata["qtype"]

        query = _build_query(domain, qtype)
        query_bytes = query.pack()

        source_port = int(parsed.metadata.get("_source_port") or 0)

        loop = asyncio.get_running_loop()
        response_future: "asyncio.Future[bytes]" = loop.create_future()

        # Build the UDP datagram endpoint. ``local_addr`` binds source_host so
        # tcpdump observes the correct client IP; ``remote_addr`` lets us use
        # ``transport.sendto`` without specifying the target every time.
        transport, _protocol = await loop.create_datagram_endpoint(
            lambda: _DnsClientProtocol(
                query_bytes, (target_host, port), response_future
            ),
            local_addr=(source_host, source_port),
            remote_addr=(target_host, port),
            family=socket.AF_INET,
        )
        logger.info("DNS query sent: %s %s → %s:%d", qtype, domain, target_host, port)

        try:
            resp_data = await asyncio.wait_for(response_future, timeout=5)
            resp = DNSRecord.parse(resp_data)
            logger.info(
                "DNS response received: %d answers for %s",
                len(resp.rr), domain,
            )
        finally:
            transport.close()

        # Small delay to ensure kernel flushes the UDP packets
        await asyncio.sleep(0.3)


# ---- self-register ----
register_handler(DnsProtocolHandler())

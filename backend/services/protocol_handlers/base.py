"""Protocol handler abstraction layer.

Every supported protocol implements :class:`ProtocolHandler`.  The generator
pipeline calls the four lifecycle methods in order:

    parse_input → create_server → send_traffic → cleanup

This keeps the "virtual-NIC ↔ tcpdump ↔ tcprewrite" pipeline generic while
individual protocols only worry about their own I/O semantics.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes shared across all handlers
# ---------------------------------------------------------------------------

@dataclass
class ParsedProtocolData:
    """Container for the result of *parse_input*.

    The handler stuffs protocol-specific artefacts into *metadata*; the
    pipeline itself only needs *protocol* and *server_port*.
    """

    protocol: str
    server_port: int
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ServerHandle:
    """Opaque handle returned by *create_server*.

    *cleanup_fn* is awaited by the pipeline (or by the handler's own
    *cleanup*) to tear down whatever the server set up.
    """

    host: str
    port: int
    cleanup_fn: Callable[[], Awaitable[None]]
    extra: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Abstract base class
# ---------------------------------------------------------------------------

class ProtocolHandler(ABC):
    """Interface that every protocol handler must implement."""

    @property
    @abstractmethod
    def protocol_name(self) -> str:
        """Short lowercase identifier, e.g. ``"http"``, ``"dns"``."""
        ...

    @abstractmethod
    async def parse_input(
        self,
        raw_request: Optional[str],
        raw_response: Optional[str],
    ) -> ParsedProtocolData:
        """Parse the user-supplied raw text into structured protocol data.

        Raises :class:`ValueError` with a human-readable message on bad input.
        """
        ...

    @abstractmethod
    async def create_server(
        self,
        parsed: ParsedProtocolData,
        bind_host: str,
        port: int,
    ) -> ServerHandle:
        """Start a temporary server that will replay the expected response.

        The server MUST bind to *bind_host*:*port* and be ready to accept
        connections when this coroutine returns.
        """
        ...

    @abstractmethod
    async def send_traffic(
        self,
        parsed: ParsedProtocolData,
        target_host: str,
        port: int,
        source_host: str,
    ) -> None:
        """Drive the client side of the interaction.

        Send the request to *target_host*:*port* (optionally binding the
        outgoing socket to *source_host*).  The method should return only
        after the full request/response exchange is complete.
        """
        ...

    async def cleanup(self, handle: ServerHandle) -> None:
        """Tear down the server.  Default implementation calls *handle.cleanup_fn*."""
        await handle.cleanup_fn()

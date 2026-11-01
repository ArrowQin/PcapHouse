"""Protocol handler registry.

Import all concrete handler modules here so they self-register.  The pipeline
looks handlers up via :func:`get_handler`.
"""

from __future__ import annotations

import logging
from typing import Dict, Optional

from services.protocol_handlers.base import ProtocolHandler

logger = logging.getLogger(__name__)

# Handler instances keyed by protocol_name
_HANDLERS: Dict[str, ProtocolHandler] = {}


def register_handler(handler: ProtocolHandler) -> None:
    """Register a handler instance.  Called at import time by each module."""
    name = handler.protocol_name
    if name in _HANDLERS:
        logger.warning("overwriting handler for protocol %r", name)
    _HANDLERS[name] = handler
    logger.info("registered protocol handler: %s", name)


def get_handler(protocol: str) -> Optional[ProtocolHandler]:
    """Return the handler for *protocol*, or ``None`` if unsupported."""
    return _HANDLERS.get(protocol.lower())


def list_protocols() -> list[dict]:
    """Return metadata for every registered handler (for the /protocols endpoint)."""
    return [
        {
            "name": h.protocol_name,
            "label": h.protocol_name.upper(),
            "description": h.__class__.__doc__ or "",
            "available": True,
        }
        for h in _HANDLERS.values()
    ]


# ---- Auto-import concrete handlers so they register themselves ----
from services.protocol_handlers import http_handler       # noqa: E402, F401
from services.protocol_handlers import dns_handler        # noqa: E402, F401
from services.protocol_handlers import websocket_handler  # noqa: E402, F401
from services.protocol_handlers import http2_handler      # noqa: E402, F401

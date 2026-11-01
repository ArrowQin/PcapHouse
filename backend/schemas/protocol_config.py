from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field


class ProtocolConfigBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    enabled: bool = True
    description: str = ""


class ProtocolConfigCreate(ProtocolConfigBase):
    """Create a new protocol-config row. `name` is lowercased server-side."""
    pass


class ProtocolConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    description: Optional[str] = None


class ProtocolConfigResponse(ProtocolConfigBase):
    id: int

    class Config:
        from_attributes = True


class ProtocolConfigBulkSet(BaseModel):
    """Replace the whole enabled-set in one shot.

    `enabled_names` is the complete set of protocol short-names the user wants
    enabled. Anything not in the list will be marked disabled (but kept around
    so the user's descriptions aren't lost). Unknown names are created.
    """
    enabled_names: List[str]


class ProtocolCatalogResponse(BaseModel):
    """Full list of protocol short-names sharkd knows about.

    Returned lowercased and de-duped. May be empty if sharkd is unavailable.
    """
    protocols: List[str]
    cached: bool  # True if this came from the in-memory cache (cheap call).

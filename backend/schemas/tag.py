from __future__ import annotations

from typing import Optional
from pydantic import BaseModel


class TagCreate(BaseModel):
    name: str
    color: str = "#3B82F6"


class TagUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class TagResponse(BaseModel):
    id: int
    name: str
    color: str

    class Config:
        from_attributes = True

from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class CategoryCreate(BaseModel):
    name: str
    description: str = ""


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class CategoryResponse(BaseModel):
    id: int
    name: str
    description: str
    is_builtin: bool = False
    file_count: int
    created_at: datetime

    class Config:
        from_attributes = True

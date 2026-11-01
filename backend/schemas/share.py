"""Pydantic schemas for the file sharing feature."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel, Field


def _as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) < 8:
        return "•" * len(value)
    return "••••" + value[-4:]


# --- Config schemas ---

class ShareConfigUpdate(BaseModel):
    """Write-side payload for share COS config."""
    bucket: Optional[str] = Field(default=None, max_length=128)
    region: Optional[str] = Field(default=None, max_length=32)
    secret_id: Optional[str] = Field(default=None, max_length=128)
    secret_key: Optional[str] = Field(default=None, max_length=256)
    path_prefix: Optional[str] = Field(default=None, max_length=256)


class ShareConfigResponse(BaseModel):
    """Read-side payload for share COS config."""
    bucket: str
    region: str
    secret_id_masked: str
    secret_key_masked: str
    has_secret_id: bool
    has_secret_key: bool
    path_prefix: str

    @classmethod
    def from_model(cls, cfg) -> "ShareConfigResponse":
        return cls(
            bucket=cfg.bucket or "",
            region=cfg.region or "",
            secret_id_masked=_mask_secret(cfg.secret_id or ""),
            secret_key_masked=_mask_secret(cfg.secret_key or ""),
            has_secret_id=bool(cfg.secret_id),
            has_secret_key=bool(cfg.secret_key),
            path_prefix=cfg.path_prefix or "",
        )


# --- Shared file schemas ---

class SharedFileResponse(BaseModel):
    id: int
    file_id: int
    file_name: str
    object_key: str
    cos_url: str
    size_bytes: int
    shared_at: datetime

    @classmethod
    def from_model(cls, rec) -> "SharedFileResponse":
        return cls(
            id=rec.id,
            file_id=rec.file_id,
            file_name=rec.file_name,
            object_key=rec.object_key,
            cos_url=rec.cos_url,
            size_bytes=rec.size_bytes,
            shared_at=_as_utc(rec.shared_at),
        )

    class Config:
        from_attributes = True


class ShareRequest(BaseModel):
    """Request body for sharing one or more files."""
    file_ids: List[int] = Field(..., min_length=1, max_length=100)


class ShareResponse(BaseModel):
    """Result of a share operation."""
    shared: List[SharedFileResponse]
    errors: List[dict]  # [{"file_id": int, "message": str}]


class UnshareResponse(BaseModel):
    """Result of an unshare (cancel share) operation."""
    status: str  # success | failed
    message: str

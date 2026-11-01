"""Pydantic schemas for the COS backup feature.

Split into three shapes:

* ``BackupConfigUpdate``: the write-side. All fields optional — the
  frontend can PATCH just what changed. The validator below enforces
  the "HH:MM" shape for ``schedule_time`` because a native
  ``<input type="time">`` already emits it, so a looser regex would
  only let through bad manual payloads.

* ``BackupConfigResponse``: the read-side. Secrets are returned as
  masked strings (only the last 4 chars) so the settings page can show
  "is something configured?" without ever re-displaying the key. The
  client sends the full value again when it wants to change it.

* ``BackupRecordResponse``: a single row of the history table.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field, field_validator


_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Ensure a datetime we read from the DB carries UTC tzinfo.

    Backend code always writes ``datetime.now(timezone.utc)``, but the
    SQLite driver (pysqlite / aiosqlite) strips tzinfo on the way back
    out — so rows read from disk come back as *naive* datetimes that
    nevertheless hold UTC wall-clock values. Serializing those as-is
    yields an ISO string without a tz suffix, which JavaScript's
    ``new Date()`` then interprets as *local* time, shifting the
    displayed "Last run" by the user's UTC offset.

    Attaching ``tzinfo=utc`` here makes Pydantic emit ``...+00:00``
    and lets the frontend render local time correctly via
    ``toLocaleString()``. Rows that already have tzinfo (e.g. future
    Postgres-backed deployments) pass through unchanged.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _mask_secret(value: str) -> str:
    """Return a masked representation suitable for display.

    Empty string stays empty (so the frontend can show "not configured").
    Short values (< 8 chars) are fully masked — showing even 4 chars of
    an 8-char secret leaks half of it. Long values keep the last 4 chars
    preceded by a fixed-width ``••••`` so the control looks stable as
    the user types.
    """
    if not value:
        return ""
    if len(value) < 8:
        return "•" * len(value)
    return "••••" + value[-4:]


class BackupConfigUpdate(BaseModel):
    """Write-side payload. Every field optional so the settings page can
    PATCH just the things the user touched.
    """

    bucket: Optional[str] = Field(default=None, max_length=128)
    region: Optional[str] = Field(default=None, max_length=32)
    secret_id: Optional[str] = Field(default=None, max_length=128)
    # ``None`` → don't change; ``""`` → user explicitly cleared the
    # field. We distinguish because the settings page returns masked
    # values on read, so the client only sends ``secret_key`` when the
    # user actually retyped it.
    secret_key: Optional[str] = Field(default=None, max_length=256)
    path_prefix: Optional[str] = Field(default=None, max_length=256)
    enabled: Optional[bool] = None
    schedule_time: Optional[str] = Field(default=None, max_length=5)

    @field_validator("schedule_time")
    @classmethod
    def _validate_time(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not _TIME_RE.match(v):
            raise ValueError("schedule_time must be in HH:MM format")
        return v


class BackupConfigResponse(BaseModel):
    """Read-side payload. ``secret_id`` / ``secret_key`` come back
    masked — enough for the UI to tell the user "a key is configured"
    without ever echoing the clear value.
    """

    bucket: str
    region: str
    secret_id_masked: str
    secret_key_masked: str
    # Convenience flags so the frontend doesn't have to re-derive
    # "is anything set?" from the masked strings.
    has_secret_id: bool
    has_secret_key: bool
    path_prefix: str
    enabled: bool
    schedule_time: str

    last_status: Optional[str]
    last_run_at: Optional[datetime]
    last_object_key: Optional[str]
    last_size_bytes: Optional[int]
    last_message: Optional[str]

    @classmethod
    def from_model(cls, cfg) -> "BackupConfigResponse":
        return cls(
            bucket=cfg.bucket or "",
            region=cfg.region or "",
            secret_id_masked=_mask_secret(cfg.secret_id or ""),
            secret_key_masked=_mask_secret(cfg.secret_key or ""),
            has_secret_id=bool(cfg.secret_id),
            has_secret_key=bool(cfg.secret_key),
            path_prefix=cfg.path_prefix or "",
            enabled=bool(cfg.enabled),
            schedule_time=cfg.schedule_time or "03:00",
            last_status=cfg.last_status,
            last_run_at=_as_utc(cfg.last_run_at),
            last_object_key=cfg.last_object_key,
            last_size_bytes=cfg.last_size_bytes,
            last_message=cfg.last_message,
        )


class BackupRecordResponse(BaseModel):
    id: int
    trigger: str
    status: str
    object_key: Optional[str]
    size_bytes: Optional[int]
    duration_ms: Optional[int]
    message: Optional[str]
    created_at: datetime

    @classmethod
    def from_model(cls, rec) -> "BackupRecordResponse":
        # Go through an explicit constructor instead of
        # ``model_validate`` so we can run ``created_at`` through
        # ``_as_utc`` — see the docstring there for why SQLite rows
        # need an explicit UTC tag before they hit the JSON
        # serializer. The frontend's ``new Date(...)`` depends on it.
        return cls(
            id=rec.id,
            trigger=rec.trigger,
            status=rec.status,
            object_key=rec.object_key,
            size_bytes=rec.size_bytes,
            duration_ms=rec.duration_ms,
            message=rec.message,
            created_at=_as_utc(rec.created_at),
        )

    class Config:
        from_attributes = True


class BackupRunResponse(BaseModel):
    """Returned by POST /backup/run-now and /backup/test-connection."""

    status: str  # success | failed
    message: str
    object_key: Optional[str] = None
    size_bytes: Optional[int] = None
    duration_ms: Optional[int] = None

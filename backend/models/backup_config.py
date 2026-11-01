"""Persistent configuration + history for the Tencent Cloud COS backup
feature.

Two tables:

* ``backup_config`` is a **singleton** — exactly one row, id=1. We model
  it as a regular table (rather than abusing key-value storage) so the
  fields stay strongly typed and validated via SQLAlchemy + Pydantic.
  The singleton invariant is enforced in the service layer by always
  fetching/updating id=1 and seeding it on first use.

* ``backup_records`` stores the outcome of every backup attempt (manual
  or scheduled). Used to render the history panel on the settings page.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class BackupConfig(Base):
    """Singleton row holding the COS credentials + schedule.

    Secrets (``secret_id`` / ``secret_key``) are stored in plaintext
    because PcapHouse has no user accounts — the DB is already trusted
    local state. If multi-tenant auth lands, migrate these to a
    per-user encrypted store; don't retrofit encryption here in a way
    that pretends the threat model has changed.
    """

    __tablename__ = "backup_config"

    # Always 1. We enforce this in the service layer instead of adding a
    # CHECK constraint so the row can be easily rebuilt if deleted.
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False, default=1)

    # --- COS connection ---
    # ``bucket`` is the full COS bucket name including the appid suffix,
    # e.g. ``my-backups-1250000000``. The appid is mandatory on COS —
    # there's no short form — so we store the full name as shown in
    # the COS console.
    bucket: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    region: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    secret_id: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    secret_key: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    # Optional prefix inside the bucket, e.g. ``pcaphouse/prod``. No
    # leading slash, trailing slash auto-stripped. If empty, uploads go
    # to the bucket root.
    path_prefix: Mapped[str] = mapped_column(String(256), default="", nullable=False)

    # --- Schedule ---
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Daily run time in 24-hour "HH:MM" form, interpreted in the server's
    # local time zone. We use a string rather than splitting into two
    # integer columns so the frontend can bind a native ``<input
    # type="time">`` directly.
    schedule_time: Mapped[str] = mapped_column(String(5), default="03:00", nullable=False)

    # --- Denormalized "last run" snapshot, for fast UI display ---
    # These duplicate the newest row in ``backup_records`` but letting
    # the frontend render the summary panel without a join/aggregation
    # is worth the tiny write cost.
    last_status: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)  # success/failed
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_object_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    last_size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    last_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class BackupRecord(Base):
    """Append-only log of every backup attempt.

    Status values:
      * ``success`` — archive uploaded to COS.
      * ``failed``  — any exception during archive/upload. ``message``
        carries the short error summary.
    """

    __tablename__ = "backup_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # "manual" = triggered by the user via the API button;
    # "scheduled" = triggered by the daily scheduler.
    trigger: Mapped[str] = mapped_column(String(16), default="scheduled", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="success", nullable=False)
    # Present when status == success.
    object_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Seconds spent on the whole run (archive + upload). Rounded.
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

"""Persistent configuration + records for the file sharing feature.

Two tables:

* ``share_config`` is a **singleton** — exactly one row, id=1. Stores
  the COS credentials dedicated to file sharing (separate from the
  backup COS config).

* ``shared_files`` tracks every file that has been shared to COS.
  Each row records the file_id, the COS object key, and the public URL.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ShareConfig(Base):
    """Singleton row holding the COS credentials for the share feature."""

    __tablename__ = "share_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False, default=1)

    # --- COS connection ---
    bucket: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    region: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    secret_id: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    secret_key: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    path_prefix: Mapped[str] = mapped_column(String(256), default="", nullable=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class SharedFile(Base):
    """Records of files shared to COS."""

    __tablename__ = "shared_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_id: Mapped[int] = mapped_column(Integer, ForeignKey("files.id", ondelete="CASCADE"), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    cos_url: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    shared_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

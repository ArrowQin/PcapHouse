from typing import Optional
from datetime import datetime, timezone
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class GenerateTask(Base):
    """Tracks a pcap-generation job.

    Each row corresponds to one user-initiated generation request.
    The pipeline updates *status* as it progresses through stages:
    pending → parsing → capturing → processing → saving → success | failed
    """

    __tablename__ = "generate_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), nullable=False, unique=True, index=True)
    protocol: Mapped[str] = mapped_column(String(32), nullable=False, default="http")

    # Pipeline status: pending | parsing | capturing | processing | saving | success | failed
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    # Network params supplied by the user (or defaults)
    src_ip: Mapped[str] = mapped_column(String(45), nullable=False, default="10.99.1.1")
    dst_ip: Mapped[str] = mapped_column(String(45), nullable=False, default="10.99.1.2")
    port: Mapped[int] = mapped_column(Integer, nullable=False, default=80)
    # Optional explicit source port. NULL / 0 means "let the OS pick an
    # ephemeral port" (the traditional client behaviour). ``dst_port`` falls
    # back to ``port`` when NULL so old rows keep working.
    src_port: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    dst_port: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Raw input from the user
    raw_request: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    raw_response: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # After success, link to the generated File record
    file_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("files.id", ondelete="SET NULL"), nullable=True
    )
    filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Optional organisation metadata forwarded to the File record
    category_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tag_ids_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Relationship (optional, for convenience)
    file = relationship("File", foreign_keys=[file_id], lazy="selectin")

from sqlalchemy import String, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ProtocolConfig(Base):
    """User-curated list of protocol short-names that should be treated as
    "of interest" when auto-identifying a freshly uploaded pcap file.

    Rows in this table represent every protocol the user has opted-in to
    (`enabled=True`) or explicitly opted-out of (`enabled=False`). Protocols
    not present in the table behave as if `enabled=False` — i.e. they still
    show up in the confirmation modal (because sharkd reported them) but are
    left *unchecked* by default.

    The short-name is whatever sharkd's frame summary returns (typically
    lowercase, e.g. `tcp`, `tls`, `http`, `image-jfif`).
    """

    __tablename__ = "protocol_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Protocol short-name as emitted by sharkd. Case-insensitive but stored
    # lowercased so frontend comparisons are trivial.
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Optional free-form note so the user can remember why they toggled
    # something (e.g. "noise — hide by default").
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)

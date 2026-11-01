"""Service layer for the user-curated protocol enable/disable registry.

See `models.protocol_config.ProtocolConfig` for storage semantics.
"""
from __future__ import annotations

from typing import Iterable, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.protocol_config import ProtocolConfig


def _norm(name: str) -> str:
    return (name or "").strip().lower()


async def list_configs(db: AsyncSession) -> List[ProtocolConfig]:
    """Return every protocol-config row, ordered by name for stable UI."""
    res = await db.execute(select(ProtocolConfig).order_by(ProtocolConfig.name))
    return list(res.scalars().all())


async def get_enabled_names(db: AsyncSession) -> List[str]:
    """Return just the lowercased names of protocols currently enabled."""
    res = await db.execute(
        select(ProtocolConfig.name).where(ProtocolConfig.enabled.is_(True))
    )
    return [n for (n,) in res.all()]


async def get_by_name(db: AsyncSession, name: str) -> Optional[ProtocolConfig]:
    res = await db.execute(
        select(ProtocolConfig).where(ProtocolConfig.name == _norm(name))
    )
    return res.scalar_one_or_none()


async def create_config(
    db: AsyncSession,
    name: str,
    enabled: bool = True,
    description: str = "",
) -> ProtocolConfig:
    """Create a new row; no-op (returns existing) if the name already exists."""
    existing = await get_by_name(db, name)
    if existing:
        return existing
    row = ProtocolConfig(name=_norm(name), enabled=enabled, description=description or "")
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def update_config(
    db: AsyncSession,
    config_id: int,
    enabled: Optional[bool] = None,
    description: Optional[str] = None,
) -> Optional[ProtocolConfig]:
    row = await db.get(ProtocolConfig, config_id)
    if not row:
        return None
    if enabled is not None:
        row.enabled = enabled
    if description is not None:
        row.description = description
    await db.commit()
    await db.refresh(row)
    return row


async def delete_config(db: AsyncSession, config_id: int) -> bool:
    row = await db.get(ProtocolConfig, config_id)
    if not row:
        return False
    await db.delete(row)
    await db.commit()
    return True


async def bulk_set_enabled(db: AsyncSession, enabled_names: Iterable[str]) -> List[ProtocolConfig]:
    """Replace the whole enabled-set atomically.

    After this call, every name in `enabled_names` has a row with
    `enabled=True` (created if needed); every other existing row is set to
    `enabled=False`. Rows are never deleted — we keep the description so the
    user's notes survive a toggle-off/on cycle.

    Returns the fresh full list (sorted).
    """
    wanted: set[str] = {_norm(n) for n in enabled_names if _norm(n)}

    existing = {row.name: row for row in await list_configs(db)}

    # Update / create rows for every wanted name.
    for name in wanted:
        row = existing.get(name)
        if row is None:
            row = ProtocolConfig(name=name, enabled=True, description="")
            db.add(row)
            existing[name] = row
        else:
            row.enabled = True

    # Flip everything else to disabled.
    for name, row in existing.items():
        if name not in wanted:
            row.enabled = False

    await db.commit()

    return await list_configs(db)

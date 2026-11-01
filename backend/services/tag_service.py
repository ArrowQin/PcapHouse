from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from models.tag import Tag


async def get_tags(db: AsyncSession) -> List[Tag]:
    result = await db.execute(select(Tag).order_by(Tag.name))
    return list(result.scalars().all())


async def create_tag(db: AsyncSession, name: str, color: str = "#3B82F6") -> Tag:
    tag = Tag(name=name, color=color)
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


async def update_tag(db: AsyncSession, tag_id: int, name: Optional[str] = None, color: Optional[str] = None) -> Optional[Tag]:
    result = await db.execute(select(Tag).where(Tag.id == tag_id))
    tag = result.scalar_one_or_none()
    if not tag:
        return None

    if name is not None:
        tag.name = name
    if color is not None:
        tag.color = color

    await db.commit()
    await db.refresh(tag)
    return tag


async def delete_tag(db: AsyncSession, tag_id: int) -> bool:
    result = await db.execute(select(Tag).where(Tag.id == tag_id))
    tag = result.scalar_one_or_none()
    if not tag:
        return False

    await db.delete(tag)
    await db.commit()
    return True


async def get_tag_by_id(db: AsyncSession, tag_id: int) -> Optional[Tag]:
    result = await db.execute(
        select(Tag).options(selectinload(Tag.files)).where(Tag.id == tag_id)
    )
    return result.scalar_one_or_none()

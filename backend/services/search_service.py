from typing import Optional, List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload

from models.file import File
from models.tag import FileTag


async def search_files(
    db: AsyncSession,
    q: Optional[str] = None,
    category_id: Optional[int] = None,
    tag_ids: Optional[List[int]] = None,
    sort_by: str = "upload_time",
    sort_order: str = "desc",
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[File], int]:
    query = select(File).options(selectinload(File.tags))

    if q:
        # Match the keyword case-insensitively against both the file name
        # and the free-form note. ``note`` has a default of ``""`` but is
        # technically nullable, so historical rows may hold NULL — that's
        # fine: ``ILIKE NULL`` evaluates to NULL and is treated as false
        # in ``WHERE``, which is exactly what we want.
        like = f"%{q}%"
        query = query.where(or_(File.name.ilike(like), File.note.ilike(like)))
    if category_id is not None:
        query = query.where(File.category_id == category_id)
    if tag_ids:
        query = query.join(FileTag).where(FileTag.tag_id.in_(tag_ids))

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Sort — only allow whitelisted columns.
    if sort_by not in ALLOWED_SORT_COLUMNS:
        sort_by = "upload_time"
    sort_column = getattr(File, sort_by, File.upload_time)
    if sort_order == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    files = list(result.scalars().unique().all())

    return files, total

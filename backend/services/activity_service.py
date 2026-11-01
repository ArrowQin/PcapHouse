from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models.activity import Activity


async def log_activity(db: AsyncSession, action: str, file_name: Optional[str] = None, description: str = ""):
    activity = Activity(action=action, file_name=file_name, description=description)
    db.add(activity)
    await db.commit()
    return activity


async def get_recent_activities(db: AsyncSession, limit: int = 20) -> List[Activity]:
    query = select(Activity).order_by(Activity.created_at.desc())
    if limit > 0:
        query = query.limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())

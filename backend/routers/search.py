from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from schemas.file import FileResponse, FileListResponse
from services import search_service

router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=FileListResponse)
async def search(
    q: Optional[str] = Query(None),
    category_id: Optional[int] = Query(None),
    tag_ids: Optional[str] = Query(None),
    sort_by: str = Query("upload_time"),
    sort_order: str = Query("desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    parsed_tag_ids = None
    if tag_ids:
        parsed_tag_ids = [int(t) for t in tag_ids.split(",") if t.strip()]

    files, total = await search_service.search_files(
        db, q=q, category_id=category_id, tag_ids=parsed_tag_ids,
        sort_by=sort_by, sort_order=sort_order, page=page, page_size=page_size,
    )
    return FileListResponse(
        files=[FileResponse.model_validate(f) for f in files],
        total=total,
        page=page,
        page_size=page_size,
    )

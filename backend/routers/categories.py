from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from schemas.category import CategoryCreate, CategoryResponse, CategoryUpdate
from services import category_service

router = APIRouter(prefix="/categories", tags=["categories"])


def _to_response(c) -> CategoryResponse:
    return CategoryResponse(
        id=c.id,
        name=c.name,
        description=c.description,
        is_builtin=bool(getattr(c, "is_builtin", False)),
        file_count=c.file_count,
        created_at=c.created_at,
    )


@router.get("", response_model=list[CategoryResponse])
async def list_categories(db: AsyncSession = Depends(get_db)):
    categories = await category_service.get_categories(db)
    return [_to_response(c) for c in categories]


@router.post("", response_model=CategoryResponse)
async def create_category(data: CategoryCreate, db: AsyncSession = Depends(get_db)):
    category = await category_service.create_category(db, data.name, data.description)
    return _to_response(category)


@router.patch("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: int,
    data: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
):
    try:
        category = await category_service.update_category(
            db, category_id, name=data.name, description=data.description
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return _to_response(category)


@router.delete("/{category_id}")
async def delete_category(category_id: int, db: AsyncSession = Depends(get_db)):
    try:
        success = await category_service.delete_category(db, category_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not success:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category deleted"}

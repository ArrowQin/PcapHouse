from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from models.category import Category
from services.activity_service import log_activity


# Name of the built-in category that stores all pcaps produced by the
# generator feature. It is created automatically on startup and cannot be
# renamed or deleted via the API.
GENERATED_CATEGORY_NAME = "Generated"
GENERATED_CATEGORY_DESCRIPTION = "Pcaps produced by the built-in generator"

# Built-in category for pcaps produced by the Tools → Decapsulate workflow
# (Geneve / VXLAN stripping and future similar transforms). Also system-
# managed, not user-renamable.
DECAPSULATED_CATEGORY_NAME = "Decapsulated"
DECAPSULATED_CATEGORY_DESCRIPTION = (
    "Pcaps produced by the built-in tools (e.g. Geneve/VXLAN decapsulation)"
)


async def get_categories(db: AsyncSession) -> List[Category]:
    result = await db.execute(
        select(Category).options(selectinload(Category.files)).order_by(Category.created_at.desc())
    )
    return list(result.scalars().all())


async def create_category(db: AsyncSession, name: str, description: str = "") -> Category:
    category = Category(name=name, description=description)
    db.add(category)
    await db.commit()
    await db.refresh(category, ["files"])
    await log_activity(db, "create_category", None, f"Created category '{name}'")
    return category


async def update_category(db: AsyncSession, category_id: int, name: Optional[str] = None, description: Optional[str] = None) -> Optional[Category]:
    result = await db.execute(
        select(Category).options(selectinload(Category.files)).where(Category.id == category_id)
    )
    category = result.scalar_one_or_none()
    if not category:
        return None

    # Built-in categories cannot be renamed (description is editable).
    if category.is_builtin and name is not None and name != category.name:
        raise ValueError("Built-in categories cannot be renamed")

    if name is not None:
        category.name = name
    if description is not None:
        category.description = description

    await db.commit()
    await db.refresh(category, ["files"])
    return category


async def delete_category(db: AsyncSession, category_id: int) -> bool:
    result = await db.execute(select(Category).where(Category.id == category_id))
    category = result.scalar_one_or_none()
    if not category:
        return False

    if category.is_builtin:
        raise ValueError("Built-in categories cannot be deleted")

    await log_activity(db, "delete_category", None, f"Deleted category '{category.name}'")
    await db.delete(category)
    await db.commit()
    return True


# ---------------------------------------------------------------------------
# Built-in category helpers
# ---------------------------------------------------------------------------

async def get_generated_category(db: AsyncSession) -> Category:
    """Return the "Generated" built-in category, creating it if absent."""
    result = await db.execute(
        select(Category).where(Category.name == GENERATED_CATEGORY_NAME)
    )
    category = result.scalar_one_or_none()
    if category is not None:
        return category

    category = Category(
        name=GENERATED_CATEGORY_NAME,
        description=GENERATED_CATEGORY_DESCRIPTION,
        is_builtin=True,
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


async def get_decapsulated_category(db: AsyncSession) -> Category:
    """Return the "Decapsulated" built-in category, creating it if absent.

    Pcaps produced by the Tools → Decapsulate workflow (Geneve/VXLAN
    stripping) land here so the user can find all tool output in one
    place. Like "Generated", this category is system-managed: it cannot
    be renamed or deleted via the API.
    """
    result = await db.execute(
        select(Category).where(Category.name == DECAPSULATED_CATEGORY_NAME)
    )
    category = result.scalar_one_or_none()
    if category is not None:
        return category

    category = Category(
        name=DECAPSULATED_CATEGORY_NAME,
        description=DECAPSULATED_CATEGORY_DESCRIPTION,
        is_builtin=True,
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


async def ensure_builtin_categories(db: AsyncSession) -> None:
    """Seed all system-managed categories. Called at application startup."""
    await get_generated_category(db)
    await get_decapsulated_category(db)

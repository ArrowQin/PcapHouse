from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from config import settings


def _ensure_sqlite_dir(url: str) -> None:
    """If DATABASE_URL points at a SQLite file, make sure its directory
    exists before SQLAlchemy tries to open it.

    Matters for the docker-compose deployment where DATABASE_URL is set to
    ``sqlite+aiosqlite:////app/db/pcaphouse.db`` and ``/app/db`` is a
    volume mount — if the volume hadn't been created yet SQLite would
    blow up with ``unable to open database file``. For non-SQLite URLs
    (postgres, mysql, …) this is a no-op.
    """
    import os

    prefix = "sqlite"
    if not url.startswith(prefix):
        return
    # Strip "sqlite[+driver]://" → path. Four slashes means absolute
    # path; three slashes means relative (to CWD).
    _, _, path = url.partition("://")
    # path now looks like "/app/db/pcaphouse.db" (abs, originally ////...)
    # or "./pcaphouse.db" (relative).
    if not path or path == ":memory:":
        return
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)


_ensure_sqlite_dir(settings.DATABASE_URL)

engine = create_async_engine(settings.DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        yield session


# -----------------------------------------------------------------------------
# Lightweight, idempotent SQLite "migrations"
# -----------------------------------------------------------------------------
# We don't use Alembic (overkill for this project), so whenever a column is
# added to an existing model we also list it here. On startup we inspect the
# live schema and ALTER TABLE any missing columns in. Each entry is
# (table_name, column_name, column_ddl).
_SCHEMA_PATCHES: list[tuple[str, str, str]] = [
    ("generate_tasks", "src_port", "src_port INTEGER"),
    ("generate_tasks", "dst_port", "dst_port INTEGER"),
]


async def _apply_schema_patches(conn) -> None:
    for table, column, ddl in _SCHEMA_PATCHES:
        # Skip tables that don't exist yet — create_all will build them.
        exists = await conn.execute(
            text(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=:t"
            ),
            {"t": table},
        )
        if exists.scalar() is None:
            continue
        # PRAGMA table_info is the canonical way to list columns in SQLite.
        rows = await conn.execute(text(f"PRAGMA table_info({table})"))
        existing_cols = {row[1] for row in rows.all()}
        if column in existing_cols:
            continue
        await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _apply_schema_patches(conn)


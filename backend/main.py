import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import init_db
from routers import files, categories, tags, search, pcap, protocols, generator, tools, backup, share
from services.sharkd_service import sharkd_pool
from services import activity_service
from services.backup_scheduler import scheduler as backup_scheduler
from database import get_db, async_session  # noqa: F401 — get_db used by router dependencies

# Import models to register them with Base
import models  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    await init_db()

    # Seed system-managed ("built-in") categories, e.g. "Generated".
    from services.category_service import ensure_builtin_categories
    async with async_session() as db:
        await ensure_builtin_categories(db)

    await sharkd_pool.start()
    # Start the daily COS-backup scheduler. It no-ops internally until
    # the user saves a valid config with ``enabled=True``, so it's safe
    # to always start — no cost in the default unconfigured state.
    await backup_scheduler.start()
    yield
    # Shutdown
    await backup_scheduler.stop()
    await sharkd_pool.stop()


app = FastAPI(
    title="PcapHouse API",
    description="Pcap file management repository with Wireshark viewer",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers under /api prefix
app.include_router(files.router, prefix="/api")
app.include_router(categories.router, prefix="/api")
app.include_router(tags.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(pcap.router, prefix="/api")
app.include_router(protocols.router, prefix="/api")
app.include_router(generator.router, prefix="/api")
app.include_router(tools.router, prefix="/api")
app.include_router(backup.router, prefix="/api")
app.include_router(share.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok", "sharkd_available": sharkd_pool.available}


@app.get("/api/storage")
async def storage_info():
    async with async_session() as db:
        from services.file_service import get_storage_info
        storage = await get_storage_info(db)
        return storage


@app.get("/api/activities")
async def get_activities():
    async with async_session() as db:
        activities = await activity_service.get_recent_activities(db, limit=20)
        return [
            {
                "id": a.id,
                "action": a.action,
                "file_name": a.file_name,
                "description": a.description,
                "created_at": a.created_at.isoformat(),
            }
            for a in activities
        ]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

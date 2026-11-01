"""HTTP routes for the COS backup feature.

- ``GET  /api/backup/config``         — read the settings (secrets masked).
- ``PUT  /api/backup/config``         — partial-update the settings.
- ``POST /api/backup/test-connection``— HEAD the bucket with current (or
  pending, if passed in body) credentials. Does not touch local files.
- ``POST /api/backup/run-now``        — trigger an out-of-band backup
  immediately.
- ``GET  /api/backup/history``        — last N records, newest first.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from schemas.backup import (
    BackupConfigResponse,
    BackupConfigUpdate,
    BackupRecordResponse,
    BackupRunResponse,
)
from services import backup_service

router = APIRouter(prefix="/backup", tags=["backup"])


@router.get("/config", response_model=BackupConfigResponse)
async def get_backup_config(db: AsyncSession = Depends(get_db)):
    cfg = await backup_service.get_or_create_config(db)
    return BackupConfigResponse.from_model(cfg)


@router.put("/config", response_model=BackupConfigResponse)
async def update_backup_config(
    data: BackupConfigUpdate, db: AsyncSession = Depends(get_db)
):
    # Pydantic's ``model_dump(exclude_unset=True)`` is exactly the
    # "only send what changed" semantics we want — fields the client
    # didn't include stay as ``None`` and the service treats ``None``
    # as "don't touch".
    cfg = await backup_service.update_config(
        db, **data.model_dump(exclude_unset=True)
    )
    return BackupConfigResponse.from_model(cfg)


@router.post("/test-connection", response_model=BackupRunResponse)
async def test_connection(db: AsyncSession = Depends(get_db)):
    """HEAD the bucket using the currently-saved credentials.

    The frontend is expected to PUT any in-flight edits first (so the
    user tests what they just typed), which matches the "Save, then
    Test" pattern used elsewhere in the app.
    """
    cfg = await backup_service.get_or_create_config(db)
    outcome = await backup_service.test_connection(cfg)
    return BackupRunResponse(
        status=outcome.status,
        message=outcome.message,
        object_key=outcome.object_key,
        size_bytes=outcome.size_bytes,
        duration_ms=outcome.duration_ms,
    )


@router.post("/run-now", response_model=BackupRunResponse)
async def run_now(db: AsyncSession = Depends(get_db)):
    """Trigger an immediate backup.

    Useful for sanity-checking COS credentials + the archive pipeline
    without waiting until 03:00. Records are written to the same
    history table as scheduled runs.
    """
    outcome = await backup_service.run_backup(db, trigger="manual")
    return BackupRunResponse(
        status=outcome.status,
        message=outcome.message,
        object_key=outcome.object_key,
        size_bytes=outcome.size_bytes,
        duration_ms=outcome.duration_ms,
    )


@router.get("/history", response_model=list[BackupRecordResponse])
async def get_history(limit: int = 20, db: AsyncSession = Depends(get_db)):
    # Clamp the limit so a typo doesn't accidentally pull the whole
    # table into memory.
    limit = max(1, min(limit, 200))
    records = await backup_service.list_records(db, limit=limit)
    return [BackupRecordResponse.from_model(r) for r in records]

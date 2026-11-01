"""HTTP routes for the file sharing feature.

- ``GET  /api/share/config``         — read COS config (secrets masked).
- ``PUT  /api/share/config``         — partial-update COS config.
- ``POST /api/share/test-connection``— test COS connectivity.
- ``POST /api/share/files``          — share one or more files to COS.
- ``GET  /api/share/files``          — list all shared files.
- ``DELETE /api/share/files/{id}``   — cancel sharing (delete from COS).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from schemas.share import (
    ShareConfigResponse,
    ShareConfigUpdate,
    ShareRequest,
    ShareResponse,
    SharedFileResponse,
    UnshareResponse,
)
from services import share_service

router = APIRouter(prefix="/share", tags=["share"])


@router.get("/config", response_model=ShareConfigResponse)
async def get_share_config(db: AsyncSession = Depends(get_db)):
    cfg = await share_service.get_or_create_config(db)
    return ShareConfigResponse.from_model(cfg)


@router.put("/config", response_model=ShareConfigResponse)
async def update_share_config(
    data: ShareConfigUpdate, db: AsyncSession = Depends(get_db)
):
    cfg = await share_service.update_config(
        db, **data.model_dump(exclude_unset=True)
    )
    return ShareConfigResponse.from_model(cfg)


@router.post("/test-connection")
async def test_connection(db: AsyncSession = Depends(get_db)):
    cfg = await share_service.get_or_create_config(db)
    status, message = await share_service.test_connection(cfg)
    return {"status": status, "message": message}


@router.post("/files", response_model=ShareResponse)
async def share_files(data: ShareRequest, db: AsyncSession = Depends(get_db)):
    shared, errors = await share_service.share_files(db, data.file_ids)
    return ShareResponse(
        shared=[SharedFileResponse.from_model(r) for r in shared],
        errors=errors,
    )


@router.get("/files", response_model=list[SharedFileResponse])
async def list_shared_files(db: AsyncSession = Depends(get_db)):
    records = await share_service.list_shared_files(db)
    return [SharedFileResponse.from_model(r) for r in records]


@router.delete("/files/{share_id}", response_model=UnshareResponse)
async def unshare_file(share_id: int, db: AsyncSession = Depends(get_db)):
    status, message = await share_service.unshare_file(db, share_id)
    if status == "failed" and "not found" in message.lower():
        raise HTTPException(status_code=404, detail=message)
    return UnshareResponse(status=status, message=message)

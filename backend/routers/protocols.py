"""HTTP routes for the protocol-identification configuration.

- `GET /api/protocols/catalog` — full sharkd protocol list (cached per process).
- `GET /api/protocols/configs` — user-defined enable/disable rows.
- `GET /api/protocols/enabled` — shortcut: just the names currently enabled.
- `POST /api/protocols/configs` — add one row (normally not needed — use bulk).
- `PATCH /api/protocols/configs/{id}` — toggle enabled / edit description.
- `DELETE /api/protocols/configs/{id}` — remove a row.
- `PUT /api/protocols/configs/bulk` — replace the whole enabled-set at once.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from schemas.protocol_config import (
    ProtocolCatalogResponse,
    ProtocolConfigBulkSet,
    ProtocolConfigCreate,
    ProtocolConfigResponse,
    ProtocolConfigUpdate,
)
from services import protocol_config_service
from services.sharkd_service import sharkd_pool

router = APIRouter(prefix="/protocols", tags=["protocols"])


@router.get("/catalog", response_model=ProtocolCatalogResponse)
async def get_protocol_catalog():
    """Return the full list of protocol short-names sharkd knows about.

    Result is cached in the sharkd pool for the process lifetime — the first
    request incurs one round-trip to sharkd (~ms), subsequent are O(1).
    """
    names, cached = await sharkd_pool.get_protocol_catalog()
    return ProtocolCatalogResponse(protocols=names, cached=cached)


@router.get("/configs", response_model=list[ProtocolConfigResponse])
async def list_protocol_configs(db: AsyncSession = Depends(get_db)):
    rows = await protocol_config_service.list_configs(db)
    return [ProtocolConfigResponse.model_validate(r) for r in rows]


@router.get("/enabled", response_model=list[str])
async def list_enabled_protocols(db: AsyncSession = Depends(get_db)):
    """Return just the lowercased names of currently-enabled protocols."""
    return await protocol_config_service.get_enabled_names(db)


@router.post("/configs", response_model=ProtocolConfigResponse)
async def create_protocol_config(
    data: ProtocolConfigCreate, db: AsyncSession = Depends(get_db)
):
    row = await protocol_config_service.create_config(
        db, name=data.name, enabled=data.enabled, description=data.description
    )
    return ProtocolConfigResponse.model_validate(row)


@router.patch("/configs/{config_id}", response_model=ProtocolConfigResponse)
async def update_protocol_config(
    config_id: int,
    data: ProtocolConfigUpdate,
    db: AsyncSession = Depends(get_db),
):
    row = await protocol_config_service.update_config(
        db, config_id, enabled=data.enabled, description=data.description
    )
    if not row:
        raise HTTPException(status_code=404, detail="Protocol config not found")
    return ProtocolConfigResponse.model_validate(row)


@router.delete("/configs/{config_id}")
async def delete_protocol_config(config_id: int, db: AsyncSession = Depends(get_db)):
    ok = await protocol_config_service.delete_config(db, config_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Protocol config not found")
    return {"message": "Protocol config deleted"}


@router.put("/configs/bulk", response_model=list[ProtocolConfigResponse])
async def bulk_set_protocol_configs(
    data: ProtocolConfigBulkSet, db: AsyncSession = Depends(get_db)
):
    """Atomically replace the entire enabled-set.

    Every name in `enabled_names` becomes enabled (rows created if missing);
    every other existing row is disabled. Rows are never deleted by this
    endpoint so user-authored descriptions survive a toggle cycle.
    """
    rows = await protocol_config_service.bulk_set_enabled(db, data.enabled_names)
    return [ProtocolConfigResponse.model_validate(r) for r in rows]

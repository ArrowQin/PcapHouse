"""Generator API — create pcap files from raw protocol data.

Endpoints:
    POST /api/generator/generate   – kick off a new generation task
    GET  /api/generator/tasks      – list recent tasks
    GET  /api/generator/tasks/{id} – single task status
    GET  /api/generator/protocols  – supported protocol list
"""

from __future__ import annotations

import json
import uuid as _uuid
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.generate_task import GenerateTask
from schemas.generator import (
    GenerateRequest,
    GenerateTaskResponse,
    SupportedProtocolResponse,
)
from services.protocol_handlers import get_handler, list_protocols
from services.pcap_generator_service import generate_pcap

router = APIRouter(prefix="/generator", tags=["generator"])


# ---- POST /generate ----

@router.post("/generate", response_model=GenerateTaskResponse)
async def start_generate(
    req: GenerateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Create a new pcap generation task.

    The heavy lifting runs in the background; the endpoint returns the task
    immediately in *pending* status.  The frontend can poll ``/tasks/{id}``
    for progress updates.
    """
    handler = get_handler(req.protocol)
    if handler is None:
        raise HTTPException(status_code=400, detail=f"Unsupported protocol: {req.protocol}")

    if not req.raw_request.strip() and not req.raw_response.strip():
        raise HTTPException(
            status_code=400,
            detail="At least one of raw_request or raw_response must be provided",
        )

    task = GenerateTask(
        uuid=str(_uuid.uuid4()),
        protocol=req.protocol,
        status="pending",
        src_ip=req.src_ip,
        dst_ip=req.dst_ip,
        port=req.port,
        src_port=req.src_port,
        dst_port=req.dst_port,
        raw_request=req.raw_request or None,
        raw_response=req.raw_response or None,
        filename=req.filename,
        category_id=req.category_id,
        tag_ids_json=json.dumps(req.tag_ids) if req.tag_ids else None,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    # Run the pipeline in the background so we can return the task immediately.
    background_tasks.add_task(_run_pipeline, task.id)

    return GenerateTaskResponse.model_validate(task)


async def _run_pipeline(task_id: int) -> None:
    """Background-task wrapper that opens its own DB session."""
    from database import async_session

    async with async_session() as db:
        result = await db.execute(
            select(GenerateTask).where(GenerateTask.id == task_id)
        )
        task = result.scalar_one_or_none()
        if task is None:
            return
        await generate_pcap(db, task)


# ---- GET /tasks ----

@router.get("/tasks", response_model=List[GenerateTaskResponse])
async def list_tasks(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Return the most recent generation tasks, newest first."""
    result = await db.execute(
        select(GenerateTask)
        .order_by(GenerateTask.created_at.desc())
        .limit(limit)
    )
    tasks = result.scalars().all()
    return [GenerateTaskResponse.model_validate(t) for t in tasks]


# ---- GET /tasks/{task_id} ----

@router.get("/tasks/{task_id}", response_model=GenerateTaskResponse)
async def get_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Return a single task by ID."""
    result = await db.execute(
        select(GenerateTask).where(GenerateTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return GenerateTaskResponse.model_validate(task)


# ---- GET /protocols ----

@router.get("/protocols", response_model=List[SupportedProtocolResponse])
async def supported_protocols():
    """List all protocol handlers registered in the system."""
    protos = list_protocols()
    return [SupportedProtocolResponse(**p) for p in protos]

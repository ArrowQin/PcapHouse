"""Tools API — small pcap-processing utilities that run synchronously.

Currently exposes:
    POST /api/tools/decapsulate  — strip Geneve / VXLAN layers from a pcap

The endpoint accepts a **direct upload** of the pcap to decapsulate. The
uploaded bytes are processed entirely in memory — we never persist the
source file, only the decapsulated output (which is ingested into the
built-in "Decapsulated" category so it appears in the normal Files UI).

This is by design: the Decapsulate tool is transformational, so users
don't want a copy of the raw encapsulated capture hanging around in the
library.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from schemas.file import FileResponse
from services.decap_service import DecapOptions, decapsulate_bytes

router = APIRouter(prefix="/tools", tags=["tools"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class DecapsulateStats(BaseModel):
    total: int
    stripped_geneve: int
    stripped_vxlan: int
    stripped_both: int
    passthrough: int
    errors: int
    warnings: List[str]


class DecapsulateResponse(BaseModel):
    file: FileResponse
    stats: DecapsulateStats


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

# Upper bound on input size. Decap is an in-memory operation (we keep the
# whole parsed packet list in RAM), so we reject very large uploads up
# front to avoid OOM'ing the server. 512 MB matches the sizes the rest
# of the app is typically asked to handle.
_MAX_UPLOAD_BYTES = 512 * 1024 * 1024


@router.post("/decapsulate", response_model=DecapsulateResponse)
async def decapsulate(
    file: UploadFile = File(..., description="Pcap / pcapng file to decapsulate"),
    strip_geneve: bool = Form(True),
    geneve_port: int = Form(6081),
    strip_vxlan: bool = Form(True),
    vxlan_port: int = Form(4789),
    filename: Optional[str] = Form(
        None,
        description="Optional output filename; defaults to '<src>.decap.pcap'",
    ),
    db: AsyncSession = Depends(get_db),
):
    """Strip outer Geneve/VXLAN layers from an uploaded pcap.

    The source upload is processed in memory and discarded; only the
    decapsulated result is persisted (under the built-in "Decapsulated"
    category). The response includes the created File record (so the UI
    can link straight to it in the PcapViewer) plus per-category strip
    counts.
    """
    # ---- Validation -------------------------------------------------------
    if not (strip_geneve or strip_vxlan):
        raise HTTPException(
            status_code=400,
            detail="At least one of strip_geneve / strip_vxlan must be enabled",
        )
    if not (1 <= geneve_port <= 65535):
        raise HTTPException(status_code=400, detail="geneve_port out of range")
    if not (1 <= vxlan_port <= 65535):
        raise HTTPException(status_code=400, detail="vxlan_port out of range")

    # ---- Read upload into memory, bounded ---------------------------------
    # We stream-read with a hard cap so a hostile / oversized upload can't
    # exhaust server memory. UploadFile's SpooledTemporaryFile handles
    # backing storage for us; we just need the bytes.
    raw = await file.read(_MAX_UPLOAD_BYTES + 1)
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Uploaded file exceeds {_MAX_UPLOAD_BYTES // (1024*1024)} MB limit",
        )
    # Make sure the underlying temp file is released promptly — we have
    # everything we need in `raw` now.
    await file.close()

    source_name = file.filename or "uploaded.pcap"

    opts = DecapOptions(
        strip_geneve=strip_geneve,
        geneve_port=geneve_port,
        strip_vxlan=strip_vxlan,
        vxlan_port=vxlan_port,
    )

    try:
        new_file, stats = await decapsulate_bytes(
            db,
            source_bytes=raw,
            source_name=source_name,
            opts=opts,
            out_filename=filename,
        )
    except ValueError as e:
        # Format errors / empty input — surface as 400 so the UI shows the
        # actual message instead of a generic 500.
        raise HTTPException(status_code=400, detail=str(e))

    return DecapsulateResponse(
        file=FileResponse.model_validate(new_file),
        stats=DecapsulateStats(
            total=stats.total,
            stripped_geneve=stats.stripped_geneve,
            stripped_vxlan=stats.stripped_vxlan,
            stripped_both=stats.stripped_both,
            passthrough=stats.passthrough,
            errors=stats.errors,
            warnings=stats.warnings,
        ),
    )

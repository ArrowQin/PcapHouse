from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from schemas.pcap import FrameListResponse, PcapFrameResponse, FrameDetailResponse, HexDumpResponse, ProtocolNodeResponse
from services.sharkd_service import sharkd_pool
from services import file_service

router = APIRouter(prefix="/pcap", tags=["pcap"])


def _check_sharkd():
    if not sharkd_pool.available:
        raise HTTPException(
            status_code=503,
            detail="Sharkd is not available. Please install Wireshark and ensure sharkd is in PATH.",
        )


@router.get("/status")
async def sharkd_status():
    """Check if sharkd is available."""
    return {"available": sharkd_pool.available}


@router.get("/{file_id}/frames", response_model=FrameListResponse)
async def get_frames(
    file_id: int,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    filter: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    _check_sharkd()

    file = await file_service.get_file_by_id(db, file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    client = await sharkd_pool.get_client()
    if not client:
        raise HTTPException(status_code=503, detail="No sharkd instances available")

    try:
        result = await client.get_frames(file.file_path, offset, limit, filter)
        frames = [PcapFrameResponse(**f) for f in result["frames"]]
        return FrameListResponse(frames=frames, total=result["total"])
    finally:
        sharkd_pool.release_client()


@router.get("/{file_id}/frame/{frame_num}", response_model=FrameDetailResponse)
async def get_frame_detail(
    file_id: int,
    frame_num: int,
    db: AsyncSession = Depends(get_db),
):
    _check_sharkd()

    file = await file_service.get_file_by_id(db, file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    client = await sharkd_pool.get_client()
    if not client:
        raise HTTPException(status_code=503, detail="No sharkd instances available")

    try:
        result = await client.get_frame_detail(file.file_path, frame_num)
        if not result:
            raise HTTPException(status_code=500, detail="Failed to get frame detail")

        def parse_nodes(nodes: list) -> list[ProtocolNodeResponse]:
            return [
                ProtocolNodeResponse(
                    label=n["label"], field=n["field"], value=n["value"],
                    children=parse_nodes(n.get("children", [])),
                )
                for n in nodes
            ]

        return FrameDetailResponse(
            number=result["number"],
            protocols=parse_nodes(result["protocols"]),
        )
    finally:
        sharkd_pool.release_client()


@router.get("/{file_id}/hexdump/{frame_num}", response_model=HexDumpResponse)
async def get_hex_dump(
    file_id: int,
    frame_num: int,
    db: AsyncSession = Depends(get_db),
):
    _check_sharkd()

    file = await file_service.get_file_by_id(db, file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    client = await sharkd_pool.get_client()
    if not client:
        raise HTTPException(status_code=503, detail="No sharkd instances available")

    try:
        result = await client.get_hex_dump(file.file_path, frame_num)
        if not result:
            raise HTTPException(status_code=500, detail="Failed to get hex dump")
        return HexDumpResponse(**result)
    finally:
        sharkd_pool.release_client()

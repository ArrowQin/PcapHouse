import io
import os
import re
import zipfile
from typing import List, Optional

from fastapi import APIRouter, Depends, UploadFile, File, Query, HTTPException
from fastapi.responses import FileResponse as FastAPIFileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from schemas.file import (
    FileResponse,
    FileListResponse,
    FileUpdate,
    ProtocolSummaryPreview,
    ProtocolSummaryUpdate,
    UploadResponse,
)
from services import file_service

router = APIRouter(prefix="/files", tags=["files"])


# ---------------------------------------------------------------------------
# Bulk-action request bodies
# ---------------------------------------------------------------------------

class BulkIdsRequest(BaseModel):
    """Payload for bulk download / delete — a plain list of file ids."""

    ids: List[int] = Field(..., min_length=1, max_length=500)


class BulkDeleteResponse(BaseModel):
    deleted: List[int]
    missing: List[int]


@router.get("", response_model=FileListResponse)
async def list_files(
    q: Optional[str] = Query(None),
    category_id: Optional[int] = Query(None),
    category_ids: Optional[str] = Query(
        None,
        description="Comma-separated category ids, e.g. '1,2,3'. Takes precedence over category_id when provided.",
    ),
    tag_ids: Optional[str] = Query(None),
    is_favorite: Optional[bool] = Query(None),
    file_type: Optional[str] = Query(
        None,
        description="Comma-separated file extensions to filter, e.g. 'pcap' or 'pcap,pcapng'",
    ),
    protocols: Optional[str] = Query(
        None,
        description=(
            "Comma-separated protocol short-names (e.g. 'tcp,tls,http2'). "
            "A file is kept if ANY requested protocol appears in its "
            "protocol_summary. Matching is case-insensitive and uses "
            "whole-token boundaries so 'tcp' won't match 'tcpdump'."
        ),
    ),
    sort_by: str = Query("upload_time"),
    sort_order: str = Query("desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    parsed_tag_ids = None
    if tag_ids:
        parsed_tag_ids = [int(t) for t in tag_ids.split(",") if t.strip()]

    # Prefer multi-select `category_ids` when provided; fall back to the
    # legacy single-value `category_id` param for backwards compatibility.
    parsed_category_ids: Optional[list] = None
    if category_ids:
        parsed_category_ids = [int(c) for c in category_ids.split(",") if c.strip()]
    elif category_id is not None:
        parsed_category_ids = [category_id]

    parsed_protocols: Optional[list] = None
    if protocols:
        parsed_protocols = [p.strip() for p in protocols.split(",") if p.strip()]

    files, total = await file_service.get_files(
        db, q=q, category_ids=parsed_category_ids, tag_ids=parsed_tag_ids,
        is_favorite=is_favorite, file_type=file_type,
        protocols=parsed_protocols,
        sort_by=sort_by, sort_order=sort_order,
        page=page, page_size=page_size,
    )
    return FileListResponse(
        files=[FileResponse.model_validate(f) for f in files],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/protocols/used", response_model=list[str])
async def list_used_protocols(db: AsyncSession = Depends(get_db)):
    """Return all protocol short-names that appear in any file's summary.

    Used by the Files page's protocol filter dropdown. Must be declared
    BEFORE the `/{file_id}` route below, otherwise FastAPI will try to
    interpret "protocols" as a file id and return 422.
    """
    return await file_service.get_used_protocols(db)


@router.get("/protocols/distribution", response_model=list[dict])
async def protocol_distribution(db: AsyncSession = Depends(get_db)):
    """Return the library-wide protocol distribution.

    Response shape: ``[{"name": "tcp", "count": 42}, ...]`` sorted by
    ``count`` desc, then ``name`` asc. Each file contributes +1 to every
    distinct protocol in its ``protocol_summary`` (duplicated tokens
    within a single file's summary are collapsed), so the values read as
    "number of files that contain this protocol".

    Used by the Dashboard's Protocol Distribution donut chart. Must be
    declared BEFORE the `/{file_id}` route so FastAPI doesn't interpret
    "protocols" as a file id.
    """
    return await file_service.get_protocol_distribution(db)


# ---------------------------------------------------------------------------
# Bulk actions — MUST be declared before `/{file_id}` so FastAPI doesn't try
# to route "/files/bulk/*" as if "bulk" were an integer file id.
# ---------------------------------------------------------------------------

# Max files per bulk op. Mirrors the `BulkIdsRequest.ids` cap and protects
# the server from a client accidentally asking for thousands of files at once.
_BULK_MAX = 500


def _safe_zip_name(name: str, taken: set) -> str:
    """Return a filename safe to use as a zip archive entry.

    - Strips path separators (defense-in-depth against traversal even
      though we build the archive server-side from trusted paths).
    - Resolves collisions by appending " (2)", " (3)", ... so all files
      survive the download even when the library contains duplicates.
    """
    base = os.path.basename(name or "unnamed")
    base = re.sub(r"[\\/]+", "_", base).strip() or "unnamed"

    if base not in taken:
        taken.add(base)
        return base

    stem, ext = os.path.splitext(base)
    i = 2
    while True:
        candidate = f"{stem} ({i}){ext}"
        if candidate not in taken:
            taken.add(candidate)
            return candidate
        i += 1


@router.post("/bulk/download")
async def bulk_download(payload: BulkIdsRequest, db: AsyncSession = Depends(get_db)):
    """Stream the selected files as a single zip archive.

    - Files that no longer exist on disk are silently skipped (they'd be
      broken entries anyway). At least one file must be zippable,
      otherwise we return 404 so the UI can show a clear error.
    - Zipping is done with `ZIP_STORED` (no compression): pcap payloads
      are essentially incompressible, so compressing only burns CPU
      without reducing size.
    """
    if len(payload.ids) > _BULK_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files requested (max {_BULK_MAX})",
        )

    files = []
    for fid in payload.ids:
        f = await file_service.get_file_by_id(db, fid)
        if f and os.path.exists(f.file_path):
            files.append(f)

    if not files:
        raise HTTPException(
            status_code=404,
            detail="No selected files are available for download",
        )

    buf = io.BytesIO()
    taken: set = set()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_STORED) as zf:
        for f in files:
            arcname = _safe_zip_name(f.name, taken)
            zf.write(f.file_path, arcname=arcname)
    buf.seek(0)

    # Give the archive a human-ish default name; the browser will override
    # this if the user picks a destination manually.
    archive_name = (
        f"pcaphouse_{files[0].name}.zip"
        if len(files) == 1
        else f"pcaphouse_{len(files)}_files.zip"
    )

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{archive_name}"',
            "Content-Length": str(buf.getbuffer().nbytes),
        },
    )


@router.post("/bulk/delete", response_model=BulkDeleteResponse)
async def bulk_delete(payload: BulkIdsRequest, db: AsyncSession = Depends(get_db)):
    """Delete multiple files in one call.

    Returns the ids actually removed (`deleted`) and ids that didn't
    exist (`missing`). Errors on individual files don't abort the batch —
    the client can report how many succeeded.
    """
    if len(payload.ids) > _BULK_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files requested (max {_BULK_MAX})",
        )

    deleted: List[int] = []
    missing: List[int] = []
    # De-dupe while preserving order — helps if the client sends the same
    # id twice for any reason.
    seen: set = set()
    for fid in payload.ids:
        if fid in seen:
            continue
        seen.add(fid)
        ok = await file_service.delete_file(db, fid)
        (deleted if ok else missing).append(fid)

    return BulkDeleteResponse(deleted=deleted, missing=missing)


@router.get("/{file_id}", response_model=FileResponse)
async def get_file(file_id: int, db: AsyncSession = Depends(get_db)):
    file = await file_service.get_file_by_id(db, file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse.model_validate(file)


@router.post("/upload", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    category_id: Optional[int] = Query(None),
    tag_ids: Optional[str] = Query(
        None,
        description="Comma-separated tag ids to attach to the uploaded file",
    ),
    note: Optional[str] = Query(
        None,
        description="Optional free-form note set at upload time",
    ),
    db: AsyncSession = Depends(get_db),
):
    parsed_tag_ids = None
    if tag_ids:
        parsed_tag_ids = [int(t) for t in tag_ids.split(",") if t.strip()]
    try:
        db_file = await file_service.upload_file(
            db, file, category_id, parsed_tag_ids, note=note
        )
    except file_service.DuplicateFileError as e:
        # 409 Conflict with a structured body so the frontend can show a
        # useful error and, if desired, jump to the existing file.
        existing = e.existing
        raise HTTPException(
            status_code=409,
            detail={
                "code": "duplicate_file",
                "message": f"File already exists: {existing.name}",
                "existing_id": existing.id,
                "existing_name": existing.name,
            },
        )
    except ValueError as e:
        # Surface validation errors (extension, size) as 400 with the
        # original message so the frontend queue row shows something
        # actionable instead of a generic 500.
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover — defensive
        # Catch-all so unexpected failures (e.g. an old DB with duplicate
        # sha256 rows, a disk-full scenario, a sharkd hiccup during
        # ingestion) don't surface as opaque 500s on the client. We log
        # the full traceback and return the error text.
        import logging, traceback
        logging.getLogger(__name__).error(
            "Upload failed for %s: %s\n%s",
            getattr(file, "filename", "<unknown>"),
            e,
            traceback.format_exc(),
        )
        raise HTTPException(
            status_code=500,
            detail={"code": "upload_failed", "message": str(e) or "Upload failed"},
        )

    # Run sharkd detection but DO NOT persist — the frontend will ask the
    # user to confirm the result via PATCH /files/{id}/protocol-summary.
    suggested = await file_service._extract_protocol_summary(db_file.file_path)

    return UploadResponse(
        file=FileResponse.model_validate(db_file),
        suggested_summary=suggested,
    )


@router.get("/{file_id}/download")
async def download_file(file_id: int, db: AsyncSession = Depends(get_db)):
    file = await file_service.get_file_by_id(db, file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if not os.path.exists(file.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FastAPIFileResponse(
        file.file_path,
        filename=file.name,
        media_type="application/octet-stream",
    )


@router.delete("/{file_id}")
async def delete_file(file_id: int, db: AsyncSession = Depends(get_db)):
    success = await file_service.delete_file(db, file_id)
    if not success:
        raise HTTPException(status_code=404, detail="File not found")
    return {"message": "File deleted"}


@router.patch("/{file_id}/favorite", response_model=FileResponse)
async def toggle_favorite(file_id: int, db: AsyncSession = Depends(get_db)):
    file = await file_service.toggle_favorite(db, file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse.model_validate(file)


@router.patch("/{file_id}", response_model=FileResponse)
async def update_file(file_id: int, data: FileUpdate, db: AsyncSession = Depends(get_db)):
    # Use model_dump(exclude_unset=True) so we can tell whether the caller
    # actually included `category_id` in the payload (and distinguish
    # "set to null" from "don't touch").
    payload = data.model_dump(exclude_unset=True)

    file = await file_service.get_file_by_id(db, file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    if "name" in payload:
        new_name = (payload["name"] or "").strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="File name cannot be empty")
        try:
            file = await file_service.rename_file(db, file_id, new_name)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if not file:
            raise HTTPException(status_code=404, detail="File not found")

    if "category_id" in payload:
        # Treat explicit null or 0 as "clear category".
        cat_id = payload["category_id"] or None
        file = await file_service.move_file(db, file_id, cat_id)
        if not file:
            raise HTTPException(status_code=404, detail="File not found")

    if "note" in payload:
        # Empty string is a valid "clear note" value, so we don't coerce
        # None here — just let the service layer handle both cases.
        file = await file_service.update_note(db, file_id, payload["note"] or "")
        if not file:
            raise HTTPException(status_code=404, detail="File not found")

    return FileResponse.model_validate(file)


@router.put("/{file_id}/tags", response_model=FileResponse)
async def update_file_tags(
    file_id: int,
    data: dict,
    db: AsyncSession = Depends(get_db),
):
    tag_ids = data.get("tag_ids", [])
    file = await file_service.update_file_tags(db, file_id, tag_ids)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse.model_validate(file)


@router.post("/{file_id}/protocol-summary/preview", response_model=ProtocolSummaryPreview)
async def preview_protocol_summary(file_id: int, db: AsyncSession = Depends(get_db)):
    """Detect protocols via sharkd WITHOUT writing to the DB.

    The response is meant to be shown to the user for confirmation.
    To persist, the client should follow up with
    `PATCH /files/{id}/protocol-summary`.
    """
    result = await file_service.preview_protocol_summary(db, file_id)
    if not result:
        raise HTTPException(status_code=404, detail="File not found")
    file, suggested = result
    return ProtocolSummaryPreview(
        file=FileResponse.model_validate(file),
        suggested_summary=suggested,
    )


@router.patch("/{file_id}/protocol-summary", response_model=FileResponse)
async def update_protocol_summary(
    file_id: int,
    data: ProtocolSummaryUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Persist a user-confirmed protocol summary."""
    file = await file_service.set_protocol_summary(db, file_id, data.summary)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse.model_validate(file)

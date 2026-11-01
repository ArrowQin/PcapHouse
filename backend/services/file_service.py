import os
import uuid
import hashlib
import aiofiles
from typing import Optional, List, Tuple, Dict
from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from sqlalchemy.orm import selectinload

from models.file import File
from models.tag import Tag, FileTag
from models.category import Category
from config import settings
from services.activity_service import log_activity

# Whitelist of File model columns allowed for sort_by parameter.
# Prevents sorting on arbitrary/sensitive attributes via user input.
ALLOWED_SORT_COLUMNS = {"id", "name", "size", "upload_time", "is_favorite"}


def _validate_extension(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in settings.ALLOWED_EXTENSIONS


async def _extract_protocol_summary(file_path: str) -> str:
    """Best-effort protocol-summary extraction via the sharkd pool.

    Returns an empty string when sharkd is unavailable or the extraction
    fails — callers should treat the field as optional.
    """
    # Local import to avoid a circular import at module load time.
    from services.sharkd_service import sharkd_pool

    if not sharkd_pool.available:
        return ""

    client = await sharkd_pool.get_client()
    if not client:
        return ""
    try:
        return await client.get_summary(file_path) or ""
    except Exception as e:  # pragma: no cover — defensive
        import logging
        logging.getLogger(__name__).warning(
            f"Failed to extract protocol summary for {file_path}: {e}"
        )
        return ""
    finally:
        sharkd_pool.release_client()


async def get_used_protocols(db: AsyncSession) -> List[str]:
    """Return the sorted, de-duplicated set of protocol short-names that
    actually appear in any file's `protocol_summary` field.

    This is what the Files page's protocol filter dropdown should show —
    it's the set of protocols the user can usefully filter *by*, because
    those are the ones that have at least one matching file. It is NOT
    gated by the user's "enabled protocols" setting on the Protocols
    page; that setting is only for pre-checking chips in the upload
    confirmation modal, not for restricting retrospective filtering.

    We pull the raw `protocol_summary` column for every file (it's small
    text, comma-separated) and aggregate in Python. SQL-side splitting
    would need dialect-specific tricks and the row count is expected to
    be modest (files, not packets).
    """
    result = await db.execute(select(File.protocol_summary))
    names: set = set()
    for (summary,) in result.all():
        if not summary:
            continue
        for raw in summary.split(","):
            tok = raw.strip().lower()
            if tok:
                names.add(tok)
    return sorted(names)


async def get_protocol_distribution(db: AsyncSession) -> List[dict]:
    """Return the library-wide protocol distribution as a list of
    ``{"name": <proto>, "count": <file_count>}`` entries.

    Semantics: for every file, we split its ``protocol_summary`` on ``,``,
    normalize tokens (trim + lowercase) and, per *file*, count each
    distinct protocol at most once. So a file whose summary is
    ``"tcp, tcp, http"`` contributes +1 to ``tcp`` and +1 to ``http`` —
    not +2 to ``tcp``. This matches the intuitive "how many files in my
    library contain protocol X" reading that the Dashboard's pie chart
    is trying to visualize.

    Sorted by ``count`` descending, then by ``name`` ascending to keep
    the ordering deterministic when several protocols tie.

    Implementation notes:
    * We reuse the same "pull the column, aggregate in Python" approach
      as :func:`get_used_protocols` — the row count is expected to be
      modest (files, not packets) and SQL-side string splitting would
      require dialect-specific tricks (SQLite has no ``string_split``).
    * No pagination: the caller (the Dashboard) wants the *global* view,
      not a window. Data volume is bounded by the number of files.
    """
    result = await db.execute(select(File.protocol_summary))
    counts: dict = {}
    for (summary,) in result.all():
        if not summary:
            continue
        # Dedupe per file so duplicated tokens in a single summary don't
        # inflate that file's contribution.
        seen: set = set()
        for raw in summary.split(","):
            tok = raw.strip().lower()
            if tok:
                seen.add(tok)
        for tok in seen:
            counts[tok] = counts.get(tok, 0) + 1
    return [
        {"name": name, "count": count}
        for name, count in sorted(
            counts.items(), key=lambda kv: (-kv[1], kv[0])
        )
    ]


async def _compute_sha256(file_path: str) -> str:
    sha256 = hashlib.sha256()
    async with aiofiles.open(file_path, "rb") as f:
        while True:
            chunk = await f.read(8192)
            if not chunk:
                break
            sha256.update(chunk)
    return sha256.hexdigest()


class DuplicateFileError(Exception):
    """Raised when an uploaded file's sha256 matches an existing record.

    The router layer converts this to HTTP 409 so the frontend can show
    a "file already exists" message. Carries the existing file so the
    frontend can, if it wants, link to or highlight it.
    """

    def __init__(self, existing: File):
        super().__init__(
            f"File already exists: {existing.name} (id={existing.id})"
        )
        self.existing = existing


async def upload_file(
    db: AsyncSession,
    file: UploadFile,
    category_id: Optional[int] = None,
    tag_ids: Optional[List[int]] = None,
    note: Optional[str] = None,
) -> File:
    if not file.filename or not _validate_extension(file.filename):
        raise ValueError(f"Invalid file type. Allowed: {settings.ALLOWED_EXTENSIONS}")

    file_uuid = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1].lower()

    if category_id:
        dir_path = os.path.join(settings.UPLOAD_DIR, str(category_id))
    else:
        dir_path = os.path.join(settings.UPLOAD_DIR, "uncategorized")

    os.makedirs(dir_path, exist_ok=True)
    file_path = os.path.join(dir_path, f"{file_uuid}{ext}")

    size = 0
    async with aiofiles.open(file_path, "wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)  # 1MB chunks
            if not chunk:
                break
            size += len(chunk)
            if size > settings.MAX_FILE_SIZE:
                os.remove(file_path)
                raise ValueError(f"File too large. Max size: {settings.MAX_FILE_SIZE // (1024*1024)}MB")
            await out.write(chunk)

    sha256 = await _compute_sha256(file_path)

    # Duplicate detection by content hash. We compute the hash only after
    # the upload is fully written so we can reject exact-content duplicates
    # even if the user renames the file locally before re-uploading.
    # Cleanup the freshly-written file on duplicate so we don't leak disk.
    #
    # IMPORTANT: legacy databases may already contain multiple rows with
    # the same sha256 (the unique index was introduced after some files
    # were imported). Using `scalar_one_or_none()` would raise
    # MultipleResultsFound in that case and surface as a 500 to the
    # client. We explicitly take the first match — any match is enough
    # to reject the upload as a duplicate.
    existing_q = await db.execute(
        select(File)
        .options(selectinload(File.tags), selectinload(File.category))
        .where(File.sha256 == sha256)
        .limit(1)
    )
    existing = existing_q.scalars().first()
    if existing is not None:
        try:
            os.remove(file_path)
        except OSError:
            pass
        raise DuplicateFileError(existing)

    db_file = File(
        uuid=file_uuid,
        name=file.filename,
        size=size,
        category_id=category_id,
        file_path=file_path,
        sha256=sha256,
        note=(note or ""),
    )
    db.add(db_file)
    await db.commit()
    await db.refresh(db_file)

    # Attach tags if provided
    if tag_ids:
        for tag_id in tag_ids:
            db.add(FileTag(file_id=db_file.id, tag_id=tag_id))
        await db.commit()

    await db.refresh(db_file, ["tags", "category"])

    # NOTE: We intentionally do NOT auto-populate `protocol_summary` here.
    # The caller (upload route) is expected to run `_extract_protocol_summary`
    # separately and surface the result to the user for confirmation before
    # it gets persisted via `set_protocol_summary`.

    await log_activity(db, "upload", file.filename, f"Uploaded file ({_format_size(size)})")

    return db_file


async def get_files(
    db: AsyncSession,
    q: Optional[str] = None,
    category_ids: Optional[List[int]] = None,
    tag_ids: Optional[List[int]] = None,
    is_favorite: Optional[bool] = None,
    file_type: Optional[str] = None,
    protocols: Optional[List[str]] = None,
    sort_by: str = "upload_time",
    sort_order: str = "desc",
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[File], int]:
    query = select(File).options(
        selectinload(File.tags),
        selectinload(File.category),
    )

    if q:
        # Match the keyword case-insensitively against both the file name
        # and the free-form note so users can find a capture by something
        # they wrote about it. ``note`` is nullable on older rows; that's
        # fine because ``ILIKE NULL`` evaluates to NULL and is treated
        # as false in ``WHERE``.
        from sqlalchemy import or_
        like = f"%{q}%"
        query = query.where(or_(File.name.ilike(like), File.note.ilike(like)))
    if category_ids:
        # ``0`` is reserved as a sentinel meaning "uncategorized" (real
        # category ids start at 1, SQLite autoincrement). We split the
        # incoming ids into (real_ids, want_null) so users can combine
        # "Uncategorized" with specific categories in a single filter
        # call — e.g. category_ids=[0, 3, 5] means "files with no
        # category OR files in category 3 or 5".
        real_ids = [cid for cid in category_ids if cid != 0]
        want_null = 0 in category_ids
        if want_null and real_ids:
            from sqlalchemy import or_
            query = query.where(
                or_(File.category_id.is_(None), File.category_id.in_(real_ids))
            )
        elif want_null:
            query = query.where(File.category_id.is_(None))
        else:
            query = query.where(File.category_id.in_(real_ids))
    if is_favorite is not None:
        query = query.where(File.is_favorite == is_favorite)
    if tag_ids:
        query = query.join(FileTag).where(FileTag.tag_id.in_(tag_ids))
    if file_type:
        # Match any of the provided extensions (comma-separated), e.g.
        # "pcap" or "pcap,pcapng". Case-insensitive.
        exts = [e.strip().lower().lstrip(".") for e in file_type.split(",") if e.strip()]
        if exts:
            from sqlalchemy import or_
            query = query.where(
                or_(*[File.name.ilike(f"%.{ext}") for ext in exts])
            )
    if protocols:
        # `protocol_summary` is stored as a comma-separated string like
        # "tcp, tls, http2". A naive `ilike('%tcp%')` would false-match
        # "tcpdump"/"tcpencap", so we pad both the haystack and the needle
        # with delimiters to enforce a whole-token match, and also strip
        # any incidental whitespace around tokens in storage.
        #
        # Semantics: OR across the provided protocols — the row is kept if
        # ANY requested protocol appears in its summary. This mirrors how
        # the tag filter behaves and is what users expect when ticking
        # multiple chips in a filter dropdown.
        from sqlalchemy import or_, literal, func as sa_func
        tokens = [p.strip().lower() for p in protocols if p and p.strip()]
        if tokens:
            # Build: ',' || replace(lower(protocol_summary), ' ', '') || ','
            # using the SQL '||' concat operator so this works uniformly
            # across SQLite (where func.concat isn't always available) and
            # PostgreSQL. Matches ',tcp,' reliably regardless of storage
            # spacing or casing.
            normalized = (
                literal(",")
                + sa_func.replace(sa_func.lower(File.protocol_summary), " ", "")
                + literal(",")
            )
            query = query.where(
                or_(*[normalized.like(f"%,{tok},%") for tok in tokens])
            )

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Sort — only allow whitelisted columns to prevent information leakage.
    if sort_by not in ALLOWED_SORT_COLUMNS:
        sort_by = "upload_time"
    sort_column = getattr(File, sort_by, File.upload_time)
    if sort_order == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    # Paginate
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    files = list(result.scalars().unique().all())

    return files, total


async def get_file_by_id(db: AsyncSession, file_id: int) -> Optional[File]:
    result = await db.execute(
        select(File)
        .options(selectinload(File.tags), selectinload(File.category))
        .where(File.id == file_id)
    )
    return result.scalar_one_or_none()


async def delete_file(db: AsyncSession, file_id: int) -> bool:
    file = await get_file_by_id(db, file_id)
    if not file:
        return False

    if os.path.exists(file.file_path):
        os.remove(file.file_path)

    await log_activity(db, "delete", file.name, f"Deleted file ({_format_size(file.size)})")
    await db.delete(file)
    await db.commit()
    return True


async def toggle_favorite(db: AsyncSession, file_id: int) -> Optional[File]:
    file = await get_file_by_id(db, file_id)
    if not file:
        return None
    file.is_favorite = not file.is_favorite
    await db.commit()
    await db.refresh(file, ["tags", "category"])
    return file


async def move_file(db: AsyncSession, file_id: int, category_id: Optional[int]) -> Optional[File]:
    file = await get_file_by_id(db, file_id)
    if not file:
        return None
    file.category_id = category_id
    await db.commit()
    # Expire the cached instance so the `category` relationship is re-loaded
    # from the DB on the next fetch (otherwise SQLAlchemy's identity map
    # returns the stale relationship object).
    db.expire(file)
    return await get_file_by_id(db, file_id)


async def update_file_tags(db: AsyncSession, file_id: int, tag_ids: List[int]) -> Optional[File]:
    file = await get_file_by_id(db, file_id)
    if not file:
        return None

    # Remove existing tags
    await db.execute(delete(FileTag).where(FileTag.file_id == file_id))

    # Add new tags
    for tag_id in tag_ids:
        db.add(FileTag(file_id=file_id, tag_id=tag_id))

    await db.commit()
    # Same reasoning as move_file — invalidate cached relationship.
    db.expire(file)
    return await get_file_by_id(db, file_id)


async def preview_protocol_summary(db: AsyncSession, file_id: int) -> Optional[Tuple[File, str]]:
    """Run sharkd to identify protocols for a file WITHOUT persisting.

    Returns a tuple of (file, detected_summary). The caller (typically the
    frontend, after showing the detection to the user) is expected to
    confirm via `set_protocol_summary` before anything is written to the DB.

    Returns None when the file doesn't exist.
    """
    file = await get_file_by_id(db, file_id)
    if not file:
        return None
    if not os.path.exists(file.file_path):
        return file, ""
    summary = await _extract_protocol_summary(file.file_path)
    return file, summary


async def rename_file(
    db: AsyncSession, file_id: int, new_name: str
) -> Optional[File]:
    """Rename a file's display name (does not change the on-disk path).

    The name must be non-empty and is forced to retain a .pcap / .pcapng
    extension so the rest of the application continues to recognise it.
    """
    file = await get_file_by_id(db, file_id)
    if not file:
        return None

    new_name = new_name.strip()
    if not new_name:
        raise ValueError("File name cannot be empty")

    # Ensure a valid pcap extension is present
    _valid_ext = ('.pcap', '.pcapng', '.cap')
    if not any(new_name.lower().endswith(ext) for ext in _valid_ext):
        # Preserve the original extension
        _, orig_ext = os.path.splitext(file.name)
        new_name = f"{new_name}{orig_ext or '.pcap'}"

    old_name = file.name
    file.name = new_name
    await db.commit()
    db.expire(file)

    await log_activity(db, "rename", new_name, f"Renamed '{old_name}' → '{new_name}'")

    return await get_file_by_id(db, file_id)


async def update_note(
    db: AsyncSession, file_id: int, note: str
) -> Optional[File]:
    """Persist a user-edited note. Empty string clears the note."""
    file = await get_file_by_id(db, file_id)
    if not file:
        return None
    file.note = note or ""
    await db.commit()
    db.expire(file)
    return await get_file_by_id(db, file_id)


async def set_protocol_summary(
    db: AsyncSession, file_id: int, summary: str
) -> Optional[File]:
    """Persist a user-confirmed protocol summary for a file.

    The summary is stored verbatim — callers are responsible for any
    normalization (e.g. de-duping, trimming). Passing an empty string
    clears the field.
    """
    file = await get_file_by_id(db, file_id)
    if not file:
        return None
    file.protocol_summary = summary or ""
    await db.commit()
    db.expire(file)
    return await get_file_by_id(db, file_id)


async def get_storage_info(db: AsyncSession) -> Dict:
    total_files_result = await db.execute(select(func.count(File.id)))
    total_files = total_files_result.scalar() or 0

    total_size_result = await db.execute(select(func.sum(File.size)))
    total_size = total_size_result.scalar() or 0

    total_categories_result = await db.execute(select(func.count(Category.id)))
    total_categories = total_categories_result.scalar() or 0

    total_tags_result = await db.execute(select(func.count(Tag.id)))
    total_tags = total_tags_result.scalar() or 0

    return {
        "total_files": total_files,
        "total_size": total_size,
        "total_categories": total_categories,
        "total_tags": total_tags,
    }


def _format_size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    elif size < 1024 * 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    return f"{size / (1024 * 1024 * 1024):.1f} GB"

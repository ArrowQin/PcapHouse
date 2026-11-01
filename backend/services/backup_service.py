"""Tencent Cloud COS backup service.

Responsibilities
----------------
1. **Archive**: streamed ``tar.gz`` built into a temp file containing
   ``db/`` and ``uploads/`` subtrees. We use a temp file (not in-memory)
   because the upload dir can be many GB; memory-backing would OOM.
   Archive creation runs in a thread executor so the event loop isn't
   blocked during the gzip pass.

   Every scheduled / manual trigger produces a fresh archive and
   uploads it unconditionally. An earlier revision tried to short-
   circuit "nothing changed" runs via a ``(path, size, mtime)``
   fingerprint, but in practice the SQLite DB's mtime bumps on nearly
   every tick (WAL checkpoints, ``last_run_at`` writes, etc.) so the
   optimization barely fired — and when it misfired it silently hid
   real changes. We'd rather pay for an extra upload than ever miss
   one; cold-storage pricing on COS makes the former trivial.

2. **Upload** via Tencent Cloud COS's HTTP API using the documented
   "COS-signed HMAC-SHA1" scheme (a.k.a. the V5/XML API signature).
   We roll our own signer instead of pulling in ``cos-python-sdk-v5``
   because:
   * the SDK is blocking and large (adds ~6 MB of deps);
   * we only need a single ``PUT /<key>`` call, which the algorithm
     reduces to ~50 lines of stdlib (``hmac`` / ``hashlib`` / ``aiohttp``);
   * keeping the implementation in-repo means we can run on air-gapped
     environments without adding an extra wheel to ``requirements.txt``.

The signature scheme reference:
    https://cloud.tencent.com/document/product/436/7778

Threading model
---------------
All sync-IO steps (directory walks, tar creation) are wrapped in
``asyncio.to_thread`` so the FastAPI event loop stays responsive during
what can be a minute-scale operation on big libraries. The COS PUT uses
``aiohttp`` directly.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import tarfile
import time
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional, Tuple

# ``hashlib`` is kept for the COS signature (SHA-1 over the string-to-
# sign). We no longer use it for library fingerprinting — see the
# module docstring.

import aiohttp
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.backup_config import BackupConfig, BackupRecord

# Filenames we deliberately skip when walking ``uploads/``. Everything
# else is backed up as-is: the backup is meant to be a faithful snapshot
# of the user's library, not a filtered view. Filtering by pcap
# extension is the *upload API*'s job (see ``config.ALLOWED_EXTENSIONS``
# / ``file_service._validate_extension``); doing it again here would
# silently drop legitimate sidecar files (metadata JSON, decrypt keys,
# generator intermediates, future format additions like ``.snoop`` /
# ``.erf``, etc.) from the archive.
#
# We still skip a small denylist of OS / editor noise and obvious
# partial-upload scratch files — backing those up is pointless and
# they'd only bloat the archive.
_SKIP_FILENAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
_SKIP_SUFFIXES = (".part", ".crdownload", ".tmp", "~")


# ---------------------------------------------------------------------------
# Config CRUD (singleton row, id=1)
# ---------------------------------------------------------------------------

async def get_or_create_config(db: AsyncSession) -> BackupConfig:
    """Return the singleton config row, creating it with defaults on first call."""
    cfg = await db.get(BackupConfig, 1)
    if cfg is None:
        cfg = BackupConfig(id=1)
        db.add(cfg)
        await db.commit()
        await db.refresh(cfg)
    return cfg


async def update_config(
    db: AsyncSession,
    *,
    bucket: Optional[str] = None,
    region: Optional[str] = None,
    secret_id: Optional[str] = None,
    secret_key: Optional[str] = None,
    path_prefix: Optional[str] = None,
    enabled: Optional[bool] = None,
    schedule_time: Optional[str] = None,
) -> BackupConfig:
    """Partial-update the singleton config. ``None`` means "don't touch".

    ``path_prefix`` is normalized: leading/trailing slashes are stripped
    so the caller can paste a COS-console-flavored path like ``/prod/``
    and we turn it into ``prod`` for consistent key construction later.
    """
    cfg = await get_or_create_config(db)
    if bucket is not None:
        cfg.bucket = bucket.strip()
    if region is not None:
        cfg.region = region.strip()
    if secret_id is not None:
        cfg.secret_id = secret_id.strip()
    if secret_key is not None:
        cfg.secret_key = secret_key.strip()
    if path_prefix is not None:
        cfg.path_prefix = path_prefix.strip().strip("/")
    if enabled is not None:
        cfg.enabled = bool(enabled)
    if schedule_time is not None:
        cfg.schedule_time = schedule_time.strip()
    cfg.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(cfg)
    return cfg


# ---------------------------------------------------------------------------
# Path enumeration
# ---------------------------------------------------------------------------

def _resolve_sqlite_path(url: str) -> Optional[str]:
    """Turn a SQLAlchemy SQLite URL into a real filesystem path.

    SQLAlchemy encodes SQLite paths with a variable number of slashes
    after the scheme:

    * ``sqlite:///relative/path.db``  → ``relative/path.db``  (3 slashes, relative to CWD)
    * ``sqlite:////abs/path.db``      → ``/abs/path.db``      (4 slashes, absolute)
    * ``sqlite+aiosqlite:///./x.db``  → ``./x.db``            (same rules)

    The naive ``url.partition("://")`` split we used before left a
    leading ``/`` on relative paths (``/./pcaphouse.db``), which made
    ``os.path.exists`` return False and silently dropped the DB from
    the backup — producing an empty archive. This helper handles both
    forms and also strips the optional ``?query`` suffix that SQLAlchemy
    tacks on (e.g. ``?check_same_thread=false``).
    """
    if not url.startswith("sqlite"):
        return None
    _, _, rest = url.partition("://")
    if not rest or rest.startswith(":memory:"):
        return None
    # Drop query string if present.
    rest = rest.split("?", 1)[0]
    # 4-slash form: ``sqlite:////abs`` → rest == "/abs" → already absolute.
    # 3-slash form: ``sqlite:///rel`` → rest == "rel" OR "./rel".
    # After partition, a 4-slash URL leaves rest starting with "/"; a
    # 3-slash URL leaves it without a leading slash. But aiosqlite /
    # aiosqlite test URLs sometimes render as "/./foo.db" — strip that.
    if rest.startswith("/./") or rest.startswith("/.\\"):
        rest = rest[1:]
    # Resolve relative to the backend working dir (where FastAPI runs).
    if not os.path.isabs(rest):
        rest = os.path.abspath(rest)
    return rest


def _iter_backup_paths() -> List[Tuple[str, str]]:
    """Yield ``(abs_path, rel_path_in_archive)`` for everything we back up.

    The archive layout is:
        db/<basename of DATABASE_URL sqlite file>
        uploads/<relative path under UPLOAD_DIR>

    Non-sqlite DATABASE_URLs (postgres etc.) are silently skipped — this
    backup tool only knows how to snapshot the single-file SQLite DB.
    The uploads tree is walked recursively and everything is included
    verbatim except for a small denylist of OS / partial-upload noise
    (see ``_SKIP_FILENAMES`` / ``_SKIP_SUFFIXES``).
    """
    items: List[Tuple[str, str]] = []

    # SQLite DB file. SQLite in WAL mode keeps two sidecar files
    # (``-wal`` and ``-shm``) that together with the main DB form a
    # consistent snapshot. We back those up too so a restored DB doesn't
    # silently miss the most recent committed transactions.
    db_path = _resolve_sqlite_path(settings.DATABASE_URL)
    if db_path and os.path.exists(db_path):
        items.append((db_path, os.path.join("db", os.path.basename(db_path))))
        for suffix in ("-wal", "-shm"):
            side = db_path + suffix
            if os.path.exists(side):
                items.append(
                    (side, os.path.join("db", os.path.basename(side)))
                )

    # Uploaded files. The backend stores them under a two-level layout
    # — ``uploads/<category_id>/<uuid>.<ext>`` — so we must walk
    # recursively. We back up *everything* under ``uploads/`` (minus a
    # tiny denylist of OS cruft and partial-upload scratch files)
    # rather than filtering by extension. Rationale: the backup's job
    # is to be a faithful snapshot of the user's library; the extension
    # whitelist belongs to the *upload* path. Filtering here would
    # silently drop sidecar files (metadata, keys, generator tempfiles
    # someone might legitimately keep) and would need to be kept in
    # perfect lockstep with ``settings.ALLOWED_EXTENSIONS`` — a
    # maintenance trap we'd rather not have.
    upload_dir = settings.UPLOAD_DIR
    if os.path.isdir(upload_dir):
        for dirpath, _dirnames, filenames in os.walk(upload_dir):
            for entry in sorted(filenames):
                # Skip dotfiles (``.DS_Store`` and anything the user /
                # OS puts there on purpose as hidden) and the named
                # denylist. Partial uploads (*.part, *.crdownload) and
                # editor swap files (*~) are also skipped — they're
                # either transient or garbage; archiving them is
                # pointless.
                if entry in _SKIP_FILENAMES:
                    continue
                if entry.startswith("."):
                    continue
                if entry.endswith(_SKIP_SUFFIXES):
                    continue
                abspath = os.path.join(dirpath, entry)
                if not os.path.isfile(abspath):
                    continue
                rel = os.path.relpath(abspath, upload_dir)
                # Use forward slashes inside the tar regardless of host
                # OS — tar archives are conventionally POSIX-pathed and
                # this also keeps object listings tidy when someone
                # ``tar tzf``s the backup on any platform.
                rel_posix = rel.replace(os.sep, "/")
                items.append((abspath, f"uploads/{rel_posix}"))

    return items


# ---------------------------------------------------------------------------
# Archive creation
# ---------------------------------------------------------------------------

def _build_archive_sync(items: List[Tuple[str, str]], out_path: str) -> int:
    """Create a tar.gz at ``out_path`` and return the final size in bytes."""
    # gzip level 6 — the default. Level 9 is marginally smaller but
    # significantly slower on large pcap sets and usually not worth it
    # for an overnight job.
    with tarfile.open(out_path, mode="w:gz", compresslevel=6) as tar:
        for abs_path, rel_path in items:
            try:
                tar.add(abs_path, arcname=rel_path, recursive=False)
            except FileNotFoundError:
                # File was deleted between ``_iter_backup_paths`` and
                # now (e.g. user removed a pcap while we were mid-
                # archive). Skip it; the archive stays internally
                # consistent.
                continue
    return os.path.getsize(out_path)


# ---------------------------------------------------------------------------
# Tencent Cloud COS signing
# ---------------------------------------------------------------------------

def _sign_request(
    *,
    method: str,
    path: str,
    secret_id: str,
    secret_key: str,
    headers: dict,
    expire_seconds: int = 600,
) -> str:
    """Produce the ``Authorization`` header value for a COS HTTP request.

    Implements the v5 HMAC-SHA1 scheme:
        SignKey    = HMAC-SHA1(SecretKey, "<start>;<end>")
        HttpString = "<method>\n<path>\n<params>\n<headers>\n"
        StringToSign = "sha1\n<start>;<end>\n" + sha1(HttpString).hexdigest() + "\n"
        Signature = HMAC-SHA1(SignKey, StringToSign)

    We only sign headers that COS treats as "canonical" — for a simple
    PUT object that's ``content-length``, ``content-md5`` (when present),
    ``content-type``, ``host`` and ``x-cos-*``. Omitting e.g.
    ``Authorization`` / ``User-Agent`` from the signed set is
    deliberate and matches the SDK behavior.

    ``path`` must start with a ``/`` and be URL-encoded (safe chars
    ``/`` preserved).
    """
    now = int(time.time())
    start = now - 60  # tiny clock-skew cushion
    end = now + expire_seconds
    key_time = f"{start};{end}"

    sign_key = hmac.new(secret_key.encode(), key_time.encode(), hashlib.sha1).hexdigest()

    # Canonical headers: lowercase names, urlencoded values, sorted.
    # COS requires ``host`` always be part of the signature.
    h_sorted = sorted((k.lower(), v) for k, v in headers.items())
    header_list = ";".join(k for k, _ in h_sorted)
    header_str = "&".join(
        f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(str(v), safe='')}"
        for k, v in h_sorted
    )

    http_string = f"{method.lower()}\n{path}\n\n{header_str}\n"
    string_to_sign = (
        "sha1\n"
        f"{key_time}\n"
        f"{hashlib.sha1(http_string.encode()).hexdigest()}\n"
    )
    signature = hmac.new(sign_key.encode(), string_to_sign.encode(), hashlib.sha1).hexdigest()

    return (
        "q-sign-algorithm=sha1"
        f"&q-ak={secret_id}"
        f"&q-sign-time={key_time}"
        f"&q-key-time={key_time}"
        f"&q-header-list={header_list}"
        "&q-url-param-list="
        f"&q-signature={signature}"
    )


def _cos_host(bucket: str, region: str) -> str:
    """Build the COS endpoint host for ``bucket`` in ``region``.

    Example: ``my-1250000000`` + ``ap-guangzhou`` → ``my-1250000000.cos.ap-guangzhou.myqcloud.com``
    """
    return f"{bucket}.cos.{region}.myqcloud.com"


async def _put_object(
    *,
    cfg: BackupConfig,
    object_key: str,
    local_path: str,
    session: aiohttp.ClientSession,
) -> None:
    """Stream-upload ``local_path`` to ``cos://<bucket>/<object_key>``.

    Raises ``RuntimeError`` with a short error summary on non-2xx
    response so the caller can log the reason verbatim.
    """
    host = _cos_host(cfg.bucket, cfg.region)
    # Encode the key path-segment-wise so ``/`` separators stay intact
    # but spaces / non-ASCII get percent-escaped.
    encoded_key = urllib.parse.quote(object_key, safe="/")
    url = f"https://{host}/{encoded_key}"
    size = os.path.getsize(local_path)

    signed_headers = {
        "host": host,
        "content-length": str(size),
        "content-type": "application/gzip",
    }
    auth = _sign_request(
        method="PUT",
        path=f"/{encoded_key}",
        secret_id=cfg.secret_id,
        secret_key=cfg.secret_key,
        headers=signed_headers,
    )

    # aiohttp accepts a file-like object as ``data`` and streams it
    # without loading into memory — critical for multi-GB archives.
    def _open():
        return open(local_path, "rb")

    # aiohttp's sync file-object support does the streaming chunking
    # for us. Content-Length is set explicitly so COS doesn't fall back
    # to chunked transfer encoding (which V5 signatures don't cover).
    with _open() as fh:
        async with session.put(
            url,
            data=fh,
            headers={
                "Host": host,
                "Content-Length": str(size),
                "Content-Type": "application/gzip",
                "Authorization": auth,
            },
            timeout=aiohttp.ClientTimeout(total=None, sock_connect=20, sock_read=300),
        ) as resp:
            if resp.status // 100 != 2:
                body = await resp.text()
                # Trim body to keep logs readable; XML error bodies from
                # COS are typically < 500 bytes anyway.
                raise RuntimeError(
                    f"COS PUT failed: HTTP {resp.status} — {body[:500]}"
                )


async def _head_bucket(cfg: BackupConfig, session: aiohttp.ClientSession) -> None:
    """Issue a HEAD on the bucket root to verify credentials/region.

    Used by the "Test connection" button. Distinct error messages for
    the common failure modes so the UI can guide the user: 403 = bad
    key, 404 = wrong bucket/region, others surface raw.
    """
    host = _cos_host(cfg.bucket, cfg.region)
    url = f"https://{host}/"
    signed_headers = {"host": host}
    auth = _sign_request(
        method="HEAD",
        path="/",
        secret_id=cfg.secret_id,
        secret_key=cfg.secret_key,
        headers=signed_headers,
    )
    async with session.head(
        url,
        headers={"Host": host, "Authorization": auth},
        timeout=aiohttp.ClientTimeout(total=15),
    ) as resp:
        if resp.status == 200:
            return
        if resp.status == 403:
            raise RuntimeError("COS returned 403 — check SecretId/SecretKey")
        if resp.status == 404:
            raise RuntimeError("COS returned 404 — check bucket name and region")
        raise RuntimeError(f"COS connection failed: HTTP {resp.status}")


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

@dataclass
class BackupOutcome:
    status: str  # success | failed
    message: str
    object_key: Optional[str] = None
    size_bytes: Optional[int] = None
    duration_ms: Optional[int] = None


def _validate_config(cfg: BackupConfig) -> Optional[str]:
    """Return an error string if ``cfg`` is not ready to perform a backup."""
    missing = [
        n
        for n, v in [
            ("bucket", cfg.bucket),
            ("region", cfg.region),
            ("secret_id", cfg.secret_id),
            ("secret_key", cfg.secret_key),
        ]
        if not v
    ]
    if missing:
        return f"Missing required fields: {', '.join(missing)}"
    return None


async def test_connection(cfg: BackupConfig) -> BackupOutcome:
    """Do a HEAD on the bucket. Never touches local files."""
    err = _validate_config(cfg)
    if err:
        return BackupOutcome(status="failed", message=err)
    try:
        async with aiohttp.ClientSession() as session:
            await _head_bucket(cfg, session)
        return BackupOutcome(status="success", message="Connection OK")
    except Exception as e:  # noqa: BLE001 — surface reason to the user
        return BackupOutcome(status="failed", message=str(e))


def _object_key_for_now(cfg: BackupConfig) -> str:
    """Build a unique, human-friendly object key for a run started *now*.

    Shape: ``[<prefix>/]pcaphouse-backup-<YYYYMMDD-HHMMSS>.tar.gz`` in
    UTC so multi-region backups line up alphabetically. Collisions
    across runs starting in the same second are effectively impossible
    for a daily scheduler, so we don't mix in a random suffix.
    """
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    name = f"pcaphouse-backup-{ts}.tar.gz"
    return f"{cfg.path_prefix}/{name}" if cfg.path_prefix else name


async def run_backup(
    db: AsyncSession,
    *,
    trigger: str,
) -> BackupOutcome:
    """End-to-end: enumerate paths → archive → upload → record.

    Every call produces a fresh archive and uploads it. There is no
    "skip if unchanged" gate — see the module docstring for why that
    optimization was removed.
    """
    start = time.monotonic()
    cfg = await get_or_create_config(db)

    err = _validate_config(cfg)
    if err:
        outcome = BackupOutcome(status="failed", message=err)
        await _record(db, cfg, trigger, outcome)
        return outcome

    # 1) Enumerate what we're going to back up.
    try:
        items = await asyncio.to_thread(_iter_backup_paths)
    except Exception as e:  # noqa: BLE001
        outcome = BackupOutcome(status="failed", message=f"Path enumeration failed: {e}")
        await _record(db, cfg, trigger, outcome)
        return outcome

    # Guard: if path resolution turned up nothing, the archive would be
    # a valid-but-empty tar.gz — which is never what the user wants and
    # makes debugging "why is my backup 0 bytes" very confusing. Fail
    # loudly instead. Most common cause: DATABASE_URL points at a path
    # that doesn't exist from the backend's CWD (e.g. Docker volume not
    # mounted) AND no pcap files have been uploaded yet.
    if not items:
        outcome = BackupOutcome(
            status="failed",
            message=(
                "Nothing to back up: the SQLite database file was not "
                f"found (DATABASE_URL={settings.DATABASE_URL!r}, resolved="
                f"{_resolve_sqlite_path(settings.DATABASE_URL)!r}) and the "
                f"upload directory ({settings.UPLOAD_DIR!r}) has no pcap files."
            ),
        )
        await _record(db, cfg, trigger, outcome)
        return outcome

    # 2) Build archive into a temp file next to the uploads dir so
    #    os.rename-class operations would be fast if we ever wanted to
    #    keep it around. ``pid + ts`` is enough to avoid collisions with
    #    parallel test runs.
    tmp_dir = os.path.join(os.path.dirname(settings.UPLOAD_DIR), "tmp_backup")
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_path = os.path.join(tmp_dir, f"backup-{os.getpid()}-{int(time.time())}.tar.gz")

    try:
        size = await asyncio.to_thread(_build_archive_sync, items, tmp_path)
    except Exception as e:  # noqa: BLE001
        # Best-effort cleanup; ignore any further failure here.
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        outcome = BackupOutcome(status="failed", message=f"Archive failed: {e}")
        await _record(db, cfg, trigger, outcome)
        return outcome

    # 3) Upload.
    object_key = _object_key_for_now(cfg)
    try:
        async with aiohttp.ClientSession() as session:
            await _put_object(cfg=cfg, object_key=object_key, local_path=tmp_path, session=session)
    except Exception as e:  # noqa: BLE001
        outcome = BackupOutcome(status="failed", message=f"Upload failed: {e}", size_bytes=size)
        await _record(db, cfg, trigger, outcome)
        return outcome
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    outcome = BackupOutcome(
        status="success",
        message="Backup uploaded",
        object_key=object_key,
        size_bytes=size,
        duration_ms=int((time.monotonic() - start) * 1000),
    )
    await _record(db, cfg, trigger, outcome)
    return outcome


async def _record(
    db: AsyncSession,
    cfg: BackupConfig,
    trigger: str,
    outcome: BackupOutcome,
) -> None:
    """Append to ``backup_records`` and update the denormalized snapshot on ``cfg``."""
    rec = BackupRecord(
        trigger=trigger,
        status=outcome.status,
        object_key=outcome.object_key,
        size_bytes=outcome.size_bytes,
        duration_ms=outcome.duration_ms,
        message=outcome.message,
    )
    db.add(rec)

    cfg.last_status = outcome.status
    cfg.last_run_at = datetime.now(timezone.utc)
    cfg.last_message = outcome.message
    # Only overwrite the "last known good" object key / size on success;
    # failed runs shouldn't wipe out the reference to what's actually in
    # the bucket.
    if outcome.status == "success":
        cfg.last_object_key = outcome.object_key
        cfg.last_size_bytes = outcome.size_bytes
    await db.commit()


async def list_records(db: AsyncSession, limit: int = 20) -> List[BackupRecord]:
    q = select(BackupRecord).order_by(BackupRecord.created_at.desc()).limit(limit)
    result = await db.execute(q)
    return list(result.scalars().all())

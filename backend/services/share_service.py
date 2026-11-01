"""File sharing service — upload/delete pcap files to/from a dedicated COS bucket.

The sharing feature uses a separate COS config from the backup feature so
credentials can be scoped differently (e.g. a public-read bucket for sharing
vs a private bucket for backups).
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
import urllib.parse
from datetime import datetime, timezone
from typing import List, Optional

import aiohttp
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from models.share_config import ShareConfig, SharedFile
from models.file import File


# ---------------------------------------------------------------------------
# Config CRUD (singleton row, id=1)
# ---------------------------------------------------------------------------

async def get_or_create_config(db: AsyncSession) -> ShareConfig:
    cfg = await db.get(ShareConfig, 1)
    if cfg is None:
        cfg = ShareConfig(id=1)
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
) -> ShareConfig:
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
    cfg.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(cfg)
    return cfg


# ---------------------------------------------------------------------------
# COS helpers
# ---------------------------------------------------------------------------

def _cos_host(bucket: str, region: str) -> str:
    return f"{bucket}.cos.{region}.myqcloud.com"


def _sign_request(
    *,
    method: str,
    path: str,
    secret_id: str,
    secret_key: str,
    headers: dict,
    expire_seconds: int = 600,
) -> str:
    now = int(time.time())
    start = now - 60
    end = now + expire_seconds
    key_time = f"{start};{end}"

    sign_key = hmac.new(secret_key.encode(), key_time.encode(), hashlib.sha1).hexdigest()

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


async def _put_object(
    *,
    cfg: ShareConfig,
    object_key: str,
    local_path: str,
    session: aiohttp.ClientSession,
) -> None:
    host = _cos_host(cfg.bucket, cfg.region)
    encoded_key = urllib.parse.quote(object_key, safe="/")
    url = f"https://{host}/{encoded_key}"
    size = os.path.getsize(local_path)

    signed_headers = {
        "host": host,
        "content-length": str(size),
        "content-type": "application/octet-stream",
    }
    auth = _sign_request(
        method="PUT",
        path=f"/{encoded_key}",
        secret_id=cfg.secret_id,
        secret_key=cfg.secret_key,
        headers=signed_headers,
    )

    with open(local_path, "rb") as fh:
        async with session.put(
            url,
            data=fh,
            headers={
                "Host": host,
                "Content-Length": str(size),
                "Content-Type": "application/octet-stream",
                "Authorization": auth,
            },
            timeout=aiohttp.ClientTimeout(total=None, sock_connect=20, sock_read=300),
        ) as resp:
            if resp.status // 100 != 2:
                body = await resp.text()
                raise RuntimeError(
                    f"COS PUT failed: HTTP {resp.status} — {body[:500]}"
                )


async def _delete_object(
    *,
    cfg: ShareConfig,
    object_key: str,
    session: aiohttp.ClientSession,
) -> None:
    host = _cos_host(cfg.bucket, cfg.region)
    encoded_key = urllib.parse.quote(object_key, safe="/")
    url = f"https://{host}/{encoded_key}"

    signed_headers = {"host": host}
    auth = _sign_request(
        method="DELETE",
        path=f"/{encoded_key}",
        secret_id=cfg.secret_id,
        secret_key=cfg.secret_key,
        headers=signed_headers,
    )

    async with session.delete(
        url,
        headers={"Host": host, "Authorization": auth},
        timeout=aiohttp.ClientTimeout(total=30),
    ) as resp:
        # COS returns 204 on successful delete, 404 if already gone — both are fine.
        if resp.status not in (200, 204, 404):
            body = await resp.text()
            raise RuntimeError(
                f"COS DELETE failed: HTTP {resp.status} — {body[:500]}"
            )


# ---------------------------------------------------------------------------
# Share operations
# ---------------------------------------------------------------------------

def _validate_config(cfg: ShareConfig) -> Optional[str]:
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
        return f"Missing required share COS config: {', '.join(missing)}"
    return None


def _build_object_key(cfg: ShareConfig, file_name: str) -> str:
    """Build the COS object key for a shared file."""
    # Prefix + original filename (with timestamp to avoid collisions)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    safe_name = file_name.replace("/", "_").replace("\\", "_")
    name = f"{ts}_{safe_name}"
    return f"{cfg.path_prefix}/{name}" if cfg.path_prefix else name


def _build_public_url(cfg: ShareConfig, object_key: str) -> str:
    """Build the permanent public URL for a COS object."""
    host = _cos_host(cfg.bucket, cfg.region)
    encoded_key = urllib.parse.quote(object_key, safe="/")
    return f"https://{host}/{encoded_key}"


async def share_files(
    db: AsyncSession,
    file_ids: List[int],
) -> tuple[List[SharedFile], List[dict]]:
    """Upload files to COS and create share records.

    Returns (shared_records, errors) where errors is a list of
    {"file_id": int, "message": str} for files that failed.
    """
    cfg = await get_or_create_config(db)
    err = _validate_config(cfg)
    if err:
        return [], [{"file_id": fid, "message": err} for fid in file_ids]

    shared: List[SharedFile] = []
    errors: List[dict] = []

    async with aiohttp.ClientSession() as session:
        for file_id in file_ids:
            # Check if already shared
            existing = await db.execute(
                select(SharedFile).where(SharedFile.file_id == file_id)
            )
            if existing.scalar_one_or_none():
                errors.append({"file_id": file_id, "message": "File already shared"})
                continue

            # Get file record
            file_record = await db.get(File, file_id)
            if not file_record:
                errors.append({"file_id": file_id, "message": "File not found"})
                continue

            if not os.path.exists(file_record.file_path):
                errors.append({"file_id": file_id, "message": "File not found on disk"})
                continue

            object_key = _build_object_key(cfg, file_record.name)
            try:
                await _put_object(
                    cfg=cfg,
                    object_key=object_key,
                    local_path=file_record.file_path,
                    session=session,
                )
            except Exception as e:
                errors.append({"file_id": file_id, "message": str(e)})
                continue

            cos_url = _build_public_url(cfg, object_key)
            record = SharedFile(
                file_id=file_id,
                file_name=file_record.name,
                object_key=object_key,
                cos_url=cos_url,
                size_bytes=file_record.size,
            )
            db.add(record)
            await db.commit()
            await db.refresh(record)
            shared.append(record)

    return shared, errors


async def unshare_file(db: AsyncSession, share_id: int) -> tuple[str, str]:
    """Delete a shared file from COS and remove the share record.

    Returns (status, message).
    """
    record = await db.get(SharedFile, share_id)
    if not record:
        return "failed", "Share record not found"

    cfg = await get_or_create_config(db)
    err = _validate_config(cfg)
    if err:
        return "failed", err

    try:
        async with aiohttp.ClientSession() as session:
            await _delete_object(cfg=cfg, object_key=record.object_key, session=session)
    except Exception as e:
        return "failed", f"Failed to delete from COS: {e}"

    await db.delete(record)
    await db.commit()
    return "success", "File unshared and deleted from COS"


async def list_shared_files(db: AsyncSession) -> List[SharedFile]:
    """List all shared files, newest first."""
    result = await db.execute(
        select(SharedFile).order_by(SharedFile.shared_at.desc())
    )
    return list(result.scalars().all())


async def test_connection(cfg: ShareConfig) -> tuple[str, str]:
    """HEAD the bucket to verify credentials."""
    err = _validate_config(cfg)
    if err:
        return "failed", err
    try:
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
        async with aiohttp.ClientSession() as session:
            async with session.head(
                url,
                headers={"Host": host, "Authorization": auth},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status == 200:
                    return "success", "Connection OK"
                if resp.status == 403:
                    return "failed", "COS returned 403 — check SecretId/SecretKey"
                if resp.status == 404:
                    return "failed", "COS returned 404 — check bucket name and region"
                return "failed", f"COS connection failed: HTTP {resp.status}"
    except Exception as e:
        return "failed", str(e)

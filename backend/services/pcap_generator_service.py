"""Pcap generation pipeline orchestrator.

Coordinates the full lifecycle of a pcap-generation task:
  1. Parse user input via the appropriate ProtocolHandler
  2. Set up loopback IP aliases (NetworkManager)
  3. Start tcpdump capture (CaptureManager)
  4. Run protocol traffic (ProtocolHandler.create_server + send_traffic)
  5. Stop capture
  6. Post-process with tcprewrite (PostProcessor)
  7. Store the result in the file repository
  8. Clean up all temporary resources

The pipeline is protocol-agnostic; protocol-specific behaviour is delegated
entirely to a :class:`ProtocolHandler` implementation.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import shutil
import tempfile
import time
import uuid as _uuid
from datetime import datetime, timezone
from typing import Optional, List

import aiofiles
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.file import File
from models.tag import FileTag
from models.generate_task import GenerateTask
from services.activity_service import log_activity
from services.network_manager import NetworkManager, LOOPBACK_IFACE
from services.capture_manager import CaptureManager
from services.post_processor import rewrite_pcap
from services.protocol_handlers import get_handler
from services.protocol_handlers.base import ParsedProtocolData, ServerHandle

logger = logging.getLogger(__name__)

# Internal IPs used on lo0 — the high octet (99) avoids clashes with common
# LAN ranges.  The last two octets are derived from a counter so concurrent
# tasks get unique pairs.
_IP_PREFIX = "10.99"
_ip_counter = 0


def _next_ip_pair() -> tuple[str, str]:
    """Return a unique (client_ip, server_ip) pair for this process."""
    global _ip_counter
    _ip_counter += 1
    # Two IPs in different /24s so tcprewrite src/dst maps don't collide.
    client = f"{_IP_PREFIX}.{(_ip_counter % 254) + 1}.1"
    server = f"{_IP_PREFIX}.{(_ip_counter % 254) + 1}.2"
    return client, server


def _pick_port() -> int:
    """Pick a random high port for the temporary server."""
    import random
    return random.randint(49152, 60000)


async def _compute_sha256(path: str) -> str:
    sha = hashlib.sha256()
    async with aiofiles.open(path, "rb") as f:
        while True:
            chunk = await f.read(8192)
            if not chunk:
                break
            sha.update(chunk)
    return sha.hexdigest()


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

async def generate_pcap(
    db: AsyncSession,
    task: GenerateTask,
) -> GenerateTask:
    """Execute the full pcap generation pipeline for *task*.

    Updates *task.status* in-place (and in the DB) as stages progress.
    On success, *task.file_id* points to the newly created File record.
    """

    handler = get_handler(task.protocol)
    if handler is None:
        task.status = "failed"
        task.error_message = f"Unsupported protocol: {task.protocol}"
        await _persist_task(db, task)
        return task

    network = NetworkManager()
    capture = CaptureManager()
    server_handle: Optional[ServerHandle] = None
    tmpdir = tempfile.mkdtemp(prefix="pcapgen_")
    raw_pcap = os.path.join(tmpdir, "raw.pcap")
    final_pcap = os.path.join(tmpdir, "final.pcap")

    # Internal IPs used on lo0 for this task
    client_ip, server_ip = _next_ip_pair()

    # --- Port selection ----------------------------------------------------
    # The user may request a specific destination port (``task.dst_port``,
    # defaulting to ``task.port``) and optionally a fixed source port
    # (``task.src_port``, defaulting to ephemeral).
    #
    # For the *capture* we need actual ports that we can bind locally:
    #   • dst port: use the user's desired port if it's non-privileged
    #     (>=1024), otherwise pick a high port and portmap it back later —
    #     bind() of 80/443 requires root on macOS.
    #   • src port: if user pinned one, use it; else 0 (kernel-ephemeral).
    user_dst_port = int(task.dst_port or task.port)
    user_src_port = int(task.src_port) if task.src_port else None

    if user_dst_port >= 1024:
        internal_dst_port = user_dst_port
    else:
        # Privileged port — bind to a high port internally and let
        # tcprewrite --portmap rewrite it in post-processing. This keeps
        # Wireshark happy (final pcap uses the real port 80/443/etc.) while
        # we don't need root to run.
        internal_dst_port = _pick_port()

    # For the source port, any non-privileged value is fine for local bind.
    # If user asked for a privileged src port, we still bind a high local
    # port and remap via tcprewrite.
    if user_src_port is None:
        internal_src_port = 0          # kernel picks
    elif user_src_port >= 1024:
        internal_src_port = user_src_port
    else:
        internal_src_port = _pick_port()

    try:
        # ---- 1. Parse ----
        await _update_status(db, task, "parsing")
        parsed: ParsedProtocolData = await handler.parse_input(
            task.raw_request, task.raw_response
        )
        # Side-channel: tell the handler which source port to bind. Using
        # a metadata key avoids changing the ProtocolHandler interface.
        if internal_src_port:
            parsed.metadata["_source_port"] = internal_src_port

        # ---- 2. Network ----
        await _update_status(db, task, "capturing")
        await network.add_alias(client_ip)
        await network.add_alias(server_ip)

        # ---- 3. Capture ----
        filter_expr = (
            f"host {client_ip} and host {server_ip} and port {internal_dst_port}"
        )
        await capture.start(LOOPBACK_IFACE, filter_expr, raw_pcap)

        # Small delay to make sure tcpdump is fully ready
        await asyncio.sleep(0.2)

        # ---- 4. Protocol traffic ----
        server_handle = await handler.create_server(parsed, server_ip, internal_dst_port)
        await handler.send_traffic(parsed, server_ip, internal_dst_port, client_ip)

        # ---- 5. Stop capture ----
        # Give the kernel some time to deliver the last packets
        await asyncio.sleep(0.5)
        await capture.stop()

        # ---- 6. Post-process ----
        await _update_status(db, task, "processing")

        src_map = (client_ip, task.src_ip) if task.src_ip != client_ip else None
        dst_map = (server_ip, task.dst_ip) if task.dst_ip != server_ip else None

        # Source port remap: only needed when user pinned a src port AND
        # the internal port we actually bound differs from what they want.
        src_port_map = None
        if user_src_port is not None and internal_src_port != user_src_port:
            src_port_map = (internal_src_port, user_src_port)

        # Destination port remap: only needed when we had to fall back to
        # a high internal port because the user asked for a privileged one.
        dst_port_map = None
        if internal_dst_port != user_dst_port:
            dst_port_map = (internal_dst_port, user_dst_port)

        await rewrite_pcap(
            raw_pcap, final_pcap,
            src_map=src_map,
            dst_map=dst_map,
            src_port_map=src_port_map,
            dst_port_map=dst_port_map,
        )
        pcap_to_store = final_pcap

        # ---- 7. Store ----
        await _update_status(db, task, "saving")
        file_record = await _store_pcap(
            db, pcap_to_store, task,
        )
        task.file_id = file_record.id
        task.status = "success"
        task.completed_at = datetime.now(timezone.utc)
        await _persist_task(db, task)

        await log_activity(
            db, "generate",
            task.filename or f"generated-{task.protocol}.pcap",
            f"Generated {task.protocol.upper()} pcap ({task.src_ip} → {task.dst_ip})",
        )

        return task

    except Exception as exc:
        logger.exception("pcap generation failed for task %s", task.uuid)
        task.status = "failed"
        # Include the exception class name because some exception types
        # (TimeoutError, AttributeError in specific CPython paths, etc.)
        # stringify to an empty message which makes debugging very hard.
        msg = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
        task.error_message = msg[:2000]
        task.completed_at = datetime.now(timezone.utc)
        await _persist_task(db, task)
        return task

    finally:
        # ---- 8. Cleanup (always) ----
        if server_handle:
            try:
                await handler.cleanup(server_handle)
            except Exception:
                logger.warning("handler cleanup error", exc_info=True)

        try:
            await capture.stop()
        except Exception:
            pass

        await network.cleanup()

        # Remove temp directory
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _update_status(db: AsyncSession, task: GenerateTask, status: str) -> None:
    task.status = status
    await _persist_task(db, task)


async def _persist_task(db: AsyncSession, task: GenerateTask) -> None:
    db.add(task)
    await db.commit()
    await db.refresh(task)


async def _store_pcap(
    db: AsyncSession,
    pcap_path: str,
    task: GenerateTask,
) -> File:
    """Copy the generated pcap into uploads/ and create a File record."""
    file_uuid = str(_uuid.uuid4())
    filename = task.filename or f"generated-{task.protocol}-{int(time.time())}.pcap"
    if not filename.endswith(".pcap"):
        filename += ".pcap"

    # If the user did not pick a category, drop the pcap into the built-in
    # "Generated" category so everything produced by this feature is easy
    # to find in the sidebar.
    category_id = task.category_id
    if category_id is None:
        from services.category_service import get_generated_category
        generated = await get_generated_category(db)
        category_id = generated.id

    dir_path = os.path.join(settings.UPLOAD_DIR, str(category_id))

    os.makedirs(dir_path, exist_ok=True)
    dest = os.path.join(dir_path, f"{file_uuid}.pcap")
    shutil.copy2(pcap_path, dest)

    size = os.path.getsize(dest)
    sha256 = await _compute_sha256(dest)

    db_file = File(
        uuid=file_uuid,
        name=filename,
        size=size,
        category_id=category_id,
        file_path=dest,
        sha256=sha256,
        note=f"Generated from raw {task.protocol.upper()} input",
    )
    db.add(db_file)
    await db.commit()
    await db.refresh(db_file)

    # Attach tags
    tag_ids: List[int] = []
    if task.tag_ids_json:
        tag_ids = json.loads(task.tag_ids_json)
    if tag_ids:
        for tid in tag_ids:
            db.add(FileTag(file_id=db_file.id, tag_id=tid))
        await db.commit()
        await db.refresh(db_file, ["tags", "category"])

    return db_file

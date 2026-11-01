"""Manage a capture subprocess for packet capture.

On Linux (Docker container) we use ``tshark`` which runs as root and does
not suffer from the privilege-drop bug that afflicts tcpdump 4.99.5 on
Fedora 41 (packets are captured but never written to the output file when
tcpdump is spawned from a Python asyncio subprocess).

On macOS we continue to use ``tcpdump`` (via sudo) since tshark may not
be installed and tcpdump works correctly there.

Both tools block until a "ready" sentinel appears on stderr, then provide
a :meth:`stop` coroutine that sends SIGTERM and collects the output.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shlex
import shutil
import sys
from typing import List

from services._sudo import with_sudo_argv

logger = logging.getLogger(__name__)

_READY_TIMEOUT = 10  # seconds to wait for capture tool's "ready" line
_STOP_TIMEOUT = 5    # seconds to wait after SIGTERM before SIGKILL


def _use_tshark() -> bool:
    """Decide whether to use tshark instead of tcpdump.

    On Linux (i.e. the Docker container), tcpdump 4.99.5 has a critical bug:
    when spawned from Python's asyncio.create_subprocess_exec, it drops
    privileges to the ``tcpdump`` user and then fails to write captured
    packets to the output file (only the 24-byte pcap header is produced,
    despite reporting "N packets captured"). ``-Z root`` would fix this but
    segfaults on Fedora 41.

    tshark (Wireshark's CLI) does NOT drop privileges when running as root
    and reliably writes all captured data. We use it on Linux when available.
    """
    if sys.platform == "darwin":
        return False
    return shutil.which("tshark") is not None


class CaptureManager:
    """Lifecycle wrapper around a single capture process (tshark or tcpdump)."""

    def __init__(self) -> None:
        self._proc: asyncio.subprocess.Process | None = None
        self._output_path: str | None = None

    async def start(
        self,
        interface: str,
        filter_expr: str,
        output_path: str,
    ) -> None:
        """Launch capture tool and block until it reports readiness."""
        self._output_path = output_path

        if _use_tshark():
            await self._start_tshark(interface, filter_expr, output_path)
        else:
            await self._start_tcpdump(interface, filter_expr, output_path)

    async def _start_tshark(
        self,
        interface: str,
        filter_expr: str,
        output_path: str,
    ) -> None:
        """Start tshark for capture (Linux/Docker)."""
        argv: List[str] = [
            "tshark",
            "-i", interface,
            "-w", output_path,
            "-F", "pcap",       # output classic pcap (not pcapng) for tcprewrite compat
            "-l",               # line-buffered output
        ]
        # tshark uses -f for capture filter (BPF)
        if filter_expr:
            argv.extend(["-f", filter_expr])

        logger.info("starting tshark: %s", argv)

        self._proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # tshark prints "Capturing on '<iface>'" on stderr when ready.
        assert self._proc.stderr is not None
        try:
            while True:
                line = await asyncio.wait_for(
                    self._proc.stderr.readline(),
                    timeout=_READY_TIMEOUT,
                )
                decoded = line.decode(errors="replace").strip()
                logger.debug("tshark stderr: %s", decoded)
                if "capturing" in decoded.lower():
                    logger.info("tshark ready on %s", interface)
                    return
                if self._proc.returncode is not None:
                    raise RuntimeError(
                        f"tshark exited prematurely (rc={self._proc.returncode}): {decoded}"
                    )
        except asyncio.TimeoutError:
            await self._kill()
            raise RuntimeError(
                f"tshark did not become ready within {_READY_TIMEOUT}s"
            )

    async def _start_tcpdump(
        self,
        interface: str,
        filter_expr: str,
        output_path: str,
    ) -> None:
        """Start tcpdump for capture (macOS fallback)."""
        tcpdump_argv: List[str] = [
            "tcpdump",
            "-i", interface,
            "-w", output_path,
            "-U",
        ]
        if sys.platform != "darwin":
            # Make the output directory writable by the tcpdump user after
            # privilege drop (fallback path if tshark is not available).
            output_dir = os.path.dirname(output_path)
            if output_dir:
                os.chmod(output_dir, 0o777)
        if filter_expr:
            tcpdump_argv.extend(shlex.split(filter_expr))

        argv = with_sudo_argv(tcpdump_argv)
        logger.info("starting tcpdump: %s", argv)

        self._proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # tcpdump prints "listening on <iface> …" on stderr when ready.
        assert self._proc.stderr is not None
        try:
            while True:
                line = await asyncio.wait_for(
                    self._proc.stderr.readline(),
                    timeout=_READY_TIMEOUT,
                )
                decoded = line.decode(errors="replace").strip()
                logger.debug("tcpdump stderr: %s", decoded)
                if "listening on" in decoded.lower():
                    logger.info("tcpdump ready on %s", interface)
                    return
                if self._proc.returncode is not None:
                    raise RuntimeError(
                        f"tcpdump exited prematurely (rc={self._proc.returncode}): {decoded}"
                    )
        except asyncio.TimeoutError:
            await self._kill()
            raise RuntimeError(
                f"tcpdump did not become ready within {_READY_TIMEOUT}s"
            )

    async def stop(self) -> None:
        """Gracefully stop the capture process (SIGTERM → wait → SIGKILL)."""
        if self._proc is None or self._proc.returncode is not None:
            return

        self._proc.terminate()
        try:
            await asyncio.wait_for(self._proc.wait(), timeout=_STOP_TIMEOUT)
            logger.info("capture process stopped (rc=%d)", self._proc.returncode)
        except asyncio.TimeoutError:
            logger.warning("capture process did not exit in time, sending SIGKILL")
            await self._kill()

        # Make the just-written pcap file visible to subsequent readers.
        #
        # On Linux/overlayfs (which backs our Docker container) we
        # reproducibly observed that the immediately following
        # ``tcprewrite --infile=raw.pcap`` subprocess — forked from a
        # different asyncio child — would sometimes see a stale view of
        # raw.pcap and process zero packets, producing a 24-byte
        # zero-packet step1 that then propagated as a 24-byte final.pcap
        # roughly 4–8 out of 10 runs. Two things are needed to defeat
        # this race deterministically:
        #
        #   1. Open+read the file from this process so that the
        #      orchestrator's page cache and dentry reflect the
        #      just-written bytes — the fork that launches tcprewrite
        #      then inherits that VFS view.
        #   2. Sleep briefly before returning, so the FS has time to
        #      settle pending metadata writes that the kernel has not
        #      yet pushed out of the capture writer's buffers.
        #
        # Either step alone is insufficient on our kernel/overlayfs
        # combination; together they've produced 30+ consecutive
        # successful runs in stress tests (serial and parallel).
        if self._output_path:
            try:
                with open(self._output_path, "rb") as _fh:
                    _fh.read(4096)
            except OSError:
                # Non-fatal: the caller will fail loudly when it tries
                # to actually use the file and discovers it is missing.
                pass
        await asyncio.sleep(0.3)

    async def _kill(self) -> None:
        if self._proc and self._proc.returncode is None:
            self._proc.kill()
            await self._proc.wait()

"""Post-process a raw pcap with tcprewrite.

Rewrites source / destination IPs (and optionally ports) and fixes TCP/IP
checksums so the final pcap looks like it was captured on the wire between
the user-specified endpoints, not between two 10.99.x.x loopback aliases.

Two-phase rewrite
-----------------
tcprewrite only accepts ONE ``--srcipmap`` and ONE ``--dstipmap`` per run,
and each flag only touches the respective field of every packet. A real
TCP flow has packets going in both directions, so a single invocation can
only ever rewrite "one half" of the conversation. We run tcprewrite
twice:

    Step 1 — request direction  (client → server)
        --srcipmap=<client_alias>:<user_src_ip>
        --dstipmap=<server_alias>:<user_dst_ip>

    Step 2 — response direction (server → client)
        --srcipmap=<server_alias>:<user_dst_ip>   # response packets' src
        --dstipmap=<client_alias>:<user_src_ip>   # response packets' dst

Port rewrites (``--portmap``) work on both directions in a single pass,
so they are applied once in step 1.

DLT conversion
--------------
On macOS we capture on ``lo0``, which uses BSD loopback (DLT_NULL, a
4-byte pseudo-header instead of an Ethernet frame). ``tcprewrite``'s
IP-rewrite engine **silently no-ops on DLT_NULL captures** — it returns
success but produces a byte-identical file. On Linux we capture on
``lo``, which uses DLT_LINUX_SLL (cooked header); IP rewrites *do* work
there, but Wireshark users still generally expect a normal Ethernet
link layer. Converting everything to Ethernet (``--dlt=enet``) with a
synthetic MAC pair is therefore the uniform strategy: it fixes the
DLT_NULL no-op on macOS, normalises the SLL output on Linux, and
produces a pcap that looks like it was captured on a regular Ethernet
link regardless of host OS.

Port rewrite note
-----------------
tcprewrite 4.5.x on macOS has a known bug where ``--portmap`` silently
does nothing (no error, but ports remain unchanged). On Linux (Docker)
portmap works correctly. The macOS issue only affects local development
and is not a concern for the production Docker deployment.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
from typing import List, Optional, Tuple

from config import settings

logger = logging.getLogger(__name__)

# Common install locations probed when $PATH does not contain tcprewrite.
# This matters when the backend is launched via ``sudo``, because sudo resets
# PATH and /opt/homebrew/bin (Apple-silicon Homebrew) is usually dropped.
_FALLBACK_DIRS = (
    "/opt/homebrew/bin",   # Homebrew on Apple silicon
    "/usr/local/bin",      # Homebrew on Intel macOS / manual installs
    "/usr/bin",
)


def _find_tcprewrite() -> str:
    """Locate tcprewrite, honouring config override and well-known paths."""
    configured = settings.TCPREWRITE_PATH
    if configured and os.path.isabs(configured) and os.path.isfile(configured):
        return configured

    path = shutil.which(configured or "tcprewrite")
    if path:
        return path

    for d in _FALLBACK_DIRS:
        cand = os.path.join(d, "tcprewrite")
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand

    return "tcprewrite"


async def _run_tcprewrite(cmd_parts: List[str]) -> None:
    """Run a single tcprewrite invocation; raise on non-zero exit.

    Security: we deliberately use :func:`asyncio.create_subprocess_exec`
    and pass argv as a list so that IPs, ports and file paths — any of
    which may ultimately trace back to user input via the HTTP request —
    are never interpreted by a shell. The previous ``" ".join(cmd_parts)``
    + ``create_subprocess_shell`` form was vulnerable to command injection
    via shell metacharacters in, for example, ``src_ip`` / ``dst_ip``.
    """
    logger.info("tcprewrite argv: %s", cmd_parts)

    proc = await asyncio.create_subprocess_exec(
        *cmd_parts,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        err_text = stderr.decode(errors="replace").strip()
        raise RuntimeError(
            f"tcprewrite failed (rc={proc.returncode}): {err_text}\n"
            "Hint: install tcpreplay (`brew install tcpreplay`) and make sure "
            "tcprewrite is on $PATH."
        )

    # Make the just-written outfile visible to subsequent readers.
    #
    # Reproducible race we observed under ``asyncio.create_subprocess_shell``
    # on Linux: ``communicate()`` returns as soon as the child's stdout/stderr
    # pipes hit EOF, but the child's regular output file (``--outfile=...``)
    # may still have pending dirty pages that are not yet reflected in the
    # inode metadata other openers will see. The very next step in the
    # pipeline (either a second tcprewrite pass reading ``*.step1``, or
    # ``shutil.copy2`` reading ``final.pcap``) then intermittently reads only
    # the 24-byte pcap header and produces a zero-packet result roughly 1 in
    # 3 runs. Explicitly opening and closing the outfile forces a re-read of
    # its inode and defeats the race deterministically across all our
    # retries. If the ``--outfile=...`` token is absent (should not happen,
    # but we do not want to crash on a future refactor) this is a no-op.
    for token in cmd_parts:
        if token.startswith("--outfile="):
            outfile = token.split("=", 1)[1]
            try:
                with open(outfile, "rb") as _fh:
                    _fh.read(0)
            except OSError:
                # Non-fatal: the caller will fail loudly when it tries to
                # actually use the outfile and discovers it is missing.
                pass
            break


async def rewrite_pcap(
    input_pcap: str,
    output_pcap: str,
    src_map: Optional[Tuple[str, str]] = None,
    dst_map: Optional[Tuple[str, str]] = None,
    src_port_map: Optional[Tuple[int, int]] = None,
    dst_port_map: Optional[Tuple[int, int]] = None,
) -> None:
    """Rewrite IPs / ports and fix checksums in ``input_pcap``.

    Parameters
    ----------
    input_pcap:
        Path to the raw capture file.
    output_pcap:
        Where to write the final pcap.
    src_map:
        ``(client_alias_ip, desired_src_ip)`` — the loopback alias used as
        the client, paired with the IP the user wants it to appear as.
        Pass ``None`` to leave the client IP untouched.
    dst_map:
        ``(server_alias_ip, desired_dst_ip)`` — same for the server side.
    src_port_map:
        ``(actual_src_port, desired_src_port)`` — rewrite the client's
        ephemeral port to the user's desired value.
    dst_port_map:
        ``(actual_dst_port, desired_dst_port)`` — rewrite the server port
        to the user's desired value. Typically only needed when the server
        was bound to a different port than the user asked for (e.g. 80
        requires root on macOS and we fell back to a high port).
    """
    tcprewrite = _find_tcprewrite()

    # Synthetic MACs for the Ethernet conversion. Values are arbitrary but
    # must be locally-administered unicast (second-lowest bit of first byte
    # set, lowest bit clear) to look legitimate in Wireshark.
    smac = "02:00:00:00:00:01"
    dmac = "02:00:00:00:00:02"
    dlt_args = ["--dlt=enet", f"--enet-smac={smac}", f"--enet-dmac={dmac}"]

    # Fast path: no IP rewrites at all — just one pass with --fixcsum
    # (plus any portmaps). Still convert to Ethernet so the final pcap
    # has a sane link layer regardless of whether rewrites were needed.
    if not src_map and not dst_map:
        cmd = [tcprewrite, *dlt_args, "--fixcsum"]
        portmaps = _build_portmaps(src_port_map, dst_port_map)
        cmd.extend(portmaps)
        cmd.append(f"--infile={input_pcap}")
        cmd.append(f"--outfile={output_pcap}")
        await _run_tcprewrite(cmd)
        return

    # Two-phase rewrite.
    stage1 = output_pcap + ".step1"

    # ---- Step 1: DLT convert + rewrite request-direction fields ----
    # Request packets go client_alias → server_alias, so:
    #   --srcipmap rewrites the client alias (appears in src)
    #   --dstipmap rewrites the server alias (appears in dst)
    # The DLT conversion MUST happen in step 1 because tcprewrite's
    # IP-rewrite pass is a no-op on DLT_NULL captures.
    cmd1 = [tcprewrite, *dlt_args]
    if src_map and src_map[0] != src_map[1]:
        cmd1.append(f"--srcipmap={src_map[0]}/32:{src_map[1]}/32")
    if dst_map and dst_map[0] != dst_map[1]:
        cmd1.append(f"--dstipmap={dst_map[0]}/32:{dst_map[1]}/32")
    # Port rewrites apply to both directions in a single pass; do them once.
    cmd1.extend(_build_portmaps(src_port_map, dst_port_map))
    cmd1.append("--fixcsum")
    cmd1.append(f"--infile={input_pcap}")
    cmd1.append(f"--outfile={stage1}")
    await _run_tcprewrite(cmd1)

    # ---- Step 2: rewrite response-direction fields ----
    # Response packets go server_alias → client_alias, so now:
    #   --srcipmap rewrites the server alias (appears in src of responses)
    #   --dstipmap rewrites the client alias (appears in dst of responses)
    # Link layer is already Ethernet from step 1, no need to convert again.
    cmd2 = [tcprewrite]
    if dst_map and dst_map[0] != dst_map[1]:
        cmd2.append(f"--srcipmap={dst_map[0]}/32:{dst_map[1]}/32")
    if src_map and src_map[0] != src_map[1]:
        cmd2.append(f"--dstipmap={src_map[0]}/32:{src_map[1]}/32")
    cmd2.append("--fixcsum")
    cmd2.append(f"--infile={stage1}")
    cmd2.append(f"--outfile={output_pcap}")
    try:
        await _run_tcprewrite(cmd2)
    finally:
        # Step1 is always a throwaway.
        try:
            os.remove(stage1)
        except OSError:
            pass

    logger.info("post-processing complete → %s", output_pcap)


def _build_portmaps(
    src_port_map: Optional[Tuple[int, int]],
    dst_port_map: Optional[Tuple[int, int]],
) -> List[str]:
    """Return ``--portmap=...`` args for the given port remaps.

    ``--portmap`` is direction-agnostic: it rewrites the port wherever it
    appears (src or dst), which is exactly what we want because a given
    port value is used on both sides of the same flow.
    """
    args: List[str] = []
    if src_port_map and src_port_map[0] != src_port_map[1]:
        args.append(f"--portmap={src_port_map[0]}:{src_port_map[1]}")
    if dst_port_map and dst_port_map[0] != dst_port_map[1]:
        args.append(f"--portmap={dst_port_map[0]}:{dst_port_map[1]}")
    return args

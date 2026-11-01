"""Pcap decapsulation service.

Strips outer Geneve and/or VXLAN layers from every packet in a pcap file,
producing a new pcap where the inner Ethernet frame is the top-level
frame. Implementation is pure-Python (no scapy / pyshark dependency) so
we parse pcap / pcapng and protocol headers directly.

Supported pcap formats:
  - Classic pcap (``0xa1b2c3d4`` / ``0xd4c3b2a1`` magic)
  - pcapng (``0x0a0d0d0a`` block magic): we read Enhanced Packet Blocks
    whose linktype is Ethernet (1).

Output is always classic pcap, LINKTYPE_ETHERNET, microsecond resolution.

Decapsulation logic per-packet (best-effort, non-destructive):
    Ethernet → [802.1Q] → IPv4/IPv6 → UDP
        if UDP dst port == geneve_port    → strip + continue on inner L2
        if UDP dst port == vxlan_port     → strip + continue on inner L2

Packets that don't match the expected layering are passed through as-is
so the tool can safely be applied to mixed captures without data loss.
"""

from __future__ import annotations

import os
import struct
import uuid as _uuid
from dataclasses import dataclass, field
from typing import Iterable, List, Optional, Tuple

import aiofiles
import hashlib
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.file import File
from services.activity_service import log_activity


# ---------------------------------------------------------------------------
# Constants — kept here (not sprinkled through the code) so the magic
# numbers are easy to audit against RFC 8926 (Geneve) / RFC 7348 (VXLAN).
# ---------------------------------------------------------------------------

PCAP_MAGIC_LE = 0xA1B2C3D4  # little-endian (us resolution) classic pcap
PCAP_MAGIC_BE = 0xD4C3B2A1
PCAP_MAGIC_NS_LE = 0xA1B23C4D  # nanosecond resolution variant
PCAP_MAGIC_NS_BE = 0x4D3CB2A1

PCAPNG_SHB_TYPE = 0x0A0D0D0A  # Section Header Block
PCAPNG_IDB_TYPE = 0x00000001  # Interface Description Block
PCAPNG_EPB_TYPE = 0x00000006  # Enhanced Packet Block

LINKTYPE_ETHERNET = 1

ETHERTYPE_IPV4 = 0x0800
ETHERTYPE_IPV6 = 0x86DD
ETHERTYPE_VLAN = 0x8100
ETHERTYPE_VLAN_QINQ = 0x88A8

IPPROTO_UDP = 17

DEFAULT_GENEVE_PORT = 6081
DEFAULT_VXLAN_PORT = 4789


@dataclass
class DecapOptions:
    strip_geneve: bool = True
    geneve_port: int = DEFAULT_GENEVE_PORT
    strip_vxlan: bool = True
    vxlan_port: int = DEFAULT_VXLAN_PORT


@dataclass
class DecapStats:
    total: int = 0
    stripped_geneve: int = 0
    stripped_vxlan: int = 0
    stripped_both: int = 0
    passthrough: int = 0
    # Unparseable packets (e.g. non-Ethernet, truncated) — we still write
    # them verbatim so the tool is non-destructive.
    errors: int = 0
    # Non-fatal issues to surface to the UI (e.g. "pcapng block N had
    # unexpected linktype, passed through"). Capped so we don't blow up
    # memory on pathological inputs.
    warnings: List[str] = field(default_factory=list)

    def warn(self, msg: str, cap: int = 10) -> None:
        if len(self.warnings) < cap:
            self.warnings.append(msg)


# ---------------------------------------------------------------------------
# pcap / pcapng readers (yield raw Ethernet frames + timestamps)
# ---------------------------------------------------------------------------

def _read_classic_pcap(data: bytes) -> Iterable[Tuple[int, int, bytes]]:
    """Yield ``(ts_sec, ts_usec, frame_bytes)`` tuples from a classic pcap.

    The caller has already verified the magic number. Endianness and time
    resolution (us vs ns) are inferred from the magic so a ns-resolution
    file is re-scaled on output.
    """
    if len(data) < 24:
        return

    magic = struct.unpack_from("<I", data, 0)[0]
    if magic in (PCAP_MAGIC_LE, PCAP_MAGIC_NS_LE):
        endian = "<"
        nano = magic == PCAP_MAGIC_NS_LE
    elif magic in (PCAP_MAGIC_BE, PCAP_MAGIC_NS_BE):
        endian = ">"
        nano = magic == PCAP_MAGIC_NS_BE
    else:
        raise ValueError(f"Unknown pcap magic: 0x{magic:08x}")

    # Global header is 24 bytes. We only need network/linktype at offset 20.
    linktype = struct.unpack_from(endian + "I", data, 20)[0]
    if linktype != LINKTYPE_ETHERNET:
        raise ValueError(f"Unsupported linktype {linktype}, only Ethernet(1) is supported")

    off = 24
    n = len(data)
    while off + 16 <= n:
        ts_sec, ts_frac, incl_len, _orig_len = struct.unpack_from(
            endian + "IIII", data, off
        )
        off += 16
        if off + incl_len > n:
            break  # truncated record — stop cleanly
        frame = data[off : off + incl_len]
        off += incl_len
        # Normalize to microseconds for classic-pcap output.
        ts_usec = ts_frac // 1000 if nano else ts_frac
        yield ts_sec, ts_usec, frame


def _read_pcapng(data: bytes) -> Iterable[Tuple[int, int, bytes]]:
    """Yield ``(ts_sec, ts_usec, frame_bytes)`` from pcapng EPB blocks.

    Only EPBs on Ethernet interfaces are yielded; other blocks (ISB, NRB,
    etc.) are ignored. Interface time resolution (``if_tsresol`` option) is
    honoured when present; default is 1e-6 seconds per tick.
    """
    n = len(data)
    if n < 12:
        return

    # Must start with an SHB. We take the byte-order from the SHB magic.
    first = struct.unpack_from("<I", data, 0)[0]
    if first != PCAPNG_SHB_TYPE:
        raise ValueError(f"Not a pcapng file (first block type=0x{first:08x})")

    # Read SHB block length (little-endian trial) then verify BOM to lock
    # endianness. BOM is at offset 8 of SHB body.
    # SHB layout: block_type(4) block_total_len(4) bom(4) ...
    bom = struct.unpack_from("<I", data, 8)[0]
    if bom == 0x1A2B3C4D:
        endian = "<"
    elif bom == 0x4D3C2B1A:
        endian = ">"
    else:
        raise ValueError(f"Bad pcapng BOM: 0x{bom:08x}")

    # Per-interface time resolution, indexed by interface_id. Default 10^-6.
    if_tsresol: dict[int, int] = {}   # interface_id -> divisor ticks per second
    if_linktype: dict[int, int] = {}
    next_if_id = 0

    off = 0
    while off + 8 <= n:
        btype, blen = struct.unpack_from(endian + "II", data, off)
        if blen < 12 or off + blen > n:
            break  # corrupt / truncated

        body = data[off + 8 : off + blen - 4]

        if btype == PCAPNG_IDB_TYPE:
            # linktype(2) reserved(2) snaplen(4) options...
            if len(body) >= 8:
                linktype = struct.unpack_from(endian + "H", body, 0)[0]
                if_linktype[next_if_id] = linktype
                # Parse if_tsresol (option code 9) if present.
                tsresol = _parse_if_tsresol(body[8:], endian)
                if tsresol is not None:
                    if_tsresol[next_if_id] = tsresol
                next_if_id += 1

        elif btype == PCAPNG_EPB_TYPE:
            # interface_id(4) ts_hi(4) ts_lo(4) captured_len(4) packet_len(4) data...
            if len(body) >= 20:
                if_id, ts_hi, ts_lo, cap_len, _orig_len = struct.unpack_from(
                    endian + "IIIII", body, 0
                )
                frame = body[20 : 20 + cap_len]
                if if_linktype.get(if_id, LINKTYPE_ETHERNET) == LINKTYPE_ETHERNET:
                    # Assemble 64-bit timestamp ticks and scale to usec.
                    ts_ticks = (ts_hi << 32) | ts_lo
                    ticks_per_sec = if_tsresol.get(if_id, 1_000_000)
                    ts_sec = ts_ticks // ticks_per_sec
                    ts_rem = ts_ticks % ticks_per_sec
                    # Scale remainder to microseconds.
                    if ticks_per_sec == 1_000_000:
                        ts_usec = ts_rem
                    else:
                        # Use int math to avoid float jitter.
                        ts_usec = (ts_rem * 1_000_000) // ticks_per_sec
                    yield ts_sec, ts_usec, frame

        # SHB / other block types: ignore, just advance.
        off += blen


def _parse_if_tsresol(opt_bytes: bytes, endian: str) -> Optional[int]:
    """Return ticks-per-second from if_tsresol option (code 9), or None."""
    o = 0
    n = len(opt_bytes)
    while o + 4 <= n:
        code, olen = struct.unpack_from(endian + "HH", opt_bytes, o)
        o += 4
        if code == 0:  # opt_endofopt
            return None
        if code == 9 and olen >= 1 and o < n:
            raw = opt_bytes[o]
            # High bit set => base 2; else base 10.
            if raw & 0x80:
                exp = raw & 0x7F
                return 1 << exp
            else:
                return 10 ** (raw & 0x7F)
        # Options are padded to 4-byte boundary.
        padded = (olen + 3) & ~0x03
        o += padded
    return None


def _iter_pcap_frames(data: bytes) -> Iterable[Tuple[int, int, bytes]]:
    """Dispatch to the correct reader based on file magic."""
    if len(data) < 4:
        return
    magic4 = struct.unpack_from("<I", data, 0)[0]
    if magic4 == PCAPNG_SHB_TYPE:
        yield from _read_pcapng(data)
    else:
        yield from _read_classic_pcap(data)


# ---------------------------------------------------------------------------
# Per-frame decapsulation
# ---------------------------------------------------------------------------

def _decap_frame(frame: bytes, opts: DecapOptions) -> Tuple[bytes, bool, bool]:
    """Attempt to strip Geneve+VXLAN layers from a single Ethernet frame.

    Returns ``(new_frame, stripped_geneve, stripped_vxlan)``. When no
    matching encapsulation is present the frame is returned verbatim.

    We purposely do up to two passes (one per strip_* flag) with the same
    Eth→IP→UDP→<tunnel>→inner-Eth logic, because many real captures nest
    Geneve-over-UDP carrying a VXLAN frame (what this tool is built for).
    """
    current = frame
    did_geneve = False
    did_vxlan = False

    if opts.strip_geneve:
        inner = _try_strip_udp_tunnel(current, opts.geneve_port, tunnel="geneve")
        if inner is not None:
            current = inner
            did_geneve = True

    if opts.strip_vxlan:
        inner = _try_strip_udp_tunnel(current, opts.vxlan_port, tunnel="vxlan")
        if inner is not None:
            current = inner
            did_vxlan = True

    return current, did_geneve, did_vxlan


def _try_strip_udp_tunnel(frame: bytes, port: int, tunnel: str) -> Optional[bytes]:
    """Return the inner Ethernet frame if *frame* is Eth|IP|UDP:port|<tunnel>|...

    ``tunnel`` is either "geneve" (8-byte base header + opt_len*4 options)
    or "vxlan" (fixed 8-byte header). Returns None when any layer check
    fails — the caller then leaves the frame unmodified.

    Note on Geneve inner framing: Geneve's ``protocol_type`` field (RFC
    8926 §3.1) can be Ethernet (0x6558 / TEB) or a plain L3 ethertype
    (IPv4 0x0800, IPv6 0x86DD). Real-world captures from cloud gateways
    often use the L3 variant. When the inner payload isn't Ethernet we
    synthesise a minimal Ethernet header (copying the outer MACs) so the
    output is always a LINKTYPE_ETHERNET pcap — this keeps the tool's
    output format stable and lets a subsequent VXLAN strip pass work.
    """
    off = 0
    n = len(frame)

    # ---- Outer Ethernet (14) + optional 802.1Q (4) / QinQ (8) ----
    if n < 14:
        return None
    outer_dst_mac = frame[0:6]
    outer_src_mac = frame[6:12]
    ethertype = struct.unpack_from("!H", frame, 12)[0]
    off = 14
    # Walk at most two VLAN tags.
    for _ in range(2):
        if ethertype in (ETHERTYPE_VLAN, ETHERTYPE_VLAN_QINQ):
            if off + 4 > n:
                return None
            ethertype = struct.unpack_from("!H", frame, off + 2)[0]
            off += 4
        else:
            break

    # ---- Outer IP ----
    if ethertype == ETHERTYPE_IPV4:
        if off + 20 > n:
            return None
        vihl = frame[off]
        if vihl >> 4 != 4:
            return None
        ihl = (vihl & 0x0F) * 4
        if ihl < 20 or off + ihl > n:
            return None
        proto = frame[off + 9]
        ip_end = off + ihl
    elif ethertype == ETHERTYPE_IPV6:
        if off + 40 > n:
            return None
        if frame[off] >> 4 != 6:
            return None
        proto = frame[off + 6]  # Next Header
        ip_end = off + 40
        # We don't walk IPv6 extension headers — rare in encap paths and
        # complex; if one appears we conservatively bail out.
    else:
        return None

    if proto != IPPROTO_UDP:
        return None

    # ---- Outer UDP (8) ----
    if ip_end + 8 > n:
        return None
    udp_dst = struct.unpack_from("!H", frame, ip_end + 2)[0]
    if udp_dst != port:
        return None
    tun_off = ip_end + 8

    # ---- Tunnel header ----
    if tunnel == "geneve":
        if tun_off + 8 > n:
            return None
        ver_optlen = frame[tun_off]
        version = ver_optlen >> 6
        if version != 0:
            return None
        opt_len = (ver_optlen & 0x3F) * 4  # options length, in bytes
        # protocol_type at bytes 2..3 of the Geneve base header tells us
        # whether the inner payload is Ethernet (TEB) or a bare L3 packet.
        inner_proto = struct.unpack_from("!H", frame, tun_off + 2)[0]
        inner_start = tun_off + 8 + opt_len
        if inner_start > n or inner_start + 1 > n:
            return None
        inner_payload = frame[inner_start:]
        inner = _wrap_as_ethernet(
            inner_proto, inner_payload, outer_dst_mac, outer_src_mac
        )
        if inner is None:
            return None
        return inner
    elif tunnel == "vxlan":
        if tun_off + 8 > n:
            return None
        # VXLAN (RFC 7348) always carries an inner Ethernet frame, so we
        # just advance past the fixed 8-byte header.
        inner_start = tun_off + 8
        if inner_start + 15 > n:
            return None
        inner = frame[inner_start:]
        inner_et = struct.unpack_from("!H", inner, 12)[0]
        if inner_et not in (
            ETHERTYPE_IPV4,
            ETHERTYPE_IPV6,
            ETHERTYPE_VLAN,
            ETHERTYPE_VLAN_QINQ,
            0x0806,  # ARP
        ):
            return None
        return bytes(inner)
    else:
        return None


# Geneve's "Transparent Ethernet Bridging" protocol_type, RFC 8926 §3.1.
GENEVE_PROTOCOL_TEB = 0x6558


def _wrap_as_ethernet(
    inner_proto: int,
    inner_payload: bytes,
    outer_dst_mac: bytes,
    outer_src_mac: bytes,
) -> Optional[bytes]:
    """Return an Ethernet frame built from *inner_payload*.

    - When the inner payload is already Ethernet (Geneve TEB, 0x6558) we
      return it verbatim after a minimal sanity check on its ethertype.
    - When the inner payload is a bare L3 packet (IPv4 / IPv6 / ARP) we
      prepend a synthetic 14-byte Ethernet header so the output file is
      a well-formed LINKTYPE_ETHERNET pcap — we reuse the outer MACs so
      the addressing at least survives.
    - Anything else: return None so the caller leaves the frame alone.
    """
    if inner_proto == GENEVE_PROTOCOL_TEB:
        if len(inner_payload) < 15:
            return None
        inner_et = struct.unpack_from("!H", inner_payload, 12)[0]
        if inner_et not in (
            ETHERTYPE_IPV4,
            ETHERTYPE_IPV6,
            ETHERTYPE_VLAN,
            ETHERTYPE_VLAN_QINQ,
            0x0806,
        ):
            return None
        return bytes(inner_payload)

    if inner_proto in (ETHERTYPE_IPV4, ETHERTYPE_IPV6, 0x0806):
        eth_hdr = outer_dst_mac + outer_src_mac + struct.pack("!H", inner_proto)
        return eth_hdr + bytes(inner_payload)

    # Unknown inner protocol — bail out.
    return None


# ---------------------------------------------------------------------------
# pcap writer
# ---------------------------------------------------------------------------

def _write_classic_pcap(
    out_path: str,
    frames: Iterable[Tuple[int, int, bytes]],
    snaplen: int = 262144,
) -> None:
    """Write a classic LE-us pcap to *out_path* with Ethernet linktype."""
    with open(out_path, "wb") as f:
        f.write(
            struct.pack(
                "<IHHiIII",
                PCAP_MAGIC_LE,
                2,            # version_major
                4,            # version_minor
                0,            # thiszone
                0,            # sigfigs
                snaplen,
                LINKTYPE_ETHERNET,
            )
        )
        for ts_sec, ts_usec, frame in frames:
            ln = len(frame)
            f.write(struct.pack("<IIII", ts_sec & 0xFFFFFFFF, ts_usec & 0xFFFFFFFF, ln, ln))
            f.write(frame)


# ---------------------------------------------------------------------------
# Orchestrator — read input, decap each packet, write output, ingest as File
# ---------------------------------------------------------------------------

async def _compute_sha256(path: str) -> str:
    sha = hashlib.sha256()
    async with aiofiles.open(path, "rb") as fh:
        while True:
            chunk = await fh.read(8192)
            if not chunk:
                break
            sha.update(chunk)
    return sha.hexdigest()


async def decapsulate_bytes(
    db: AsyncSession,
    *,
    source_bytes: bytes,
    source_name: str,
    opts: DecapOptions,
    out_filename: Optional[str] = None,
) -> Tuple[File, DecapStats]:
    """Run Geneve/VXLAN stripping on the supplied pcap bytes.

    The source bytes are processed entirely in memory and never persisted
    — only the decapsulated output is written to disk and registered as a
    File under the built-in "Decapsulated" category. *source_name* is the
    original filename (for note / default-output-name purposes only).

    Returns ``(new_file, stats)``.
    """
    stats = DecapStats()

    # Decap in-memory; for the typical pcap size in this app (<500MB) this
    # is fine and dramatically simpler than streaming.
    decapped: List[Tuple[int, int, bytes]] = []
    try:
        for ts_sec, ts_usec, frame in _iter_pcap_frames(source_bytes):
            stats.total += 1
            try:
                new_frame, did_g, did_v = _decap_frame(frame, opts)
            except Exception as e:  # pragma: no cover — defensive
                stats.errors += 1
                stats.warn(f"packet {stats.total}: decap error {e!s}")
                new_frame, did_g, did_v = frame, False, False

            if did_g and did_v:
                stats.stripped_both += 1
            elif did_g:
                stats.stripped_geneve += 1
            elif did_v:
                stats.stripped_vxlan += 1
            else:
                stats.passthrough += 1

            decapped.append((ts_sec, ts_usec, new_frame))
    except ValueError as e:
        raise ValueError(f"Failed to read pcap: {e}") from e

    if not decapped:
        raise ValueError("No packets found in source pcap (or unsupported format)")

    # ---- Target path under the built-in "Decapsulated" category ----
    from services.category_service import get_decapsulated_category

    category = await get_decapsulated_category(db)

    dir_path = os.path.join(settings.UPLOAD_DIR, str(category.id))
    os.makedirs(dir_path, exist_ok=True)

    file_uuid = str(_uuid.uuid4())
    dest = os.path.join(dir_path, f"{file_uuid}.pcap")

    # Ensure *filename* ends with .pcap so it's recognized by the rest of
    # the app. We also generate a sensible default when the caller didn't
    # pass one.
    filename = out_filename or _default_output_name(source_name)
    if not filename.lower().endswith(".pcap"):
        filename = f"{filename}.pcap"

    _write_classic_pcap(dest, decapped)

    size = os.path.getsize(dest)
    sha256 = await _compute_sha256(dest)

    note_parts = []
    if opts.strip_geneve:
        note_parts.append(f"Geneve:{opts.geneve_port}")
    if opts.strip_vxlan:
        note_parts.append(f"VXLAN:{opts.vxlan_port}")
    note = (
        f"Decapsulated from '{source_name}' "
        f"(stripped { ' + '.join(note_parts) or 'nothing' }; "
        f"{stats.stripped_both} both, {stats.stripped_geneve} geneve-only, "
        f"{stats.stripped_vxlan} vxlan-only, {stats.passthrough} passthrough)"
    )

    db_file = File(
        uuid=file_uuid,
        name=filename,
        size=size,
        category_id=category.id,
        file_path=dest,
        sha256=sha256,
        note=note,
    )
    db.add(db_file)
    await db.commit()
    await db.refresh(db_file, ["tags", "category"])

    await log_activity(
        db,
        "decapsulate",
        filename,
        f"Decapsulated {stats.total} packets from uploaded '{source_name}'",
    )

    return db_file, stats


def _default_output_name(src_name: str) -> str:
    """Build a default output filename from the source file's display name."""
    base, _ext = os.path.splitext(src_name)
    # Avoid absurdly long names; most pcaps are fine.
    base = base[:180] if len(base) > 180 else base
    return f"{base}.decap.pcap"

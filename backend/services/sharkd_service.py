import asyncio
import base64
import json
import logging
import shutil
from typing import Any, Optional, List

from config import settings

logger = logging.getLogger(__name__)


class SharkdClient:
    """Client for communicating with Wireshark's sharkd daemon via stdin/stdout JSON-RPC 2.0.

    Sharkd (>= 4.x) uses the JSON-RPC 2.0 protocol. On startup it prints the
    greeting "Hello in child." to **stderr** (not stdout), so we must not block
    on reading stdout before sending the first request.
    """

    def __init__(self):
        self._process: Optional[asyncio.subprocess.Process] = None
        self._lock = asyncio.Lock()
        self._available = False
        self._current_file: Optional[str] = None
        self._request_id = 0

    @property
    def available(self) -> bool:
        return self._available

    async def start(self) -> bool:
        """Start sharkd process in pipe mode and verify it responds to a probe."""
        sharkd_path = shutil.which(settings.SHARKD_PATH) or settings.SHARKD_PATH
        try:
            self._process = await asyncio.create_subprocess_exec(
                sharkd_path, "-",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            logger.warning(
                f"Sharkd not found at '{sharkd_path}'. "
                "Pcap viewer will be unavailable. Install Wireshark to enable."
            )
            self._available = False
            return False
        except Exception as e:
            logger.error(f"Failed to launch sharkd: {type(e).__name__}: {e}")
            self._available = False
            return False

        # Mark available *before* the probe so _send_request will run,
        # then verify with a real JSON-RPC call.
        self._available = True
        probe = await self._send_request("status")
        if probe is None or "result" not in probe:
            logger.warning(
                f"Sharkd started but did not respond to probe: {probe!r}. "
                "Pcap viewer disabled."
            )
            await self.stop()
            return False

        logger.info(f"Sharkd started successfully from '{sharkd_path}'")
        return True

    async def stop(self):
        """Stop sharkd process."""
        if self._process:
            try:
                if self._process.stdin and not self._process.stdin.is_closing():
                    self._process.stdin.close()
                try:
                    await asyncio.wait_for(self._process.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    self._process.kill()
                    await self._process.wait()
            except Exception as e:
                logger.debug(f"Error stopping sharkd: {e}")
            self._process = None
        self._available = False
        self._current_file = None

    async def _send_request(self, method: str, params: Optional[dict] = None) -> Optional[dict]:
        """Send a JSON-RPC 2.0 request to sharkd and return the parsed response."""
        if not self._process or not self._available:
            return None

        async with self._lock:
            self._request_id += 1
            request: dict[str, Any] = {
                "jsonrpc": "2.0",
                "id": self._request_id,
                "method": method,
            }
            if params is not None:
                request["params"] = params

            try:
                req_str = json.dumps(request) + "\n"
                self._process.stdin.write(req_str.encode())
                await self._process.stdin.drain()

                response_line = await asyncio.wait_for(
                    self._process.stdout.readline(), timeout=30.0
                )
                if not response_line:
                    logger.error("Sharkd closed stdout unexpectedly")
                    self._available = False
                    return None

                return json.loads(response_line.decode())
            except asyncio.TimeoutError:
                logger.error(f"Sharkd request '{method}' timed out")
                return None
            except Exception as e:
                logger.error(f"Sharkd request '{method}' error: {type(e).__name__}: {e}")
                return None

    async def load(self, file_path: str) -> bool:
        """Load a pcap file into sharkd. Returns True on success."""
        if self._current_file == file_path:
            return True

        result = await self._send_request("load", {"file": file_path})
        if not result:
            return False
        if "error" in result:
            logger.error(f"Sharkd load failed for {file_path}: {result['error']}")
            self._current_file = None
            return False
        self._current_file = file_path
        return True

    async def get_frames(
        self,
        file_path: str,
        offset: int = 0,
        limit: int = 100,
        display_filter: Optional[str] = None,
    ) -> dict:
        """Get frame list from loaded pcap file.

        Sharkd frames response (JSON-RPC 2.0) returns a list where each item
        is like {"c": [No, Time, Source, Destination, Protocol, Length, Info], "num": N}.
        The ordering of `c` follows the default column layout.
        """
        if not await self.load(file_path):
            return {"frames": [], "total": 0}

        params: dict[str, Any] = {"limit": limit}
        # sharkd requires skip to be a *positive* integer (>0); omit when 0.
        if offset and offset > 0:
            params["skip"] = offset
        if display_filter:
            params["filter"] = display_filter

        resp = await self._send_request("frames", params)
        frames: list[dict] = []
        if resp and "result" in resp:
            raw = resp["result"]
            if isinstance(raw, list):
                for f in raw:
                    if isinstance(f, dict):
                        frames.append(self._parse_frame_row(f))

        # Get total frame count via status
        total = len(frames) + offset
        status_resp = await self._send_request("status")
        if status_resp and "result" in status_resp:
            total = status_resp["result"].get("frames", total)

        return {"frames": frames, "total": total}

    @staticmethod
    def _parse_frame_row(f: dict) -> dict:
        """Normalize a sharkd frame entry to our API shape."""
        cols = f.get("c") or []
        # Default column order: No., Time, Source, Destination, Protocol, Length, Info
        def col(i: int) -> str:
            return cols[i] if i < len(cols) else ""

        number = f.get("num")
        try:
            number = int(number) if number is not None else int(col(0) or 0)
        except (TypeError, ValueError):
            number = 0

        length = col(5)
        try:
            length_int = int(length) if length else 0
        except ValueError:
            length_int = 0

        return {
            "number": number,
            "time": col(1),
            "source": col(2),
            "destination": col(3),
            "protocol": col(4),
            "length": length_int,
            "info": col(6),
        }

    async def get_frame_detail(self, file_path: str, frame_num: int) -> Optional[dict]:
        """Get detailed protocol tree for a specific frame."""
        if not await self.load(file_path):
            return None

        resp = await self._send_request("frame", {
            "frame": frame_num,
            "proto": True,
        })
        if not resp or "result" not in resp:
            return None

        tree = resp["result"].get("tree", [])
        return {
            "number": frame_num,
            "protocols": self._parse_protocol_tree(tree),
        }

    async def get_hex_dump(self, file_path: str, frame_num: int) -> Optional[dict]:
        """Get hex dump for a specific frame."""
        if not await self.load(file_path):
            return None

        resp = await self._send_request("frame", {
            "frame": frame_num,
            "bytes": True,
        })
        if not resp or "result" not in resp:
            return None

        bytes_data = resp["result"].get("bytes", "")
        return self._format_hex_dump(bytes_data)

    def _parse_protocol_tree(self, tree: list) -> List[dict]:
        """Parse sharkd protocol tree into structured format.

        Sharkd tree nodes use:
          l: label (display text)
          f: field filter expression (e.g. "ip.src == 10.0.0.1")
          fn: field name (e.g. "ip.src")
          n: child nodes
        """
        protocols: List[dict] = []
        for node in tree:
            if not isinstance(node, dict):
                continue
            label = node.get("l", "")
            proto = {
                "label": label,
                "field": node.get("fn", node.get("f", "")),
                "value": label,
                "children": self._parse_protocol_tree(node.get("n", [])),
            }
            protocols.append(proto)
        return protocols

    def _format_hex_dump(self, hex_string: str) -> dict:
        """Format hex data (base64-encoded bytes from sharkd) into offset/hex/ascii columns."""
        try:
            raw_bytes = base64.b64decode(hex_string) if hex_string else b""
        except Exception:
            try:
                raw_bytes = bytes.fromhex(hex_string) if hex_string else b""
            except Exception:
                raw_bytes = b""

        offsets = []
        hex_lines = []
        ascii_lines = []

        for i in range(0, len(raw_bytes), 16):
            chunk = raw_bytes[i:i + 16]
            offsets.append(f"{i:08x}")
            hex_parts = " ".join(f"{b:02x}" for b in chunk)
            hex_lines.append(hex_parts.ljust(48))
            ascii_part = "".join(
                chr(b) if 32 <= b < 127 else "." for b in chunk
            )
            ascii_lines.append(ascii_part)

        return {
            "offset": offsets,
            "hex": hex_lines,
            "ascii": ascii_lines,
        }

    async def list_all_protocols(self) -> List[str]:
        """Return the full list of protocol short-names Wireshark knows about.

        Implementation note: we intentionally do NOT use sharkd's `complete`
        method here — despite its name suggesting autocompletion, on
        Wireshark 4.x `complete` with `field: "proto"` is interpreted as a
        prefix match against the literal string "proto", so it returns only
        the handful of protocols whose filter names actually start with
        "proto" (e.g. `protobuf`, `protobuf_json`). That was the root cause
        of the "only two protocols in the catalog" bug.

        Instead we shell out to `tshark -G protocols`, which unconditionally
        dumps every registered protocol as a tab-separated line:

            <full name>\\t<short name>\\t<filter name>\\t<enabled>\\t...

        The third column is the protocol filter name (`tcp`, `tls`, `http2`,
        …) — exactly what BPF-style display filters use and what we want
        surfaced in the UI.

        The tshark binary is assumed to live next to the configured sharkd
        binary (a standard Wireshark install ships them together). Result
        is independent of any loaded capture and of the running sharkd
        instance; callers still cache it at the pool level since it never
        changes for a given Wireshark build.

        Returns an empty list if tshark cannot be located or the subprocess
        fails for any reason.
        """
        import os

        # Resolve tshark: prefer a binary sitting next to the configured
        # sharkd (so users who point SHARKD_PATH at a custom install get the
        # matching tshark automatically), else fall back to $PATH.
        sharkd_resolved = shutil.which(settings.SHARKD_PATH) or settings.SHARKD_PATH
        tshark_path: Optional[str] = None
        if sharkd_resolved and os.path.isabs(sharkd_resolved):
            candidate = os.path.join(os.path.dirname(sharkd_resolved), "tshark")
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                tshark_path = candidate
        if not tshark_path:
            tshark_path = shutil.which("tshark")
        if not tshark_path:
            logger.warning("tshark not found; protocol catalog will be empty")
            return []

        try:
            proc = await asyncio.create_subprocess_exec(
                tshark_path, "-G", "protocols",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
        except Exception as e:
            logger.warning(f"Failed to run '{tshark_path} -G protocols': {e}")
            return []

        if proc.returncode != 0:
            logger.warning(
                f"tshark -G protocols exited with {proc.returncode}: "
                f"{stderr.decode('utf-8', errors='replace')[:200]}"
            )
            return []

        names: set[str] = set()
        for raw_line in stdout.decode("utf-8", errors="replace").splitlines():
            # Each line: "<long>\t<short>\t<filter>\t<enabled>\t..."
            # We want column 3 (filter name). Skip malformed / empty lines.
            parts = raw_line.split("\t")
            if len(parts) < 3:
                continue
            filter_name = parts[2].strip()
            if filter_name:
                names.add(filter_name.lower())
        return sorted(names)

    async def get_summary(self, file_path: str) -> str:
        """Get protocol summary for a pcap file (top-level protocols).

        Strategy (version-resilient):

        1. Try the ``phs`` (protocol hierarchy statistics) tap. This is the
           cleanest data source but only exists in Wireshark **4.2+** sharkd.
           On 4.0.x (e.g. Debian bookworm's ``tshark 4.0.17``) sharkd replies
           with ``error: sharkd_session_process_tap() phs not recognized``
           (code -11012), so ``result`` is absent.
        2. Fall back to the ``frames`` method, which has been available since
           Wireshark 3.x. Each frame's ``c[4]`` column is the highest-level
           dissected protocol ("TCP", "HTTP", "DNS", ...). Aggregating those
           gives a summary that matches what the user sees in Wireshark's
           packet list — good enough for the UI chip picker.

        Returning "" means "we truly couldn't tell"; the UI then prompts
        the user to enter protocols manually.
        """
        if not await self.load(file_path):
            return ""

        protocols: set[str] = set()

        # --- attempt 1: phs tap (Wireshark >= 4.2) --------------------------
        resp = await self._send_request("tap", {"tap0": "phs"})
        if resp and "result" in resp:
            def walk(protos: list):
                for p in protos or []:
                    if not isinstance(p, dict):
                        continue
                    name = p.get("proto")
                    if name:
                        protocols.add(name)
                    walk(p.get("protos") or [])

            for tap in resp["result"].get("taps", []):
                walk(tap.get("protos") or [])

        # --- attempt 2: frames method (Wireshark 3.x / 4.0.x fallback) ------
        if not protocols:
            # No explicit row limit: sharkd caps it internally and we only
            # read the ``c[4]`` column, so the response stays small even on
            # large captures. If you hit truly huge pcaps, add ``"limit":N``
            # here — the trade-off is that rarely-seen protocols late in the
            # file would be missed.
            resp = await self._send_request("frames", {})
            if resp and isinstance(resp.get("result"), list):
                for frame in resp["result"]:
                    cols = frame.get("c") if isinstance(frame, dict) else None
                    # Column layout is fixed by sharkd: No, Time, Src, Dst,
                    # Protocol, Length, Info. Guard against schema drift.
                    if isinstance(cols, list) and len(cols) >= 5:
                        proto = cols[4]
                        if isinstance(proto, str) and proto:
                            protocols.add(proto.lower())

        # Drop "frame" (always present in phs) and keep deterministic ordering
        protocols.discard("frame")
        return ", ".join(sorted(protocols)[:10]) if protocols else "Unknown"


class SharkdPool:
    """Pool of SharkdClient instances."""

    def __init__(self, pool_size: int = 2):
        self._pool_size = pool_size
        self._clients: List[SharkdClient] = []
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._available = False
        # Process-level cache of the full protocol catalog. sharkd's protocol
        # table is determined at compile time, so once fetched it's stable for
        # the lifetime of the process.
        self._protocol_catalog: Optional[List[str]] = None

    @property
    def available(self) -> bool:
        return self._available

    async def start(self):
        """Start the pool of sharkd clients."""
        self._semaphore = asyncio.Semaphore(self._pool_size)
        for _ in range(self._pool_size):
            client = SharkdClient()
            if await client.start():
                self._clients.append(client)

        self._available = len(self._clients) > 0
        if self._available:
            logger.info(f"Sharkd pool started with {len(self._clients)} instance(s)")
        else:
            logger.warning("No sharkd instances available. Pcap viewer disabled.")

    async def stop(self):
        """Stop all sharkd clients."""
        for client in self._clients:
            await client.stop()
        self._clients = []
        self._available = False

    async def get_client(self) -> Optional[SharkdClient]:
        """Get an available client from the pool."""
        if not self._available or not self._clients:
            return None
        if self._semaphore:
            await self._semaphore.acquire()
        # Simple round-robin: return first client
        return self._clients[0]

    def release_client(self):
        """Release a client back to the pool."""
        if self._semaphore:
            self._semaphore.release()

    async def get_protocol_catalog(self) -> tuple[List[str], bool]:
        """Return sharkd's full protocol-name catalog (cached).

        Returns a tuple of (protocol_names, was_cached). On the first call
        it queries sharkd once and stores the result; subsequent calls are
        O(1). Returns ([], False) if sharkd is unavailable.
        """
        if self._protocol_catalog is not None:
            return self._protocol_catalog, True
        if not self._available:
            return [], False
        client = await self.get_client()
        if not client:
            return [], False
        try:
            names = await client.list_all_protocols()
        finally:
            self.release_client()
        if names:
            self._protocol_catalog = names
        return names, False


# Global pool instance
sharkd_pool = SharkdPool(pool_size=settings.SHARKD_POOL_SIZE)

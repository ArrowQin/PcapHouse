"""Manage loopback IP aliases for pcap generation.

Each pcap-generation task needs a unique pair of IPs bound to the loopback
interface so tcpdump can capture traffic between them. The exact syntax
differs per OS:

* **macOS / BSD** — ``ifconfig lo0 alias <ip> netmask 255.255.255.255`` and
  ``ifconfig lo0 -alias <ip>``. Capture interface is ``lo0``.

* **Linux** (including Docker containers) — ``ip addr add <ip>/32 dev lo``
  and ``ip addr del <ip>/32 dev lo``. Capture interface is ``lo``. The
  container must have ``NET_ADMIN`` (for address changes) and ``NET_RAW``
  (for tcpdump) capabilities.

The platform is detected once at import time and exposed as
:data:`LOOPBACK_IFACE` so the capture pipeline can pick the right
interface name without duplicating the detection logic.

Security
--------
All privileged commands are launched with
:func:`asyncio.create_subprocess_exec` using a pre-built argv list (never
through a shell). This prevents shell metacharacters in any argument
(e.g. a maliciously crafted IP) from being interpreted as additional
commands. The IP is additionally validated via :mod:`ipaddress` before
the argv list is assembled, so even a reachable argv won't ever contain
arbitrary user text.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import sys
from typing import List

from services._sudo import SUDO_PREFIX_ARGV, with_sudo_argv

logger = logging.getLogger(__name__)


def _detect_loopback_iface() -> str:
    """Return the loopback interface name for the current OS."""
    # darwin = macOS; everything else (linux, *bsd-ish containers) uses "lo".
    # BSD *hosts* would also need "lo0" but PcapHouse only supports macOS
    # for the BSD family today, so this simple branch is sufficient.
    return "lo0" if sys.platform == "darwin" else "lo"


LOOPBACK_IFACE: str = _detect_loopback_iface()
_IS_MACOS = sys.platform == "darwin"


def _validate_ip(ip: str) -> str:
    """Ensure *ip* is a valid IPv4/IPv6 literal before it reaches argv.

    Raises :class:`ValueError` on anything that isn't a plain IP literal
    (including CIDR suffixes, whitespace, shell metacharacters, etc.).
    """
    # ip_address rejects trailing junk, slashes, spaces and metacharacters.
    ipaddress.ip_address(ip)
    return ip


def _add_argv(ip: str) -> List[str]:
    if _IS_MACOS:
        return ["ifconfig", LOOPBACK_IFACE, "alias", ip, "netmask", "255.255.255.255"]
    # Linux: ``ip`` is provided by iproute2; present in every modern distro.
    return ["ip", "addr", "add", f"{ip}/32", "dev", LOOPBACK_IFACE]


def _del_argv(ip: str) -> List[str]:
    if _IS_MACOS:
        return ["ifconfig", LOOPBACK_IFACE, "-alias", ip]
    return ["ip", "addr", "del", f"{ip}/32", "dev", LOOPBACK_IFACE]


class NetworkManager:
    """Create and tear down loopback aliases for a single generation task."""

    def __init__(self) -> None:
        self._aliases: List[str] = []

    async def add_alias(self, ip: str) -> None:
        """Add *ip* as an alias on the loopback interface."""
        ip = _validate_ip(ip)
        argv = with_sudo_argv(_add_argv(ip))
        logger.debug("add alias argv: %s", argv)
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            err = stderr.decode(errors="replace").strip()
            # EEXIST is harmless — another concurrent task or a leftover
            # from a previous run already installed the alias. Both
            # ``ifconfig`` and ``ip`` report this in stderr; detect it
            # loosely so we don't have to parse per-OS error codes.
            if "exists" in err.lower() or "file exists" in err.lower():
                logger.debug("alias %s already present, reusing", ip)
                self._aliases.append(ip)
                return
            hint = (
                "Start the backend as root (recommended): "
                "`sudo ./pcaphouse.sh start backend` on macOS, or run the "
                "docker-compose stack which grants NET_ADMIN/NET_RAW; "
                "alternatively configure sudoers NOPASSWD for ifconfig/ip/tcpdump."
            )
            raise RuntimeError(
                f"Failed to add loopback alias {ip} (exit {proc.returncode}): {err}\n"
                f"Hint: {hint}"
            )
        self._aliases.append(ip)
        logger.info(
            "loopback alias added: %s on %s (sudo=%s)",
            ip, LOOPBACK_IFACE, bool(SUDO_PREFIX_ARGV),
        )

    async def remove_alias(self, ip: str) -> None:
        """Remove *ip* alias from the loopback interface. Best-effort."""
        try:
            ip = _validate_ip(ip)
        except ValueError:
            # Stay defensive: never pass anything non-IP to argv, even in
            # best-effort cleanup paths.
            logger.warning("remove_alias got invalid ip %r; skipping", ip)
            return
        argv = with_sudo_argv(_del_argv(ip))
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        if ip in self._aliases:
            self._aliases.remove(ip)
        logger.info(
            "loopback alias removed: %s on %s (rc=%d, sudo=%s)",
            ip, LOOPBACK_IFACE, proc.returncode, bool(SUDO_PREFIX_ARGV),
        )

    async def cleanup(self) -> None:
        """Remove every alias that was added via this instance."""
        for ip in list(self._aliases):
            await self.remove_alias(ip)

"""Decide whether a privileged command needs a ``sudo`` prefix.

PcapHouse calls ``ifconfig``/``ip`` (for loopback aliases) and ``tcpdump``
(for packet capture) — both need root. There are three supported modes:

1. **Backend started as root** (e.g. ``sudo ./pcaphouse.sh start`` on
   macOS, or running inside the docker-compose backend container which
   has ``NET_ADMIN``/``NET_RAW`` and runs as root). ``os.geteuid() == 0``
   is true, so we run the commands directly with no prefix — no password
   prompts, no sudoers changes needed.

2. **Backend started as a normal user** with sudoers NOPASSWD configured
   for ``ifconfig``/``ip``/``tcpdump``.  We emit ``sudo -n`` so a missing
   NOPASSWD entry fails fast instead of blocking on a tty prompt.

3. **Inside a container without root but with the required Linux
   capabilities** (uncommon). ``sudo -n`` usually still works if sudo is
   installed; otherwise mode 1 is strongly recommended.

The decision is computed once at import time; callers use
:func:`with_sudo_argv` to prepend ``["sudo", "-n"]`` to their argv list
so commands can be safely executed via ``asyncio.create_subprocess_exec``
without going through a shell (which would be vulnerable to command
injection if any argument contained shell metacharacters).
"""

from __future__ import annotations

import os
from typing import List, Sequence


def _compute_prefix_argv() -> List[str]:
    # Running as root → no prefix needed.
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        return []
    # Otherwise fall back to non-interactive sudo; user is expected to have
    # configured NOPASSWD for ifconfig/tcpdump.
    return ["sudo", "-n"]


# Argv-style prefix. Empty list means "run directly as current user".
SUDO_PREFIX_ARGV: List[str] = _compute_prefix_argv()

# Kept for backwards compatibility / logging. Do NOT feed this into a
# shell command that also concatenates user input — that is a command
# injection vulnerability. Use :data:`SUDO_PREFIX_ARGV` instead.
SUDO_PREFIX: str = " ".join(SUDO_PREFIX_ARGV)


def with_sudo_argv(argv: Sequence[str]) -> List[str]:
    """Return *argv* with ``["sudo", "-n"]`` prepended when not already root.

    The returned list is always a fresh list suitable for passing straight
    to :func:`asyncio.create_subprocess_exec` (``*cmd``). Every argument
    is preserved as-is — no shell interpretation is performed, which is
    exactly why this form is safe against argument-based injection.
    """
    return [*SUDO_PREFIX_ARGV, *argv]

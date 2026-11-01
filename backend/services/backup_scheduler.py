"""Daily backup scheduler.

A single long-running asyncio task loops forever, sleeping until the
next configured run time and then triggering :func:`run_backup`. It
does **not** use cron/APScheduler — the requirements are modest (one
daily trigger, re-read config every cycle) and an in-process loop keeps
the deployment a single container with no extra processes.

Design notes
------------
* The scheduler re-fetches ``BackupConfig`` on every iteration so
  config changes take effect immediately without a restart.
* ``schedule_time`` is interpreted in the server's **local** time zone
  (the container's /etc/timezone). That's what users expect from a
  "daily at 03:00" input on a settings page. UTC-only scheduling would
  surprise users in non-UTC locales far more than TZ edge cases would.
* We deliberately tolerate small time drift: the loop sleeps with a
  60-second ceiling so a clock change or an ``enabled`` toggle can be
  picked up promptly without needing a wake signal.
* Missed runs (e.g. machine asleep at 03:00) are NOT replayed — the
  semantics is "run at most once per configured time, fire-and-forget".
  Users can hit "Backup now" if they want an out-of-band snapshot.

Safety
------
Exceptions inside the loop are caught and logged so a single failure
doesn't crash the lifespan task; the scheduler retries on the next
tick.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from database import async_session
from services import backup_service

logger = logging.getLogger("pcaphouse.backup_scheduler")

# When the scheduler has nothing to do (disabled / no valid time), it
# still polls at this interval so config changes take effect within a
# minute without an explicit wake-up.
_IDLE_POLL_SECONDS = 60

# When the scheduler is waiting for a scheduled run, we still wake up
# at least this often to re-check whether the config changed under us
# (e.g. user disabled the schedule, moved the time earlier, etc.).
_MAX_SLEEP_SECONDS = 60


def _parse_hhmm(value: str) -> tuple[int, int] | None:
    """Return ``(hh, mm)`` or ``None`` if ``value`` is malformed."""
    if not value or ":" not in value:
        return None
    try:
        h_str, m_str = value.split(":", 1)
        h = int(h_str)
        m = int(m_str)
    except ValueError:
        return None
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return h, m


def _next_run_at(now: datetime, hh: int, mm: int) -> datetime:
    """Return the next wall-clock time at which ``HH:MM`` occurs.

    If today's ``HH:MM`` is still in the future we return that; otherwise
    tomorrow's. Math is done on naive local-time datetimes because
    that's what the user provided via the settings page — see the
    module docstring for the rationale.
    """
    candidate = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if candidate <= now:
        candidate = candidate + timedelta(days=1)
    return candidate


class BackupScheduler:
    """Thin wrapper around the loop task so FastAPI's lifespan can start/stop it."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        # Tracks the most recent "scheduled slot" we fired at, to avoid
        # firing twice in the same minute if the loop wakes up multiple
        # times during that minute (which would otherwise be possible
        # given the 60s cap on sleep intervals).
        self._last_fired_slot: datetime | None = None

    async def start(self) -> None:
        if self._task is not None:
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run(), name="backup-scheduler")
        logger.info("Backup scheduler started")

    async def stop(self) -> None:
        if self._task is None:
            return
        assert self._stop_event is not None
        self._stop_event.set()
        try:
            await asyncio.wait_for(self._task, timeout=5)
        except asyncio.TimeoutError:
            self._task.cancel()
        self._task = None
        self._stop_event = None
        logger.info("Backup scheduler stopped")

    async def _run(self) -> None:
        assert self._stop_event is not None
        while not self._stop_event.is_set():
            try:
                sleep_for = await self._tick()
            except Exception:  # noqa: BLE001
                logger.exception("Backup scheduler iteration failed")
                sleep_for = _IDLE_POLL_SECONDS
            # Sleep until the next tick, but wake early if we're asked
            # to stop. ``wait_for`` gives us both signals cheaply.
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=sleep_for)
                # wait returned → stop_event set → exit loop
                return
            except asyncio.TimeoutError:
                continue

    async def _tick(self) -> float:
        """One iteration of the loop. Returns how long to sleep before the next tick."""
        async with async_session() as db:
            cfg = await backup_service.get_or_create_config(db)

            if not cfg.enabled:
                return _IDLE_POLL_SECONDS

            parsed = _parse_hhmm(cfg.schedule_time)
            if parsed is None:
                logger.warning(
                    "Backup schedule_time %r is invalid; idling", cfg.schedule_time
                )
                return _IDLE_POLL_SECONDS
            hh, mm = parsed

            now = datetime.now()  # local time, intentional
            next_at = _next_run_at(now, hh, mm)
            delta = (next_at - now).total_seconds()

            # Are we currently within the "fire window" for today's slot?
            # We treat any tick that arrives within 60 seconds *after*
            # the nominal HH:MM as belonging to that slot.
            today_slot = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
            if now >= today_slot and (now - today_slot).total_seconds() < 60:
                if self._last_fired_slot != today_slot:
                    self._last_fired_slot = today_slot
                    logger.info(
                        "Triggering scheduled backup for slot %s", today_slot.isoformat()
                    )
                    outcome = await backup_service.run_backup(db, trigger="scheduled")
                    logger.info(
                        "Scheduled backup finished: %s — %s",
                        outcome.status,
                        outcome.message,
                    )
                # Sleep just past the end of the fire window so we don't
                # re-enter this branch until tomorrow.
                return max(5.0, 60 - (now - today_slot).total_seconds())

            # Otherwise, sleep until the next slot — but cap at 60s so
            # config edits take effect quickly.
            return min(delta, float(_MAX_SLEEP_SECONDS))


# Process-wide singleton, imported by main.py's lifespan.
scheduler = BackupScheduler()

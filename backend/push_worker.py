import argparse
import logging
import signal
import threading
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from types import FrameType
from typing import Literal, TypedDict

from sqlalchemy.orm import sessionmaker

from config import Settings, get_settings

logger = logging.getLogger(__name__)


class PushWorkerSnapshot(TypedDict):
    running: bool
    last_successful_cycle_at: datetime | None
    last_error_at: datetime | None
    last_error: str | None
    last_cycle_counts: dict[str, int]


class NotificationRuntime(TypedDict):
    configured: bool
    mode: Literal["embedded", "external", "disabled"]
    status: Literal["ready", "starting", "unavailable", "external", "disabled"]
    last_cycle_at: datetime | None


class PushWorkerState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._running = False
        self._last_successful_cycle_at: datetime | None = None
        self._last_error_at: datetime | None = None
        self._last_error: str | None = None
        self._last_cycle_counts: dict[str, int] = {}

    def mark_started(self) -> None:
        with self._lock:
            self._running = True

    def mark_stopped(self) -> None:
        with self._lock:
            self._running = False

    def record_success(
        self,
        counts: dict[str, int],
        *,
        at: datetime | None = None,
    ) -> None:
        with self._lock:
            self._last_successful_cycle_at = at or datetime.now(UTC)
            self._last_cycle_counts = dict(counts)

    def record_error(self, exc: Exception, *, at: datetime | None = None) -> None:
        with self._lock:
            self._last_error_at = at or datetime.now(UTC)
            # Exception messages may contain provider responses or credentials.
            self._last_error = type(exc).__name__[:255]

    def snapshot(self) -> PushWorkerSnapshot:
        with self._lock:
            return {
                "running": self._running,
                "last_successful_cycle_at": self._last_successful_cycle_at,
                "last_error_at": self._last_error_at,
                "last_error": self._last_error,
                "last_cycle_counts": dict(self._last_cycle_counts),
            }


def notification_runtime(
    settings: Settings,
    state: PushWorkerState,
    *,
    now: datetime | None = None,
) -> NotificationRuntime:
    if not settings.push_enabled:
        return {
            "configured": False,
            "mode": "disabled",
            "status": "disabled",
            "last_cycle_at": None,
        }
    if not settings.PUSH_SCHEDULER_IN_API:
        return {
            "configured": True,
            "mode": "external",
            "status": "external",
            "last_cycle_at": None,
        }

    snapshot = state.snapshot()
    last_cycle_at = snapshot["last_successful_cycle_at"]
    if not snapshot["running"]:
        worker_status: Literal["ready", "starting", "unavailable"] = "unavailable"
    elif last_cycle_at is None:
        worker_status = "unavailable" if snapshot["last_error_at"] else "starting"
    else:
        current = now or datetime.now(UTC)
        if current.tzinfo is None:
            current = current.replace(tzinfo=UTC)
        cycle_at = last_cycle_at
        if cycle_at.tzinfo is None:
            cycle_at = cycle_at.replace(tzinfo=UTC)
        last_error_at = snapshot["last_error_at"]
        if last_error_at is not None and last_error_at.tzinfo is None:
            last_error_at = last_error_at.replace(tzinfo=UTC)
        freshness = timedelta(
            seconds=max(30, settings.PUSH_WORKER_POLL_SECONDS * 2 + 5)
        )
        worker_status = (
            "ready"
            if current - cycle_at <= freshness
            and (last_error_at is None or last_error_at <= cycle_at)
            else "unavailable"
        )

    return {
        "configured": True,
        "mode": "embedded",
        "status": worker_status,
        "last_cycle_at": last_cycle_at,
    }


def validate_worker_settings(settings: Settings) -> None:
    if not settings.push_enabled or not settings.vapid_private_key:
        raise RuntimeError("The push worker requires a complete VAPID configuration")


def run_worker(
    settings: Settings,
    *,
    once: bool = False,
    stop_event: threading.Event | None = None,
    state: PushWorkerState | None = None,
    session_factory: sessionmaker | None = None,
) -> int:
    validate_worker_settings(settings)
    from push_scheduler import run_push_cycle

    if session_factory is None:
        from database import SessionLocal

        session_factory = SessionLocal
    stopped = stop_event or threading.Event()
    worker_state = state or PushWorkerState()
    worker_state.mark_started()
    logger.info("Push worker started")
    try:
        while not stopped.is_set():
            try:
                result = run_push_cycle(
                    session_factory,
                    settings,
                    stop_event=stopped,
                )
                worker_state.record_success(result)
                if result["enqueued"] or result["processed"]:
                    logger.info(
                        "Push cycle completed: enqueued=%s processed=%s",
                        result["enqueued"],
                        result["processed"],
                    )
            except Exception as exc:
                worker_state.record_error(exc)
                logger.error("Push worker cycle failed (%s)", type(exc).__name__)
                if once:
                    return 1
            if once:
                return 0
            stopped.wait(settings.PUSH_WORKER_POLL_SECONDS)
        return 0
    finally:
        worker_state.mark_stopped()
        logger.info("Push worker stopped")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the durable Ritmo push worker")
    parser.add_argument(
        "--once",
        action="store_true",
        help="run one enqueue/delivery cycle and exit",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    stopped = threading.Event()

    def request_stop(_signum: int, _frame: FrameType | None) -> None:
        stopped.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    try:
        return run_worker(get_settings(), once=args.once, stop_event=stopped)
    except RuntimeError as exc:
        logger.error("Push worker configuration error: %s", exc)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

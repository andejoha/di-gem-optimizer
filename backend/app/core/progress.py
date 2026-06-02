"""Progress reporting for the optimization pipeline.

Provides a lightweight callback protocol that can be threaded through the core
optimizer functions without coupling them to any web framework.  The default
``NullReporter`` is a no-op so all existing callers (tests, plain POST) work
unchanged.  The ``QueueReporter`` feeds a ``queue.Queue`` that the SSE route
handler drains to stream events to the browser.
"""

import queue
import time
from typing import Protocol


class ProgressReporter(Protocol):
    def report(
        self,
        stage: str,
        status: str,
        *,
        iteration: int | None = None,
        detail: str | None = None,
        force: bool = False,
    ) -> None: ...


class NullReporter:
    """No-op reporter used by all non-SSE code paths."""

    def report(
        self,
        stage: str,
        status: str,
        *,
        iteration: int | None = None,
        detail: str | None = None,
        force: bool = False,
    ) -> None:
        pass


class QueueReporter:
    """Puts progress events onto a queue for the SSE generator to consume.

    Throttles rapid iteration reports to at most one per ``min_interval``
    seconds so the SSE stream is not flooded on fast loops.  Stage-transition
    calls (``force=True``) are always sent immediately.
    """

    def __init__(self, q: queue.Queue, min_interval: float = 1.0) -> None:
        self._q = q
        self._min_interval = min_interval
        self._last_time: float = 0.0

    def report(
        self,
        stage: str,
        status: str,
        *,
        iteration: int | None = None,
        detail: str | None = None,
        force: bool = False,
    ) -> None:
        now = time.monotonic()
        if not force and (now - self._last_time) < self._min_interval:
            return
        self._last_time = now
        self._q.put(
            {
                "stage": stage,
                "status": status,
                "iteration": iteration,
                "detail": detail,
            }
        )

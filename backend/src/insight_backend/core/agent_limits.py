from __future__ import annotations

import logging
from contextvars import ContextVar
import threading
from typing import Dict

from .config import settings


log = logging.getLogger("insight.core.agent_limits")


class AgentBudgetExceeded(RuntimeError):
    """Raised when an agent exceeds its configured request budget."""


_limits_var: ContextVar[Dict[str, int] | None] = ContextVar("agent_limits", default=None)
_counts_var: ContextVar[Dict[str, int] | None] = ContextVar("agent_counts", default=None)
_counts_lock = threading.Lock()


def reset_from_settings() -> None:
    """Initialize per-request agent limits and reset counters.

    Should be called at the beginning of a request handling context (e.g., in API routes)
    to enforce AGENT_MAX_REQUESTS for the duration of that request.
    """
    caps = dict(settings.agent_max_requests)
    _limits_var.set(caps or {})
    _counts_var.set({})
    if caps:
        log.debug("Agent limits active: %s", caps)


def get_limit(agent: str) -> int | None:
    limits = _limits_var.get() or {}
    return limits.get(agent)


def get_count(agent: str) -> int:
    counts = _counts_var.get() or {}
    return int(counts.get(agent, 0))


def check_and_increment(agent: str) -> None:
    """Increment usage for ``agent`` and enforce its cap if configured.

    If no cap is configured, this is a no-op.
    Raises AgentBudgetExceeded when exceeding the configured cap.
    """
    limits = _limits_var.get() or {}
    if not limits:
        return  # no limits configured
    cap = limits.get(agent)
    if cap is None:
        return  # agent not capped
    with _counts_lock:
        counts = _counts_var.get()
        if counts is None:
            counts = {}
            _counts_var.set(counts)
        current = int(counts.get(agent, 0))
        new_val = current + 1
        if new_val > cap:
            log.warning("Agent %s exceeded request cap (%d/%d)", agent, new_val, cap)
            # Do not persist the overflow attempt; keep the stored counter <= cap
            raise AgentBudgetExceeded(f"Limite de requêtes atteinte pour l'agent '{agent}' ({cap})")
        # Update in place to keep shared counters consistent across threads.
        counts[agent] = new_val

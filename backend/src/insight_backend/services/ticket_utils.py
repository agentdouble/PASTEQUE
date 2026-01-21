from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Dict, List

from ..core.config import settings


log = logging.getLogger("insight.services.tickets")


def parse_ticket_date(raw: Any) -> date | None:
    if raw is None:
        return None
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    if isinstance(raw, datetime):
        return raw.date()
    text = str(raw).strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None


def prepare_ticket_entries(
    *,
    rows: List[Dict[str, Any]],
    text_column: str,
    date_column: str,
) -> List[Dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for row in rows:
        text_raw = row.get(text_column)
        text_value = str(text_raw).strip() if text_raw is not None else ""
        if not text_value:
            continue
        dt = parse_ticket_date(row.get(date_column))
        if not dt:
            log.warning("Ligne ignorée: date invalide (%r)", row.get(date_column))
            continue
        ticket_id = row.get("ticket_id") or row.get("id") or row.get("ref")
        entries.append(
            {
                "text": text_value,
                "date": dt,
                "ticket_id": ticket_id,
                "raw": dict(row),
            }
        )
    entries.sort(key=lambda item: item["date"], reverse=True)
    log.info("Tickets préparés: %d", len(entries))
    return entries


def format_ticket_context(items: List[Dict[str, Any]]) -> tuple[List[str], bool]:
    cap = max(1, int(settings.loop_max_tickets))
    max_chars = max(32, int(settings.loop_ticket_text_max_chars))
    trimmed = items[:cap]
    lines: list[str] = []
    for idx, item in enumerate(trimmed, start=1):
        text = item["text"]
        if len(text) > max_chars:
            text = text[: max_chars - 1] + "…"
        prefix = f"{item['date'].isoformat()}"
        ticket_id = item.get("ticket_id")
        if ticket_id:
            prefix = f"{prefix} #{ticket_id}"
        lines.append(f"{idx}. {prefix} — {text}")
    return lines, len(items) > cap


def chunk_ticket_items(items: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    max_tickets = max(1, int(settings.loop_max_tickets_per_call))
    max_chars = max(1000, int(settings.loop_max_input_chars))
    chunks: list[list[Dict[str, Any]]] = []
    current: list[Dict[str, Any]] = []
    current_chars = 0

    def _ticket_cost(item: dict[str, Any]) -> int:
        text = str(item.get("text") or "")
        return min(len(text), settings.loop_ticket_text_max_chars)

    for item in items:
        cost = _ticket_cost(item)
        if current and (len(current) >= max_tickets or (current_chars + cost) > max_chars):
            chunks.append(current)
            current = []
            current_chars = 0
        current.append(item)
        current_chars += cost

    if current:
        chunks.append(current)

    return chunks or [items]


def truncate_text(value: Any, *, max_chars: int | None = None) -> str:
    text = str(value or "")
    limit = max_chars if max_chars is not None else settings.loop_ticket_text_max_chars
    if limit <= 0 or len(text) <= limit:
        return text
    return text[: max(limit - 1, 0)] + "…"

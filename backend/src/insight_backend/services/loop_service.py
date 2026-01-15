from __future__ import annotations

import calendar
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Tuple

from fastapi import HTTPException, status

from ..core.config import settings
from ..repositories.data_repository import DataRepository
from ..repositories.loop_repository import LoopRepository
from ..services.looper_agent import LooperAgent
from ..models.loop import LoopConfig, LoopSummary


log = logging.getLogger("insight.services.loop")


class LoopService:
    def __init__(
        self,
        repo: LoopRepository,
        data_repo: DataRepository,
        agent: LooperAgent | None = None,
    ):
        self.repo = repo
        self.data_repo = data_repo
        self.agent = agent or LooperAgent()

    # --- Public API ----------------------------------------------------
    def get_overview(
        self, *, allowed_tables: Iterable[str] | None = None
    ) -> list[tuple[LoopConfig, list[LoopSummary], list[LoopSummary], list[LoopSummary]]]:
        configs = self.repo.list_configs()
        if allowed_tables is not None:
            allowed_lookup = {name.casefold() for name in allowed_tables}
            configs = [config for config in configs if config.table_name.casefold() in allowed_lookup]
        items: list[tuple[LoopConfig, list[LoopSummary], list[LoopSummary], list[LoopSummary]]] = []
        for config in configs:
            daily = self.repo.list_by_kind(kind="daily", config_id=config.id)[:1]
            weekly = self.repo.list_by_kind(kind="weekly", config_id=config.id)[:1]
            monthly = self.repo.list_by_kind(kind="monthly", config_id=config.id)[:1]
            items.append((config, daily, weekly, monthly))
        return items

    def save_config(self, *, table_name: str, text_column: str, date_column: str) -> LoopConfig:
        self._validate_columns(table_name=table_name, text_column=text_column, date_column=date_column)
        existing = self.repo.get_config_by_table(table_name)
        previous = (existing.text_column, existing.date_column) if existing else None
        config = self.repo.save_config(
            table_name=table_name,
            text_column=text_column,
            date_column=date_column,
        )
        if previous and previous != (config.text_column, config.date_column):
            # Purge les résumés obsolètes pour éviter toute confusion sur cette table
            self.repo.replace_summaries(config=config, items=[])
        return config

    def regenerate(
        self, *, table_name: str | None = None
    ) -> list[tuple[LoopConfig, list[LoopSummary], list[LoopSummary], list[LoopSummary]]]:
        configs = self.repo.list_configs()
        if table_name:
            lookup = table_name.casefold()
            configs = [config for config in configs if config.table_name.casefold() == lookup]
            if not configs:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Aucune configuration loop trouvée pour la table {table_name}.",
                )

        if not configs:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Aucune configuration loop n'est définie.",
            )

        results: list[tuple[LoopConfig, list[LoopSummary], list[LoopSummary], list[LoopSummary]]] = []
        for config in configs:
            results.append(self._regenerate_for_config(config))
        return results

    def _regenerate_for_config(
        self, config: LoopConfig
    ) -> tuple[LoopConfig, list[LoopSummary], list[LoopSummary], list[LoopSummary]]:
        try:
            rows = self.data_repo.read_rows(config.table_name)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

        entries = self._prepare_entries(rows=rows, text_column=config.text_column, date_column=config.date_column)
        if not entries:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Aucun ticket exploitable pour la table {config.table_name}.",
            )

        daily_groups = self._group_by_day(entries)
        weekly_groups = self._group_by_week(entries)
        monthly_groups = self._group_by_month(entries)
        if not daily_groups and not weekly_groups and not monthly_groups:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Impossible de constituer des groupes journaliers, hebdomadaires ou mensuels avec les données présentes pour {config.table_name}.",
            )

        payloads: list[dict] = []
        for group in daily_groups:
            content = self._summarize_group(group, kind="daily")
            payloads.append(content)
        for group in weekly_groups:
            content = self._summarize_group(group, kind="weekly")
            payloads.append(content)

        for group in monthly_groups:
            content = self._summarize_group(group, kind="monthly")
            payloads.append(content)

        saved = self.repo.replace_summaries(config=config, items=payloads)
        now = datetime.now(timezone.utc)
        self.repo.touch_generated(config_id=config.id, ts=now)

        daily = [item for item in saved if item.kind == "daily"][:1]
        weekly = [item for item in saved if item.kind == "weekly"][:1]
        monthly = [item for item in saved if item.kind == "monthly"][:1]
        return config, daily, weekly, monthly

    # --- Helpers -------------------------------------------------------
    def _validate_columns(self, *, table_name: str, text_column: str, date_column: str) -> None:
        try:
            cols = [name for name, _ in self.data_repo.get_schema(table_name)]
        except FileNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        missing: list[str] = []
        for col in (text_column, date_column):
            if col not in cols:
                missing.append(col)
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Colonnes manquantes dans {table_name}: {', '.join(missing)}",
            )

    def _prepare_entries(self, *, rows: List[Dict[str, Any]], text_column: str, date_column: str) -> List[Dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for row in rows:
            text_raw = row.get(text_column)
            text_value = str(text_raw).strip() if text_raw is not None else ""
            if not text_value:
                continue
            dt = self._parse_date(row.get(date_column))
            if not dt:
                log.warning("Ligne ignorée: date invalide (%r)", row.get(date_column))
                continue
            ticket_id = row.get("ticket_id") or row.get("id") or row.get("ref")
            entries.append(
                {
                    "text": text_value,
                    "date": dt,
                    "ticket_id": ticket_id,
                }
            )
        entries.sort(key=lambda item: item["date"], reverse=True)
        log.info("Tickets préparés pour loop: %d", len(entries))
        return entries

    def _parse_date(self, raw: Any) -> date | None:
        if raw is None:
            return None
        if isinstance(raw, date):
            return raw
        if isinstance(raw, datetime):
            return raw.date()
        text = str(raw).strip()
        if not text:
            return None
        # Essais restreints pour rester explicites sur les formats acceptés
        for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(text, fmt).date()
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(text).date()
        except ValueError:
            return None

    def _group_by_week(self, entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        buckets: dict[tuple[int, int], list[dict[str, Any]]] = {}
        for item in entries:
            d: date = item["date"]
            iso = d.isocalendar()
            key = (iso.year, iso.week)
            buckets.setdefault(key, []).append(item)
        groups: list[dict[str, Any]] = []
        for (year, week), items in buckets.items():
            start = date.fromisocalendar(year, week, 1)
            end = start + timedelta(days=6)
            groups.append(
                {
                    "label": f"{year}-S{week:02d}",
                    "start": start,
                    "end": end,
                    "items": items,
                }
            )
        groups.sort(key=lambda g: g["start"], reverse=True)
        limit = max(1, int(settings.loop_max_weeks))
        return groups[:limit]

    def _group_by_month(self, entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        buckets: dict[tuple[int, int], list[dict[str, Any]]] = {}
        for item in entries:
            d: date = item["date"]
            key = (d.year, d.month)
            buckets.setdefault(key, []).append(item)
        groups: list[dict[str, Any]] = []
        for (year, month), items in buckets.items():
            start = date(year, month, 1)
            last_day = calendar.monthrange(year, month)[1]
            end = date(year, month, last_day)
            groups.append(
                {
                    "label": f"{year}-{month:02d}",
                    "start": start,
                    "end": end,
                    "items": items,
                }
            )
        groups.sort(key=lambda g: g["start"], reverse=True)
        limit = max(1, int(settings.loop_max_months))
        return groups[:limit]

    def _group_by_day(self, entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        buckets: dict[date, list[dict[str, Any]]] = {}
        for item in entries:
            buckets.setdefault(item["date"], []).append(item)

        limit = max(1, int(settings.loop_max_days))
        today = date.today()
        ordered_dates: list[date] = [today] + [d for d in sorted(buckets.keys(), reverse=True) if d != today]

        seen: set[date] = set()
        selected: list[date] = []
        for d in ordered_dates:
            if d in seen:
                continue
            seen.add(d)
            selected.append(d)
            if len(selected) >= limit:
                break

        if not selected:
            selected = [today]

        groups: list[dict[str, Any]] = []
        for current in selected:
            items = sorted(buckets.get(current, []), key=lambda item: item["date"], reverse=True)
            groups.append(
                {
                    "label": current.isoformat(),
                    "start": current,
                    "end": current,
                    "items": items,
                }
            )

        return groups

    def _format_context(self, items: List[Dict[str, Any]]) -> Tuple[List[str], bool]:
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

    def _chunk_items(self, items: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
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

    def _summarize_group(self, group: Dict[str, Any], *, kind: str) -> dict:
        items = group["items"]
        if not items:
            return {
                "kind": kind,
                "period_label": group["label"],
                "period_start": group["start"],
                "period_end": group["end"],
                "ticket_count": 0,
                "content": "Aucun ticket enregistré sur cette période. Aucun suivi requis.",
            }
        chunks = self._chunk_items(items)
        partial_summaries: list[str] = []

        for idx, chunk in enumerate(chunks, start=1):
            lines, truncated = self._format_context(chunk)
            if truncated:
                log.warning(
                    "Context %s %s tronqué à %d tickets (chunk=%d/%d total_chunk_tickets=%d)",
                    kind,
                    group["label"],
                    len(lines),
                    idx,
                    len(chunks),
                    len(chunk),
                )
            partial = self.agent.summarize(
                period_label=f"{group['label']} (part {idx}/{len(chunks)})",
                period_start=group["start"],
                period_end=group["end"],
                tickets=lines,
                total_tickets=len(chunk),
            )
            partial_summaries.append(partial)

        if len(partial_summaries) == 1:
            final_content = partial_summaries[0]
        else:
            tickets = [
                f"Synthèse partielle {i+1}/{len(partial_summaries)} : {text}"
                for i, text in enumerate(partial_summaries)
            ]
            final_content = self.agent.summarize(
                period_label=f"{group['label']} (fusion)",
                period_start=group["start"],
                period_end=group["end"],
                tickets=tickets,
                total_tickets=len(items),
            )
        return {
            "kind": kind,
            "period_label": group["label"],
            "period_start": group["start"],
            "period_end": group["end"],
            "ticket_count": len(items),
            "content": final_content,
        }

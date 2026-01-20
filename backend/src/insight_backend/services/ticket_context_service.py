from __future__ import annotations

import logging
from datetime import date
from typing import Any, Dict, Iterable, List

from fastapi import HTTPException, status

from ..core.config import settings
from ..repositories.data_repository import DataRepository
from ..repositories.loop_repository import LoopRepository
from ..repositories.data_source_preference_repository import (
    DataSourcePreferenceRepository,
    DataSourcePreferences,
)
from ..services.ticket_context_agent import TicketContextAgent
from ..services.ticket_utils import (
    chunk_ticket_items,
    format_ticket_context,
    prepare_ticket_entries,
    truncate_text,
)


log = logging.getLogger("insight.services.ticket_context_service")


class TicketContextService:
    def __init__(
        self,
        loop_repo: LoopRepository,
        data_repo: DataRepository,
        agent: TicketContextAgent | None = None,
        data_pref_repo: DataSourcePreferenceRepository | None = None,
    ):
        self.loop_repo = loop_repo
        self.data_repo = data_repo
        self.agent = agent or TicketContextAgent()
        self.data_pref_repo = data_pref_repo
        self._cached_entries: dict[str, list[dict[str, Any]]] = {}

    # -------- Public API --------
    def get_metadata(
        self,
        *,
        allowed_tables: Iterable[str] | None,
        table: str | None = None,
        text_column: str | None = None,
        date_column: str | None = None,
    ) -> dict[str, Any]:
        config = self._get_config(table=table, text_column=text_column, date_column=date_column)
        self._ensure_allowed(config.table_name, allowed_tables)
        entries = self._load_entries(config)
        if not entries:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Aucun ticket exploitable avec cette configuration.",
            )
        dates = [item["date"] for item in entries]
        return {
            "table": config.table_name,
            "text_column": config.text_column,
            "date_column": config.date_column,
            "date_min": min(dates) if dates else None,
            "date_max": max(dates) if dates else None,
            "total_count": len(entries),
        }

    def build_context(
        self,
        *,
        allowed_tables: Iterable[str] | None,
        date_from: str | None,
        date_to: str | None,
        periods: list[dict[str, str | None]] | None = None,
        table: str | None = None,
        text_column: str | None = None,
        date_column: str | None = None,
    ) -> dict[str, Any]:
        config, entries, filtered, parsed_periods, period_label = self._prepare_context(
            allowed_tables=allowed_tables,
            date_from=date_from,
            date_to=date_to,
            periods=periods,
            table=table,
            text_column=text_column,
            date_column=date_column,
        )
        chunks = self._build_chunks(filtered)
        summary = self.agent.summarize_chunks(period_label=period_label, chunks=chunks)

        # Evidence spec + rows for UI side panel
        columns = self._derive_columns(config=config, sample=filtered)
        spec = self._build_evidence_spec(config=config, columns=columns, period_label=period_label)
        rows_payload = self._build_rows_payload(
            columns=columns,
            items=filtered,
            text_column=config.text_column,
        )

        system_message = (
            f"Contexte tickets ({period_label}) — {len(filtered)} éléments sélectionnés.\n"
            f"{summary}\n"
            "Utilise ce contexte uniquement pour répondre à l'utilisateur. Ne rajoute pas d'autres sources."
        )

        return {
            "summary": summary,
            "period_label": period_label,
            "count": len(filtered),
            "total": len(entries),
            "chunks": len(chunks),
            "table": config.table_name,
            "date_from": rows_payload.get("period", {}).get("from"),
            "date_to": rows_payload.get("period", {}).get("to"),
            "system_message": system_message,
            "evidence_spec": spec,
            "evidence_rows": rows_payload,
        }

    def build_preview(
        self,
        *,
        allowed_tables: Iterable[str] | None,
        date_from: str | None,
        date_to: str | None,
        periods: list[dict[str, str | None]] | None = None,
        table: str | None = None,
        text_column: str | None = None,
        date_column: str | None = None,
    ) -> dict[str, Any]:
        config, entries, filtered, parsed_periods, period_label = self._prepare_context(
            allowed_tables=allowed_tables,
            date_from=date_from,
            date_to=date_to,
            periods=periods,
            table=table,
            text_column=text_column,
            date_column=date_column,
        )
        columns = self._derive_columns(config=config, sample=filtered)
        spec = self._build_evidence_spec(config=config, columns=columns, period_label=period_label)
        rows_payload = self._build_rows_payload(
            columns=columns,
            items=filtered,
            text_column=config.text_column,
        )
        return {
            "period_label": period_label,
            "count": len(filtered),
            "total": len(entries),
            "table": config.table_name,
            "evidence_spec": spec,
            "evidence_rows": rows_payload,
        }

    # -------- Internals --------
    def _prepare_context(
        self,
        *,
        allowed_tables: Iterable[str] | None,
        date_from: str | None,
        date_to: str | None,
        periods: list[dict[str, str | None]] | None,
        table: str | None,
        text_column: str | None,
        date_column: str | None,
    ) -> tuple[Any, list[dict[str, Any]], list[dict[str, Any]], list[tuple[date | None, date | None]], str]:
        config = self._get_config(table=table, text_column=text_column, date_column=date_column)
        self._ensure_allowed(config.table_name, allowed_tables)
        entries = self._load_entries(config)
        if not entries:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Aucun ticket exploitable avec cette configuration.",
            )
        parsed_periods = self._parse_periods(date_from=date_from, date_to=date_to, periods=periods)
        filtered = self._filter_by_periods(entries, periods=parsed_periods)
        if not filtered:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Aucun ticket dans cette plage de dates.",
            )
        period_label = self._period_label(filtered, periods=parsed_periods)
        return config, entries, filtered, parsed_periods, period_label
    def _get_config(self, *, table: str | None, text_column: str | None, date_column: str | None):
        if table:
            canon = self._canonical_table(table, None)
            inferred_text, inferred_date = self._infer_columns(canon)
            t_col = text_column or inferred_text
            d_col = date_column or inferred_date
            if not t_col or not d_col:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Impossible de déduire les colonnes texte/date pour cette table.",
                )
            return type("Cfg", (), {"table_name": canon, "text_column": t_col, "date_column": d_col})

        config = self.loop_repo.get_config()
        if not config:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Configuration loop/tickets manquante.",
            )
        return config

    def _infer_columns(self, table: str) -> tuple[str | None, str | None]:
        try:
            schema = [name for name, _ in self.data_repo.get_schema(table)]
        except FileNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

        pref = self._get_preferences(table)

        def pick(candidates: list[str]) -> str | None:
            for cand in candidates:
                for col in schema:
                    if col.lower() == cand.lower():
                        return col
            return None

        def _match_pref(name: str | None) -> str | None:
            if not name:
                return None
            for col in schema:
                if col.lower() == name.lower():
                    return col
            return None

        date_col = _match_pref(pref.date_field if pref else None) or pick(
            [
                "date_feedback",
                "creation_date",
                "created_at",
                "date",
                "timestamp",
            ]
        ) or next((c for c in schema if "date" in c.lower()), None)

        text_col = pick(
            [
                "commentaire",
                "comment",
                "description",
                "resume",
                "feedback",
                "text",
            ]
        ) or next((c for c in schema if any(key in c.lower() for key in ["comment", "desc", "resume", "text"])), None)

        return text_col, date_col

    def _get_preferences(self, table: str) -> DataSourcePreferences | None:
        if self.data_pref_repo is None:
            return None
        try:
            return self.data_pref_repo.get_preferences_for_source(source=table)
        except Exception:
            log.debug("Unable to load data source preferences for %s", table, exc_info=True)
            return None

    def _ensure_allowed(self, table_name: str, allowed_tables: Iterable[str] | None) -> None:
        if allowed_tables is None:
            return
        allowed_set = {t.casefold() for t in allowed_tables}
        if table_name.casefold() not in allowed_set:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Table tickets non autorisée pour cet utilisateur.",
            )

    def _canonical_table(self, name: str, allowed_tables: Iterable[str] | None) -> str:
        target = name.strip()
        if not target:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nom de table manquant.")
        available = self.data_repo.list_tables()
        mapping = {t.casefold(): t for t in available}
        key = target.casefold()
        if key not in mapping:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Table introuvable: {target}")
        canon = mapping[key]
        if allowed_tables is not None and canon.casefold() not in {t.casefold() for t in allowed_tables}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Table tickets non autorisée pour cet utilisateur.")
        return canon

    def _load_entries(self, config) -> list[dict[str, Any]]:
        cached = self._cached_entries.get(config.table_name)
        if cached is not None:
            return cached
        entries = prepare_ticket_entries(
            rows=self.data_repo.read_rows(
                config.table_name,
                columns=[
                    config.text_column,
                    config.date_column,
                    "ticket_id",
                    "id",
                    "ref",
                ],
            ),
            text_column=config.text_column,
            date_column=config.date_column,
        )
        self._cached_entries[config.table_name] = entries
        return entries

    def _parse_periods(
        self,
        *,
        date_from: str | None,
        date_to: str | None,
        periods: list[dict[str, str | None]] | None,
    ) -> list[tuple[date | None, date | None]]:
        def _parse(dt: str | None) -> date | None:
            if not dt:
                return None
            try:
                return date.fromisoformat(dt[:10])
            except Exception:
                return None

        parsed: list[tuple[date | None, date | None]] = []
        if periods:
            for item in periods:
                if not isinstance(item, dict):
                    continue
                start = _parse(item.get("from"))
                end = _parse(item.get("to"))
                if start or end:
                    parsed.append((start, end))
        # Fallback to single range for backward compatibility
        start = _parse(date_from)
        end = _parse(date_to)
        if not parsed and (start or end):
            parsed.append((start, end))
        # If still empty, keep None to represent "all dates"
        return parsed or [(None, None)]

    def _filter_by_periods(
        self,
        entries: list[dict[str, Any]],
        *,
        periods: list[tuple[date | None, date | None]],
    ) -> list[dict[str, Any]]:
        filtered = []
        for item in entries:
            d: date = item["date"]
            for start, end in periods:
                if start and d < start:
                    continue
                if end and d > end:
                    continue
                filtered.append(item)
                break
        return filtered

    def _build_chunks(self, entries: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
        # Pre-format ticket lines once for LLM payloads
        formatted: list[dict[str, Any]] = []
        for item in entries:
            line = f"{item['date'].isoformat()}#{item.get('ticket_id') or ''} — {truncate_text(item['text'])}"
            formatted.append(
                {
                    **item,
                    "line": line,
                    "total_count": len(entries),
                }
            )
        return chunk_ticket_items(formatted)

    def _period_label(self, entries: list[dict[str, Any]], *, periods: list[tuple[date | None, date | None]]) -> str:
        dates = [item["date"] for item in entries]
        if not dates:
            return "période inconnue"
        labels: list[str] = []
        for start, end in periods:
            s = start.isoformat() if start else min(dates).isoformat()
            e = end.isoformat() if end else max(dates).isoformat()
            labels.append(f"{s} → {e}")
        # Deduplicate to avoid noise when single-period fallback is present
        uniq = list(dict.fromkeys(labels))
        return " ; ".join(uniq)

    def _derive_columns(self, *, config, sample: list[dict[str, Any]]) -> list[str]:
        columns: list[str] = []
        seen: set[str] = set()
        for key in (config.text_column, config.date_column, "ticket_id"):
            if key and key not in seen:
                columns.append(key)
                seen.add(key)
        # Add remaining keys from sample raw rows to aid UI
        for item in sample[: min(10, len(sample))]:
            row = item.get("raw") or {}
            for k in row.keys():
                if k not in seen:
                    seen.add(k)
                    columns.append(k)
        return columns

    def _build_evidence_spec(self, *, config, columns: list[str], period_label: str) -> dict[str, Any]:
        pk = "ticket_id" if "ticket_id" in columns else (columns[0] if columns else "id")
        spec = {
            "entity_label": "Tickets",
            "pk": pk,
            "display": {
                "title": config.text_column,
                "created_at": config.date_column,
            },
            "columns": columns,
            "limit": settings.evidence_limit_default,
            "period": period_label,
        }
        return spec

    def _build_rows_payload(
        self,
        *,
        columns: list[str],
        items: list[dict[str, Any]],
        text_column: str,
    ) -> dict[str, Any]:
        limit = settings.evidence_limit_default
        rows: list[Dict[str, Any]] = []
        for item in items[:limit]:
            raw = item.get("raw") or {}
            row: dict[str, Any] = {}
            for col in columns:
                if col == text_column:
                    row[col] = truncate_text(raw.get(col) or item.get("text"))
                else:
                    row[col] = raw.get(col) or item.get(col)
            rows.append(row)
        return {
            "columns": columns,
            "rows": rows,
            "row_count": len(items),
            "purpose": "evidence",
            "period": {
                "from": items[-1]["date"].isoformat() if items else None,
                "to": items[0]["date"].isoformat() if items else None,
            },
        }

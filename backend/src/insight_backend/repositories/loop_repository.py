from __future__ import annotations

import logging
from datetime import datetime, date
from typing import Iterable, Literal

from sqlalchemy.orm import Session

from ..models.loop import LoopConfig, LoopSummary


log = logging.getLogger("insight.repositories.loop")


LoopKind = Literal["daily", "weekly", "monthly"]


class LoopRepository:
    def __init__(self, session: Session):
        self.session = session

    # --- Config --------------------------------------------------------
    def list_configs(self) -> list[LoopConfig]:
        items = (
            self.session.query(LoopConfig)
            .order_by(LoopConfig.updated_at.desc(), LoopConfig.id.desc())
            .all()
        )
        log.debug("Loaded %d loop configs", len(items))
        return items

    def get_config_by_table(self, table_name: str) -> LoopConfig | None:
        lookup = table_name.casefold()
        items = self.list_configs()
        for config in items:
            if config.table_name.casefold() == lookup:
                return config
        return None

    def get_config(self) -> LoopConfig | None:
        """Return the most recently updated loop config, if any."""
        items = self.list_configs()
        return items[0] if items else None

    def save_config(self, *, table_name: str, text_column: str, date_column: str) -> LoopConfig:
        config = self.get_config_by_table(table_name)
        if config is None:
            config = LoopConfig(
                table_name=table_name,
                text_column=text_column,
                date_column=date_column,
            )
            self.session.add(config)
            log.info("Loop config created (table=%s, text=%s, date=%s)", table_name, text_column, date_column)
        else:
            previous = (config.text_column, config.date_column)
            config.text_column = text_column
            config.date_column = date_column
            if (text_column, date_column) != previous:
                config.last_generated_at = None
            log.info("Loop config updated (table=%s, text=%s, date=%s)", table_name, text_column, date_column)
        self.session.flush()
        return config

    def touch_generated(self, *, config_id: int, ts: datetime) -> None:
        self.session.query(LoopConfig).filter(LoopConfig.id == config_id).update(
            {LoopConfig.last_generated_at: ts, LoopConfig.updated_at: ts}
        )
        log.info("Loop config last_generated_at updated (config_id=%s, ts=%s)", config_id, ts.isoformat())

    # --- Summaries -----------------------------------------------------
    def replace_summaries(
        self,
        *,
        config: LoopConfig,
        items: Iterable[dict],
    ) -> list[LoopSummary]:
        self.session.query(LoopSummary).filter(LoopSummary.config_id == config.id).delete()
        saved: list[LoopSummary] = []
        for item in items:
            summary = LoopSummary(config_id=config.id, **item)
            self.session.add(summary)
            saved.append(summary)
        self.session.flush()
        log.info("Loop summaries replaced (config_id=%s, count=%d)", config.id, len(saved))
        return saved

    def list_summaries(self, *, config_id: int | None = None) -> list[LoopSummary]:
        query = self.session.query(LoopSummary)
        if config_id is not None:
            query = query.filter(LoopSummary.config_id == config_id)
        items = (
            query.order_by(
                LoopSummary.period_start.desc(),
                LoopSummary.kind.asc(),
                LoopSummary.id.desc(),
            )
            .all()
        )
        log.debug("Loaded %d loop summaries (config_id=%s)", len(items), config_id)
        return items

    def list_by_kind(self, *, kind: LoopKind, config_id: int | None = None) -> list[LoopSummary]:
        query = self.session.query(LoopSummary).filter(LoopSummary.kind == kind)
        if config_id is not None:
            query = query.filter(LoopSummary.config_id == config_id)
        items = (
            query.order_by(
                LoopSummary.period_start.desc(),
                LoopSummary.id.desc(),
            )
            .all()
        )
        log.debug("Loaded %d loop summaries (kind=%s, config_id=%s)", len(items), kind, config_id)
        return items

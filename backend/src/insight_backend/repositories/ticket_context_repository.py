from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..models.ticket_context_config import TicketContextConfig


log = logging.getLogger("insight.repositories.ticket_context")


class TicketContextConfigRepository:
    def __init__(self, session: Session):
        self.session = session

    def list_configs(self) -> list[TicketContextConfig]:
        """Return all ticket context configs ordered by most recent first."""
        items = (
            self.session.query(TicketContextConfig)
            .order_by(TicketContextConfig.updated_at.desc(), TicketContextConfig.id.desc())
            .all()
        )
        log.debug("Loaded %d ticket context configs", len(items))
        return items

    def get_config_by_table(self, table_name: str) -> TicketContextConfig | None:
        """Return the config for a specific table (case-insensitive match)."""
        lookup = table_name.casefold()
        for config in self.list_configs():
            if config.table_name.casefold() == lookup:
                return config
        return None

    def get_config(self) -> TicketContextConfig | None:
        """Return the most recently updated config (for backward compatibility)."""
        items = self.list_configs()
        return items[0] if items else None

    def save_config(
        self,
        *,
        table_name: str,
        text_column: str,
        title_column: str,
        date_column: str,
    ) -> TicketContextConfig:
        config = self.get_config_by_table(table_name)
        if config is None:
            config = TicketContextConfig(
                table_name=table_name,
                text_column=text_column,
                title_column=title_column,
                date_column=date_column,
            )
            self.session.add(config)
            log.info(
                "Ticket context config created (table=%s, text=%s, title=%s, date=%s)",
                table_name,
                text_column,
                title_column,
                date_column,
            )
        else:
            config.text_column = text_column
            config.title_column = title_column
            config.date_column = date_column
            log.info(
                "Ticket context config updated (table=%s, text=%s, title=%s, date=%s)",
                table_name,
                text_column,
                title_column,
                date_column,
            )
        self.session.flush()
        return config

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..models.ticket_context_config import TicketContextConfig


log = logging.getLogger("insight.repositories.ticket_context")


class TicketContextConfigRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_config(self) -> TicketContextConfig | None:
        return (
            self.session.query(TicketContextConfig)
            .order_by(TicketContextConfig.updated_at.desc(), TicketContextConfig.id.desc())
            .first()
        )

    def save_config(
        self,
        *,
        table_name: str,
        text_column: str,
        title_column: str,
        date_column: str,
    ) -> TicketContextConfig:
        config = self.get_config()
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
            config.table_name = table_name
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

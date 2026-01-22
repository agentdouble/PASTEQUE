from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


class TicketContextConfig(Base):
    __tablename__ = "ticket_context_configs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    table_name: Mapped[str] = mapped_column(String(255), nullable=False)
    text_column: Mapped[str] = mapped_column(String(255), nullable=False)
    title_column: Mapped[str] = mapped_column(String(255), nullable=False)
    date_column: Mapped[str] = mapped_column(String(255), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

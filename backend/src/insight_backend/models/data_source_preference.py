from __future__ import annotations

from datetime import datetime

from sqlalchemy import String, JSON, DateTime, func, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base


class DataSourcePreference(Base):
    __tablename__ = "data_source_preferences"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    hidden_fields: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    date_field: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category_field: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sub_category_field: Mapped[str | None] = mapped_column(String(255), nullable=True)
    explorer_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

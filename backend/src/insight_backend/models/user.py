from __future__ import annotations

from datetime import datetime

from sqlalchemy import String, Boolean, DateTime, func, text, JSON
from typing import TYPE_CHECKING

from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base

if TYPE_CHECKING:
    from .chart import Chart
    from .user_table_permission import UserTablePermission
    from .conversation import Conversation
    from .feedback import MessageFeedback


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    must_reset_password: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default=text("true"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    charts: Mapped[list["Chart"]] = relationship("Chart", back_populates="user", cascade="all,delete-orphan")
    conversations: Mapped[list["Conversation"]] = relationship(
        "Conversation",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    table_permissions: Mapped[list["UserTablePermission"]] = relationship(
        "UserTablePermission",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    # Optional JSON settings per user (e.g., default excludes for NL→SQL)
    settings: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    feedback: Mapped[list["MessageFeedback"]] = relationship(
        "MessageFeedback",
        back_populates="user",
        cascade="all, delete-orphan",
    )

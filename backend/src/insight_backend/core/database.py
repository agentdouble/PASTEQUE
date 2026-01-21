from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Iterator, Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session

from .config import settings


log = logging.getLogger("insight.core.database")


class Base(DeclarativeBase):
    """Base declarative class for SQLAlchemy models."""


engine = create_engine(settings.database_url, echo=False, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_database() -> None:
    """Create schema if it does not exist."""
    # Import models so SQLAlchemy is aware of them before creating tables.
    from .. import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_conversation_indexes()
    _ensure_conversation_settings_column()
    _ensure_user_password_reset_column()
    _ensure_user_settings_column()
    _ensure_admin_column()
    _ensure_feedback_archive_column()
    _ensure_data_source_preference_columns()
    log.info("Database initialized (tables ensured).")


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a session."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _ensure_admin_column() -> None:
    inspector = inspect(engine)
    columns = {col["name"] for col in inspector.get_columns("users")}
    with engine.begin() as conn:
        if "is_admin" not in columns:
            conn.execute(
                text(
                    "ALTER TABLE users "
                    "ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE"
                )
            )
        previous_admins = conn.execute(
            text(
                "SELECT username FROM users "
                "WHERE is_admin = TRUE AND username <> :admin_username"
            ),
            {"admin_username": settings.admin_username},
        ).fetchall()
        if previous_admins:
            names = ", ".join(row[0] for row in previous_admins)
            log.warning("Resetting admin flag for unexpected users: %s", names)
        conn.execute(
            text(
                "UPDATE users "
                "SET is_admin = CASE WHEN username = :admin_username THEN TRUE ELSE FALSE END"
            ),
            {"admin_username": settings.admin_username},
        )
    log.info("Admin flag column ensured on users table.")


def _ensure_data_source_preference_columns() -> None:
    """Ensure optional columns exist on data_source_preferences."""
    inspector = inspect(engine)
    columns = {col["name"] for col in inspector.get_columns("data_source_preferences")}
    stmts = []
    if "date_field" not in columns:
        stmts.append("ALTER TABLE data_source_preferences ADD COLUMN IF NOT EXISTS date_field VARCHAR(255)")
    if "category_field" not in columns:
        stmts.append(
            "ALTER TABLE data_source_preferences ADD COLUMN IF NOT EXISTS category_field VARCHAR(255)"
        )
    if "sub_category_field" not in columns:
        stmts.append(
            "ALTER TABLE data_source_preferences ADD COLUMN IF NOT EXISTS sub_category_field VARCHAR(255)"
        )
    if "explorer_enabled" not in columns:
        stmts.append(
            "ALTER TABLE data_source_preferences ADD COLUMN IF NOT EXISTS explorer_enabled BOOLEAN NOT NULL DEFAULT TRUE"
        )
    if not stmts:
        log.debug("data_source_preferences columns already present.")
        return

    with engine.begin() as conn:
        for stmt in stmts:
            conn.execute(text(stmt))
    log.info("data_source_preferences optional columns ensured (%d added).", len(stmts))


@contextmanager
def session_scope() -> Iterator[Session]:
    """Context manager for manual session usage (startup tasks)."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _ensure_user_password_reset_column() -> None:
    """Ensure the must_reset_password column exists on the users table."""
    with engine.begin() as connection:
        inspector = inspect(connection)
        columns = {column["name"] for column in inspector.get_columns("users")}
        column_present = "must_reset_password" in columns
        added_column = False
        if not column_present:
            add_statement = text(
                "ALTER TABLE users ADD COLUMN "
                "must_reset_password BOOLEAN NOT NULL DEFAULT TRUE"
            )
            try:
                connection.execute(add_statement)
                column_present = True
                added_column = True
            except DBAPIError as exc:  # pragma: no cover - defensive guard
                if not _is_duplicate_column_error(exc):
                    raise
                column_present = True
        if column_present:
            connection.execute(
                text("UPDATE users SET must_reset_password = FALSE WHERE must_reset_password IS NULL")
            )
    if added_column:
        log.info("Added must_reset_password column to users table.")
    else:
        log.debug("must_reset_password column already present.")


def _ensure_user_settings_column() -> None:
    """Ensure a JSON settings column exists on users for per-account defaults.

    Example payload: {"default_exclude_tables": ["tickets", ...]}.
    """
    with engine.begin() as connection:
        inspector = inspect(connection)
        columns = {column["name"] for column in inspector.get_columns("users")}
        if "settings" in columns:
            log.debug("users.settings column already present.")
            return
        stmt = text("ALTER TABLE users ADD COLUMN settings JSON")
        try:
            connection.execute(stmt)
            log.info("Added settings column to users table.")
        except DBAPIError as exc:  # pragma: no cover
            message = str(getattr(exc, "orig", exc)).lower()
            if "duplicate column" in message or "already exists" in message:
                log.debug("users.settings column already exists (race).")
            else:
                raise


def _is_duplicate_column_error(exc: DBAPIError) -> bool:
    """Return True if the DBAPIError indicates a duplicate column addition."""
    orig = getattr(exc, "orig", None)
    if getattr(orig, "pgcode", None) == "42701":  # PostgreSQL duplicate column
        return True
    message = str(orig or exc).lower()
    return "duplicate column" in message and "must_reset_password" in message


def _ensure_conversation_indexes() -> None:
    """Ensure helpful composite indexes exist for conversation items.

    Uses CREATE INDEX IF NOT EXISTS to avoid errors on repeated startups.
    """
    stmts = [
        "CREATE INDEX IF NOT EXISTS ix_conv_msg_conv_created ON conversation_messages (conversation_id, created_at)",
        "CREATE INDEX IF NOT EXISTS ix_conv_evt_conv_created ON conversation_events (conversation_id, created_at)",
    ]
    with engine.begin() as conn:
        for sql in stmts:
            conn.execute(text(sql))
    log.info("Conversation composite indexes ensured.")


def _ensure_conversation_settings_column() -> None:
    """Ensure a JSON settings column exists on conversations for per-conversation prefs.

    Stores items like {"exclude_tables": ["tickets", ...]}.
    """
    with engine.begin() as connection:
        inspector = inspect(connection)
        columns = {column["name"] for column in inspector.get_columns("conversations")}
        if "settings" in columns:
            log.debug("conversations.settings column already present.")
            return
        stmt = text("ALTER TABLE conversations ADD COLUMN settings JSON")
        try:
            connection.execute(stmt)
            log.info("Added settings column to conversations table.")
        except DBAPIError as exc:  # pragma: no cover - defensive
            # If another process created it or backend doesn't support JSON IF NOT EXISTS semantics
            message = str(getattr(exc, "orig", exc)).lower()
            if "duplicate column" in message or "already exists" in message:
                log.debug("settings column already exists (race).")
            else:
                raise


def _ensure_feedback_archive_column() -> None:
    """Ensure message_feedback has an is_archived column (backfill default false)."""
    with engine.begin() as connection:
        inspector = inspect(connection)
        columns = {column["name"] for column in inspector.get_columns("message_feedback")}
        if "is_archived" in columns:
            return
        try:
            connection.execute(
                text("ALTER TABLE message_feedback ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE")
            )
            log.info("Added is_archived column to message_feedback.")
        except DBAPIError as exc:  # pragma: no cover - defensive
            message = str(getattr(exc, "orig", exc)).lower()
            if "duplicate column" in message or "already exists" in message or "duplicate" in message:
                log.debug("is_archived column already present on message_feedback.")
            else:
                raise


def transactional(session: Session):
    """Return a context manager for an isolated write transaction.

    If a transaction is already open (often because a prior SELECT triggered
    autobegin), end it first so we can start a top-level `begin()` that will
    actually commit to the DB. This avoids nested transactions whose changes
    would be discarded if the outer transaction rolls back at request end.
    """
    if session.in_transaction():
        try:
            session.commit()  # safe even if only reads occurred
        except Exception:  # pragma: no cover - safety guard
            session.rollback()
    return session.begin()

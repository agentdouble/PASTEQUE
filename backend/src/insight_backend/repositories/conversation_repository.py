from __future__ import annotations

import logging
from typing import Any
import json
from datetime import datetime, timezone
from sqlalchemy import text

from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from ..models.conversation import Conversation, ConversationMessage, ConversationEvent


log = logging.getLogger("insight.repositories.conversation")


class ConversationRepository:
    def __init__(self, session: Session):
        self.session = session

    # Conversations
    def create(self, *, user_id: int, title: str) -> Conversation:
        conv = Conversation(user_id=user_id, title=title)
        self.session.add(conv)
        log.info("Conversation created (user_id=%s, title=%s)", user_id, title)
        return conv

    def list_by_user(self, user_id: int) -> list[Conversation]:
        items = (
            self.session.query(Conversation)
            .filter(Conversation.user_id == user_id)
            .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
            .all()
        )
        log.info("Retrieved %d conversations for user_id=%s", len(items), user_id)
        return items

    def get_by_id(self, conversation_id: int) -> Conversation | None:
        return (
            self.session.query(Conversation)
            .options(joinedload(Conversation.messages), joinedload(Conversation.events))
            .filter(Conversation.id == conversation_id)
            .one_or_none()
        )

    def get_by_id_for_user(self, conversation_id: int, user_id: int) -> Conversation | None:
        return (
            self.session.query(Conversation)
            .options(joinedload(Conversation.messages), joinedload(Conversation.events))
            .filter(Conversation.id == conversation_id, Conversation.user_id == user_id)
            .one_or_none()
        )

    # Messages
    def append_message(self, *, conversation_id: int, role: str, content: str) -> ConversationMessage:
        msg = ConversationMessage(conversation_id=conversation_id, role=role, content=content)
        self.session.add(msg)
        # Flush to ensure PK is available immediately (used in streaming metadata)
        self.session.flush()
        # touch conversation updated_at
        self.session.query(Conversation).filter(Conversation.id == conversation_id).update({Conversation.updated_at: func.now()})
        log.info(
            "Appended message (conversation_id=%s, role=%s, preview=%s)",
            conversation_id,
            role,
            (content[:60] + "…") if len(content) > 60 else content,
        )
        return msg

    # Events (sql | rows | plan | meta | done)
    def add_event(self, *, conversation_id: int, kind: str, payload: dict[str, Any] | None) -> ConversationEvent:
        evt = ConversationEvent(conversation_id=conversation_id, kind=kind, payload=payload)
        self.session.add(evt)
        # touch conversation updated_at
        self.session.query(Conversation).filter(Conversation.id == conversation_id).update({Conversation.updated_at: func.now()})
        log.debug("Added event (conversation_id=%s, kind=%s)", conversation_id, kind)
        return evt

    def get_message_by_id(self, message_id: int) -> ConversationMessage | None:
        return (
            self.session.query(ConversationMessage)
            .filter(ConversationMessage.id == message_id)
            .one_or_none()
        )

    # Settings (JSON)
    def get_settings(self, *, conversation_id: int) -> dict[str, Any]:
        conv = (
            self.session.query(Conversation)
            .filter(Conversation.id == conversation_id)
            .one_or_none()
        )
        return dict(conv.settings or {}) if conv else {}

    def set_settings(self, *, conversation_id: int, settings: dict[str, Any]) -> dict[str, Any]:
        # Ensure plain JSON-serializable payload to avoid driver-specific surprises
        payload = json.loads(json.dumps(settings or {}))
        self.session.query(Conversation).filter(Conversation.id == conversation_id).update({
            Conversation.settings: payload,
            Conversation.updated_at: func.now(),
        })
        # Make sure it’s flushed when caller needs to read back in the same transaction
        self.session.flush()
        log.info("Conversation settings updated (conversation_id=%s, keys=%s)", conversation_id, ",".join(sorted(payload.keys())))
        return payload

    def get_ticket_context_cache(self, *, conversation_id: int) -> dict[str, Any] | None:
        settings = self.get_settings(conversation_id=conversation_id)
        if not isinstance(settings, dict):
            return None
        cache = settings.get("ticket_context_cache")
        if not isinstance(cache, dict):
            return None
        return cache

    def set_ticket_context_cache(
        self,
        *,
        conversation_id: int,
        key: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        entry = {
            "key": key,
            "payload": json.loads(json.dumps(payload or {})),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        bind = self.session.get_bind()
        if bind is not None and bind.dialect.name.startswith("postgres"):
            payload_json = json.dumps(entry)
            self.session.execute(
                text(
                    "UPDATE conversations "
                    "SET settings = jsonb_set(COALESCE(settings::jsonb, '{}'::jsonb), '{ticket_context_cache}', (:payload)::jsonb, true)::json, "
                    "    updated_at = NOW() "
                    "WHERE id = :cid"
                ),
                {"payload": payload_json, "cid": conversation_id},
            )
            self.session.flush()
            log.info(
                "Ticket context cache updated via jsonb_set (conversation_id=%s, key=%s)",
                conversation_id,
                key[:8],
            )
            return entry

        current = self.get_settings(conversation_id=conversation_id)
        current["ticket_context_cache"] = entry
        self.set_settings(conversation_id=conversation_id, settings=current)
        log.info("Ticket context cache updated (conversation_id=%s, key=%s)", conversation_id, key[:8])
        return entry

    def get_excluded_tables(self, *, conversation_id: int) -> list[str]:
        s = self.get_settings(conversation_id=conversation_id)
        raw = s.get("exclude_tables") if isinstance(s, dict) else None
        if not isinstance(raw, list):
            return []
        out: list[str] = []
        seen: set[str] = set()
        for item in raw:
            if isinstance(item, str) and item.strip():
                key = item.strip()
                if key.casefold() in seen:
                    continue
                seen.add(key.casefold())
                out.append(key)
        return out

    def set_excluded_tables(self, *, conversation_id: int, tables: list[str]) -> list[str]:
        # Normalize and persist in settings JSON (atomic update when Postgres is available)
        from ..utils.validation import normalize_table_names

        normalized = normalize_table_names(tables)

        # Postgres: do a jsonb_set to avoid read-modify-write races on unrelated keys
        bind = self.session.get_bind()
        if bind is not None and bind.dialect.name.startswith("postgres"):
            payload_json = json.dumps(normalized)
            self.session.execute(
                text(
                    "UPDATE conversations "
                    "SET settings = jsonb_set(COALESCE(settings::jsonb, '{}'::jsonb), '{exclude_tables}', (:payload)::jsonb, true)::json, "
                    "    updated_at = NOW() "
                    "WHERE id = :cid"
                ),
                {"payload": payload_json, "cid": conversation_id},
            )
            self.session.flush()
            log.info("Conversation exclude_tables set via jsonb_set (conversation_id=%s, count=%d)", conversation_id, len(normalized))
            return normalized

        # Fallback (non-Postgres): read-modify-write with flush
        current = self.get_settings(conversation_id=conversation_id)
        current["exclude_tables"] = normalized
        self.set_settings(conversation_id=conversation_id, settings=current)
        return normalized

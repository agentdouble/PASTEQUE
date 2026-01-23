from __future__ import annotations

from typing import Any, List, Dict
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ....core.database import get_session
from ....models.user import User
from ....repositories.conversation_repository import ConversationRepository
from ....core.security import get_current_user, user_is_admin
from ....integrations.mindsdb_client import MindsDBClient
from ....core.config import settings
from ....utils.rows import normalize_rows
from ....utils.text import sanitize_title
from ....repositories.feedback_repository import FeedbackRepository

log = logging.getLogger("insight.api.conversations")


router = APIRouter(prefix="/conversations")


@router.get("")
def list_conversations(  # type: ignore[valid-type]
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[dict[str, Any]]:
    repo = ConversationRepository(session)
    items = repo.list_by_user(current_user.id)
    return [
        {
            "id": c.id,
            "title": c.title,
            "created_at": c.created_at.isoformat(),
            "updated_at": c.updated_at.isoformat(),
        }
        for c in items
    ]


@router.post("")
def create_conversation(  # type: ignore[valid-type]
    payload: dict[str, Any] | None = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    raw = (payload or {}).get("title") or "Nouvelle conversation"
    title = sanitize_title(str(raw))
    repo = ConversationRepository(session)
    conv = repo.create(user_id=current_user.id, title=title)
    session.commit()
    return {"id": conv.id, "title": conv.title}


@router.get("/{conversation_id}")
def get_conversation(  # type: ignore[valid-type]
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    repo = ConversationRepository(session)
    is_admin = user_is_admin(current_user)
    conv = repo.get_by_id(conversation_id) if is_admin else repo.get_by_id_for_user(conversation_id, current_user.id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation introuvable")

    # Last evidence spec and rows if present
    evidence_spec: dict[str, Any] | None = None
    evidence_rows: dict[str, Any] | None = None

    # use shared normalization util
    for evt in conv.events:
        if evt.kind == "meta" and isinstance(evt.payload, dict) and "evidence_spec" in evt.payload:
            evidence_spec = evt.payload.get("evidence_spec")  # type: ignore[assignment]
        elif evt.kind == "rows" and isinstance(evt.payload, dict) and evt.payload.get("purpose") == "evidence":
            cols = evt.payload.get("columns") or []
            raw_rows = evt.payload.get("rows") or []
            evidence_rows = {
                "columns": cols,
                # Normalize here so the frontend gets a consistent shape in history
                "rows": normalize_rows(cols, raw_rows),
                "row_count": evt.payload.get("row_count") or (len(raw_rows) if isinstance(raw_rows, list) else 0),
                "purpose": "evidence",
            }

    # Feedback map for the current user (UI highlight)
    fb_repo = FeedbackRepository(session)
    feedback_by_msg: dict[int, tuple[str, int]] = {}
    try:
        feedback_items = fb_repo.list_for_conversation_user(
            conversation_id=conv.id,
            user_id=current_user.id,
            include_archived=True,
        )
        feedback_by_msg = {item.message_id: (item.value, item.id) for item in feedback_items}
    except Exception:
        log.warning("Failed to load feedback for conversation_id=%s", conv.id, exc_info=True)

    # ---- Build a unified, time-ordered stream mixing messages and chart events ----
    entries: List[Dict[str, Any]] = []
    # 1) Start with plain messages and attach details (plan/sql) to assistant answers
    last_user_ts = None
    evs = list(conv.events)
    for msg in conv.messages:
        details: dict[str, Any] | None = None
        if msg.role == "user":
            last_user_ts = msg.created_at
        else:
            if last_user_ts is not None:
                steps: list[dict[str, Any]] = []
                plan: dict[str, Any] | None = None
                retrieval_detail: dict[str, Any] | None = None
                for evt in evs:
                    ts = evt.created_at
                    if ts < last_user_ts or ts > msg.created_at:
                        continue
                    if evt.kind == "sql" and isinstance(evt.payload, dict):
                        steps.append({
                            "step": evt.payload.get("step"),
                            "purpose": evt.payload.get("purpose"),
                            "sql": evt.payload.get("sql"),
                        })
                    elif evt.kind == "plan" and isinstance(evt.payload, dict):
                        plan = evt.payload
                    elif evt.kind == "meta" and isinstance(evt.payload, dict):
                        retrieval_payload = _normalize_retrieval_meta(evt.payload.get("retrieval"))
                        if retrieval_payload:
                            retrieval_detail = retrieval_payload
                detail_payload: dict[str, Any] = {}
                if steps:
                    detail_payload["steps"] = steps
                if plan is not None:
                    detail_payload["plan"] = plan
                if retrieval_detail:
                    detail_payload["retrieval"] = retrieval_detail
                if detail_payload:
                    details = detail_payload
        payload: dict[str, Any] = {
            "message_id": msg.id,
            "role": msg.role,
            "content": msg.content,
            "created_at": msg.created_at.isoformat(),
        }
        fb_entry = feedback_by_msg.get(msg.id)
        if fb_entry:
            payload["feedback"] = fb_entry[0]
            payload["feedback_id"] = fb_entry[1]
        if details:
            payload["details"] = details
        entries.append({"created_at": msg.created_at.isoformat(), "payload": payload})

    # 2) Add chart events as synthetic assistant messages
    for evt in conv.events:
        if evt.kind != "chart" or not isinstance(evt.payload, dict):
            continue
        p = evt.payload
        chart_url = p.get("chart_url")
        if not isinstance(chart_url, str) or not chart_url:
            continue
        payload = {
            "role": "assistant",
            "content": "",
            "created_at": evt.created_at.isoformat(),
            "chart_url": chart_url,
            "chart_title": p.get("chart_title"),
            "chart_description": p.get("chart_description"),
            "chart_tool": p.get("tool_name") or p.get("chart_tool"),
            "chart_spec": p.get("chart_spec"),
        }
        entries.append({"created_at": evt.created_at.isoformat(), "payload": payload})

    # 3) Sort entries by time (ISO 8601 sort is chronological)
    entries.sort(key=lambda x: x["created_at"])  # type: ignore[no-any-return]
    messages: list[dict[str, Any]] = [e["payload"] for e in entries]

    return {
        "id": conv.id,
        "title": conv.title,
        "created_at": conv.created_at.isoformat(),
        "updated_at": conv.updated_at.isoformat(),
        "messages": messages,
        "evidence_spec": evidence_spec,
        "evidence_rows": evidence_rows,
        "settings": (conv.settings or {}),
    }


@router.get("/{conversation_id}/dataset")
def get_message_dataset(  # type: ignore[valid-type]
    conversation_id: int,
    message_index: int = Query(..., ge=0),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Re-exécute la dernière requête SQL liée à un message assistant et renvoie un petit dataset.

    Utilise les événements persistés (kind="sql") entre le dernier message user et le message assistant ciblé.
    Les requêtes d'évidence sont ignorées.
    """
    repo = ConversationRepository(session)
    conv = repo.get_by_id(conversation_id) if user_is_admin(current_user) else repo.get_by_id_for_user(conversation_id, current_user.id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation introuvable")
    if message_index < 0 or message_index >= len(conv.messages):
        raise HTTPException(status_code=400, detail="Index de message invalide")
    msg = conv.messages[message_index]
    if msg.role != "assistant":
        raise HTTPException(status_code=400, detail="Le message ciblé n'est pas une réponse assistant")

    # Délimiter la fenêtre temporelle: après le dernier message user précédent et avant/à l'horodatage du message assistant
    start_ts = None
    for m in reversed(conv.messages[: message_index]):
        if m.role == "user":
            start_ts = m.created_at
            break
    end_ts = msg.created_at

    sql_text: str | None = None
    step: int | None = None
    purpose: str | None = None
    for evt in conv.events:
        ts = evt.created_at
        if start_ts and ts < start_ts:
            continue
        if ts > end_ts:
            continue
        if evt.kind == "sql" and isinstance(evt.payload, dict):
            if evt.payload.get("purpose") == "evidence":
                continue
            # Retenir le dernier SQL non-évidence de la fenêtre
            sql_text = evt.payload.get("sql") or sql_text
            step = evt.payload.get("step") if isinstance(evt.payload.get("step"), int) else step
            purpose = evt.payload.get("purpose") or purpose

    if not sql_text or not isinstance(sql_text, str):
        raise HTTPException(status_code=404, detail="Aucune requête SQL associée à ce message")
    # Valider strictement: SELECT‑only, une seule instruction, aucun commentaire,
    # tables sous le préfixe autorisé, et LIMIT obligatoire.
    try:
        s = _validate_select_sql(sql_text, required_prefix=settings.nl2sql_db_prefix, limit_default=settings.evidence_limit_default)
    except ValueError as e:
        log.warning("Invalid SQL for dataset: %s", e)
        raise HTTPException(status_code=400, detail=str(e))

    client = MindsDBClient(base_url=settings.mindsdb_base_url, token=settings.mindsdb_token)
    data = client.sql(s)

    # Normaliser le résultat (inspiré de ChatService._normalize_result)
    rows: list[Any] = []
    columns: list[Any] = []
    if isinstance(data, dict):
        if data.get("type") == "table":
            columns = data.get("column_names") or []
            rows = data.get("data") or []
        if not rows:
            rows = data.get("result", {}).get("rows") or data.get("rows") or rows
        if not columns:
            columns = data.get("result", {}).get("columns") or data.get("columns") or columns

    # Convertir en objets côté API pour le front
    cols = [str(c) for c in (columns or [])]
    obj_rows = normalize_rows(cols, rows or [])

    return {
        "dataset": {
            "sql": s,
            "columns": cols,
            "rows": obj_rows,
            "row_count": len(obj_rows),
            "step": step,
            "description": purpose,
        }
    }


@router.post("/{conversation_id}/chart")
def append_chart_event(  # type: ignore[valid-type]
    conversation_id: int,
    payload: dict[str, Any],
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Persist a chart generation event so charts reappear in conversation history.

    Body fields (subset used): chart_url (required), tool_name, chart_title, chart_description, chart_spec.
    """
    repo = ConversationRepository(session)
    conv = repo.get_by_id(conversation_id) if user_is_admin(current_user) else repo.get_by_id_for_user(conversation_id, current_user.id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation introuvable")
    url = payload.get("chart_url")
    if not isinstance(url, str) or not url.strip():
        raise HTTPException(status_code=400, detail="chart_url manquant")
    safe_payload = {
        "chart_url": url,
        "tool_name": payload.get("tool_name"),
        "chart_title": payload.get("chart_title"),
        "chart_description": payload.get("chart_description"),
        "chart_spec": payload.get("chart_spec"),
    }
    evt = repo.add_event(conversation_id=conversation_id, kind="chart", payload=safe_payload)
    session.commit()
    return {"id": evt.id, "created_at": evt.created_at.isoformat()}


def _validate_select_sql(sql: str, *, required_prefix: str, limit_default: int) -> str:
    """Validate SQL is a single, safe SELECT and enforce a LIMIT if missing.

    Raises ValueError on invalid input; returns a sanitized SQL string otherwise.
    """
    # reject comments and multiple statements
    if re.search(r"--|/\*|\*/", sql):
        raise ValueError("Commentaires SQL interdits")
    if ";" in sql:
        raise ValueError("Plusieurs instructions non autorisées")
    try:
        import sqlglot
        from sqlglot import exp
    except Exception as e:  # pragma: no cover - safety net, dependency present via uv
        raise ValueError(f"Validation SQL indisponible: {e}")

    try:
        parsed = sqlglot.parse(sql)
    except Exception:
        raise ValueError("SQL invalide")
    if len(parsed) != 1:
        raise ValueError("Une seule instruction SELECT est autorisée")

    stmt = parsed[0]
    if not isinstance(stmt, exp.Select):
        # allow SELECT wrapped by Subquery? enforce strict: top-level must be Select
        raise ValueError("Seules les requêtes SELECT sont autorisées")

    # Disallow UNION/EXCEPT/INTERSECT and INTO
    if stmt.args.get("union") is not None:
        raise ValueError("UNION non autorisé")
    if stmt.args.get("into") is not None:
        raise ValueError("SELECT ... INTO non autorisé")
    # Walk tree to ban any DML/DDL nodes just in case
    forbidden = (exp.Insert, exp.Update, exp.Delete, exp.Alter, exp.Create, exp.Drop)
    for node in stmt.walk():
        if isinstance(node, forbidden):
            raise ValueError("Opérations d'écriture interdites")

    # Enforce table prefix policy if configured
    pref = (required_prefix or "").strip()
    if pref:
        pref_cf = pref.casefold() + "."
        for table in stmt.find_all(exp.Table):
            name = table.sql(dialect=None).strip("`\"")
            # raw name may include schema; do a simple case-insensitive prefix check
            if not name.casefold().startswith(pref_cf):
                raise ValueError(f"Tables hors du préfixe autorisé: {name}")

    s = sql.strip()
    # Add a LIMIT if missing
    if not re.search(r"\blimit\b", s, flags=re.I):
        s = f"{s} LIMIT {limit_default}"
    return s


def _normalize_retrieval_meta(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    rows = payload.get("rows")
    if not isinstance(rows, list):
        return None
    normalized_rows: list[dict[str, Any]] = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        values = item.get("values")
        normalized_rows.append(
            {
                "table": str(item.get("table") or ""),
                "score": item.get("score"),
                "focus": item.get("focus"),
                "source_column": item.get("source_column"),
                "values": values if isinstance(values, dict) else {},
            }
        )
    if not normalized_rows:
        return None
    detail: dict[str, Any] = {"rows": normalized_rows}
    if isinstance(payload.get("round"), int):
        detail["round"] = payload["round"]
    return detail

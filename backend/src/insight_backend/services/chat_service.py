import logging
import json
import re

from sqlglot import parse_one, exp
from pathlib import Path
from typing import Protocol, Callable, Dict, Any, Iterable, List

from ..schemas.chat import ChatRequest, ChatResponse, ChatMessage
from ..core.config import settings, resolve_project_path
from ..integrations.mindsdb_client import MindsDBClient
from ..repositories.data_repository import DataRepository
from ..repositories.dictionary_repository import DataDictionaryRepository
from .nl2sql_service import NL2SQLService
from .retrieval_service import RetrievalService
from .retrieval_agent import RetrievalAgent
from ..core.agent_limits import get_limit, get_count, AgentBudgetExceeded


log = logging.getLogger("insight.services.chat")

# Maximum exploration steps per round for NL→SQL explorer
NL2SQL_EXPLORE_MAX_STEPS = 3


def _preview_text(text: str, *, limit: int = 160) -> str:
    """Return a single-line preview capped at ``limit`` characters."""
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    cutoff = max(limit - 3, 1)
    return f"{compact[:cutoff]}..."


def _serialize_dico_compact(dico: Dict[str, Any], *, limit: int) -> tuple[str, bool, int, int]:
    """Return a JSON string for ``dico`` within ``limit`` chars when possible.

    Falls back to a compact subset while keeping valid JSON. Returns a tuple
    of (json_str, truncated_flag, kept_tables, kept_cols_per_table_max).
    """
    def _dumps(obj: Any) -> str:
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))

    raw = _dumps(dico)
    if len(raw) <= limit:
        # no truncation
        return raw, False, len(dico), max((len(v.get("columns", [])) for v in dico.values()), default=0)

    # Try progressively smaller subsets: fewer columns per table, then fewer tables
    tables = list(dico.items())
    # Keep deterministic order by table name
    tables.sort(key=lambda kv: kv[0])

    for cols_cap in (5, 3, 1):
        subset: Dict[str, Any] = {}
        for name, spec in tables:
            cols = list(spec.get("columns", []))
            subset[name] = {k: v for k, v in spec.items() if k != "columns"}
            subset[name]["columns"] = cols[:cols_cap]
        s = _dumps(subset)
        if len(s) <= limit:
            return s, True, len(subset), cols_cap
        # Also try reducing the number of tables for this cols_cap
        for keep_tables in (3, 2, 1):
            trimmed = {k: subset[k] for k in list(subset.keys())[:keep_tables]}
            s2 = _dumps(trimmed)
            if len(s2) <= limit:
                return s2, True, keep_tables, cols_cap

    # As a last resort, keep the first table and one column to remain valid JSON
    if tables:
        name, spec = tables[0]
        minimal = {name: {"columns": list(spec.get("columns", []))[:1]}}
        return _dumps(minimal), True, 1, 1
    return _dumps({}), True, 0, 0


class ChatEngine(Protocol):
    def run(self, payload: ChatRequest) -> ChatResponse:  # type: ignore[valid-type]
        ...


class ChatService:
    """Orchestre les appels à un moteur de chat.

    Implémentation réelle à fournir ultérieurement.
    """

    def __init__(self, engine: ChatEngine):
        self.engine = engine
        self._retrieval_agent: RetrievalAgent | None = None

    def _llm_diag(self) -> str:
        if settings.llm_mode == "api":
            return (
                f"LLM(mode=api, base_url={settings.openai_base_url}, model={settings.llm_model})"
            )
        return (
            f"LLM(mode=local, base_url={settings.vllm_base_url}, model={settings.z_local_model})"
        )

    def _log_completion(self, response: ChatResponse, *, context: str) -> ChatResponse:
        provider = (response.metadata or {}).get("provider", "-")
        log.info(
            "ChatService.%s: provider=%s reply_preview=\"%s\"",
            context,
            provider,
            _preview_text(response.reply),
        )
        return response

    def _get_retrieval_agent(self) -> RetrievalAgent:
        if self._retrieval_agent is None:
            self._retrieval_agent = RetrievalAgent()
        return self._retrieval_agent

    def _retrieve_context(
        self,
        *,
        question: str,
        events: Callable[[str, Dict[str, Any]], None] | None = None,
        round_label: int | None = None,
    ) -> tuple[List[Dict[str, Any]], str]:
        try:
            agent = self._get_retrieval_agent()
            payload, highlight = agent.run(
                question=question,
                top_n=settings.rag_top_n,
                events=events,
                round_label=round_label,
            )
            return payload, highlight
        except AgentBudgetExceeded:
            # Bubble up so API can convert to 429
            raise
        except Exception as exc:
            message = _preview_text(str(exc), limit=160)
            log.error("Retrieval agent failed: %s", message)
            return [], f"Mise en avant : synthèse indisponible ({message})."

    def _format_retrieval_highlight(
        self,
        *,
        question: str,
        payload: List[Dict[str, Any]],
        error: str | None = None,
    ) -> str:
        """Compat wrapper kept for tests; delegates to RetrievalAgent where possible."""
        prefix = "Mise en avant : "
        if error:
            return f"{prefix}récupération indisponible ({error})."
        if not payload:
            return f"{prefix}aucun exemple rapproché n'a été trouvé dans les données vectorisées."
        try:
            insight = self._generate_retrieval_insight(question=question, rows=payload).strip()
        except Exception as exc:
            message = _preview_text(str(exc), limit=160)
            log.error("Retrieval highlight synthesis failed: %s", message)
            return f"{prefix}synthèse indisponible ({message})."
        if not insight:
            log.error("Retrieval highlight synthesis returned empty content.")
            return f"{prefix}synthèse indisponible (réponse vide)."
        return f"{prefix}{insight}"

    def _generate_retrieval_insight(
        self,
        *,
        question: str,
        rows: List[Dict[str, Any]],
    ) -> str:
        """Compat seam for tests; uses RetrievalAgent summarization with caps and tuning."""
        agent = self._get_retrieval_agent()
        # Reuse the agent's summarization on provided rows without re-emitting events
        return agent._summarize(question=question, rows=rows)  # type: ignore[attr-defined]

    

    @staticmethod
    def _append_highlight(base: str, highlight: str) -> str:
        base_stripped = (base or "").rstrip()
        highlight_stripped = (highlight or "").strip()
        if not highlight_stripped:
            return base_stripped
        if not base_stripped:
            return highlight_stripped
        return f"{base_stripped}\n\n{highlight_stripped}"

    def completion(
        self,
        payload: ChatRequest,
        *,
        events: Callable[[str, Dict[str, Any]], None] | None = None,
        allowed_tables: Iterable[str] | None = None,
    ) -> ChatResponse:  # type: ignore[valid-type]
        metadata_keys = list((payload.metadata or {}).keys())
        message_count = len(payload.messages)
        if payload.messages:
            last = payload.messages[-1]
            log.info(
                "ChatService.completion start: count=%d last_role=%s preview=\"%s\" mode=%s metadata_keys=%s",
                message_count,
                last.role,
                _preview_text(last.content),
                settings.llm_mode,
                metadata_keys,
            )
        else:
            log.info(
                "ChatService.completion start: count=0 mode=%s metadata_keys=%s",
                settings.llm_mode,
                metadata_keys,
            )
        # Lightweight command passthrough for MindsDB SQL without changing the UI.
        # If the last user message starts with '/sql ', execute it against MindsDB and return the result.
        if payload.messages:
            last = payload.messages[-1]
            if last.role == "user" and last.content.strip().casefold().startswith("/sql "):
                sql = last.content.strip()[5:]
                log.info(
                    "ChatService.mindsdb passthrough: sql_preview=\"%s\"",
                    _preview_text(sql, limit=200),
                )
                if events:
                    try:
                        events("sql", {"sql": sql})
                    except Exception:  # pragma: no cover - defensive
                        pass
                client = MindsDBClient(base_url=settings.mindsdb_base_url, token=settings.mindsdb_token)
                data = client.sql(sql)
                # Normalize using a single canonical helper
                columns, rows = self._normalize_result(data)

                if events:
                    snapshot = {
                        "columns": columns,
                        "rows": rows if isinstance(rows, list) else [],
                        "row_count": len(rows) if isinstance(rows, list) else 0,
                    }
                    try:
                        events("rows", snapshot)
                    except Exception:  # pragma: no cover - defensive
                        pass

                # Emit evidence contract + dataset (generic) so the front can open the panel
                self._emit_evidence(
                    events=events,
                    client=client,
                    label_hint=sql,
                    base_sql=sql,
                    fallback_columns=columns,
                    fallback_rows=rows,
                )

                if rows and columns:
                    header = " | ".join(str(c) for c in columns)
                    lines = [header, "-" * len(header)]
                    for r in rows[:50]:
                        if isinstance(r, dict):
                            line = " | ".join(str(r.get(c)) for c in columns)
                        else:
                            line = " | ".join(str(v) for v in r)
                        lines.append(line)
                    text = "\n".join(lines)
                else:
                    # Error forwarding
                    err = data.get("error_message") if isinstance(data, dict) else None
                    text = err or "(Aucune ligne)"
                log.info(
                    "ChatService.mindsdb passthrough response: columns=%d rows=%d",
                    len(columns),
                    len(rows),
                )
                return self._log_completion(
                    ChatResponse(reply=text, metadata={"provider": "mindsdb-sql"}),
                    context="completion done (mindsdb-sql)",
                )

        # NL→SQL is always enabled; proceed when there is a user message.
        meta = payload.metadata or {}
        if payload.messages:
            last = payload.messages[-1]
            if last.role == "user":
                raw_question, contextual_question = self._prepare_nl2sql_question(payload.messages)
                # Build schema from local CSV headers
                repo = DataRepository(tables_dir=Path(settings.tables_dir))
                tables = repo.list_tables()
                # 1) Appliquer les permissions (si non‑admin)
                allowed_lookup = {name.casefold() for name in allowed_tables} if allowed_tables is not None else None
                if allowed_lookup is not None:
                    tables = [name for name in tables if name.casefold() in allowed_lookup]
                # 2) Appliquer les exclusions demandées par l'utilisateur (par conversation/requête)
                exclude_raw = meta.get("exclude_tables")
                exclude_lookup: set[str] = set()
                if isinstance(exclude_raw, (list, tuple)):
                    for item in exclude_raw:
                        if isinstance(item, str) and item.strip():
                            exclude_lookup.add(item.strip().casefold())
                effective_tables = [name for name in tables if name.casefold() not in exclude_lookup]
                # Synchroniser l'UI (stream): publier les tables effectivement actives
                if events:
                    try:
                        events("meta", {"effective_tables": effective_tables})
                    except Exception:
                        log.debug("Failed to emit effective_tables meta", exc_info=True)
                # Si aucune table, bloquer explicitement le flux NL→SQL (pas de fallback)
                if not effective_tables:
                    message = (
                        "Aucune table active pour vos requêtes après application des exclusions. "
                        "Réactivez des tables dans le panneau ‘Données utilisées’."
                    )
                    log.info(
                        "NL2SQL aborted: no effective tables (allowed=%s, exclude=%s)",
                        sorted(list(allowed_lookup or set())),
                        sorted(list(exclude_lookup)),
                    )
                    return self._log_completion(
                        ChatResponse(reply=message, metadata={"provider": "nl2sql-acl", "effective_tables": []}),
                        context="completion denied (no effective tables)",
                    )
                tables = effective_tables
                schema: dict[str, list[str]] = {}
                for name in tables:
                    cols = [c for c, _ in repo.get_schema(name)]
                    schema[name] = cols
                # Load compact data dictionary (if available) limited to the current schema
                dico_repo = DataDictionaryRepository(
                    directory=Path(resolve_project_path(settings.data_dictionary_dir))
                )
                dico = dico_repo.for_schema(schema)
                contextual_question_with_dico = contextual_question
                if dico:
                    try:
                        # Log if PII columns are present in the prompt material
                        pii_hits: list[str] = []
                        for t, spec in dico.items():
                            for c in spec.get("columns", []):
                                if bool(c.get("pii")):
                                    pii_hits.append(f"{t}.{c.get('name')}")
                        if pii_hits:
                            log.warning("PII columns included in dictionary: %s", pii_hits)

                        blob, truncated, kept_tables, kept_cols = _serialize_dico_compact(
                            dico, limit=max(1, settings.data_dictionary_max_chars)
                        )
                        if truncated:
                            log.warning(
                                "Data dictionary truncated to %d chars (kept %d tables, ≤ %d cols/table)",
                                settings.data_dictionary_max_chars,
                                kept_tables,
                                kept_cols,
                            )
                        contextual_question_with_dico = (
                            f"{contextual_question}\n\nData dictionary (JSON):\n{blob}"
                        )
                    except Exception as e:
                        log.error("Failed to serialize data dictionary JSON: %s", e, exc_info=True)
                nl2sql = NL2SQLService()
                log.info(
                    "NL2SQL tables selected: %s (allowed=%s)",
                    tables,
                    sorted(list(allowed_lookup or set())) if allowed_lookup is not None else "<admin/all>",
                )
                log.info(
                    "NL2SQL question prepared: raw=\"%s\" enriched_preview=\"%s\"",
                    _preview_text(raw_question, limit=200),
                    _preview_text(contextual_question_with_dico, limit=200),
                )
                client = MindsDBClient(base_url=settings.mindsdb_base_url, token=settings.mindsdb_token)
                
                # Multi‑agent mode is always enabled
                if True:
                    evidence: list[dict[str, object]] = []
                    last_columns: list[Any] = []
                    last_rows: list[Any] = []
                    # Derive exploration rounds from per-agent budgets (explorateur/analyste)
                    def _remaining(agent: str) -> int | None:
                        cap = get_limit(agent)
                        if cap is None:
                            return None
                        return max(0, cap - get_count(agent))

                    rem_expl = _remaining("explorateur")
                    rem_anal = _remaining("analyste")
                    if rem_expl is None and rem_anal is None:
                        rounds = 1
                    else:
                        candidates = [c for c in (rem_expl, rem_anal) if c is not None]
                        rounds = max(0, min(candidates)) if candidates else 1
                    log.info("Multi‑agent rounds derived from budgets: %s (explorateur=%s, analyste=%s)", rounds, rem_expl, rem_anal)
                    min_rows = max(0, settings.nl2sql_satisfaction_min_rows)
                    if events:
                        try:
                            events(
                                "plan",
                                {
                                    "mode": "multiagent",
                                    "explore_rounds": rounds,
                                    "satisfaction_min_rows": min_rows,
                                },
                            )
                        except Exception:  # pragma: no cover
                            pass
                    if rounds <= 0:
                        # No exploration rounds allowed by current budgets (e.g., cap set to 0)
                        message = (
                            "Exploration désactivée: aucun tour autorisé avec les plafonds d'agents actuels. "
                            "Ajustez AGENT_MAX_REQUESTS pour 'explorateur'/'analyste' ou relancez la requête."
                        )
                        return self._log_completion(
                            ChatResponse(
                                reply=f"{message}\n{self._llm_diag()}",
                                metadata={"provider": "nl2sql-multiagent-empty", "rounds_used": 0},
                            ),
                            context="completion done (nl2sql-multiagent-no-round)",
                        )

                    for r in range(1, rounds + 1):
                        try:
                            observations = None
                            if evidence:
                                # Keep a compact summary for prompt control
                                try:
                                    observations = f"Evidence so far: {len(evidence)} items."
                                except Exception:
                                    observations = None
                            plan = nl2sql.explore(
                                question=contextual_question_with_dico,
                                schema=schema,
                                max_steps=NL2SQL_EXPLORE_MAX_STEPS,
                                observations=observations,
                            )
                            log.info("NL2SQL explore round %d: %d queries", r, len(plan))
                            if events:
                                try:
                                    events("plan", {"round": r, "steps": plan, "purpose": "explore"})
                                except Exception:  # pragma: no cover
                                    pass
                        except AgentBudgetExceeded:
                            # Bubble up so API can convert to 429
                            raise
                        except Exception as e:
                            log.error("NL2SQL explore failed (round %d): %s", r, e)
                            return self._log_completion(
                                ChatResponse(
                                    reply=f"Échec de l'exploration (tour {r}): {e}\n{self._llm_diag()}",
                                    metadata={"provider": "nl2sql-explore"},
                                ),
                                context="completion done (nl2sql-explore-error)",
                            )
                        # Execute exploration queries
                        for idx, item in enumerate(plan, start=1):
                            sql = item["sql"]
                            purpose = item.get("purpose", "explore")
                            log.info("MindsDB SQL (explore r=%d step=%d) [%s]: %s", r, idx, purpose or "explore", _preview_text(str(sql), limit=200))
                            if events:
                                try:
                                    events("sql", {"sql": sql, "purpose": "explore", "round": r, "step": idx})
                                except Exception:
                                    log.warning("Failed to emit sql event (explore)", exc_info=True)
                            data = client.sql(sql)
                            columns, rows = self._normalize_result(data)
                            if events:
                                try:
                                    events(
                                        "rows",
                                        {
                                            "round": r,
                                            "step": idx,
                                            "purpose": "explore",
                                            "columns": columns,
                                            "rows": rows,
                                            "row_count": len(rows),
                                        },
                                    )
                                except Exception:
                                    log.warning("Failed to emit rows event (explore)", exc_info=True)
                            evidence.append({"purpose": purpose or "explore", "sql": sql, "columns": columns, "rows": rows})
                            if columns and rows:
                                last_columns = columns
                                last_rows = rows

                        # Ask Explorateur to propose chart axes based on evidence (optional)
                        try:
                            axes = nl2sql.propose_axes(
                                question=contextual_question,  # pas de dico nécessaire ici (pas de génération SQL)
                                schema=schema,
                                evidence=evidence,
                                max_items=3,
                            )
                            log.info("Axes proposés (r=%d): %s", r, axes)
                            if events:
                                try:
                                    events("meta", {"axes_suggestions": axes, "round": r})
                                except Exception:
                                    log.warning("Failed to emit axes suggestions", exc_info=True)
                        except AgentBudgetExceeded:
                            # Bubble up so API can convert to 429
                            raise
                        except Exception as e:
                            log.warning("Proposition d'axes indisponible: %s", e)

                        # Ask Analyst to produce final SQL using evidence
                        try:
                            final_sql = nl2sql.generate_with_evidence(
                                question=contextual_question_with_dico,
                                schema=schema,
                                evidence=evidence,
                            )
                        except AgentBudgetExceeded:
                            # Bubble up so API can convert to 429
                            raise
                        except Exception as e:
                            log.error("NL2SQL analyst failed to generate SQL: %s", e)
                            return self._log_completion(
                                ChatResponse(
                                    reply=f"Échec de la génération SQL (analyste): {e}\n{self._llm_diag()}",
                                    metadata={"provider": "nl2sql-analyst"},
                                ),
                                context="completion done (nl2sql-analyst-error)",
                            )
                        log.info("MindsDB SQL (final): %s", _preview_text(str(final_sql), limit=200))
                        if events:
                            try:
                                events("sql", {"sql": final_sql, "purpose": "answer", "round": r})
                            except Exception:
                                log.warning("Failed to emit sql event (final)", exc_info=True)
                        result = client.sql(final_sql)
                        fcols, frows = self._normalize_result(result)
                        if events:
                            try:
                                events(
                                    "rows",
                                    {
                                        "purpose": "answer",
                                        "round": r,
                                        "columns": fcols,
                                        "rows": frows,
                                        "row_count": len(frows),
                                    },
                                )
                            except Exception:
                                log.warning("Failed to emit rows event (final)", exc_info=True)
                        # Emit evidence for the side panel based on the final result or last non-empty exploration
                        self._emit_evidence(
                            events=events,
                            client=client,
                            label_hint=raw_question,
                            base_sql=final_sql,
                            fallback_columns=last_columns,
                            fallback_rows=last_rows,
                        )
                        if len(frows) >= min_rows:
                            ev_for_answer = evidence + [
                                {"purpose": "answer", "sql": final_sql, "columns": fcols, "rows": frows}
                            ]
                            # Optionally ask the analyst to draft a SQL-only answer and inject
                            # it into the retrieval question to guide investigation.
                            analyst_preview: str | None = None
                            if settings.retrieval_inject_analyst:
                                try:
                                    limit = get_limit("analyste")
                                    count = get_count("analyste")
                                    # We already consumed one 'analyste' for generate_with_evidence. Only call
                                    # synthesize if it won't exceed the cap (when a cap is configured).
                                    if limit is None or (count + 1) <= limit:
                                        analyst_preview = nl2sql.synthesize(
                                            question=contextual_question,
                                            evidence=ev_for_answer,
                                        ).strip() or None
                                    else:
                                        log.info("Skip analyst preview for retrieval due to cap (%d/%d)", count, limit)
                                except Exception as e:
                                    log.warning("Analyst preview unavailable for retrieval injection: %s", e)

                            retrieval_question = contextual_question
                            if analyst_preview:
                                retrieval_question = (
                                    f"{contextual_question}\n\nRéponse analyste (SQL): {analyst_preview}"
                                )
                            retrieval_payload, highlight_text = self._retrieve_context(
                                question=retrieval_question,
                                events=events,
                                round_label=r,
                            )
                            try:
                                answer = nl2sql.write(
                                    question=contextual_question,
                                    evidence=ev_for_answer,
                                    retrieval_context=retrieval_payload,
                                ).strip()
                                reply_text = answer or "Je n'ai pas pu formuler de réponse à partir des résultats."
                                metadata = {
                                    "provider": "nl2sql-multiagent",
                                    "rounds_used": r,
                                    "sql": final_sql,
                                    "agents": ["explorateur", "analyste", "retrieval", "redaction"],
                                    "retrieval_rows": retrieval_payload,
                                }
                                return self._log_completion(
                                    ChatResponse(
                                        reply=reply_text,
                                        metadata=metadata,
                                    ),
                                    context="completion done (nl2sql-multiagent)",
                                )
                            except AgentBudgetExceeded:
                                # Bubble up so API can convert to 429
                                raise
                            except Exception as e:
                                error_reply = f"Échec de la synthèse finale (rédaction): {e}\n{self._llm_diag()}"
                                return self._log_completion(
                                    ChatResponse(
                                        reply=error_reply,
                                        metadata={
                                            "provider": "nl2sql-multiagent-synth",
                                            "retrieval_rows": retrieval_payload,
                                        },
                                    ),
                                    context="completion done (nl2sql-multiagent-synth-error)",
                                )
                        # Not satisfied; continue another explore round if available
                    # After all rounds, no satisfactory result
                    return self._log_completion(
                        ChatResponse(
                            reply=(
                                "Impossible de produire une réponse satisfaisante après l'exploration. "
                                "Affinez votre question ou vérifiez les données disponibles.\n" + self._llm_diag()
                            ),
                            metadata={"provider": "nl2sql-multiagent-empty"},
                        ),
                        context="completion done (nl2sql-multiagent-empty)",
                    )

        # If no user message was found, fall back to the engine.
        response = self.engine.run(payload)
        return self._log_completion(response, context="completion done (engine)")

    # ----------------------
    # Helpers
    # ----------------------
    def _prepare_nl2sql_question(self, messages: list[ChatMessage]) -> tuple[str, str]:
        """Return the raw user question plus a context-enriched variant for NL→SQL."""
        if not messages:
            return "", ""
        last = messages[-1]
        question = last.content.strip()
        if not question:
            return "", ""

        history: list[str] = []
        for msg in messages[:-1]:
            text = msg.content.strip()
            if not text:
                continue
            if msg.role == "system":
                continue
            speaker = "User" if msg.role == "user" else "Assistant"
            history.append(f"{speaker}: {text}")
        if not history:
            return question, question
        context = "\n".join(history[-8:])
        enriched = (
            "Conversation history (keep implicit references consistent):\n"
            f"{context}\n"
            f"Current user question: {question}"
        )
        return question, enriched

    def _build_evidence_spec(self, columns: list[Any], *, label_hint: str | None = None) -> dict[str, Any]:
        """Build a generic evidence spec from available columns.

        Not a UI heuristic: this is an explicit contract so the front can render
        a generic panel for any entity. We pick commonly used field names when present.
        """
        cols_lc = [str(c) for c in columns]
        cols_set = {c.casefold() for c in cols_lc}
        def pick(*candidates: str) -> str | None:
            for c in candidates:
                if c.casefold() in cols_set:
                    return c
            return None

        # Label guessing based on hint/columns (transparent; only used for labeling)
        label = "Éléments"
        text = (label_hint or "").casefold()
        if "ticket" in text or any("ticket" in c for c in cols_set):
            label = "Tickets"
        elif "feedback" in text or any("feedback" in c for c in cols_set):
            label = "Feedback"

        pk = pick("ticket_id", "feedback_id", "id", "pk") or (cols_lc[0] if cols_lc else "id")
        created_at = pick("created_at", "createdAt", "date", "timestamp", "createdon", "created")
        status = pick("status", "state")
        title = pick("title", "subject", "name")

        spec: dict[str, Any] = {
            "entity_label": label,
            "pk": pk,
            "display": {
                **({"title": title} if title else {}),
                **({"status": status} if status else {}),
                **({"created_at": created_at} if created_at else {}),
            },
            "columns": cols_lc,
            "limit": settings.evidence_limit_default,
        }
        return spec

    def _normalize_result(self, data: Any) -> tuple[list[Any], list[Any]]:
        """Extract columns and rows from MindsDB result payloads."""
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

        columns_list = [str(col) for col in (columns or [])]
        rows_list = list(rows or [])

        max_rows = settings.agent_output_max_rows
        if max_rows and len(rows_list) > max_rows:
            rows_list = rows_list[:max_rows]

        max_cols = settings.agent_output_max_columns
        if max_cols and columns_list and len(columns_list) > max_cols:
            columns_list = columns_list[:max_cols]

            def _trim_row(row: Any) -> Any:
                if isinstance(row, dict):
                    return {col: row.get(col) for col in columns_list}
                if isinstance(row, list):
                    return row[: len(columns_list)]
                if isinstance(row, tuple):
                    return row[: len(columns_list)]
                return row

            rows_list = [_trim_row(row) for row in rows_list]

        return columns_list, rows_list

    def _derive_evidence_sql(self, sql: str, *, limit: int | None = None) -> str | None:
        """Build a safe ``SELECT * ... LIMIT N`` for the evidence panel.

        Rationale (PR#58 recommendations):
        - Use SQL AST (sqlglot) instead of regex to avoid false matches in
          string literals and to correctly handle CTEs.
        - Apply to both aggregate and non-aggregate queries so the panel gets
          full rows when possible.
        - Skip set operations (UNION / INTERSECT / EXCEPT) to avoid producing
          misleading evidence; the regular table payload remains available.
        """
        try:
            if limit is None:
                limit = settings.evidence_limit_default
            s = (sql or "").strip()
            if not s:
                return None

            # If already SELECT * then just ensure LIMIT.
            if re.search(r"\bselect\s+\*", s, re.I):
                return s if re.search(r"\blimit\b", s, re.I) else f"{s} LIMIT {limit}"

            node = parse_one(s, read=None)  # autodetect dialect, tolerant parser

            # Reject DML/DDL early
            if isinstance(node, (exp.Insert, exp.Update, exp.Delete, exp.Alter, exp.Drop, exp.Create)):
                return None

            # Handle SELECT (optionally with WITH ... CTEs)
            select_node: exp.Select | None = None
            if isinstance(node, exp.Select):
                select_node = node
            elif isinstance(node, exp.With) and isinstance(node.this, exp.Select):
                select_node = node.this
            # Skip set operations (UNION/INTERSECT/EXCEPT): non-trivial to preserve semantics safely
            elif isinstance(node, (exp.Union, exp.Intersect, exp.Except)):
                return None

            if not select_node:
                return None

            # Clone FROM / WHERE (keep CTEs if any)
            base_select = exp.select("*")
            if select_node.args.get("from") is not None:
                base_select.set("from", select_node.args["from"].copy())
            else:
                # No FROM → nothing to select as evidence
                return None

            if select_node.args.get("where") is not None:
                base_select.set("where", select_node.args["where"].copy())

            # Preserve CTEs
            if select_node.args.get("with") is not None:
                base_select.set("with", select_node.args["with"].copy())

            # Ensure a LIMIT cap
            if base_select.args.get("limit") is None:
                base_select.set("limit", exp.Limit(expression=exp.Literal.number(limit)))

            # Render back to SQL (defaults to standard dialect)
            derived = base_select.sql()
            return derived
        except Exception:  # pragma: no cover - defensive
            log.warning("_derive_evidence_sql failed", exc_info=True)
            return None

    def _emit_evidence(
        self,
        *,
        events: Callable[[str, Dict[str, Any]], None] | None,
        client: MindsDBClient,
        label_hint: str,
        base_sql: str | None = None,
        fallback_columns: list[Any] | None = None,
        fallback_rows: list[Any] | None = None,
    ) -> None:
        """Consolidated evidence emission.

        Emits:
          - optional "sql" event with purpose:"evidence" for the derived detail query
          - "meta" with evidence_spec
          - "rows" with purpose:"evidence"
        """
        if not events:
            return
        try:
            ev_cols: list[Any] = []
            ev_rows: list[Any] = []
            derived: str | None = None
            if base_sql:
                derived = self._derive_evidence_sql(base_sql)
            if derived:
                try:
                    events("sql", {"sql": derived, "purpose": "evidence"})
                except Exception:
                    log.warning("Failed to emit evidence SQL event", exc_info=True)
                ev = client.sql(derived)
                ev_cols, ev_rows = self._normalize_result(ev)
            else:
                if fallback_columns and fallback_rows:
                    ev_cols, ev_rows = fallback_columns, fallback_rows
            if ev_cols and ev_rows:
                spec = self._build_evidence_spec(ev_cols, label_hint=label_hint)
                events("meta", {"evidence_spec": spec})
                events(
                    "rows",
                    {
                        "purpose": "evidence",
                        "columns": ev_cols,
                        "rows": ev_rows,
                        "row_count": len(ev_rows),
                    },
                )
                log.info(
                    "Emitted evidence_spec: label=%s cols=%d rows=%d",
                    spec.get("entity_label"),
                    len(ev_cols),
                    len(ev_rows),
                )
        except Exception:
            # Defensive: do not break the main flow, but keep traceback
            log.warning("Failed to emit evidence (helper)", exc_info=True)

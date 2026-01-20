from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Dict, List
import json
import logging

from ..core.config import settings
import sqlglot
from sqlglot import exp
from ..integrations.openai_client import OpenAICompatibleClient
from ..core.agent_limits import check_and_increment
from ..repositories.data_repository import DataRepository

log = logging.getLogger("insight.services.nl2sql")


def _preview(text: str, *, limit: int = 160) -> str:
    """Compact text for logging."""
    if not text:
        return ""
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    cutoff = max(limit - 3, 1)
    return f"{compact[:cutoff]}..."


def _truncate_text(val: object, *, max_chars: int) -> object:
    """Truncate string-like values for prompt safety.

    Leaves non-string values untouched. Returns original value if already small.
    """
    try:
        s = str(val)
    except Exception:
        return val
    if len(s) <= max_chars:
        return val
    # Keep tail hint when long textual content appears
    return s[: max(1, max_chars - 1)] + "…"


def _condense_evidence(
    evidence: List[Dict[str, object]],
    *,
    max_items: int = 5,
    rows_per_item: int = 10,
    max_columns: int = 10,
    cell_max_chars: int = 80,
) -> List[Dict[str, object]]:
    """Return a compact version of evidence for LLM prompts.

    - Limits number of items, columns, and rows
    - Truncates long SQL, purposes and cell values
    - Preserves shape using {columns, rows} where rows are list[list]
    """
    out: List[Dict[str, object]] = []
    if not isinstance(evidence, list):
        return out
    for e in evidence[: max(1, max_items)]:
        try:
            cols_raw = e.get("columns") if isinstance(e, dict) else []  # type: ignore[assignment]
            cols = [str(c) for c in (cols_raw or [])][: max_columns]
            # Rows can be list[list] or list[dict]; normalize to list[list]
            rows_raw = e.get("rows") if isinstance(e, dict) else []  # type: ignore[assignment]
            rows_list: List[object] = list(rows_raw or []) if isinstance(rows_raw, list) else []
            if rows_list and cols:
                trimmed_rows: List[List[object]] = []
                for row in rows_list[: max(1, rows_per_item)]:
                    if isinstance(row, dict):
                        # Keep column order from cols, drop extras
                        vals = [row.get(c) for c in cols]
                    elif isinstance(row, (list, tuple)):
                        vals = list(row)[: len(cols)]
                    else:
                        # Unrecognized row shape → stringify
                        vals = [str(row)]
                    # Truncate verbose cell values
                    trimmed_rows.append([
                        _truncate_text(v, max_chars=cell_max_chars) for v in vals
                    ])
            else:
                trimmed_rows = []
            out.append(
                {
                    "purpose": str(e.get("purpose", ""))[:200] if isinstance(e, dict) else "",
                    "sql": str(e.get("sql", ""))[:400] if isinstance(e, dict) else "",
                    "columns": cols,
                    "rows": trimmed_rows,
                    "row_count": len(rows_list),
                }
            )
        except Exception:  # pragma: no cover - defensive
            # Skip malformed entries but continue
            continue
    return out


def _extract_sql(text: str) -> str:
    t = text.strip()
    if "```" in t:
        parts = t.split("```")
        # Prefer the first fenced block content
        if len(parts) >= 2:
            code = parts[1]
            # Strip optional language hint like ```sql
            code = code.split("\n", 1)[-1] if code.lower().startswith("sql\n") else code
            return code.strip().strip(";")
    return t.strip().strip(";")


def _is_select_only(sql: str) -> bool:
    s = sql.strip().lower()
    if not s.startswith("select"):
        return False
    forbidden = (";", " insert ", " update ", " delete ", " drop ", " alter ", " create ", " grant ", " revoke ")
    # Allow single trailing semicolon by stripping earlier
    s2 = f" {s} "
    return not any(tok in s2 for tok in forbidden[1:])


def _extract_json_blob(text: str) -> str:
    """Return JSON payload possibly wrapped in a fenced block.

    Accepts raw JSON or triple‑backticked blocks (```json … ``` or ``` … ```).
    """
    blob = text or ""
    if "```" in blob:
        parts = blob.split("```")
        if len(parts) >= 2:
            blob = parts[1]
            if blob.lower().startswith("json\n"):
                blob = blob.split("\n", 1)[-1]
    return blob.strip()


_TABLE_REF_PATTERN = re.compile(r"\b(from|join)\s+(?!\s*\()([a-zA-Z_][\w\.]*)", re.IGNORECASE)
_PREFIX_SKIP_KEYWORDS = {"select", "lateral", "unnest", "values", "table", "cast"}


def _rewrite_date_functions(sql: str) -> str:
    """Rewrite YEAR(col) / MONTH(col) into DuckDB-safe EXTRACT with CAST to DATE."""
    def rep_year(m: re.Match[str]) -> str:
        expr = m.group(1).strip()
        # Avoid NULLIF; use explicit CASE to handle 'None' or empty strings
        return (
            "EXTRACT(YEAR FROM CAST("
            f"CASE WHEN {expr} IS NULL OR {expr} IN ('None','') THEN NULL ELSE {expr} END"
            " AS DATE))"
        )

    def rep_month(m: re.Match[str]) -> str:
        expr = m.group(1).strip()
        return (
            "EXTRACT(MONTH FROM CAST("
            f"CASE WHEN {expr} IS NULL OR {expr} IN ('None','') THEN NULL ELSE {expr} END"
            " AS DATE))"
        )

    out = re.sub(r"(?is)\byear\s*\(\s*([^\)]+?)\s*\)", rep_year, sql)
    out = re.sub(r"(?is)\bmonth\s*\(\s*([^\)]+?)\s*\)", rep_month, out)
    return out


def _collect_cte_names(sql: str) -> set[str]:
    names: set[str] = set()
    s = sql.lstrip()
    if not s.lower().startswith("with"):
        return names

    lower = s.lower()
    length = len(s)
    i = len("with")

    def skip_ws(pos: int) -> int:
        while pos < length and s[pos].isspace():
            pos += 1
        return pos

    i = skip_ws(i)
    if lower.startswith("recursive", i):
        i += len("recursive")
        i = skip_ws(i)

    while i < length:
        if not (s[i].isalpha() or s[i] == "_"):
            break
        start = i
        i += 1
        while i < length and (s[i].isalnum() or s[i] == "_"):
            i += 1
        names.add(s[start:i].lower())
        i = skip_ws(i)

        if i < length and s[i] == "(":
            depth = 1
            i += 1
            while i < length and depth:
                if s[i] == "(":
                    depth += 1
                elif s[i] == ")":
                    depth -= 1
                i += 1
            i = skip_ws(i)

        if not lower.startswith("as", i):
            break
        i += 2
        i = skip_ws(i)

        if lower.startswith("not materialized", i):
            i += len("not materialized")
            i = skip_ws(i)
        elif lower.startswith("materialized", i):
            i += len("materialized")
            i = skip_ws(i)

        if i >= length or s[i] != "(":
            break
        depth = 1
        i += 1
        while i < length and depth:
            if s[i] == "(":
                depth += 1
            elif s[i] == ")":
                depth -= 1
            i += 1
        i = skip_ws(i)

        if i < length and s[i] == ",":
            i += 1
            i = skip_ws(i)
            continue
        break

    return names


def _ensure_required_prefix(sql: str) -> None:
    """Validate that every referenced table uses the configured schema prefix.

    Uses sqlglot to parse the query and extract table nodes, avoiding false positives
    on constructs like EXTRACT(... FROM col) where 'FROM' is not a table clause.
    """
    try:
        tree = sqlglot.parse_one(sql, dialect="mysql")
    except Exception as e:  # surface real parse errors
        raise RuntimeError(f"SQL invalide (parse): {e}")

    required = settings.nl2sql_db_prefix.lower()
    cte_names = _collect_cte_names(sql)
    bad: list[str] = []
    for t in tree.find_all(exp.Table):
        db = t.args.get("db")
        tbl = t.args.get("this")
        db_name = (db.this if hasattr(db, "this") else None)
        tbl_name = (tbl.this if hasattr(tbl, "this") else None)
        # Skip CTE references
        if tbl_name and tbl_name.lower() in cte_names:
            continue
        # Consider only real tables; skip CTEs (sqlglot resolves separately)
        fq = ".".join([p for p in [db_name, tbl_name] if p])
        if not db_name or db_name.lower() != required:
            bad.append(fq or "<inconnu>")
    if bad:
        raise RuntimeError(
            "Requête SQL invalide: toutes les tables doivent être préfixées par "
            f"'{settings.nl2sql_db_prefix}.' (trouvé: {', '.join(repr(x) for x in bad)})"
        )


@dataclass
class NL2SQLService:
    """Generate SQL from NL using the configured OpenAI-compatible LLM.

    Strict rules: SELECT-only and target DB prefix (e.g., files.).
    """

    def _client_and_model(self) -> tuple[OpenAICompatibleClient, str]:
        if settings.llm_mode == "local":
            base_url = settings.vllm_base_url
            model = settings.z_local_model
            api_key = None
        elif settings.llm_mode == "api":
            base_url = settings.openai_base_url
            model = settings.llm_model
            api_key = settings.openai_api_key
        else:
            raise RuntimeError("Invalid LLM_MODE; expected 'local' or 'api'")
        if not base_url or not model:
            raise RuntimeError("LLM base_url/model not configured")
        log.info(
            "NL2SQL LLM target resolved: mode=%s base=%s model=%s timeout_s=%s",
            settings.llm_mode,
            base_url,
            model,
            settings.openai_timeout_s,
        )
        return (
            OpenAICompatibleClient(
                base_url=base_url,
                api_key=api_key,
                timeout_s=settings.openai_timeout_s,
            ),
            str(model),
        )

    def generate(self, *, question: str, schema: Dict[str, List[str]]) -> str:
        # Input validation (defensive)
        if not isinstance(question, str) or not question.strip():
            raise RuntimeError("La question est vide.")
        if not isinstance(schema, dict) or not schema:
            raise RuntimeError("Aucun schéma disponible pour générer le SQL.")
        log.info(
            "NL2SQL.generate start: schema_tables=%d question=\"%s\"",
            len(schema),
            _preview(question, limit=200),
        )
        client, model = self._client_and_model()
        tables_desc = []
        for t, cols in schema.items():
            col_list = ", ".join(cols)
            tables_desc.append(f"- {settings.nl2sql_db_prefix}.{t}({col_list})")
        tables_blob = "\n".join(tables_desc)
        # Cap prompt size to avoid runaway contexts (truncate at line boundaries)
        if len(tables_blob) > 8000:
            lines = tables_blob.split("\n")
            truncated: list[str] = []
            length = 0
            for line in lines:
                if length + len(line) > 8000:
                    break
                truncated.append(line)
                length += len(line) + 1
            tables_blob = "\n".join(truncated) + "\n…"
            log.warning(
                "NL2SQL.generate truncated schema blob to 8000 chars (kept_lines=%d)",
                len(truncated),
            )
        # Hints for date-like columns
        date_hints: Dict[str, List[str]] = {}
        for t, cols in schema.items():
            dcols = [c for c in cols if "date" in c.lower()]
            if dcols:
                date_hints[t] = dcols
        if date_hints:
            log.info("NL2SQL.generate date hints for tables: %s", sorted(date_hints.keys()))

        system = (
            "You are a strict SQL generator. Dialect: MindsDB SQL (MySQL-like).\n"
            f"Use only the tables listed below under the '{settings.nl2sql_db_prefix}.' schema.\n"
            "Return exactly ONE SELECT query. No comments. No explanations.\n"
            "Rules: SELECT-only; never modify data. Date-like columns are TEXT in 'YYYY-MM-DD'.\n"
            "For date parts, use EXTRACT(YEAR|MONTH FROM CAST(CASE WHEN col IS NULL OR col IN ('None','') THEN NULL ELSE col END AS DATE)).\n"
            "Never use NULLIF with more than 2 arguments. Prefer the CASE…END form above over NULLIF.\n"
            f"Every FROM/JOIN must reference tables as '{settings.nl2sql_db_prefix}.table' and assign an alias (e.g. FROM {settings.nl2sql_db_prefix}.tickets_jira AS t).\n"
            "After introducing an alias, reuse it everywhere (SELECT, WHERE, subqueries) instead of the raw table name.\n"
            "Never invent table or column names: use them exactly as provided (e.g. if only 'tickets_jira' exists, do NOT use 'tickets')."
        )
        hints = ""
        if date_hints:
            hint_lines = [f"- {settings.nl2sql_db_prefix}.{t}: {', '.join(cols)}" for t, cols in date_hints.items()]
            hints = "\nDate-like columns (cast before date ops):\n" + "\n".join(hint_lines)
        user = (
            f"Available tables and columns:\n{tables_blob}{hints}\n\n"
            f"Question: {question}\n"
            f"Produce a single SQL query using only {settings.nl2sql_db_prefix}.* tables."
        )
        # Enforce per-agent cap (nl2sql)
        check_and_increment("nl2sql")
        log.info(
            "NL2SQL.generate invoking LLM: model=%s max_tokens=%d table_blob_chars=%d",
            model,
            settings.llm_max_tokens,
            len(tables_blob),
        )
        try:
            resp = client.chat_completions(
                model=model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0,
                max_tokens=settings.llm_max_tokens,
            )
        except Exception:
            log.exception("NL2SQL.generate LLM call failed")
            raise
        text = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
        sql = _extract_sql(text)
        sql = _rewrite_date_functions(sql)
        if not _is_select_only(sql):
            raise RuntimeError("Generated SQL is invalid or not SELECT-only")
        _ensure_required_prefix(sql)
        log.info("NL2SQL.generate done: sql_preview=\"%s\"", _preview(sql, limit=200))
        return sql


    def synthesize(self, *, question: str, evidence: List[Dict[str, object]]) -> str:
        client, model = self._client_and_model()
        log.info(
            "NL2SQL.synthesize start: question=\"%s\" evidence_items=%d",
            _preview(question, limit=200),
            len(evidence),
        )
        system = (
            "You are an analyst. Given a question and the results of prior SQL queries,"
            " write a concise answer in French. Use numbers and be precise."
            " If data is insufficient, say so. Do not include SQL in the final answer."
        )
        condensed = _condense_evidence(
            evidence,
            max_items=6,
            rows_per_item=10,
            max_columns=min(10, settings.agent_output_max_columns),
            cell_max_chars=80,
        )
        user = json.dumps({"question": question, "evidence": condensed}, ensure_ascii=False)
        # Enforce per-agent cap (analyste)
        check_and_increment("analyste")
        log.info(
            "NL2SQL.synthesize invoking LLM: model=%s max_tokens=%d payload_chars=%d (items=%d)",
            model,
            settings.llm_max_tokens,
            len(user),
            len(condensed),
        )
        try:
            resp = client.chat_completions(
                model=model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0,
                max_tokens=settings.llm_max_tokens,
            )
        except Exception:
            log.exception("NL2SQL.synthesize LLM call failed")
            raise
        reply = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
        log.info("NL2SQL.synthesize done: reply_preview=\"%s\"", _preview(reply, limit=200))
        return reply

    def write(
        self,
        *,
        question: str,
        evidence: List[Dict[str, object]],
        retrieval_context: List[Dict[str, object]] | None = None,
    ) -> str:
        """Synthesis agent: fuses SQL evidence with optional retrieval rows.

        - Prefers SQL-derived numbers when conflicts arise
        - Uses retrieval rows as contextual examples only
        - Produces a concise French answer, no SQL in the output
        """
        client, model = self._client_and_model()
        log.info(
            "NL2SQL.write(synthesis) start: question=\"%s\" evidence=%d retrieval=%d",
            _preview(question, limit=200),
            len(evidence),
            len(retrieval_context or []),
        )
        payload = {
            "question": question,
            "evidence": _condense_evidence(
                evidence,
                max_items=6,
                rows_per_item=12,
                max_columns=min(10, settings.agent_output_max_columns),
                cell_max_chars=80,
            ),
            "retrieval": retrieval_context or [],
            "guidelines": [
                "Base the answer primarily on SQL evidence (columns/rows).",
                "Use retrieval rows to add color/examples; do not invent facts.",
                "If there is insufficient data, state it clearly.",
                "Answer in French, 2–4 concise sentences, include key figures.",
            ],
        }
        system = (
            "You are a synthesis agent. Combine the SQL evidence and any retrieved related rows\n"
            "to answer the user's question precisely in French. Prefer the SQL-derived numbers\n"
            "when data conflicts. Do not output SQL or code."
        )
        # Enforce per-agent cap (redaction)
        check_and_increment("redaction")
        payload_json = json.dumps(payload, ensure_ascii=False)
        log.info(
            "NL2SQL.write(synthesis) invoking LLM: model=%s max_tokens=%d payload_chars=%d",
            model,
            settings.llm_max_tokens,
            len(payload_json),
        )
        try:
            resp = client.chat_completions(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": payload_json},
                ],
                temperature=0,
                max_tokens=settings.llm_max_tokens,
            )
        except Exception:
            log.exception("NL2SQL.write(synthesis) LLM call failed")
            raise
        reply = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
        log.info("NL2SQL.write(synthesis) done: reply_preview=\"%s\"", _preview(reply, limit=200))
        return reply

    # --- Multi‑agent helpers -------------------------------------------------
    def explore(
        self,
        *,
        question: str,
        schema: Dict[str, List[str]],
        max_steps: int,
        observations: str | None = None,
    ) -> List[Dict[str, str]]:
        """Ask the LLM to propose small exploratory SELECT queries.

        The goal is to quickly learn about value ranges and categories related to the question
        (e.g., DISTINCT values, MIN/MAX, sample rows, small GROUP BY counts).
        Returns a list of {"purpose", "sql"}.
        """
        client, model = self._client_and_model()
        log.info(
            "NL2SQL.explore start: question=\"%s\" schema_tables=%d max_steps=%d observations=%s",
            _preview(question, limit=160),
            len(schema),
            max_steps,
            "yes" if observations else "no",
        )
        tables_desc = []
        for t, cols in schema.items():
            col_list = ", ".join(cols)
            tables_desc.append(f"- {settings.nl2sql_db_prefix}.{t}({col_list})")
        tables_blob = "\n".join(tables_desc)

        system = (
            "You are a data explorer agent. Propose up to N short SELECT queries that help\n"
            "understand the data relevant to the question: small DISTINCT lists, MIN/MAX for dates\n"
            "or numbers, COUNTs by key categories, and a few sample rows (LIMIT ≤ 20).\n"
            f"Use only the '{settings.nl2sql_db_prefix}.' schema and always add an alias after each table.\n"
            "All queries must be SELECT‑only, safe to execute, and return quickly.\n"
            "For date parts, use EXTRACT(YEAR|MONTH FROM CAST(CASE WHEN col IS NULL OR col IN ('None','') THEN NULL ELSE col END AS DATE)).\n"
            "Never use NULLIF with more than 2 arguments; prefer the CASE…END form above.\n"
            "Return JSON only: {\"queries\":[{\"purpose\":str,\"sql\":str}, ...]}. No prose."
        )
        obs_section = (f"\nObservations to consider:\n{observations}\n" if observations else "")
        user = (
            f"Available tables and columns:\n{tables_blob}\n\n"
            f"Max steps: {max_steps}. Question: {question}\n"
            f"Focus on columns likely involved in the question.\n"
            + obs_section
        )
        # Enforce per-agent cap (explorateur)
        check_and_increment("explorateur")
        log.info(
            "NL2SQL.explore invoking LLM: model=%s max_tokens=%d tables=%d",
            model,
            settings.llm_max_tokens,
            len(schema),
        )
        try:
            resp = client.chat_completions(
                model=model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0,
                max_tokens=settings.llm_max_tokens,
            )
        except Exception:
            log.exception("NL2SQL.explore LLM call failed")
            raise
        text = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
        blob = text
        if "```" in text:
            parts = text.split("```")
            if len(parts) >= 2:
                blob = parts[1]
                if blob.lower().startswith("json\n"):
                    blob = blob.split("\n", 1)[-1]
        try:
            data = json.loads(blob)
        except Exception as e:
            raise RuntimeError(f"Exploration JSON invalide: {e}")
        queries = data.get("queries") if isinstance(data, dict) else None
        if not isinstance(queries, list) or not queries:
            raise RuntimeError("Aucune requête exploratoire proposée")
        out: List[Dict[str, str]] = []
        for q in queries[:max_steps]:
            purpose = str(q.get("purpose", "")).strip()
            sql = _extract_sql(str(q.get("sql", "")))
            if not purpose or not sql:
                continue
            sql = _rewrite_date_functions(sql)
            if not _is_select_only(sql):
                raise RuntimeError("Une requête exploratoire n'est pas un SELECT")
            _ensure_required_prefix(sql)
            out.append({"purpose": purpose, "sql": sql})
        if not out:
            raise RuntimeError("Aucune requête exploratoire exploitable")
        log.info("NL2SQL.explore done: queries=%d", len(out))
        return out

    def generate_with_evidence(
        self,
        *,
        question: str,
        schema: Dict[str, List[str]],
        evidence: List[Dict[str, object]],
    ) -> str:
        """Produce a single final SELECT using prior exploration evidence.

        The model must return only one SELECT that answers the question precisely.
        """
        client, model = self._client_and_model()
        log.info(
            "NL2SQL.generate_with_evidence start: question=\"%s\" schema_tables=%d evidence_items=%d",
            _preview(question, limit=200),
            len(schema),
            len(evidence),
        )
        tables_desc = []
        for t, cols in schema.items():
            col_list = ", ".join(cols)
            tables_desc.append(f"- {settings.nl2sql_db_prefix}.{t}({col_list})")
        system = (
            "You are an analyst agent. Given a natural language question and the results of prior\n"
            "exploratory queries, write ONE SQL SELECT that directly answers the question.\n"
            "Dialect: MindsDB (MySQL-like). Rules: SELECT-only; prefix tables with the allowed schema;\n"
            "For date parts, use EXTRACT(YEAR|MONTH FROM CAST(CASE WHEN col IS NULL OR col IN ('None','') THEN NULL ELSE col END AS DATE)).\n"
            "Never use NULLIF with more than 2 arguments; prefer the CASE…END form above.\n"
            "Return only the SQL (optionally fenced). No explanation."
        )
        # Condense evidence to keep prompt within safe bounds
        condensed = _condense_evidence(
            evidence,
            max_items=5,
            rows_per_item=10,
            max_columns=min(10, settings.agent_output_max_columns),
            cell_max_chars=80,
        )
        user = json.dumps(
            {
                "question": question,
                "tables": tables_desc,
                "evidence": condensed,
                "rules": {
                    "schema_prefix": settings.nl2sql_db_prefix,
                },
            },
            ensure_ascii=False,
        )
        # Enforce per-agent cap (analyste)
        check_and_increment("analyste")
        log.info(
            "NL2SQL.generate_with_evidence invoking LLM: model=%s max_tokens=%d payload_chars=%d (items=%d)",
            model,
            settings.llm_max_tokens,
            len(user),
            len(condensed),
        )
        try:
            resp = client.chat_completions(
                model=model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0,
                max_tokens=settings.llm_max_tokens,
            )
        except Exception:
            log.exception("NL2SQL.generate_with_evidence LLM call failed")
            raise
        text = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
        sql = _extract_sql(text)
        sql = _rewrite_date_functions(sql)
        if not _is_select_only(sql):
            raise RuntimeError("La requête finale générée n'est pas un SELECT")
        _ensure_required_prefix(sql)
        log.info("NL2SQL.generate_with_evidence done: sql_preview=\"%s\"", _preview(sql, limit=200))
        return sql

    def propose_axes(
        self,
        *,
        question: str,
        schema: Dict[str, List[str]],
        evidence: List[Dict[str, object]] | None = None,
        max_items: int = 3,
    ) -> List[Dict[str, str]]:
        """Suggest chart axes and aggregations based on the question and exploration evidence.

        Returns a list of objects with keys: x, y (optional), agg (optional), chart (bar|line|pie|table), reason.
        """
        client, model = self._client_and_model()
        log.info(
            "NL2SQL.propose_axes start: question=\"%s\" schema_tables=%d evidence_items=%d max_items=%d",
            _preview(question, limit=160),
            len(schema),
            len(evidence or []),
            max_items,
        )
        tables_desc = []
        for t, cols in schema.items():
            col_list = ", ".join(cols)
            tables_desc.append(f"- {settings.nl2sql_db_prefix}.{t}({col_list})")
        payload = {
            "question": question,
            "tables": tables_desc,
            "evidence_preview": (
                [
                    {
                        "purpose": str(e.get("purpose", "")),
                        "sql": str(e.get("sql", ""))[:200],
                        "columns": e.get("columns", []),
                        "row_count": len(e.get("rows", []) if isinstance(e.get("rows"), list) else []),
                    }
                    for e in (evidence or [])
                ]
            ),
            "max_items": max_items,
        }
        system = (
            "You are a visualization assistant. Propose up to N concise axis suggestions\n"
            "for charts that would best communicate the answer to the question, based on the columns\n"
            "available and any exploratory findings. Prefer simple bar/line charts; fall back to 'table' when unclear.\n"
            "Return ONLY JSON: {\"axes\":[{\"x\":str,\"y\":str?,\"agg\":str?,\"chart\":str,\"reason\":str}...]}."
        )
        # Enforce per-agent cap (axes)
        check_and_increment("axes")
        payload_json = json.dumps(payload, ensure_ascii=False)
        log.info(
            "NL2SQL.propose_axes invoking LLM: model=%s max_tokens=%d payload_chars=%d",
            model,
            settings.llm_max_tokens,
            len(payload_json),
        )
        try:
            resp = client.chat_completions(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": payload_json},
                ],
                temperature=0,
                max_tokens=settings.llm_max_tokens,
            )
        except Exception:
            log.exception("NL2SQL.propose_axes LLM call failed")
            raise
        text = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
        blob = text
        if "```" in text:
            parts = text.split("```")
            if len(parts) >= 2:
                blob = parts[1]
                if blob.lower().startswith("json\n"):
                    blob = blob.split("\n", 1)[-1]
        try:
            data = json.loads(blob)
        except Exception as e:
            raise RuntimeError(f"Axes JSON invalide: {e}")
        axes = data.get("axes") if isinstance(data, dict) else None
        if not isinstance(axes, list) or not axes:
            raise RuntimeError("Aucune proposition d'axes")
        out: List[Dict[str, str]] = []
        for a in axes[: max(1, max_items)]:
            x = str(a.get("x", "")).strip()
            y = str(a.get("y", "")).strip() if a.get("y") is not None else ""
            chart = str(a.get("chart", "")).strip() or "table"
            reason = str(a.get("reason", "")).strip()
            agg = str(a.get("agg", "")).strip() if a.get("agg") is not None else ""
            if not x:
                continue
            out.append({"x": x, "y": y, "agg": agg, "chart": chart, "reason": reason})
        if not out:
            raise RuntimeError("Aucune proposition d'axes exploitable")
        log.info("NL2SQL.propose_axes done: suggestions=%d", len(out))
        return out

    # Writer agent: interpret results with Constat / Action / Question
    def write(
        self,
        *,
        question: str,
        evidence: List[Dict[str, object]],
        retrieval_context: List[Dict[str, object]] | None = None,
    ) -> str:
        client, model = self._client_and_model()
        log.info(
            "NL2SQL.write(writer) start: question=\"%s\" evidence=%d retrieval=%d",
            _preview(question, limit=200),
            len(evidence),
            len(retrieval_context or []),
        )
        system = (
            "Tu es un rédacteur‑analyste français. À partir des tableaux de résultats fournis (evidence), "
            "réponds directement à la question de l'utilisateur de manière naturelle et fluide.\n\n"
            "Règles:\n"
            "- Adapte librement la structure de ta réponse selon la question et les données disponibles\n"
            "- Intègre les chiffres précis (comptes, pourcentages, tendances) de l'evidence SQL\n"
            "- Si un bloc 'retrieval_context' est fourni, enrichis ta réponse avec ces exemples concrets de manière naturelle\n"
            "- Si l'evidence SQL est vide ou non pertinente, ignore-la et base-toi uniquement sur retrieval_context si disponible\n"
            "- Si retrieval_context est vide ou non pertinent, ignore-le et base-toi uniquement sur l'evidence SQL\n"
            "- Si les deux sources sont insuffisantes, indique clairement que tu n'as pas trouvé de données pertinentes\n"
            "- N'utilise JAMAIS de formulations prédéfinies comme « Mise en avant : », « Constat : », « Action proposée : »\n"
            "- Pas de titres, pas de listes à puces, pas de sections numérotées\n"
            "- Français professionnel, direct et concis (2-5 phrases selon le contexte)\n"
            "- Pas de SQL ni de jargon technique dans la réponse finale"
        )
        payload = {
            "question": question,
            "evidence": _condense_evidence(
                evidence,
                max_items=6,
                rows_per_item=12,
                max_columns=min(10, settings.agent_output_max_columns),
                cell_max_chars=80,
            ),
        }
        if retrieval_context is not None:
            payload["retrieval_context"] = retrieval_context
        # Enforce per-agent cap (redaction)
        check_and_increment("redaction")
        payload_json = json.dumps(payload, ensure_ascii=False)
        log.info(
            "NL2SQL.write(writer) invoking LLM: model=%s max_tokens=%d payload_chars=%d",
            model,
            settings.llm_max_tokens,
            len(payload_json),
        )
        try:
            resp = client.chat_completions(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": payload_json},
                ],
                temperature=0,
                max_tokens=settings.llm_max_tokens,
            )
        except Exception:
            log.exception("NL2SQL.write(writer) LLM call failed")
            raise
        reply = resp.get("choices", [{}])[0].get("message", {}).get("content", "")
        log.info("NL2SQL.write(writer) done: reply_preview=\"%s\"", _preview(reply, limit=200))
        return reply

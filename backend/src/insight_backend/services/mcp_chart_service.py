from __future__ import annotations

import json
import os
import sys
from contextlib import asynccontextmanager
from functools import lru_cache
from dataclasses import dataclass
from typing import Any, AsyncIterator, Dict, Iterable, List, TextIO, Tuple

import logging
import anyio
import anyio.lowlevel
import httpx

from openai.types.chat import ChatCompletion as OpenAIChatCompletion
from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.mcp import MCPServerStdio
from pydantic_ai.messages import ModelResponse
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai import models as ai_models
from pydantic_ai.providers.openai import OpenAIProvider

from anyio.streams.memory import MemoryObjectReceiveStream, MemoryObjectSendStream
from anyio.streams.text import TextReceiveStream
from mcp.client import stdio as mcp_stdio
from mcp.shared.message import SessionMessage
import mcp.types as mcp_types

from ..core.config import settings
from ..core.agent_limits import check_and_increment, AgentBudgetExceeded
from ..integrations.mcp_manager import MCPManager, MCPServerSpec
from ..schemas.mcp_chart import ChartDataset


class ChartGenerationError(RuntimeError):
    """Raised when chart generation via MCP fails."""


log = logging.getLogger("insight.services.mcp_chart")
_stdout_log = log.getChild("stdio")


def _should_suppress_json_error(raw_line: str) -> bool:
    text = raw_line.strip()
    if not text:
        return True
    return "jsonrpc" not in text


@lru_cache
def _openai_http_client(verify_ssl: bool) -> httpx.AsyncClient:
    timeout = httpx.Timeout(timeout=600, connect=5)
    return httpx.AsyncClient(
        timeout=timeout,
        headers={"User-Agent": ai_models.get_user_agent()},
        verify=verify_ssl,
    )


@asynccontextmanager
async def _filtered_stdio_client(
    server: mcp_stdio.StdioServerParameters,
    errlog: TextIO = sys.stderr,
) -> AsyncIterator[
    Tuple[
        MemoryObjectReceiveStream[SessionMessage | Exception],
        MemoryObjectSendStream[SessionMessage],
    ]
]:
    read_stream_writer, read_stream = anyio.create_memory_object_stream(0)
    write_stream, write_stream_reader = anyio.create_memory_object_stream(0)

    try:
        command = mcp_stdio._get_executable_command(server.command)
        process = await mcp_stdio._create_platform_compatible_process(
            command=command,
            args=server.args,
            env=(
                {**mcp_stdio.get_default_environment(), **server.env}
                if server.env is not None
                else mcp_stdio.get_default_environment()
            ),
            errlog=errlog,
            cwd=server.cwd,
        )
    except OSError:
        await read_stream.aclose()
        await write_stream.aclose()
        await read_stream_writer.aclose()
        await write_stream_reader.aclose()
        raise

    async def stdout_reader() -> None:
        assert process.stdout, "Opened process is missing stdout"

        try:
            async with read_stream_writer:
                buffer = ""
                async for chunk in TextReceiveStream(
                    process.stdout,
                    encoding=server.encoding,
                    errors=server.encoding_error_handler,
                ):
                    lines = (buffer + chunk).split("\n")
                    buffer = lines.pop()

                    for line in lines:
                        try:
                            message = mcp_types.JSONRPCMessage.model_validate_json(line)
                        except Exception as exc:  # pragma: no cover - depends on external server
                            if _should_suppress_json_error(line):
                                preview = line.strip()
                                if preview:
                                    _stdout_log.debug("Ignored MCP stdout noise: %s", preview[:200])
                                continue
                            _stdout_log.exception("Failed to parse JSONRPC message from server")
                            await read_stream_writer.send(exc)
                            continue

                        session_message = SessionMessage(message)
                        await read_stream_writer.send(session_message)
        except anyio.ClosedResourceError:  # pragma: no cover - driven by transport shutdown
            await anyio.lowlevel.checkpoint()

    async def stdin_writer() -> None:
        assert process.stdin, "Opened process is missing stdin"

        try:
            async with write_stream_reader:
                async for session_message in write_stream_reader:
                    payload = session_message.message.model_dump_json(by_alias=True, exclude_none=True)
                    await process.stdin.send(
                        (payload + "\n").encode(
                            encoding=server.encoding,
                            errors=server.encoding_error_handler,
                        )
                    )
        except anyio.ClosedResourceError:  # pragma: no cover - driven by transport shutdown
            await anyio.lowlevel.checkpoint()

    async with (
        anyio.create_task_group() as tg,
        process,
    ):
        tg.start_soon(stdout_reader)
        tg.start_soon(stdin_writer)
        try:
            yield read_stream, write_stream
        finally:
            if process.stdin:
                try:
                    await process.stdin.aclose()
                except Exception:  # pragma: no cover - depends on subprocess state
                    pass

            try:
                with anyio.fail_after(mcp_stdio.PROCESS_TERMINATION_TIMEOUT):
                    await process.wait()
            except TimeoutError:
                await mcp_stdio._terminate_process_tree(process)
            except ProcessLookupError:  # pragma: no cover - depends on OS scheduling
                pass
            await read_stream.aclose()
            await write_stream.aclose()
            await read_stream_writer.aclose()
            await write_stream_reader.aclose()


class FilteredMCPServerStdio(MCPServerStdio):
    @asynccontextmanager
    async def client_streams(
        self,
    ) -> AsyncIterator[
        Tuple[
            MemoryObjectReceiveStream[SessionMessage | Exception],
            MemoryObjectSendStream[SessionMessage],
        ]
    ]:
        server = mcp_stdio.StdioServerParameters(
            command=self.command,
            args=list(self.args),
            env=self.env,
            cwd=self.cwd,
        )
        async with _filtered_stdio_client(server=server) as streams:
            yield streams


class ChartAgentOutput(BaseModel):
    chart_url: str
    tool_name: str
    chart_title: str | None = None
    chart_description: str | None = None
    chart_spec: Dict[str, Any] | None = None


@dataclass(slots=True)
class ChartAgentDeps:
    dataset: ChartDataset
    answer: str | None = None
    max_rows: int = 400

    def trimmed_rows(self, limit: int | None = None) -> List[Dict[str, Any]]:
        cap = self.max_rows if limit is None else min(limit, self.max_rows)
        return [dict(row) for row in self.dataset.rows[:cap]]

    def payload(self, limit: int | None = None) -> Dict[str, Any]:
        rows = self.trimmed_rows(limit)
        total = self.dataset.row_count if self.dataset.row_count is not None else len(self.dataset.rows)
        return {
            "sql": self.dataset.sql,
            "columns": self.dataset.columns,
            "rows": rows,
            "row_count": total,
            "step": self.dataset.step,
            "description": self.dataset.description,
        }

    def describe_dataset(self, preview_limit: int = 5) -> str:
        total = self.dataset.row_count if self.dataset.row_count is not None else len(self.dataset.rows)
        provided = len(self.dataset.rows)
        columns = ", ".join(self.dataset.columns) if self.dataset.columns else "(aucune)"
        lines = [
            f"Requête SQL: {self.dataset.sql}",
            f"Colonnes disponibles: {columns}",
            f"Lignes totales annoncées: {total}",
            f"Lignes transmises au modèle (limitées à {self.max_rows}): {provided}",
        ]
        preview = self.payload(preview_limit)["rows"]
        if preview:
            lines.append("Aperçu des premières lignes (JSON):")
            lines.append(json.dumps(preview, ensure_ascii=False))
        if self.answer:
            lines.append("Synthèse NL→SQL fournie précédemment:")
            lines.append(self.answer.strip())
        if self.dataset.description:
            lines.append(f"Contexte additionnel: {self.dataset.description}")
        return "\n".join(lines)


@dataclass(slots=True)
class ChartResult:
    prompt: str
    chart_url: str
    tool_name: str
    chart_title: str | None
    chart_description: str | None
    chart_spec: Dict[str, Any] | None
    source_sql: str | None
    source_row_count: int | None


class LenientOpenAIChatModel(OpenAIChatModel):
    """OpenAI chat model that tolerates missing metadata from compatible backends."""

    def _process_response(self, response: OpenAIChatCompletion | str) -> ModelResponse:  # type: ignore[override]
        if isinstance(response, OpenAIChatCompletion) and not getattr(response, "object", None):
            response.object = "chat.completion"
        return super()._process_response(response)


class ChartGenerationService:
    """Generates charts dynamically through the MCP chart server."""

    _DEFAULT_MAX_ROWS = 400

    def __init__(self) -> None:
        self._chart_spec = self._resolve_chart_spec()

    async def generate_chart(
        self,
        prompt: str,
        dataset: ChartDataset,
        answer: str | None = None,
    ) -> ChartResult:
        if not prompt.strip():
            raise ChartGenerationError("La requête utilisateur est vide.")

        if not dataset.sql.strip():
            raise ChartGenerationError("La requête SQL source est manquante.")

        if not dataset.columns:
            raise ChartGenerationError("Le résultat SQL ne contient aucune colonne exploitable.")

        if not dataset.rows:
            raise ChartGenerationError("Le résultat SQL est vide; impossible de générer un graphique.")

        normalized_rows = self._normalize_rows(dataset.columns, dataset.rows)
        limited_rows = normalized_rows[: self._DEFAULT_MAX_ROWS]
        normalized_dataset = ChartDataset(
            sql=dataset.sql,
            columns=dataset.columns,
            rows=limited_rows,
            row_count=dataset.row_count,
            step=dataset.step,
            description=dataset.description,
        )

        provider, model_name = self._build_provider()
        env = os.environ.copy()
        env.update(self._chart_spec.env or {})

        server = FilteredMCPServerStdio(
            self._chart_spec.command,
            self._chart_spec.args,
            env=env,
            tool_prefix=self._chart_spec.name,
            timeout=30,
            read_timeout=300,
        )

        model = LenientOpenAIChatModel(model_name=model_name, provider=provider)
        agent = Agent(
            model,
            name="mcp-chart",
            instructions=self._base_instructions(self._chart_spec.name, normalized_dataset, answer),
            deps_type=ChartAgentDeps,
            output_type=ChartAgentOutput,
            toolsets=[server],
        )

        @agent.tool
        async def get_sql_result(ctx: RunContext[ChartAgentDeps]) -> Dict[str, Any]:  # type: ignore[no-untyped-def]
            """Retourne les colonnes et lignes issues de la requête SQL exécutée en amont."""
            return ctx.deps.payload()

        @agent.instructions
        async def sql_result_overview(ctx: RunContext[ChartAgentDeps]) -> str:  # type: ignore[no-untyped-def]
            return ctx.deps.describe_dataset()

        deps = ChartAgentDeps(
            dataset=normalized_dataset,
            answer=answer,
            max_rows=self._DEFAULT_MAX_ROWS,
        )

        try:
            async with agent:
                # Enforce per-agent cap (mcp_chart)
                check_and_increment("mcp_chart")
                result = await agent.run(prompt, deps=deps)
        except UnexpectedModelBehavior as exc:
            log.exception("Réponse LLM incompatible pour la génération de graphiques")
            raise ChartGenerationError(f"Réponse LLM incompatible: {exc}") from exc
        except AgentBudgetExceeded:
            # Bubble up so the API layer can return 429
            raise
        except Exception as exc:  # pragma: no cover - dépend des intégrations externes
            log.exception("Échec lors de la génération de graphique via MCP")
            raise ChartGenerationError(str(exc)) from exc

        output = result.output
        if not output.chart_url:
            raise ChartGenerationError("L'agent n'a pas fourni d'URL de graphique.")

        total_rows = normalized_dataset.row_count if normalized_dataset.row_count is not None else len(normalized_dataset.rows)

        return ChartResult(
            prompt=prompt,
            chart_url=output.chart_url,
            tool_name=output.tool_name,
            chart_title=output.chart_title,
            chart_description=output.chart_description,
            chart_spec=output.chart_spec,
            source_sql=normalized_dataset.sql,
            source_row_count=total_rows,
        )

    def _resolve_chart_spec(self) -> MCPServerSpec:
        manager = MCPManager()
        for spec in manager.list_servers():
            if spec.name in {"chart", "mcp-server-chart"}:
                return spec
        raise ChartGenerationError(
            "Serveur MCP 'chart' introuvable. Vérifiez MCP_CONFIG_PATH ou MCP_SERVERS_JSON."
        )

    def _build_provider(self) -> tuple[OpenAIProvider, str]:
        if settings.llm_mode not in {"local", "api"}:
            raise ChartGenerationError("LLM_MODE doit valoir 'local' ou 'api'.")

        if settings.llm_mode == "local":
            base_url = (settings.vllm_base_url or "").rstrip("/")
            model_name = settings.z_local_model
            api_key = None
        else:
            base_url = (settings.openai_base_url or "").rstrip("/")
            model_name = settings.llm_model
            api_key = settings.openai_api_key

        if not base_url or not model_name:
            raise ChartGenerationError(
                "Configuration LLM incomplète pour la génération de graphiques."
            )

        verify_ssl = bool(settings.llm_verify_ssl)
        if not verify_ssl:
            log.warning(
                "LLM SSL verification disabled for MCP chart calls (LLM_VERIFY_SSL=%r).",
                settings.llm_verify_ssl,
            )

        http_client = _openai_http_client(verify_ssl)
        provider = OpenAIProvider(
            base_url=base_url,
            api_key=api_key,
            http_client=http_client,
        )
        return provider, model_name

    @staticmethod
    def _normalize_rows(columns: List[str], rows: Iterable[Any]) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        headings = list(columns)
        fallback_key = headings[0] if headings else "value"
        for row in rows:
            if isinstance(row, dict):
                normalized.append({col: row.get(col) for col in headings})
            elif isinstance(row, (list, tuple)):
                normalized.append({
                    col: row[idx] if idx < len(row) else None
                    for idx, col in enumerate(headings)
                })
            else:
                normalized.append({fallback_key: row})
        return normalized

    @staticmethod
    def _base_instructions(
        tool_prefix: str | None,
        dataset: ChartDataset,
        answer: str | None,
    ) -> str:
        prefix_hint = (
            f"Les outils du serveur MCP sont exposés sous le préfixe '{tool_prefix}_'."
            if tool_prefix
            else "Les outils du serveur MCP sont disponibles sans préfixe spécifique."
        )
        total_rows = dataset.row_count if dataset.row_count is not None else len(dataset.rows)
        summary_cols = ", ".join(dataset.columns[:6])
        if len(dataset.columns) > 6:
            summary_cols += ", …"
        answer_hint = f"\nSynthèse NL→SQL à respecter: {answer.strip()}" if answer else ""
        return (
            "Tu es un analyste data. Une réponse NL→SQL a déjà produit un résultat SQL précis."
            " Tu dois créer un graphique basé UNIQUEMENT sur ces données."
            f" {prefix_hint}\n"
            "Processus obligatoire :\n"
            "1. Récupérer le résultat SQL avec l'outil `get_sql_result` (colonnes et lignes disponibles).\n"
            "2. Déterminer un graphique cohérent avec la question utilisateur et les colonnes disponibles"
            f" (colonnes principales: {summary_cols} — {total_rows} lignes en tout).\n"
            "3. Appeler l'outil MCP adéquat en lui transmettant les données structurées (type de graphique,"
            " axes, mesures, filtres éventuels).\n"
            "4. Retourner un ChartAgentOutput strictement valide avec :\n"
            "   - chart_url : URL livrée par le MCP\n"
            "   - tool_name : nom exact de l'outil MCP utilisé\n"
            "   - chart_title / chart_description : résumé concis et fidèle\n"
            "   - chart_spec : payload JSON envoyé au MCP (type, data, options).\n"
            "N'invente ni colonnes ni données supplémentaires; utilise uniquement ce que `get_sql_result` fournit."
            + answer_hint
        )

from __future__ import annotations

import contextvars
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import List

from ..core.agent_limits import check_and_increment
from ..core.config import settings
from ..core.prompts import get_prompt_store
from ..integrations.openai_client import OpenAICompatibleClient, OpenAIBackendError


log = logging.getLogger("insight.services.ticket_context")


class TicketContextAgent:
    """Agent dédié à la synthèse des tickets pour le mode chat."""

    def _summarize(self, *, period_label: str, tickets: List[str], total_tickets: int) -> str:
        if not tickets:
            raise ValueError("Aucun ticket fourni pour la synthèse.")
        if settings.llm_mode not in {"local", "api"}:
            raise RuntimeError("LLM_MODE doit être 'local' ou 'api' pour le mode tickets.")

        check_and_increment("tickets_chat")

        mode = settings.llm_mode
        if mode == "local":
            base_url = settings.vllm_base_url
            model = settings.z_local_model
            api_key = None
            provider = "vllm-local"
        else:
            base_url = settings.openai_base_url
            model = settings.llm_model
            api_key = settings.openai_api_key
            provider = "openai-api"
        if not base_url or not model:
            raise RuntimeError("Backend LLM non configuré pour le mode tickets.")

        max_tokens = min(int(settings.loop_max_tokens), int(settings.llm_max_tokens))
        client = OpenAICompatibleClient(base_url=base_url, api_key=api_key, timeout_s=settings.openai_timeout_s)

        store = get_prompt_store()
        system_prompt = store.get("ticket_context_system").template
        formatted = "\n".join(tickets)
        user_prompt = store.render(
            "ticket_context_user",
            {
                "period_label": period_label,
                "ticket_count": len(tickets),
                "total_tickets": total_tickets,
                "formatted": formatted,
            },
        )

        log.info(
            "TicketContextAgent: synthèse %s tickets (provider=%s, période=%s)",
            len(tickets),
            provider,
            period_label,
        )

        try:
            response = client.chat_completions(
                model=str(model),
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=float(settings.loop_temperature),
                max_tokens=max_tokens,
            )
        except OpenAIBackendError as exc:
            raise RuntimeError(f"LLM tickets indisponible: {exc}") from exc
        except Exception as exc:  # pragma: no cover - defensive
            raise RuntimeError(f"Erreur lors de la synthèse tickets: {exc}") from exc
        finally:
            client.close()

        try:
            choice = response["choices"][0]
            content = choice["message"]["content"]
            finish_reason = choice.get("finish_reason") if isinstance(choice, dict) else None
        except Exception as exc:  # pragma: no cover - defensive
            raise RuntimeError("Réponse LLM tickets invalide.") from exc
        text = str(content or "").strip()
        if not text:
            raise RuntimeError("Réponse LLM tickets vide.")
        if finish_reason == "length":
            log.warning(
                "TicketContextAgent response truncated (finish_reason=length, max_tokens=%d, provider=%s, period=%s)",
                max_tokens,
                provider,
                period_label,
            )
        return text

    def summarize_chunks(
        self,
        *,
        period_label: str,
        chunks: List[List[dict]],
        total_tickets: int,
    ) -> str:
        total_chunks = len(chunks)
        if total_tickets <= 0:
            raise ValueError("Total tickets invalide pour la synthèse.")

        def _summarize_chunk(idx: int, chunk: List[dict]) -> str:
            tickets = [item["line"] for item in chunk]
            return self._summarize(
                period_label=f"{period_label} (part {idx}/{total_chunks})",
                tickets=tickets,
                total_tickets=total_tickets,
            )

        partials: list[str] = []
        workers = max(1, int(settings.ticket_context_workers))
        active_workers = min(workers, total_chunks) if total_chunks else 0
        mode = "parallèle" if workers > 1 and total_chunks > 1 else "séquentiel"
        log.info(
            "TicketContextAgent: mode=%s (chunks=%d, workers=%d, actifs=%d)",
            mode,
            total_chunks,
            workers,
            active_workers,
        )
        if workers > 1 and total_chunks > 1:
            results: list[str | None] = [None] * total_chunks
            with ThreadPoolExecutor(max_workers=active_workers) as executor:
                futures = []
                for idx, chunk in enumerate(chunks, start=1):
                    ctx = contextvars.copy_context()
                    futures.append(executor.submit(ctx.run, _summarize_chunk, idx, chunk))
                for idx, future in enumerate(futures):
                    results[idx] = future.result()
            partials = [text for text in results if text]
        else:
            for idx, chunk in enumerate(chunks, start=1):
                partials.append(_summarize_chunk(idx, chunk))

        if len(partials) == 1:
            return partials[0]

        fused_inputs = [
            f"Synthèse partielle {i+1}/{len(partials)} : {text}"
            for i, text in enumerate(partials)
        ]
        return self._summarize(
            period_label=f"{period_label} (fusion)",
            tickets=fused_inputs,
            total_tickets=total_tickets,
        )

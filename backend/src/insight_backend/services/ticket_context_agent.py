from __future__ import annotations

import logging
from datetime import date
from typing import List

from ..core.agent_limits import check_and_increment
from ..core.config import settings
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

        system_prompt = (
            "Tu aides un agent de chat à répondre aux utilisateurs en synthétisant des tickets. "
            "Rédige en français, sans inventer, en restant concis mais riche. "
            "Structure attendue: bref paragraphe d'ouverture (contexte + volume), "
            "puis puces '-' pour les signaux clés ou tendances, puis actions concrètes/priorisées. "
            "Ne produis pas de tableau ni de code. Mentionne explicitement la période."
        )
        formatted = "\n".join(tickets)
        user_prompt = (
            f"Période: {period_label}\n"
            f"Tickets fournis: {len(tickets)} sur {total_tickets}\n"
            f"{formatted}"
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
            content = response["choices"][0]["message"]["content"]
        except Exception as exc:  # pragma: no cover - defensive
            raise RuntimeError("Réponse LLM tickets invalide.") from exc
        text = str(content or "").strip()
        if not text:
            raise RuntimeError("Réponse LLM tickets vide.")
        return text

    def summarize_chunks(
        self,
        *,
        period_label: str,
        chunks: List[List[dict]],
    ) -> str:
        partials: list[str] = []
        for idx, chunk in enumerate(chunks, start=1):
            tickets = [item["line"] for item in chunk]
            total = sum(item.get("total_count", 0) or 0 for item in chunk) or len(chunk)
            partials.append(
                self._summarize(
                    period_label=f"{period_label} (part {idx}/{len(chunks)})",
                    tickets=tickets,
                    total_tickets=total,
                )
            )

        if len(partials) == 1:
            return partials[0]

        fused_inputs = [
            f"Synthèse partielle {i+1}/{len(partials)} : {text}"
            for i, text in enumerate(partials)
        ]
        return self._summarize(
            period_label=f"{period_label} (fusion)",
            tickets=fused_inputs,
            total_tickets=sum(len(chunk) for chunk in chunks),
        )

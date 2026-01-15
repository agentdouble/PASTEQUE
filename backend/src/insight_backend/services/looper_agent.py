from __future__ import annotations

import logging
from datetime import date
from typing import List

from ..core.agent_limits import check_and_increment
from ..core.config import settings
from ..integrations.openai_client import OpenAICompatibleClient, OpenAIBackendError


log = logging.getLogger("insight.services.looper")


class LooperAgent:
    """Agent dédié aux résumés journaliers/hebdomadaires/mensuels des tickets."""

    def summarize(
        self,
        *,
        period_label: str,
        period_start: date,
        period_end: date,
        tickets: List[str],
        total_tickets: int,
    ) -> str:
        if not tickets:
            raise ValueError("Aucun ticket fourni au looper.")
        if settings.llm_mode not in {"local", "api"}:
            raise RuntimeError("LLM_MODE doit être 'local' ou 'api' pour le looper.")

        check_and_increment("looper")

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
            raise RuntimeError("Backend LLM non configuré pour le looper.")

        max_tokens = min(int(settings.loop_max_tokens), int(settings.llm_max_tokens))
        client = OpenAICompatibleClient(base_url=base_url, api_key=api_key, timeout_s=settings.openai_timeout_s)

        system_prompt = (
            "Tu es en charge du suivi récurrent des tickets. "
            "À partir des tickets fournis pour la période indiquée, rédige en français un résumé structuré et riche. "
            "Commence par un bref paragraphe synthétique (3-4 phrases) qui capture l'état global, puis enchaîne avec "
            "les problèmes majeurs à résoudre (2-4 points précis, avec fréquence si visible) et termine par un plan "
            "d'action concret et priorisé. Mets en avant les points critiques (impact fort, récurrence élevée) de façon explicite. "
            "Reste fidèle aux tickets et n'invente rien. "
            "Format attendu: Markdown clair (titres ou sous-titres optionnels), listes à puces '-', sections en gras "
            "(ex: **Problèmes majeurs**), pas de blocs de code ni de tableaux."
        )
        formatted = "\n".join(tickets)
        user_prompt = (
            f"Période: {period_label} ({period_start.isoformat()} → {period_end.isoformat()})\n"
            f"Tickets fournis: {len(tickets)} sur {total_tickets}\n"
            f"{formatted}"
        )

        log.info(
            "Looper summarizing %s tickets (provider=%s, period=%s)",
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
            raise RuntimeError(f"LLM looper indisponible: {exc}") from exc
        except Exception as exc:  # pragma: no cover - defensive
            raise RuntimeError(f"Erreur lors de la synthèse looper: {exc}") from exc
        finally:
            client.close()

        try:
            content = response["choices"][0]["message"]["content"]
        except Exception as exc:  # pragma: no cover - defensive
            raise RuntimeError("Réponse LLM looper invalide.") from exc
        text = str(content or "").strip()
        if not text:
            raise RuntimeError("Réponse LLM looper vide.")
        return text

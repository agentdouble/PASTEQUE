from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List, Optional, Tuple

from ..core.config import settings
from ..core.agent_limits import check_and_increment
from ..integrations.openai_client import OpenAICompatibleClient, OpenAIBackendError
from .retrieval_service import RetrievalService


log = logging.getLogger("insight.services.retrieval_agent")


class RetrievalAgent:
    """Agent de récupération + synthèse pour la mise en avant.

    - Récupère des lignes proches via `RetrievalService` (embeddings)
    - Appelle un LLM (local/API) pour synthétiser une mise en avant concise
    - Enforce un quota dédié `retrieval` pour l'appel LLM
    """

    def __init__(self, service: Optional[RetrievalService] = None) -> None:
        self._service = service or RetrievalService()

    def run(
        self,
        *,
        question: str,
        top_n: Optional[int] = None,
        events: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        round_label: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], str]:
        """Retourne (payload_lignes, texte_mise_en_avant)."""
        q = (question or "").strip()
        if not q:
            raise ValueError("Question vide pour l'agent retrieval.")

        rows = self._service.retrieve(question=q, top_n=top_n or settings.rag_top_n)
        payload = [r.as_payload() for r in rows]

        if events and payload:
            meta: Dict[str, Any] = {"retrieval": {"rows": payload}}
            if round_label is not None:
                meta["retrieval"]["round"] = round_label
            try:
                events("meta", meta)
            except Exception:
                log.warning("Failed to emit retrieval meta", exc_info=True)

        highlight = self._summarize(question=q, rows=payload)
        return payload, f"Mise en avant : {highlight}" if highlight else ""

    # --- internals -----------------------------------------------------
    def _build_client(self) -> tuple[OpenAICompatibleClient, str]:
        mode = (settings.llm_mode or "").strip().lower()
        model_override = (settings.retrieval_model or "").strip() or None
        if mode == "local":
            base_url = settings.vllm_base_url
            model = model_override or settings.z_local_model
            api_key = None
        elif mode == "api":
            base_url = settings.openai_base_url
            model = model_override or settings.llm_model
            api_key = settings.openai_api_key
        else:
            raise RuntimeError("Invalid LLM_MODE; expected 'local' or 'api'")
        if not base_url or not model:
            raise RuntimeError("LLM non configuré pour la mise en avant (base_url ou modèle absent).")
        client = OpenAICompatibleClient(
            base_url=base_url,
            api_key=api_key,
            timeout_s=settings.openai_timeout_s,
        )
        return client, str(model)

    def _summarize(self, *, question: str, rows: List[Dict[str, Any]]) -> str:
        q = (question or "").strip()
        if not q:
            raise RuntimeError("Question vide pour la synthèse de mise en avant.")
        if not rows:
            return "aucun exemple rapproché n'a été trouvé dans les données vectorisées."

        lines: List[str] = []
        for idx, item in enumerate(rows, start=1):
            table = str(item.get("table") or "-")
            score = item.get("score")
            if isinstance(score, (int, float)):
                score_txt = f"{float(score):.4f}"
            else:
                score_txt = str(score or "-")
            focus = str(item.get("focus") or "").strip() or "-"
            values_txt = "-"
            values = item.get("values")
            if isinstance(values, dict):
                pairs: List[str] = []
                for key, value in values.items():
                    if value in (None, ""):
                        continue
                    pairs.append(f"{key}: {value}")
                if pairs:
                    values_txt = ", ".join(pairs)
            lines.append(
                f"{idx}. table={table}, score={score_txt}, focus={focus}, valeurs={values_txt}"
            )

        rows_blob = "\n".join(lines)
        system_prompt = (
            "Given the user question and the retrieved related informations, give the user some insights. "
            "Answer in French with une ou deux phrases concises."
        )
        user_prompt = f"Question:\n{q}\n\nInformations récupérées:\n{rows_blob}"

        # Enforce per-agent cap (retrieval synthesis)
        check_and_increment("retrieval")

        client, model = self._build_client()
        try:
            response = client.chat_completions(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=float(settings.retrieval_temperature),
                max_tokens=int(settings.retrieval_max_tokens),
            )
        except OpenAIBackendError as exc:
            raise RuntimeError(f"Synthèse LLM indisponible: {exc}") from exc
        except Exception as exc:
            raise RuntimeError(f"Erreur lors de l'appel au LLM pour la mise en avant: {exc}") from exc
        finally:
            client.close()

        try:
            content = response["choices"][0]["message"]["content"]
        except Exception as exc:
            raise RuntimeError("Réponse LLM invalide pour la mise en avant.") from exc
        text = str(content).strip()
        if not text:
            raise RuntimeError("Réponse LLM vide pour la mise en avant.")
        return text


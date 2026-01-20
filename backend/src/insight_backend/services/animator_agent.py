from __future__ import annotations

from typing import Any, Dict, Optional
import json

from ..core.config import settings
from ..integrations.openai_client import OpenAICompatibleClient, OpenAIBackendError
from ..core.agent_limits import check_and_increment


class AnimatorAgent:
    """LLM‑driven animator: produces brief, friendly status lines for the UI.

    No SQL is ever echoed. If the LLM is unavailable or returns nothing, we
    emit no message (no heuristic fallback to respect failure transparency).
    """

    def __init__(self) -> None:
        self._client: OpenAICompatibleClient | None = None
        self._model: str | None = None

    def _client_and_model(self) -> tuple[OpenAICompatibleClient, str]:
        if self._client and self._model:
            return self._client, self._model
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
            raise RuntimeError("LLM base_url/model not configured for Animator")
        self._client = OpenAICompatibleClient(base_url=base_url, api_key=api_key, timeout_s=settings.openai_timeout_s)
        self._model = str(model)
        return self._client, self._model

    @staticmethod
    def _facts(kind: str, payload: Dict[str, Any] | None) -> Dict[str, Any]:
        p = payload or {}
        k = (kind or "").strip().lower()
        facts: Dict[str, Any] = {"event": k}
        # Restrict to small, non-sensitive hints. Never include raw SQL or rows.
        if isinstance(p, dict):
            if "purpose" in p and isinstance(p.get("purpose"), str):
                facts["purpose"] = str(p.get("purpose"))
            if "step" in p and isinstance(p.get("step"), int):
                facts["step"] = int(p.get("step"))
            if k == "sql":
                facts["has_sql"] = bool(p.get("sql"))
            if k == "rows":
                rc = p.get("row_count")
                try:
                    facts["row_count"] = int(rc) if rc is not None else None
                except Exception:
                    pass
            if k == "meta":
                eff = p.get("effective_tables")
                if isinstance(eff, list):
                    facts["effective_tables"] = len(eff)
                if p.get("evidence_spec"):
                    facts["has_evidence_spec"] = True
        return facts

    def translate(self, kind: str, payload: Dict[str, Any] | None) -> Optional[str]:
        client, model = self._client_and_model()
        facts = self._facts(kind, payload)
        # Short, French, slightly playful. Never disclose SQL, columns or code.
        system = (
            "Tu es 'Animator', un narrateur d'interface.\n"
            "Mission: expliquer brièvement ce que fait la pipeline (exploration, comptage, chargement).\n"
            "Contraintes: 1 phrase courte (≤ 14 mots), français, claire, avec parfois une touche amusante.\n"
            "Jamais de SQL, ni de noms de colonnes, ni de détails techniques (pas de 'SSE'/'evidence').\n"
            "Pas de balises, pas de code, pas d'emoji. Réponds UNIQUEMENT par la phrase.\n"
            "Adapte la phrase à hint.event/hint.purpose si présents (ex: explore, answer, evidence).\n"
            "Exemples de style (non obligatoires):\n"
            "- Analyse des données pas nettoyées…\n"
            "- Anonymisation des données\n"
            "- Récupération des colonnes\n"
            "- Comptage par catégorie\n"
            "- Échantillonnage en douceur\n"
            "- Filtrage par période"
        )
        user = json.dumps({"hint": facts}, ensure_ascii=False)
        try:
            # Enforce per-request cap if configured for 'animator'
            check_and_increment("animator")
            resp = client.chat_completions(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.35,
                max_tokens=40,
            )
        except OpenAIBackendError:
            return None
        text = (
            resp.get("choices", [{}])[0].get("message", {}).get("content", "")
            if isinstance(resp, dict)
            else ""
        )
        s = (text or "").strip()
        if not s:
            return None
        # Keep answers tight even if the backend exceeds max_tokens.
        if len(s) > 120:
            s = s[:117] + "..."
        return s

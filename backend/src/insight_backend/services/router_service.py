from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Literal

from ..core.config import settings
from ..core.agent_limits import check_and_increment
from ..integrations.openai_client import OpenAICompatibleClient, OpenAIBackendError
from .nl2sql_service import _extract_json_blob  # reuse robust JSON extractor


log = logging.getLogger("insight.services.router")


RouteKind = Literal["data", "feedback", "foyer", "none"]


@dataclass(frozen=True)
class RouterDecision:
    allow: bool
    route: RouteKind
    confidence: float
    reason: str


class RouterService:
    """Lightweight router applied before NL→SQL/LLM.

    Modes (no implicit fallbacks):
    - rule: deterministic regex-based classifier (permissive by default)
    - local: use vLLM via OpenAI-compatible API
    - api: use external OpenAI-compatible API

    Notes:
    - The API layer bypasses routing for explicit SQL commands that start with '/sql ' (case-insensitive).
    - When ROUTER_MODE=false (handled by the API layer), routing is skipped entirely.
    """

    def decide(self, text: str) -> RouterDecision:
        mode = (settings.router_mode or "rule").strip().lower()
        if mode == "rule":
            return self._decide_rule(text)
        if mode in {"local", "api"}:
            return self._decide_llm(text, mode)
        log.warning("Unknown ROUTER_MODE=%s; defaulting to rule", settings.router_mode)
        return self._decide_rule(text)

    # --- Rule-based classifier -------------------------------------------------
    _RE_GREET = re.compile(r"\b(bonjour|salut|coucou|hello|hey)\b", re.I)
    _RE_PLEAS = re.compile(r"(ça va|ca va|merci|merci\s!|ok\b|test)", re.I)
    _RE_DATA = re.compile(
        r"\b(donn[ée]e?s?|data|kpi|indicateur|m[ée]trique|stat(istiques?)?|graphi(que|ques)|courbe|table(au|aux)?|requ[êe]te?s?|sql|analyse|moyenne|r[ée]partition|taux|[ée]volution|ticket[s]?)\b",
        re.I,
    )
    _RE_FEEDBACK = re.compile(
        r"\b(feedback|retours?|avis|satisfaction|nps|csat|commentaires?)\b",
        re.I,
    )
    _RE_FOYER = re.compile(r"\b(foyer|foyerinsight|m[ée]nage|household)\b", re.I)
    _RE_QUESTION = re.compile(
        r"\b(combien|quel(?:le|s)?|quand|comment|liste|montre|affiche|top|entre|par)\b|\?",
        re.I,
    )
    _RE_TIME = re.compile(
        r"\b(janv(?:ier)?|f[ée]vr(?:ier)?|mars|avril|mai|juin|juil(?:let)?|ao[ûu]t|sept(?:embre)?|oct(?:obre)?|nov(?:embre)?|d[ée]c(?:embre)?|20\d{2})\b",
        re.I,
    )

    # Confidence scale and thresholds
    _SHORT_MESSAGE_TOKEN_THRESHOLD = 3
    _AMBIGUOUS_CONFIDENCE = 0.55
    _CONF_FEEDBACK = 0.9
    _CONF_DATA = 0.85
    _CONF_FOYER = 0.7
    _CONF_QUESTION = 0.75
    _CONF_SHORT_TALK = 0.9

    def _decide_rule(self, text: str) -> RouterDecision:
        """Heuristic routing order:
        1) Domain cues (feedback, data keywords, foyer)
        2) Interrogatives/time hints/digits → allow data
        3) Very short greetings/pleasantries → block
        4) Otherwise allow data (permissive default)
        """
        t = text.strip()
        if not t:
            return RouterDecision(False, "none", 1.0, "Message vide")
        # Category routing (keep first); prioritize domain over generic data
        if self._RE_FEEDBACK.search(t):
            return RouterDecision(True, "feedback", self._CONF_FEEDBACK, "Termes liés au feedback détectés")
        if self._RE_FOYER.search(t):
            return RouterDecision(True, "foyer", self._CONF_FOYER, "Référence au domaine Foyer")
        if self._RE_DATA.search(t):
            return RouterDecision(True, "data", self._CONF_DATA, "Termes analytiques/données détectés")

        # Permissive cues: interrogatives, time hints, numbers, or explicit '?'
        has_digit = any(ch.isdigit() for ch in t)
        if self._RE_QUESTION.search(t) or self._RE_TIME.search(t) or has_digit:
            return RouterDecision(True, "data", self._CONF_QUESTION, "Formulation interrogative/indice temporel ou chiffre")

        # Obvious small talk / greetings — only block if very short and no cues
        token_count = len(re.findall(r"\w+", t))
        if token_count <= self._SHORT_MESSAGE_TOKEN_THRESHOLD and (self._RE_GREET.search(t) or self._RE_PLEAS.search(t)):
            return RouterDecision(False, "none", self._CONF_SHORT_TALK, "Salutation/banalité courte détectée")

        # Default: permissive allow to reduce false negatives
        return RouterDecision(True, "data", self._AMBIGUOUS_CONFIDENCE, "Ambigu mais permis (politique permissive)")

    def _FEEDBACK_OR_FOYER(self, t: str) -> bool:
        return bool(self._RE_FEEDBACK.search(t) or self._RE_FOYER.search(t))

    # --- LLM-based classifier --------------------------------------------------
    def _decide_llm(self, text: str, mode: Literal["local", "api"]) -> RouterDecision:
        if mode == "local":
            base_url = settings.vllm_base_url
            api_key = None
            model = settings.router_model or settings.z_local_model
        else:
            base_url = settings.openai_base_url
            api_key = settings.openai_api_key
            model = settings.router_model or settings.llm_model
        if not base_url or not model:
            raise OpenAIBackendError("Router LLM non configuré (base_url/model)")

        prompt = (
            "Tu es un routeur. Analyse le message utilisateur et décide si on doit déclencher\n"
            "une pipeline de données (catégories: data, feedback, foyer). Réponds UNIQUEMENT en JSON\n"
            "avec les champs: allow (true|false), route ('data'|'feedback'|'foyer'|'none'),\n"
            "confidence (0..1), reason (français concis).\n"
            "En cas de doute, préfère allow=true et route='data'.\n"
            "Exemples: 'coucou ça va' -> {\"allow\":false,\"route\":\"none\",...}."
        )
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": text},
        ]
        # Enforce per-agent cap (router)
        check_and_increment("router")
        client = OpenAICompatibleClient(base_url=base_url, api_key=api_key, timeout_s=settings.openai_timeout_s)
        data = client.chat_completions(
            model=model,
            messages=messages,
            temperature=0,
            max_tokens=settings.llm_max_tokens,
        )
        raw = ""
        try:
            raw = data["choices"][0]["message"]["content"]
            blob = _extract_json_blob(raw)
            obj = json.loads(blob)
            allow = bool(obj.get("allow"))
            route = obj.get("route", "none")
            if route not in {"data", "feedback", "foyer", "none"}:
                route = "none"
            conf = float(obj.get("confidence", 0.5))
            reason = str(obj.get("reason", "")) or "Classifié par LLM"
            return RouterDecision(allow, route, max(0.0, min(conf, 1.0)), reason)
        except Exception as e:
            preview = (raw or "").strip()[:120]
            log.error("Échec du parsing JSON du routeur LLM: %s | preview=%.120s", e, preview)
            raise OpenAIBackendError("Réponse LLM invalide pour le routeur") from e

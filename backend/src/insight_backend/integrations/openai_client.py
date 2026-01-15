from __future__ import annotations

import json
import logging
from typing import Any, Dict, Iterator, List, Optional

import httpx
from ..core.config import settings


class OpenAIBackendError(RuntimeError):
    """Raised when the OpenAI-compatible backend cannot satisfy a request."""
    pass


log = logging.getLogger("insight.integrations.openai")


class OpenAICompatibleClient:
    """Minimal OpenAI-compatible client for chat completions.

    Works with vLLM's OpenAI server and providers that expose the same schema.
    Only implements what we need now to keep the surface small.
    """

    def __init__(self, *, base_url: str, api_key: Optional[str] = None, timeout_s: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        verify_ssl = bool(settings.llm_verify_ssl)
        if not verify_ssl:
            log.warning(
                "LLM SSL verification disabled (LLM_VERIFY_SSL=%r). "
                "Use this setting only in controlled environments.",
                settings.llm_verify_ssl,
            )
        self.client = httpx.Client(timeout=timeout_s, verify=verify_ssl)

    def chat_completions(self, *, model: str, messages: List[Dict[str, str]], **params: Any) -> Dict[str, Any]:
        url = f"{self.base_url}/chat/completions"
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload: Dict[str, Any] = {"model": model, "messages": messages}
        payload.update(params)
        log.debug("POST %s model=%s", url, model)
        try:
            resp = self.client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
        except httpx.ConnectError as exc:
            log.error("LLM backend unreachable at %s: %s", url, exc)
            raise OpenAIBackendError(
                f"Impossible de joindre le backend LLM ({self.base_url})."
                " Assurez-vous que vLLM est démarré ou que la configuration OPENAI_BASE_URL est correcte."
            ) from exc
        except httpx.HTTPStatusError as exc:
            body = exc.response.text
            log.error(
                "LLM backend returned %s for %s: %s", exc.response.status_code, url, body
            )
            raise OpenAIBackendError(
                f"Le backend LLM a retourné un statut {exc.response.status_code}."
                " Consultez ses logs pour plus de détails."
            ) from exc
        except httpx.HTTPError as exc:
            log.error("LLM backend request failed for %s: %s", url, exc)
            raise OpenAIBackendError("Erreur lors de l'appel au backend LLM.") from exc
        return resp.json()

    def embeddings(self, *, model: str, inputs: List[str], **params: Any) -> List[List[float]]:
        url = f"{self.base_url}/embeddings"
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload: Dict[str, Any] = {"model": model, "input": inputs}
        payload.update(params)
        log.debug("POST %s model=%s (embeddings, batch=%d)", url, model, len(inputs))
        try:
            resp = self.client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
        except httpx.ConnectError as exc:
            log.error("Embedding backend unreachable at %s: %s", url, exc)
            raise OpenAIBackendError(
                f"Impossible de joindre le backend d'embeddings ({self.base_url})."
            ) from exc
        except httpx.HTTPStatusError as exc:
            body = exc.response.text
            log.error(
                "Embedding backend returned %s for %s: %s", exc.response.status_code, url, body
            )
            raise OpenAIBackendError(
                f"Le backend d'embeddings a retourné un statut {exc.response.status_code}."
            ) from exc
        except httpx.HTTPError as exc:
            log.error("Embedding backend request failed for %s: %s", url, exc)
            raise OpenAIBackendError("Erreur lors de l'appel au backend d'embeddings.") from exc
        data = resp.json()
        try:
            items = data["data"]
        except Exception as exc:  # pragma: no cover - defensive
            log.error("Embedding response missing 'data': %s", exc)
            raise OpenAIBackendError("Réponse embedding invalide (pas de champ 'data').") from exc

        vectors: List[List[float]] = []
        for idx, item in enumerate(items):
            vec = item.get("embedding") if isinstance(item, dict) else None
            if not isinstance(vec, list):
                log.error("Embedding #%d invalide: %r", idx, item)
                raise OpenAIBackendError("Réponse embedding invalide (vecteur manquant).")
            try:
                vectors.append([float(x) for x in vec])
            except (TypeError, ValueError) as exc:  # pragma: no cover - defensive
                log.error("Embedding #%d non castable en float: %s", idx, exc)
                raise OpenAIBackendError("Réponse embedding invalide (valeur non numérique).") from exc
        return vectors

    def close(self) -> None:
        self.client.close()

    def stream_chat_completions(
        self, *, model: str, messages: List[Dict[str, str]], **params: Any
    ) -> Iterator[Dict[str, Any]]:
        """Stream OpenAI-compatible chat completions as raw SSE JSON chunks.

        Yields parsed JSON dicts from lines starting with ``data: ``. Stops on ``[DONE]``.
        """
        url = f"{self.base_url}/chat/completions"
        headers: Dict[str, str] = {"Content-Type": "application/json", "Accept": "text/event-stream"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload: Dict[str, Any] = {"model": model, "messages": messages, "stream": True}
        payload.update(params)
        log.debug("STREAM %s model=%s", url, model)
        try:
            with self.client.stream("POST", url, headers=headers, json=payload) as resp:
                resp.raise_for_status()
                for line in resp.iter_lines():
                    if not line:
                        continue
                    # Expect SSE lines like: "data: {json}" or "data: [DONE]"
                    if not line.startswith("data: "):
                        continue
                    data = line[len("data: ") :].strip()
                    if data == "[DONE]":
                        break
                    try:
                        yield json.loads(data)
                    except Exception as exc:  # pragma: no cover - defensive parsing
                        log.error("Invalid SSE chunk: %s", exc)
                        continue
        except httpx.ConnectError as exc:
            log.error("LLM backend unreachable at %s: %s", url, exc)
            raise OpenAIBackendError(
                f"Impossible de joindre le backend LLM ({self.base_url})."
                " Assurez-vous que vLLM est démarré ou que la configuration OPENAI_BASE_URL est correcte."
            ) from exc
        except httpx.HTTPStatusError as exc:
            body = exc.response.text
            log.error(
                "LLM backend returned %s for %s: %s", exc.response.status_code, url, body
            )
            raise OpenAIBackendError(
                f"Le backend LLM a retourné un statut {exc.response.status_code}."
                " Consultez ses logs pour plus de détails."
            ) from exc
        except httpx.HTTPError as exc:
            log.error("LLM backend request failed for %s: %s", url, exc)
            raise OpenAIBackendError("Erreur lors de l'appel au backend LLM.") from exc

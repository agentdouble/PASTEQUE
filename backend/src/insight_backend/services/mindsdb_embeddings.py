from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Protocol

import yaml

from ..core.config import resolve_project_path, settings
from ..integrations.openai_client import OpenAICompatibleClient


log = logging.getLogger("insight.services.mindsdb_embeddings")


class EmbeddingClient(Protocol):
    """Minimal contract shared by local/API embedding backends."""

    def embeddings(self, *, model: str, inputs: list[str]) -> list[list[float]]:  # pragma: no cover - interface
        ...

    def close(self) -> None:  # pragma: no cover - interface
        ...


@dataclass(frozen=True)
class EmbeddingTableConfig:
    source_column: str
    embedding_column: str
    model: str | None = None


@dataclass(frozen=True)
class EmbeddingConfig:
    tables: dict[str, EmbeddingTableConfig]
    default_model: str
    batch_size: int


def load_embedding_config(raw_path: str | None) -> EmbeddingConfig | None:
    """Parse the YAML configuration describing MindsDB embedding columns."""
    if not raw_path:
        log.info("MINDSDB_EMBEDDINGS_CONFIG_PATH not set; embeddings will be unavailable.")
        return None

    resolved = Path(resolve_project_path(raw_path))
    if not resolved.exists():
        raise FileNotFoundError(f"MindsDB embedding config not found: {resolved}")

    with resolved.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}

    if not isinstance(data, dict):
        raise ValueError("MindsDB embedding config must be a mapping at the top level.")

    default_model = data.get("default_model")
    if default_model is not None and not isinstance(default_model, str):
        raise ValueError("default_model must be a string when provided.")

    batch_size = data.get("batch_size", settings.mindsdb_embedding_batch_size)
    if not isinstance(batch_size, int) or batch_size <= 0:
        raise ValueError("batch_size must be a positive integer.")

    tables_section = data.get("tables") or {}
    if not isinstance(tables_section, dict):
        raise ValueError("tables must be a mapping of table names.")

    tables: dict[str, EmbeddingTableConfig] = {}
    for table_name, table_config in tables_section.items():
        if not isinstance(table_name, str):
            raise ValueError("Table names in the embedding config must be strings.")
        if not isinstance(table_config, dict):
            raise ValueError(f"Configuration for table {table_name!r} must be a mapping.")
        source_column = table_config.get("source_column")
        embedding_column = table_config.get("embedding_column")
        model = table_config.get("model")
        if not source_column or not isinstance(source_column, str):
            raise ValueError(f"Table {table_name!r} requires a string 'source_column'.")
        if not embedding_column or not isinstance(embedding_column, str):
            raise ValueError(f"Table {table_name!r} requires a string 'embedding_column'.")
        if model is not None and not isinstance(model, str):
            raise ValueError(f"Table {table_name!r} has an invalid 'model' value (must be string).")
        tables[table_name] = EmbeddingTableConfig(
            source_column=source_column,
            embedding_column=embedding_column,
            model=model,
        )

    if not tables:
        log.warning("Embedding config %s defines no tables. Embeddings will be ignored.", resolved)
        return None

    resolved_default = default_embedding_model(default_model)
    log.info(
        "Loaded embedding config from %s (%d table(s), batch_size=%d, default_model=%s)",
        resolved,
        len(tables),
        batch_size,
        resolved_default,
    )
    return EmbeddingConfig(tables=tables, default_model=resolved_default, batch_size=batch_size)


def default_embedding_model(configured: str | None) -> str:
    """Return the embedding model that should be used given current settings."""
    mode = (settings.embedding_mode or "").strip().lower()
    if mode == "local":
        candidate = (
            settings.embedding_local_model
            or configured
            or settings.embedding_model
        )
    elif mode == "api":
        candidate = configured or settings.embedding_model or settings.llm_model
    else:
        raise RuntimeError("EMBEDDING_MODE must be 'local' or 'api' to compute embeddings.")
    if not candidate:
        raise RuntimeError("No embedding model configured (check EMBEDDING_MODEL or default model).")
    return candidate


class _SentenceTransformerClient:
    def __init__(self, model_name: str):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:  # pragma: no cover - import guard
            raise RuntimeError(
                "Le mode d'embedding local nécessite le package 'sentence-transformers'."
                " Installez-le via 'uv add sentence-transformers'."
            ) from exc

        self._model_name = model_name
        log.info("Initialisation du modèle d'embedding local: %s", model_name)
        self._model = SentenceTransformer(model_name)

    def embeddings(self, *, model: str, inputs: list[str]) -> list[list[float]]:
        if not inputs:
            return []
        vectors = self._model.encode(
            inputs,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        processed: list[list[float]] = []
        for vec in vectors:
            if hasattr(vec, "tolist"):
                raw = vec.tolist()  # type: ignore[assignment]
            else:
                raw = vec
            processed.append([float(item) for item in raw])
        return processed

    def close(self) -> None:  # pragma: no cover - nothing to clean explicitly
        return


def build_embedding_client(config: EmbeddingConfig) -> tuple[EmbeddingClient, str]:
    """Instantiate the embedding backend according to configuration."""
    mode = (settings.embedding_mode or "").strip().lower()
    model = config.default_model

    if mode == "local":
        client = _SentenceTransformerClient(model_name=model)
        log.info("Initialised embedding backend (mode=local, model=%s)", model)
        return client, model

    if mode == "api":
        base_url = settings.openai_base_url
        if not base_url:
            raise RuntimeError("Embedding backend base URL is missing (OPENAI_BASE_URL).")
        api_key = settings.openai_api_key
        timeout = settings.openai_timeout_s
        client = OpenAICompatibleClient(base_url=base_url, api_key=api_key, timeout_s=timeout)
        log.info("Initialised embedding backend (mode=api, base_url=%s, model=%s)", base_url, model)
        return client, model

    raise RuntimeError("EMBEDDING_MODE must be 'local' or 'api' to compute embeddings.")


def normalise_embedding(value: object) -> Iterable[float]:
    """Convert embedding payloads (list or JSON string) into a float iterator."""
    if isinstance(value, str):
        raw = json.loads(value)
    else:
        raw = value
    if not isinstance(raw, (list, tuple)):
        raise ValueError(f"Unexpected embedding payload: {type(raw)!r}")
    for item in raw:
        yield float(item)

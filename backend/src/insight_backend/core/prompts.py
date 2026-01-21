from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import logging
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Dict

import yaml

from .config import settings, resolve_project_path


log = logging.getLogger("insight.core.prompts")

_PLACEHOLDER_RE = re.compile(r"{{\s*([A-Za-z0-9_\.]+)\s*}}")

PROMPT_VARIABLES: dict[str, set[str]] = {
    "chat_markdown_system": set(),
    "ticket_context_system": set(),
    "ticket_context_user": {"period_label", "ticket_count", "total_tickets", "formatted"},
    "ticket_context_injected_system": {"period_label", "selected_count", "summary"},
    "looper_system": set(),
    "looper_user": {"period_label", "period_start", "period_end", "ticket_count", "total_tickets", "formatted"},
    "retrieval_system": set(),
    "retrieval_user": {"question", "rows_blob"},
    "router_system": set(),
    "nl2sql_generate_system": {"db_prefix"},
    "nl2sql_generate_user": {"tables_blob", "hints", "question", "db_prefix"},
    "nl2sql_analyst_system": set(),
    "nl2sql_synthesis_system": set(),
    "nl2sql_explore_system": {"db_prefix"},
    "nl2sql_generate_with_evidence_system": {"db_prefix"},
    "nl2sql_axes_system": set(),
    "nl2sql_writer_system": set(),
    "animator_system": set(),
    "mcp_chart_base_instructions": {"prefix_hint", "summary_cols", "total_rows", "answer_hint"},
}

REQUIRED_PROMPTS = set(PROMPT_VARIABLES.keys())


@dataclass(frozen=True)
class PromptEntry:
    key: str
    label: str
    description: str | None
    template: str
    placeholders: list[str]
    allowed_variables: list[str]


@dataclass(frozen=True)
class PromptCatalog:
    version: int
    entries: Dict[str, PromptEntry]


def _extract_placeholders(template: str) -> list[str]:
    return sorted({m.group(1) for m in _PLACEHOLDER_RE.finditer(template)})


class PromptStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._cache: PromptCatalog | None = None
        self._cache_mtime: float | None = None

    def invalidate(self) -> None:
        self._cache = None
        self._cache_mtime = None

    def list(self) -> list[PromptEntry]:
        catalog = self._load_catalog()
        return [catalog.entries[key] for key in sorted(catalog.entries.keys())]

    def get(self, key: str) -> PromptEntry:
        catalog = self._load_catalog()
        if key not in catalog.entries:
            raise KeyError(f"Prompt introuvable: {key}")
        return catalog.entries[key]

    def catalog(self) -> PromptCatalog:
        return self._load_catalog()

    def render(self, key: str, variables: Dict[str, Any]) -> str:
        entry = self.get(key)
        missing = [name for name in entry.placeholders if name not in variables]
        if missing:
            raise KeyError(f"Variables manquantes pour '{key}': {', '.join(missing)}")

        def _replace(match: re.Match[str]) -> str:
            name = match.group(1)
            return str(variables[name])

        return _PLACEHOLDER_RE.sub(_replace, entry.template)

    def update_template(self, key: str, template: str) -> PromptEntry:
        raw = self._read_raw()
        prompts = raw.get("prompts")
        if not isinstance(prompts, dict):
            raise ValueError("Fichier de prompts invalide (prompts manquant).")
        if key not in prompts:
            raise KeyError(f"Prompt introuvable: {key}")
        if not isinstance(template, str) or not template.strip():
            raise ValueError("Le template ne peut pas être vide.")
        self._validate_template(key, template)

        item = prompts.get(key)
        if not isinstance(item, dict):
            raise ValueError(f"Entrée de prompt invalide pour '{key}'.")
        item["template"] = template
        self._write_raw(raw)
        self.invalidate()
        return self.get(key)

    def _load_catalog(self) -> PromptCatalog:
        if not self.path.exists():
            raise FileNotFoundError(f"Fichier de prompts introuvable: {self.path}")
        mtime = self.path.stat().st_mtime
        if self._cache is not None and self._cache_mtime == mtime:
            return self._cache
        raw = self._read_raw()
        catalog = self._parse_raw(raw)
        self._cache = catalog
        self._cache_mtime = mtime
        return catalog

    def _read_raw(self) -> Dict[str, Any]:
        if not self.path.exists():
            raise FileNotFoundError(f"Fichier de prompts introuvable: {self.path}")
        with self.path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        if not isinstance(data, dict):
            raise ValueError("Fichier de prompts invalide (racine non dict).")
        return data

    def _parse_raw(self, raw: Dict[str, Any]) -> PromptCatalog:
        version = raw.get("version")
        if not isinstance(version, int):
            raise ValueError("Fichier de prompts invalide (version manquante).")
        prompts = raw.get("prompts")
        if not isinstance(prompts, dict):
            raise ValueError("Fichier de prompts invalide (prompts manquant).")

        entries: Dict[str, PromptEntry] = {}
        for key, item in prompts.items():
            if not isinstance(key, str) or not key.strip():
                raise ValueError("Clé de prompt invalide.")
            if not isinstance(item, dict):
                raise ValueError(f"Prompt invalide pour '{key}'.")
            template = item.get("template")
            if not isinstance(template, str) or not template.strip():
                raise ValueError(f"Template manquant pour '{key}'.")
            label = item.get("label")
            label_txt = str(label).strip() if label is not None else key
            description = item.get("description")
            description_txt = str(description).strip() if description is not None else None
            placeholders = _extract_placeholders(template)
            allowed = PROMPT_VARIABLES.get(key)
            if allowed is not None:
                unknown = sorted(set(placeholders) - allowed)
                if unknown:
                    raise ValueError(
                        f"Prompt '{key}' utilise des variables non autorisées: {', '.join(unknown)}"
                    )
                allowed_vars = sorted(allowed)
            else:
                allowed_vars = placeholders
            entries[key] = PromptEntry(
                key=key,
                label=label_txt or key,
                description=description_txt,
                template=template,
                placeholders=placeholders,
                allowed_variables=allowed_vars,
            )

        missing = sorted(REQUIRED_PROMPTS - entries.keys())
        if missing:
            raise ValueError(f"Prompts requis manquants: {', '.join(missing)}")

        return PromptCatalog(version=version, entries=entries)

    def _validate_template(self, key: str, template: str) -> None:
        placeholders = _extract_placeholders(template)
        allowed = PROMPT_VARIABLES.get(key)
        if allowed is None:
            return
        unknown = sorted(set(placeholders) - allowed)
        if unknown:
            raise ValueError(
                f"Prompt '{key}' utilise des variables non autorisées: {', '.join(unknown)}"
            )

    def _write_raw(self, raw: Dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp_fd, tmp_path = tempfile.mkstemp(dir=str(self.path.parent), prefix=self.path.name, suffix=".tmp")
        try:
            with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
                yaml.safe_dump(
                    raw,
                    f,
                    allow_unicode=True,
                    sort_keys=False,
                    default_flow_style=False,
                )
            os.replace(tmp_path, self.path)
            log.info("Prompts saved: %s", self.path)
        except Exception:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            log.exception("Failed to write prompts file: %s", self.path)
            raise


@lru_cache
def get_prompt_store() -> PromptStore:
    path = Path(resolve_project_path(settings.prompts_path))
    return PromptStore(path)

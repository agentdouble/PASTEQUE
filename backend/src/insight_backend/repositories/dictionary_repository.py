from __future__ import annotations

import logging
from pathlib import Path
from functools import lru_cache
import re
from typing import Dict, List, Any
import tempfile
import os

import yaml


log = logging.getLogger("insight.repositories.dictionary")

# Cache dictionary table loads across requests (per root+table)
@lru_cache(maxsize=512)
def _load_table_from_root(root: str, table: str) -> dict[str, Any] | None:
    root_path = Path(root)
    # Basic validation to prevent path traversal or invalid filenames
    if not re.fullmatch(r"[A-Za-z0-9_\-\.]+", table):
        log.warning("Rejected dictionary table name due to invalid characters: %r", table)
        return None
    candidates = [root_path / f"{table}.yml", root_path / f"{table}.yaml"]
    for p in candidates:
        try:
            with p.open("r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            if not isinstance(data, dict):
                return None
            return data
        except FileNotFoundError:
            continue
        except Exception:
            log.warning("Failed to read dictionary file: %s", p, exc_info=True)
            return None
    return None


class DataDictionaryRepository:
    """Load table/column definitions from YAML files stored on disk.

    Directory layout (config: DATA_DICTIONARY_DIR, default: ../data/dictionary):
      - <table>.yml or <table>.yaml per table present in DATA_TABLES_DIR

    Minimal schema for a file:
    ---
    version: 1
    table: tickets_jira
    title: Tickets Jira
    description: Tickets d'incidents JIRA
    columns:
      - name: ticket_id
        description: Identifiant unique du ticket
        type: integer
        synonyms: [id, issue_id]
        unit: null
        pii: false
        example: "12345"
      - name: created_at
        description: Date de création (YYYY-MM-DD)
        type: date
        pii: false
    """

    def __init__(self, *, directory: str | Path):
        self.root = Path(directory)

    def _load_file(self, path: Path) -> dict[str, Any] | None:
        try:
            with path.open("r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            if not isinstance(data, dict):
                return None
            return data
        except FileNotFoundError:
            return None
        except Exception:
            log.warning("Failed to read dictionary file: %s", path, exc_info=True)
            return None

    def _candidates(self, table: str) -> List[Path]:
        name = table.strip()
        # Reject suspicious names (path traversal, absolute, separators). Allow dots for compatibility.
        if not re.fullmatch(r"[A-Za-z0-9_\-\.]+", name):
            return []
        return [self.root / f"{name}.yml", self.root / f"{name}.yaml"]

    def _target_path(self, table: str) -> Path | None:
        """Pick the path to write the dictionary file (prefer existing extension)."""
        candidates = self._candidates(table)
        if not candidates:
            return None
        for path in candidates:
            if path.exists():
                return path
        return candidates[0]

    def load_table(self, table: str) -> dict[str, Any] | None:
        # Use cross-request cache keyed by absolute root and table
        return _load_table_from_root(str(self.root.resolve()), table)

    def exists(self, table: str) -> bool:
        return self._target_path(table) is not None and self._target_path(table).exists()

    def save_table(self, table: str, payload: Dict[str, Any]) -> Path:
        """Persist the given dictionary payload to disk atomically."""
        path = self._target_path(table)
        if path is None:
            raise ValueError("Nom de table invalide pour le dictionnaire.")
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_fd, tmp_path = tempfile.mkstemp(dir=str(path.parent), prefix=path.name, suffix=".tmp")
        try:
            with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
                yaml.safe_dump(
                    payload,
                    f,
                    allow_unicode=True,
                    sort_keys=False,
                    default_flow_style=False,
                )
            os.replace(tmp_path, path)
            # Invalidate cache after successful write
            _load_table_from_root.cache_clear()
            log.info("Dictionary saved: %s (%d bytes)", path, path.stat().st_size)
            return path
        except Exception:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            log.error("Failed to write dictionary file: %s", path, exc_info=True)
            raise

    def delete_table(self, table: str) -> bool:
        """Delete dictionary file for a table. Returns True if a file was removed."""
        removed = False
        for path in self._candidates(table):
            try:
                path.unlink()
                removed = True
                log.info("Dictionary deleted: %s", path)
            except FileNotFoundError:
                continue
            except Exception:
                log.error("Failed to delete dictionary file: %s", path, exc_info=True)
                raise
        if removed:
            _load_table_from_root.cache_clear()
        return removed

    def for_schema(self, schema: Dict[str, List[str]]) -> Dict[str, Any]:
        """Return a compact dictionary (JSON-serializable) limited to the given schema.

        Keeps only columns that exist in the provided schema to avoid noise.
        Output shape:
          { table: { description: str?, title: str?, columns: [{name, description?, type?, synonyms?, unit?, pii?, example?}] } }
        """
        out: Dict[str, Any] = {}
        for table, cols in schema.items():
            raw = self.load_table(table)
            if not raw:
                continue
            col_docs = []
            items = raw.get("columns") or []
            if not isinstance(items, list):
                items = []
            # Build lookup to avoid O(n^2)
            wanted = {c.casefold() for c in cols}
            for it in items:
                try:
                    name = str(it.get("name", "")).strip()
                    if not name or name.casefold() not in wanted:
                        continue
                    col_docs.append(
                        {
                            "name": name,
                            **({"description": str(it.get("description"))} if it.get("description") else {}),
                            **({"type": str(it.get("type"))} if it.get("type") else {}),
                            **({"synonyms": list(it.get("synonyms"))} if isinstance(it.get("synonyms"), list) else {}),
                            **({"unit": str(it.get("unit"))} if it.get("unit") else {}),
                            **({"pii": bool(it.get("pii"))} if it.get("pii") is not None else {}),
                            **({"example": it.get("example")} if it.get("example") is not None else {}),
                        }
                    )
                except Exception as e:
                    # Environment-aware logging: warn in dev, error elsewhere
                    try:
                        from ..core.config import settings  # local import to avoid cycles at import time
                        env = (settings.env or "").strip().lower()
                    except Exception:
                        env = ""
                    if env in {"dev", "development", "local"}:
                        log.warning(
                            "Invalid dictionary entry for table '%s': %r (skipped)",
                            table,
                            it,
                            exc_info=True,
                        )
                    else:
                        log.error("Invalid dictionary entry encountered; skipping.", exc_info=True)
                    continue
            if not col_docs:
                continue
            out[table] = {
                **({"title": raw.get("title")} if raw.get("title") else {}),
                **({"description": raw.get("description")} if raw.get("description") else {}),
                "columns": col_docs,
            }
        return out

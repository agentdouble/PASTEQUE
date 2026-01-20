from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Iterable

from sqlalchemy.orm import Session

from ..models.data_source_preference import DataSourcePreference


log = logging.getLogger("insight.repositories.data_source_preference")


@dataclass(frozen=True)
class DataSourcePreferences:
    hidden_fields: list[str]
    date_field: str | None
    category_field: str | None
    sub_category_field: str | None
    explorer_enabled: bool


class DataSourcePreferenceRepository:
    def __init__(self, session: Session):
        self.session = session

    @staticmethod
    def _clean_optional_name(name: str | None) -> str | None:
        if not isinstance(name, str):
            return None
        cleaned = name.strip()
        return cleaned or None

    @staticmethod
    def _clean_hidden_fields(fields: Iterable[str] | None) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for name in fields or []:
            if not isinstance(name, str):
                continue
            trimmed = name.strip()
            if not trimmed:
                continue
            key = trimmed.casefold()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(trimmed)
        return cleaned

    @staticmethod
    def _clean_enabled_flag(value: object | None) -> bool:
        return bool(value) if value is not None else True

    def list_hidden_fields_by_source(self) -> dict[str, list[str]]:
        preferences = self.session.query(DataSourcePreference).all()
        result: dict[str, list[str]] = {}
        for pref in preferences:
            hidden = self._clean_hidden_fields(pref.hidden_fields)
            if hidden:
                result[pref.source] = hidden
        log.debug("Loaded hidden fields for %d sources", len(result))
        return result

    def list_preferences(self) -> dict[str, DataSourcePreferences]:
        preferences = self.session.query(DataSourcePreference).all()
        result: dict[str, DataSourcePreferences] = {}
        for pref in preferences:
            hidden = self._clean_hidden_fields(pref.hidden_fields)
            result[pref.source] = DataSourcePreferences(
                hidden_fields=hidden,
                date_field=self._clean_optional_name(pref.date_field),
                category_field=self._clean_optional_name(pref.category_field),
                sub_category_field=self._clean_optional_name(pref.sub_category_field),
                explorer_enabled=self._clean_enabled_flag(pref.explorer_enabled),
            )
        log.debug("Loaded data source preferences for %d sources", len(result))
        return result

    def set_hidden_fields(self, *, source: str, hidden_fields: Iterable[str]) -> list[str]:
        cleaned = self._clean_hidden_fields(hidden_fields)

        pref = (
            self.session.query(DataSourcePreference)
            .filter(DataSourcePreference.source == source)
            .one_or_none()
        )
        if pref is None:
            pref = DataSourcePreference(source=source, hidden_fields=cleaned, explorer_enabled=True)
            self.session.add(pref)
        else:
            pref.hidden_fields = cleaned

        log.info("Updated hidden fields for source=%s (count=%d)", source, len(cleaned))
        return cleaned

    def set_column_roles(
        self,
        *,
        source: str,
        date_field: str | None,
        category_field: str | None,
        sub_category_field: str | None,
    ) -> DataSourcePreferences:
        date_clean = self._clean_optional_name(date_field)
        category_clean = self._clean_optional_name(category_field)
        sub_category_clean = self._clean_optional_name(sub_category_field)

        pref = (
            self.session.query(DataSourcePreference)
            .filter(DataSourcePreference.source == source)
            .one_or_none()
        )
        if pref is None:
            pref = DataSourcePreference(
                source=source,
                hidden_fields=[],
                date_field=date_clean,
                category_field=category_clean,
                sub_category_field=sub_category_clean,
                explorer_enabled=True,
            )
            self.session.add(pref)
        else:
            pref.date_field = date_clean
            pref.category_field = category_clean
            pref.sub_category_field = sub_category_clean

        updated = DataSourcePreferences(
            hidden_fields=self._clean_hidden_fields(pref.hidden_fields),
            date_field=date_clean,
            category_field=category_clean,
            sub_category_field=sub_category_clean,
            explorer_enabled=self._clean_enabled_flag(pref.explorer_enabled),
        )
        log.info(
            "Updated column roles for source=%s (date=%s, category=%s, sub_category=%s)",
            source,
            date_clean,
            category_clean,
            sub_category_clean,
        )
        return updated

    def set_explorer_enabled(self, *, source: str, enabled: bool) -> bool:
        pref = (
            self.session.query(DataSourcePreference)
            .filter(DataSourcePreference.source == source)
            .one_or_none()
        )
        target = bool(enabled)
        if pref is None:
            pref = DataSourcePreference(
                source=source,
                hidden_fields=[],
                explorer_enabled=target,
            )
            self.session.add(pref)
        else:
            pref.explorer_enabled = target

        log.info("Updated explorer_enabled for source=%s -> %s", source, target)
        return target

    def get_preferences_for_source(self, *, source: str) -> DataSourcePreferences | None:
        pref = (
            self.session.query(DataSourcePreference)
            .filter(DataSourcePreference.source == source)
            .one_or_none()
        )
        if pref is None:
            return None
        return DataSourcePreferences(
            hidden_fields=self._clean_hidden_fields(pref.hidden_fields),
            date_field=self._clean_optional_name(pref.date_field),
            category_field=self._clean_optional_name(pref.category_field),
            sub_category_field=self._clean_optional_name(pref.sub_category_field),
            explorer_enabled=self._clean_enabled_flag(pref.explorer_enabled),
        )

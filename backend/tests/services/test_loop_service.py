from __future__ import annotations

from datetime import date, timedelta

import pytest

from insight_backend.core.config import settings
from insight_backend.services.loop_service import LoopService


class _StubRepo:
    pass


class _StubDataRepo:
    pass


@pytest.fixture(autouse=True)
def _reset_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "loop_max_days", 1)


def test_group_by_day_uses_latest_available_date() -> None:
    service = LoopService(repo=_StubRepo(), data_repo=_StubDataRepo())
    today = date.today()
    recent = today - timedelta(days=1)
    older = today - timedelta(days=5)

    entries = [
        {"date": older, "text": "ancien"},
        {"date": recent, "text": "recent"},
    ]

    groups = service._group_by_day(entries)

    assert len(groups) == 1
    assert groups[0]["start"] == recent
    assert groups[0]["end"] == recent
    assert groups[0]["items"]
    assert all(item["date"] == recent for item in groups[0]["items"])

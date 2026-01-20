from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TicketContextMetadataResponse(BaseModel):
  table: str
  text_column: str
  date_column: str
  date_min: date | None = None
  date_max: date | None = None
  total_count: int


class TicketContextPeriod(BaseModel):
  model_config = ConfigDict(populate_by_name=True)
  from_: str | None = Field(default=None, alias="from")
  to: str | None = None


class TicketContextSource(BaseModel):
  model_config = ConfigDict(extra="forbid")
  table: str | None = None
  text_column: str | None = None
  date_column: str | None = None
  periods: list[TicketContextPeriod] | None = None


class TicketContextPreviewRequest(BaseModel):
  model_config = ConfigDict(extra="forbid")
  sources: list[TicketContextSource]


class TicketContextPreviewItem(BaseModel):
  model_config = ConfigDict(extra="forbid")
  table: str | None = None
  period_label: str | None = None
  count: int | None = None
  total: int | None = None
  evidence_spec: dict[str, Any] | None = None
  evidence_rows: dict[str, Any] | None = None
  error: str | None = None

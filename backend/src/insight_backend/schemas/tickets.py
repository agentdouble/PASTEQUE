from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TicketContextConfigRequest(BaseModel):
  table_name: str = Field(..., min_length=1)
  text_column: str = Field(..., min_length=1)
  title_column: str = Field(..., min_length=1)
  date_column: str = Field(..., min_length=1)
  ticket_context_fields: list[str] | None = None


class TicketContextConfigResponse(BaseModel):
  id: int
  table_name: str
  text_column: str
  title_column: str
  date_column: str
  updated_at: datetime
  ticket_context_fields: list[str] = Field(default_factory=list)

  @classmethod
  def from_model(cls, config, *, ticket_context_fields: list[str] | None = None) -> "TicketContextConfigResponse":
    return cls(
      id=config.id,
      table_name=config.table_name,
      text_column=config.text_column,
      title_column=config.title_column,
      date_column=config.date_column,
      updated_at=config.updated_at,
      ticket_context_fields=ticket_context_fields or [],
    )


class TicketContextMetadataResponse(BaseModel):
  table: str
  text_column: str
  date_column: str
  date_min: date | None = None
  date_max: date | None = None
  recommended_from: date | None = None
  total_count: int
  context_char_limit: int | None = None


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
  context_chars: int | None = None
  context_char_limit: int | None = None
  evidence_spec: dict[str, Any] | None = None
  evidence_rows: dict[str, Any] | None = None
  error: str | None = None

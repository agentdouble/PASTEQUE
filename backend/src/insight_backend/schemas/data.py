from datetime import datetime

from typing import Literal

from pydantic import BaseModel, Field


class IngestResponse(BaseModel):
    ok: bool
    details: str | None = None


class ValueCount(BaseModel):
    label: str
    count: int


class CategorySubCategoryCount(BaseModel):
    category: str
    sub_category: str
    count: int


class FieldBreakdown(BaseModel):
    field: str
    label: str
    kind: Literal["date", "text", "number", "boolean", "unknown"] = "text"
    non_null: int = 0
    missing_values: int = 0
    unique_values: int = 0
    counts: list[ValueCount] = Field(default_factory=list)
    truncated: bool = False
    hidden: bool = False


class DataSourceOverview(BaseModel):
    source: str
    title: str
    total_rows: int
    date_min: str | None = None
    date_max: str | None = None
    date_field: str | None = None
    category_field: str | None = None
    sub_category_field: str | None = None
    explorer_enabled: bool = True
    field_count: int = 0
    fields: list[FieldBreakdown] = Field(default_factory=list)
    category_breakdown: list[CategorySubCategoryCount] = Field(default_factory=list)


class DataOverviewResponse(BaseModel):
    generated_at: datetime
    sources: list[DataSourceOverview] = Field(default_factory=list)


class UpdateHiddenFieldsRequest(BaseModel):
    hidden_fields: list[str] = Field(default_factory=list)


class HiddenFieldsResponse(BaseModel):
    source: str
    hidden_fields: list[str] = Field(default_factory=list)


class UpdateColumnRolesRequest(BaseModel):
    date_field: str | None = None
    category_field: str | None = None
    sub_category_field: str | None = None


class ColumnRolesResponse(BaseModel):
    source: str
    date_field: str | None = None
    category_field: str | None = None
    sub_category_field: str | None = None


class UpdateExplorerEnabledRequest(BaseModel):
    enabled: bool


class ExplorerEnabledResponse(BaseModel):
    source: str
    enabled: bool


class TableExplorePreview(BaseModel):
    source: str
    category: str
    sub_category: str
    matching_rows: int
    preview_columns: list[str] = Field(default_factory=list)
    preview_rows: list[dict[str, str | int | float | bool | None]] = Field(default_factory=list)
    limit: int | None = None
    offset: int | None = None
    sort_date: Literal["asc", "desc"] | None = None
    date_from: str | None = None
    date_to: str | None = None
    date_min: str | None = None
    date_max: str | None = None

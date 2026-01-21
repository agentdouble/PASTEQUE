export type FieldKind = 'date' | 'text' | 'number' | 'boolean' | 'unknown'

export interface ValueCount {
  label: string
  count: number
}

export interface CategorySubCategoryCount {
  category: string
  sub_category: string
  count: number
}

export interface FieldBreakdown {
  field: string
  label: string
  kind: FieldKind
  non_null: number
  missing_values: number
  unique_values: number
  counts: ValueCount[]
  truncated: boolean
  hidden?: boolean
}

export interface DataSourceOverview {
  source: string
  title: string
  total_rows: number
  date_min?: string | null
  date_max?: string | null
  date_field?: string | null
  category_field?: string | null
  sub_category_field?: string | null
   explorer_enabled?: boolean
  field_count: number
  fields: FieldBreakdown[]
  category_breakdown?: CategorySubCategoryCount[]
}

export interface DataOverviewResponse {
  generated_at: string
  sources: DataSourceOverview[]
}

export interface HiddenFieldsResponse {
  source: string
  hidden_fields: string[]
}

export interface ColumnRolesResponse {
  source: string
  date_field?: string | null
  category_field?: string | null
  sub_category_field?: string | null
}

export interface UpdateExplorerEnabledRequest {
  enabled: boolean
}

export interface ExplorerEnabledResponse {
  source: string
  enabled: boolean
}

export interface UpdateColumnRolesRequest {
  date_field?: string | null
  category_field?: string | null
  sub_category_field?: string | null
}

export type TableRow = Record<string, string | number | boolean | null>

export interface TableExplorePreview {
  source: string
  category: string
  sub_category: string
  matching_rows: number
  preview_columns: string[]
  preview_rows: TableRow[]
  limit?: number
  offset?: number
  sort_date?: 'asc' | 'desc'
  date_from?: string
  date_to?: string
  date_min?: string
  date_max?: string
}

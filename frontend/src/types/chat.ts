export type FeedbackValue = 'up' | 'down'

export interface Message {
  id?: string
  role: 'user' | 'assistant'
  content: string
  messageId?: number
  feedback?: FeedbackValue
  feedbackId?: number
  feedbackSaving?: boolean
  feedbackError?: string
  // Optional dataset captured during NL→SQL streaming for this answer
  // Enables one-click chart generation from the assistant message bubble
  chartDataset?: ChartDatasetPayload
  chartUrl?: string
  chartTitle?: string
  chartDescription?: string
  chartTool?: string
  chartPrompt?: string
  chartSpec?: Record<string, unknown>
  chartSaved?: boolean
  chartSaving?: boolean
  chartSaveError?: string
  chartRecordId?: number
  // Streaming placeholder (ephemeral) removed at end
  ephemeral?: boolean
  // When streaming NL→SQL, show SQL first then final answer
  interimSql?: string
  // Optional per-message details shown on toggle inside the bubble
  details?: {
    requestId?: string
    provider?: string
    model?: string
    elapsed?: number
    plan?: any
    steps?: Array<{ step?: number; purpose?: string; sql?: string }>
    samples?: Array<{ step?: number; columns?: string[]; row_count?: number }>
    retrieval?: RetrievalDetails
  }
}

export interface ChatMetadata {
  // Force NL→SQL pour cette requête
  nl2sql?: boolean
  // Identifiant conversation existante (créée automatiquement sinon)
  conversation_id?: number
  // Tables à exclure pour cette requête/conversation
  exclude_tables?: string[]
  // Demander au serveur d'enregistrer ces exclusions comme valeur par défaut utilisateur
  save_as_default?: boolean
  // Mode tickets: injecte un contexte de tickets borné par dates
  ticket_mode?: boolean
  tickets_from?: string
  tickets_to?: string
  // Extension point
  [key: string]: unknown
}

export interface ChatCompletionRequest {
  messages: Message[]
  metadata?: ChatMetadata
}

export interface ChatCompletionResponse {
  reply: string
}

// Streaming event shapes
export interface ChatStreamMeta {
  request_id?: string
  provider?: string
  model?: string
  // Optional evidence spec provided by the pipeline (MCP/LLM)
  evidence_spec?: EvidenceSpec
  // Conversation identifier (server-created on first message)
  conversation_id?: number
  // Tables effectivement actives côté serveur pour NL→SQL
  effective_tables?: string[]
  retrieval?: RetrievalDetails
  ticket_context?: TicketContextMeta
  ticket_context_error?: string
}

export interface ChatStreamDelta {
  seq: number
  content: string
}

export interface ChatStreamDone {
  id: string
  content_full: string
  usage?: any
  finish_reason?: string
  elapsed_s?: number
  message_id?: number
  conversation_id?: number
}

export interface ChartDatasetPayload {
  sql: string
  columns: string[]
  rows: Record<string, unknown>[]
  row_count?: number
  step?: number
  description?: string
}

export interface ChartGenerationRequest {
  prompt: string
  answer?: string
  dataset: ChartDatasetPayload
}

export interface ChartGenerationResponse {
  prompt: string
  chart_url: string
  tool_name: string
  chart_title?: string
  chart_description?: string
  chart_spec?: Record<string, unknown>
  source_sql?: string
  source_row_count?: number
}

export interface SavedChartResponse {
  id: number
  prompt: string
  chart_url: string
  tool_name?: string | null
  chart_title?: string | null
  chart_description?: string | null
  chart_spec?: Record<string, unknown> | null
  created_at: string
  owner_username: string
}

// Generic evidence contract (no hardcoding to "tickets")
export interface EvidenceSpec {
  entity_label: string
  entity_name?: string
  pk: string
  display?: {
    title?: string
    status?: string
    created_at?: string
    link_template?: string
  }
  columns?: string[]
  limit?: number
  // Optional period hint for UI summary
  period?: { from?: string; to?: string } | string
}

export interface EvidenceRowsPayload {
  columns: string[]
  rows: Record<string, unknown>[]
  row_count?: number
  step?: number
  purpose?: string // expected: 'evidence'
}

export interface RetrievalRow {
  table?: string
  score?: number
  focus?: string
  source_column?: string
  values?: Record<string, unknown>
}

export interface RetrievalDetails {
  rows: RetrievalRow[]
  round?: number
}

export interface TicketContextMeta {
  period_label?: string
  count?: number
  total?: number
  chunks?: number
  table?: string
  date_from?: string
  date_to?: string
}

export interface TicketPreviewItem {
  table?: string
  period_label?: string
  count?: number
  total?: number
  evidence_spec?: EvidenceSpec | null
  evidence_rows?: EvidenceRowsPayload | null
  error?: string
}

export interface FeedbackResponse {
  id: number
  conversation_id: number
  message_id: number
  value: FeedbackValue
  is_archived: boolean
  created_at: string
  updated_at: string
}

export interface AdminFeedbackEntry {
  id: number
  value: FeedbackValue
  created_at: string
  conversation_id: number
  conversation_title: string
  message_id: number
  message_content: string
  message_created_at: string
  owner_username: string
  author_username: string
  is_archived: boolean
}

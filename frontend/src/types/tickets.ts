export interface TicketContextConfig {
  id: number
  table_name: string
  text_column: string
  date_column: string
  updated_at: string
  ticket_context_fields?: string[]
}

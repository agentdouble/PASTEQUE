export interface AuthState {
  token: string
  tokenType: string
  username: string
  isAdmin: boolean
  canUseSqlAgent: boolean
  canGenerateChart: boolean
  canViewGraph: boolean
}

export interface LoginResponse {
  access_token: string
  token_type?: string
  username: string
  is_admin?: boolean
  can_use_sql_agent?: boolean
  can_generate_chart?: boolean
  can_view_graph?: boolean
}

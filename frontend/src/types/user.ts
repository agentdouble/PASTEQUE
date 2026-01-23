export interface CreateUserRequest {
  username: string
  password: string
}

export interface CreateUserResponse {
  username: string
}

export interface UserWithPermissionsResponse {
  username: string
  is_active: boolean
  is_admin: boolean
  created_at: string
  allowed_tables: string[]
}

export interface UserPermissionsOverviewResponse {
  tables: string[]
  users: UserWithPermissionsResponse[]
}

export interface UpdateUserPermissionsRequest {
  allowed_tables: string[]
}

export interface AdminResetPasswordResponse {
  username: string
  temporary_password: string
}

export interface UsageTotals {
  users: number
  conversations: number
  messages: number
  charts: number
  conversations_last_7_days: number
  messages_last_7_days: number
  charts_last_7_days: number
  active_users_last_7_days: number
}

export interface UserUsageStats {
  username: string
  is_active: boolean
  created_at: string
  last_activity_at: string | null
  conversations: number
  messages: number
  charts: number
}

export interface AdminUsageStatsResponse {
  generated_at: string
  totals: UsageTotals
  per_user: UserUsageStats[]
}

export interface AuthState {
  token: string
  tokenType: string
  username: string
  isAdmin: boolean
}

export interface LoginResponse {
  access_token: string
  token_type?: string
  username: string
  is_admin?: boolean
}

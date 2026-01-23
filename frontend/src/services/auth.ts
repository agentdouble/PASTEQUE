import type { AuthState, LoginResponse } from '@/types/auth'

const AUTH_KEY = 'authState'

export class PasswordResetRequiredError extends Error {
  readonly username: string

  constructor(username: string, message = 'Vous devez définir un nouveau mot de passe.') {
    super(message)
    this.name = 'PasswordResetRequiredError'
    this.username = username
  }
}

export function storeAuth(auth: AuthState): void {
  window.localStorage.setItem(AUTH_KEY, JSON.stringify(auth))
}

export function clearAuth(): void {
  window.localStorage.removeItem(AUTH_KEY)
}

export function getToken(): string | null {
  const auth = getAuth()
  return auth ? auth.token : null
}

export function getAuth(): AuthState | null {
  const raw = window.localStorage.getItem(AUTH_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthState
  } catch (err) {
    console.error('Invalid auth state, clearing.', err)
    clearAuth()
    return null
  }
}

function extractErrorMessage(raw: string): string {
  const text = raw.trim()
  if (!text) return 'Échec de la requête'
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'string') return parsed
    if (typeof parsed?.message === 'string') return parsed.message
    if (typeof parsed?.detail === 'string') return parsed.detail
    if (parsed?.detail && typeof parsed.detail === 'object') {
      if (typeof parsed.detail.message === 'string') return parsed.detail.message
      if (typeof parsed.detail.detail === 'string') return parsed.detail.detail
    }
    if (typeof parsed?.error === 'string') return parsed.error
  } catch {
    // ignore parsing failure
  }
  return text
}

export async function login(username: string, password: string): Promise<AuthState> {
  const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  if (!res.ok) {
    const text = await res.text()
    let parsed: any = null
    try {
      parsed = JSON.parse(text)
    } catch {
      // ignore parsing error
    }
    if (res.status === 403 && parsed) {
      const detail = typeof parsed.detail === 'object' ? parsed.detail : undefined
      const code = parsed.code ?? detail?.code
      if (code === 'PASSWORD_RESET_REQUIRED') {
        const message =
          parsed.message ??
          detail?.message ??
          'Vous devez définir un nouveau mot de passe.'
        throw new PasswordResetRequiredError(username, message)
      }
    }
    throw new Error(extractErrorMessage(text) || 'Échec de la connexion')
  }

  const data = (await res.json()) as LoginResponse
  if (!data?.access_token) {
    throw new Error('Réponse API invalide')
  }
  const auth: AuthState = {
    token: data.access_token,
    tokenType: data.token_type || 'bearer',
    username: data.username,
    isAdmin: Boolean(data.is_admin),
  }
  storeAuth(auth)
  return auth
}

interface ResetPasswordOptions {
  username: string
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

export async function resetPassword(options: ResetPasswordOptions): Promise<void> {
  const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: options.username,
      current_password: options.currentPassword,
      new_password: options.newPassword,
      confirm_password: options.confirmPassword,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(extractErrorMessage(text) || 'Échec de la mise à jour du mot de passe')
  }
}

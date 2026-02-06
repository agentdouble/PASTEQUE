import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, resetPassword, PasswordResetRequiredError } from '@/services/auth'
import { Button, Input, Card } from '@/components/ui'

type Mode = 'login' | 'reset'

export default function Login() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>('login')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pendingReset, setPendingReset] = useState<{ username: string; currentPassword: string } | null>(null)

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(username.trim(), password)
      setUsername('')
      setPassword('')
      navigate('/chat')
    } catch (err) {
      if (err instanceof PasswordResetRequiredError) {
        const trimmed = username.trim()
        setPendingReset({ username: trimmed, currentPassword: password })
        setMode('reset')
        setPassword('')
        setError(err.message)
        return
      }
      setError(err instanceof Error ? err.message : 'Échec de la connexion')
    } finally {
      setLoading(false)
    }
  }

  async function handleResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pendingReset) return
    if (newPassword !== confirmPassword) {
      setError('Les deux mots de passe doivent être identiques.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await resetPassword({
        username: pendingReset.username,
        currentPassword: pendingReset.currentPassword,
        newPassword,
        confirmPassword,
      })
      await login(pendingReset.username, newPassword)
      setUsername('')
      setPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPendingReset(null)
      setMode('login')
      navigate('/chat')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de mettre à jour le mot de passe.')
    } finally {
      setLoading(false)
    }
  }

  function handleCancelReset() {
    setMode('login')
    setPendingReset(null)
    setNewPassword('')
    setConfirmPassword('')
    setPassword('')
    setError(null)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-white flex items-center justify-center p-4">
      <Card className="w-full max-w-md animate-slide-up" variant="elevated">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary-950 mb-2">
            FoyerInsight
          </h1>
          <p className="text-primary-600">
            {mode === 'login'
              ? 'Veuillez vous connecter pour accéder à la plateforme.'
              : 'Définissez un nouveau mot de passe pour finaliser votre première connexion.'}
          </p>
        </div>

        <form
          onSubmit={mode === 'login' ? handleLoginSubmit : handleResetSubmit}
          className="space-y-4"
        >
          {mode === 'login' ? (
            <>
              <Input
                label="Utilisateur"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                fullWidth
                placeholder="Entrez votre nom d'utilisateur"
              />

              <Input
                label="Mot de passe"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                fullWidth
                placeholder="Entrez votre mot de passe"
              />
            </>
          ) : (
            <>
              <Input
                label="Utilisateur"
                type="text"
                value={pendingReset?.username ?? username}
                readOnly
                disabled
                fullWidth
              />

              <Input
                label="Nouveau mot de passe"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
                fullWidth
                placeholder="Saisissez votre nouveau mot de passe"
              />

              <Input
                label="Confirmez le mot de passe"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                fullWidth
                placeholder="Répétez votre nouveau mot de passe"
              />
            </>
          )}

          {error && (
            <div className="bg-red-50 border-2 border-red-200 rounded-lg p-3 animate-fade-in">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {mode === 'login' ? (
            <Button
              type="submit"
              disabled={loading}
              fullWidth
              size="lg"
              className="mt-6"
            >
              {loading ? 'Connexion en cours…' : 'Se connecter'}
            </Button>
          ) : (
            <div className="flex flex-col gap-3 pt-2">
              <Button
                type="submit"
                disabled={loading}
                fullWidth
                size="lg"
              >
                {loading ? 'Mise à jour…' : 'Valider le nouveau mot de passe'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleCancelReset}
                disabled={loading}
              >
                Annuler
              </Button>
            </div>
          )}
        </form>
      </Card>
    </div>
  )
}

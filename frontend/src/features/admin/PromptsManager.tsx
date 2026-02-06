import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { apiFetch } from '@/services/api'
import { Button, Card, Loader, Textarea } from '@/components/ui'
import type { PromptItem, PromptsResponse } from '@/types/prompts'

interface Status {
  type: 'success' | 'error'
  message: string
}

export default function PromptsManager() {
  const [prompts, setPrompts] = useState<PromptItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')

  const sortedPrompts = useMemo(() => {
    return [...prompts].sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }))
  }, [prompts])

  const selected = useMemo(
    () => sortedPrompts.find(item => item.key === selectedKey) ?? null,
    [sortedPrompts, selectedKey]
  )

  const isDirty = Boolean(selected && draft !== selected.template)

  useEffect(() => {
    void loadPrompts()
  }, [])

  useEffect(() => {
    if (!selected) {
      setDraft('')
      return
    }
    setDraft(selected.template)
  }, [selected])

  async function loadPrompts() {
    setLoading(true)
    setError('')
    setStatus(null)
    try {
      const data = await apiFetch<PromptsResponse>('/prompts')
      const items = data?.prompts ?? []
      setPrompts(items)
      if (items.length > 0) {
        setSelectedKey(prev => (prev && items.find(item => item.key === prev) ? prev : items[0].key))
      } else {
        setSelectedKey(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement des prompts impossible.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    setStatus(null)
    try {
      const updated = await apiFetch<PromptItem>(`/prompts/${encodeURIComponent(selected.key)}`, {
        method: 'PUT',
        body: JSON.stringify({ template: draft }),
      })
      setPrompts(prev => prev.map(item => (item.key === updated.key ? updated : item)))
      setStatus({ type: 'success', message: 'Prompt sauvegardé.' })
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Sauvegarde impossible.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="space-y-4" variant="elevated" padding="lg">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-primary-950">Prompts LLM</h3>
          <p className="text-sm text-primary-600">
            Éditez les prompts utilisés par les agents. Les variables sont remplacées automatiquement.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void loadPrompts()} disabled={loading}>
            {loading ? 'Actualisation…' : 'Actualiser'}
          </Button>
        </div>
      </div>

      {status && (
        <div
          className={clsx(
            'px-3 py-2 rounded-lg text-sm font-medium',
            status.type === 'success'
              ? 'bg-success-lighter text-success-dark border border-success-light'
              : 'bg-danger-lighter text-danger-darker border border-danger-light'
          )}
        >
          {status.message}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded-lg bg-danger-lighter border border-danger-light text-danger-darker text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-primary-900">Prompts</h4>
            {loading && <Loader size="sm" />}
          </div>
          <div className="rounded-lg border border-primary-100 bg-white max-h-[520px] overflow-auto">
            {sortedPrompts.map(item => (
              <button
                key={item.key}
                onClick={() => setSelectedKey(item.key)}
                className={clsx(
                  'w-full text-left px-3 py-2 border-b last:border-b-0 transition-colors',
                  'border-primary-100 hover:bg-primary-50',
                  selectedKey === item.key ? 'bg-primary-100 font-semibold' : 'bg-white'
                )}
              >
                <div className="text-sm text-primary-900">{item.label}</div>
                <div className="text-xs text-primary-500">{item.key}</div>
              </button>
            ))}
            {!loading && sortedPrompts.length === 0 && (
              <div className="px-3 py-4 text-sm text-primary-600">Aucun prompt disponible.</div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          <Card variant="outlined" padding="md" className="space-y-3">
            {!selected && (
              <div className="text-sm text-primary-600">Sélectionnez un prompt pour l'éditer.</div>
            )}
            {selected && loading && <Loader text="Chargement des prompts..." />}
            {selected && !loading && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-primary-500">{selected.key}</p>
                  <h4 className="text-lg font-semibold text-primary-900">{selected.label}</h4>
                  {selected.description && (
                    <p className="text-sm text-primary-600 mt-1">{selected.description}</p>
                  )}
                </div>

                <div className="grid gap-2 text-xs text-primary-600">
                  <div>
                    Variables utilisées:{' '}
                    <span className="font-semibold text-primary-800">
                      {selected.placeholders.length ? selected.placeholders.join(', ') : 'Aucune'}
                    </span>
                  </div>
                  <div>
                    Variables autorisées:{' '}
                    <span className="font-semibold text-primary-800">
                      {selected.allowed_variables.length ? selected.allowed_variables.join(', ') : 'Aucune'}
                    </span>
                  </div>
                </div>

                <Textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={14}
                  className="font-mono text-xs"
                />

                <div className="flex items-center gap-3">
                  <Button onClick={() => void handleSave()} disabled={saving || !isDirty}>
                    {saving ? 'Sauvegarde…' : 'Sauvegarder'}
                  </Button>
                  {isDirty && <span className="text-xs text-warning-dark">Modifications non sauvegardées</span>}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </Card>
  )
}

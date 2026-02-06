import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { apiFetch } from '@/services/api'
import { Button, Card, Input, Loader, Textarea } from '@/components/ui'
import type { DictionaryTable, DictionaryTableSummary, DictionaryColumn } from '@/types/dictionary'

interface Status {
  type: 'success' | 'error'
  message: string
}

export default function DictionaryManager() {
  const [summaries, setSummaries] = useState<DictionaryTableSummary[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<DictionaryTable | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const sortedSummaries = useMemo(() => {
    return [...summaries].sort((a, b) => a.table.localeCompare(b.table, 'fr', { sensitivity: 'base' }))
  }, [summaries])

  const selectedSummary = useMemo(
    () => sortedSummaries.find(item => item.table === selected) ?? null,
    [sortedSummaries, selected]
  )

  useEffect(() => {
    void loadSummaries()
  }, [])

  useEffect(() => {
    if (!selected) {
      setDetail(null)
      return
    }
    void loadDetail(selected)
  }, [selected])

  async function loadSummaries() {
    setLoadingList(true)
    setError('')
    try {
      const data = await apiFetch<DictionaryTableSummary[]>('/dictionary')
      const next = data ?? []
      setSummaries(next)
      if (next.length > 0 && (!selected || !next.find(item => item.table === selected))) {
        setSelected(next[0].table)
      } else if (next.length === 0) {
        setSelected(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible.')
    } finally {
      setLoadingList(false)
    }
  }

  async function loadDetail(table: string, opts: { keepStatus?: boolean } = {}) {
    setLoadingDetail(true)
    setError('')
    if (!opts.keepStatus) {
      setStatus(null)
    }
    try {
      const data = await apiFetch<DictionaryTable>(`/dictionary/${encodeURIComponent(table)}`)
      setDetail(data ?? null)
    } catch (err) {
      setDetail(null)
      setError(err instanceof Error ? err.message : 'Chargement impossible.')
    } finally {
      setLoadingDetail(false)
    }
  }

  function updateColumn(name: string, updater: (prev: DictionaryColumn) => DictionaryColumn) {
    setDetail(prev => {
      if (!prev) return prev
      return {
        ...prev,
        columns: prev.columns.map(col => (col.name === name ? updater(col) : col)),
      }
    })
  }

  async function handleSave() {
    if (!detail) return
    setSaving(true)
    setStatus(null)
    try {
      const payload: DictionaryTable = {
        ...detail,
        columns: detail.columns.map(col => ({
          ...col,
          // Ensure optional arrays are always present to keep metadata intact
          synonyms: col.synonyms ?? [],
          enum: col.enum ?? [],
        })),
      }
      const updated = await apiFetch<DictionaryTable>(
        `/dictionary/${encodeURIComponent(detail.table)}`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        }
      )
      setDetail(updated ?? payload)
      setStatus({ type: 'success', message: 'Dictionnaire sauvegardé.' })
      await loadSummaries()
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Sauvegarde impossible.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!detail) return
    const confirmed = window.confirm(`Supprimer le dictionnaire pour "${detail.table}" ?`)
    if (!confirmed) return
    setDeleting(true)
    setStatus(null)
    try {
      await apiFetch<void>(`/dictionary/${encodeURIComponent(detail.table)}`, { method: 'DELETE' })
      await loadSummaries()
      await loadDetail(detail.table, { keepStatus: true })
      setStatus({ type: 'success', message: 'Dictionnaire supprimé.' })
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Suppression impossible.' })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card className="space-y-4" variant="elevated" padding="lg">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-primary-950">Dictionnaire de données</h3>
          <p className="text-sm text-primary-600">Créer, modifier ou supprimer les définitions des tables.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void loadSummaries()}>
            Rafraîchir
          </Button>
        </div>
      </div>

      {status && (
        <div
          className={clsx(
            'px-3 py-2 rounded-lg text-sm font-medium',
            status.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
          )}
        >
          {status.message}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-primary-900">Tables</h4>
            {loadingList && <Loader size="sm" />}
          </div>
          <div className="rounded-lg border border-primary-100 bg-white max-h-[520px] overflow-auto">
            {sortedSummaries.map(item => (
              <button
                key={item.table}
                onClick={() => setSelected(item.table)}
                className={clsx(
                  'w-full text-left px-3 py-2 border-b last:border-b-0 transition-colors',
                  'border-primary-100 hover:bg-primary-50',
                  selected === item.table ? 'bg-primary-100 font-semibold' : 'bg-white'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-primary-900">{item.table}</span>
                  <span
                    className={clsx(
                      'text-xs px-2 py-0.5 rounded-full border',
                      item.has_dictionary
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    )}
                  >
                    {item.has_dictionary ? 'Défini' : 'À créer'}
                  </span>
                </div>
                <div className="text-xs text-primary-600 mt-1">
                  {item.columns_count} colonne{item.columns_count > 1 ? 's' : ''}
                </div>
              </button>
            ))}
            {!loadingList && sortedSummaries.length === 0 && (
              <div className="px-3 py-4 text-sm text-primary-600">Aucune table disponible.</div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          <Card variant="outlined" padding="md" className="space-y-3">
            {!selected && (
              <div className="text-sm text-primary-600">Sélectionnez une table pour éditer son dictionnaire.</div>
            )}
            {selected && loadingDetail && <Loader text="Chargement du dictionnaire..." />}
            {selected && !loadingDetail && detail && (
              <div className="space-y-4">
                <div className="flex items-start gap-4 flex-wrap">
                  <Input
                    label="Nom de la table"
                    value={detail.table}
                    disabled
                    className="bg-primary-50"
                  />
                  <Input
                    label="Titre"
                    placeholder="Titre lisible (optionnel)"
                    value={detail.title ?? ''}
                    onChange={e => setDetail(prev => prev ? { ...prev, title: e.target.value } : prev)}
                    fullWidth
                  />
                </div>
                <Textarea
                  label="Description"
                  placeholder="Résumé fonctionnel de la table"
                  value={detail.description ?? ''}
                  rows={3}
                  onChange={e => setDetail(prev => prev ? { ...prev, description: e.target.value } : prev)}
                />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h5 className="font-semibold text-primary-900">Colonnes ({detail.columns.length})</h5>
                  </div>
                  <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
                    {detail.columns.map(col => (
                      <Card key={col.name} padding="sm" variant="default" className="space-y-2">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-sm font-semibold text-primary-900">{col.name}</span>
                          <Input
                            label="Type"
                            placeholder="string, integer…"
                            value={col.type ?? ''}
                            onChange={e => updateColumn(col.name, prev => ({ ...prev, type: e.target.value }))}
                            className="max-w-[200px]"
                          />
                          <label className="inline-flex items-center gap-2 text-sm text-primary-800">
                            <input
                              type="checkbox"
                              checked={Boolean(col.pii)}
                              onChange={e => updateColumn(col.name, prev => ({ ...prev, pii: e.target.checked }))}
                              className="accent-primary-900"
                            />
                            PII
                          </label>
                          <label className="inline-flex items-center gap-2 text-sm text-primary-800">
                            <input
                              type="checkbox"
                              checked={Boolean(col.nullable)}
                              onChange={e => updateColumn(col.name, prev => ({ ...prev, nullable: e.target.checked }))}
                              className="accent-primary-900"
                            />
                            Nullable
                          </label>
                        </div>
                        <Textarea
                          label="Description"
                          placeholder="Décrire le rôle de la colonne"
                          value={col.description ?? ''}
                          rows={3}
                          onChange={e => updateColumn(col.name, prev => ({ ...prev, description: e.target.value }))}
                        />
                      </Card>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="text-sm text-primary-600">
                    {selectedSummary?.has_dictionary ? 'Mettez à jour les descriptions puis sauvegardez.' : 'Aucun dictionnaire existant : complétez et enregistrez pour le créer.'}
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedSummary?.has_dictionary && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void handleDelete()}
                        disabled={deleting}
                      >
                        {deleting ? 'Suppression...' : 'Supprimer'}
                      </Button>
                    )}
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void handleSave()}
                      disabled={saving}
                    >
                      {saving ? 'Sauvegarde...' : 'Enregistrer'}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </Card>
  )
}

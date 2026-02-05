import { useEffect, useState, useCallback } from 'react'
import { Card, Loader } from '@/components/ui'
import { apiFetch } from '@/services/api'
import type { LoopKind, LoopOverview, LoopSummary, LoopTableOverview } from '@/types/loop'
import { marked, Renderer } from 'marked'

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const renderer = new Renderer()
renderer.heading = (text) => `<p class="text-primary-900 font-semibold text-base mt-2">${text}</p>`
renderer.paragraph = (text) => `<p class="text-primary-800 text-sm leading-relaxed">${text}</p>`
renderer.list = (body) =>
  `<ul class="list-disc pl-5 space-y-1 text-primary-800 text-sm">${body}</ul>`
renderer.listitem = (text) => `<li>${text}</li>`
renderer.hr = () => `<hr class="border-primary-200 my-2" />`

marked.use({ renderer })
marked.setOptions({ breaks: true, gfm: true })

function renderMarkdown(content: string) {
  const safe = escapeHtml(content || '')
  const html = marked.parse(safe) as string
  return (
    <div
      className="space-y-2"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

const modeOptions: Array<{ key: LoopKind; label: string }> = [
  { key: 'daily', label: 'Journalier' },
  { key: 'weekly', label: 'Hebdomadaire' },
  { key: 'monthly', label: 'Mensuel' },
]

function SummaryList({ summary }: { summary?: LoopSummary }) {
  const emptyText = 'Aucune synthèse disponible.'

  return (
    <div>
      {summary ? (
        <Card
          variant="elevated"
          className="p-5 space-y-3 bg-gradient-to-br from-white via-primary-50/50 to-primary-25 border border-primary-100"
        >
          {renderMarkdown(summary.content)}
        </Card>
      ) : (
        <Card variant="elevated" className="p-4">
          <p className="text-primary-600 text-sm">{emptyText}</p>
        </Card>
      )}
    </div>
  )
}

export default function Loop() {
  const [overview, setOverview] = useState<LoopOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedMode, setSelectedMode] = useState<LoopKind>('daily')
  const [selectedTable, setSelectedTable] = useState('')

  const fetchOverview = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const data = await apiFetch<LoopOverview>('/loop/overview')
      setOverview(data ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchOverview()
  }, [fetchOverview])

  useEffect(() => {
    const items = overview?.items ?? []
    if (!items.length) return
    if (!selectedTable || !items.some(item => item.config.table_name === selectedTable)) {
      setSelectedTable(items[0].config.table_name)
    }
  }, [overview, selectedTable])

  const items = overview?.items ?? []
  const selectedItem = items.find(item => item.config.table_name === selectedTable)
  const selectedSummary = selectedItem
    ? selectedMode === 'daily'
      ? selectedItem.daily?.[0]
      : selectedMode === 'weekly'
        ? selectedItem.weekly?.[0]
        : selectedItem.monthly?.[0]
    : undefined

  return (
    <div className="max-w-7xl mx-auto animate-fade-in space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-primary-950">Radar</h2>
      </div>

      {loading ? (
        <Card variant="elevated" className="py-12 flex justify-center">
          <Loader text="Chargement…" />
        </Card>
      ) : error ? (
        <Card variant="elevated" className="py-6 px-4 border border-red-200 bg-red-50 text-red-700">
          <p className="text-sm">{error}</p>
        </Card>
      ) : (
        <>
          {(items.length === 0) ? (
            <Card variant="elevated" className="p-6">
              <p className="text-primary-700 text-sm">
                Aucune table Radar accessible.
              </p>
            </Card>
          ) : (
            <div className="space-y-6">
              <div className="px-1">
                <div className="mx-auto w-full max-w-4xl space-y-5">
                  <div className="space-y-1">
                    <label htmlFor="radar-table" className="text-xs uppercase tracking-wide text-primary-500">
                      Table
                    </label>
                    <select
                      id="radar-table"
                      className="w-full rounded-md border border-primary-200 bg-white px-3 py-2 text-primary-900 focus:border-primary-400 focus:outline-none"
                      value={selectedTable}
                      onChange={(event) => setSelectedTable(event.target.value)}
                    >
                      {items.map((item: LoopTableOverview) => (
                        <option key={item.config.id} value={item.config.table_name}>
                          {item.config.table_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <p className="text-center text-xs uppercase tracking-wide text-primary-500">Mode</p>
                    <div className="mx-auto grid w-full max-w-xl grid-cols-3 gap-1 rounded-lg border border-primary-200 bg-primary-50/70 p-1 shadow-sm">
                      {modeOptions.map(option => {
                        const isActive = selectedMode === option.key
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => setSelectedMode(option.key)}
                            aria-pressed={isActive}
                            className={
                              `rounded-md px-3 py-2 text-sm font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 ${
                                isActive
                                  ? 'bg-primary-900 text-white shadow-sm'
                                  : 'text-primary-700 hover:bg-white hover:text-primary-900'
                              }`
                            }
                          >
                            {option.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {selectedItem ? (
                <SummaryList summary={selectedSummary} />
              ) : (
                <Card variant="elevated" className="p-6">
                  <p className="text-primary-700 text-sm">
                    Aucune synthèse disponible pour cette table.
                  </p>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

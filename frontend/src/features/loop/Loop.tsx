import { useEffect, useState, useCallback } from 'react'
import { Card, Button, Loader } from '@/components/ui'
import { apiFetch } from '@/services/api'
import type { LoopOverview, LoopSummary, LoopTableOverview } from '@/types/loop'
import { HiArrowPath } from 'react-icons/hi2'
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

function SummaryList({ title, summary }: { title: string; summary?: LoopSummary }) {
  if (!summary) return null

  return (
    <div className="space-y-2">
      <h3 className="text-base font-semibold text-primary-900">{title}</h3>
      <Card
        variant="elevated"
        className="p-5 space-y-3 bg-gradient-to-br from-white via-primary-50/50 to-primary-25 border border-primary-100"
      >
        {renderMarkdown(summary.content)}
      </Card>
    </div>
  )
}

export default function Loop() {
  const [overview, setOverview] = useState<LoopOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const fetchOverview = useCallback(async () => {
    setError('')
    setRefreshing(true)
    try {
      const data = await apiFetch<LoopOverview>('/loop/overview')
      setOverview(data ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchOverview()
  }, [fetchOverview])

  return (
    <div className="max-w-7xl mx-auto animate-fade-in space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-primary-950">Radar</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={fetchOverview}
            disabled={refreshing}
            className="inline-flex items-center gap-2"
          >
            <HiArrowPath className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Actualiser
          </Button>
        </div>
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
          {(!overview?.items || overview.items.length === 0) ? (
            <Card variant="elevated" className="p-6">
              <p className="text-primary-700 text-sm">
                Aucune table Radar accessible.
              </p>
            </Card>
          ) : (
            <div className="space-y-6">
              {overview.items.map((item: LoopTableOverview) => (
                <Card key={item.config.id} variant="elevated" className="p-5 space-y-4">
                  <div>
                    <h3 className="text-xl font-semibold text-primary-950">{item.config.table_name}</h3>
                  </div>

                  <div className="space-y-4">
                    <SummaryList
                      title="Flash du jour"
                      summary={item.daily?.[0]}
                    />
                    <SummaryList
                      title="Focus de la semaine"
                      summary={item.weekly?.[0]}
                    />
                    <SummaryList
                      title="Panorama du mois"
                      summary={item.monthly?.[0]}
                    />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

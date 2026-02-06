import { useEffect, useState } from 'react'
import { Card, Loader, Button } from '@/components/ui'
import { HiChartBar, HiClock, HiUsers, HiArrowTopRightOnSquare, HiTrash } from 'react-icons/hi2'
import { apiFetch } from '@/services/api'
import { getAuth } from '@/services/auth'
import type { SavedChartResponse } from '@/types/chat'

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export default function Dashboard() {
  const [charts, setCharts] = useState<SavedChartResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [actionError, setActionError] = useState('')
  const [deletingIds, setDeletingIds] = useState<Set<number>>(() => new Set())
  const auth = getAuth()
  const isAdmin = Boolean(auth?.isAdmin)

  useEffect(() => {
    let active = true
    async function fetchCharts() {
      setLoading(true)
      setFetchError('')
      try {
        const res = await apiFetch<SavedChartResponse[]>('/charts')
        if (!active) return
        setCharts(res ?? [])
      } catch (err) {
        if (!active) return
        setFetchError(err instanceof Error ? err.message : 'Chargement impossible')
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }
    fetchCharts()
    return () => {
      active = false
    }
  }, [])

  async function handleDelete(chartId: number) {
    const chart = charts.find(item => item.id === chartId)
    if (!chart) return
    const confirmation = window.confirm(
      `Supprimer le graphique « ${chart.chart_title || 'sans titre'} » de la page Graph ?`
    )
    if (!confirmation) return

    setActionError('')
    setDeletingIds(prev => {
      const next = new Set(prev)
      next.add(chartId)
      return next
    })

    try {
      await apiFetch<void>(`/charts/${chartId}`, { method: 'DELETE' })
      setCharts(prev => prev.filter(item => item.id !== chartId))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Suppression impossible'
      setActionError(message)
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev)
        next.delete(chartId)
        return next
      })
    }
  }

  const chartCount = charts.length

  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-primary-950 mb-2">Graph</h2>
        <p className="text-primary-600">
          {isAdmin
            ? 'Vue globale des graphiques sauvegardés par tous les utilisateurs.'
            : 'Vue d’ensemble de vos graphiques sauvegardés.'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatCard
          icon={HiChartBar}
          title="Graphiques enregistrés"
          value={String(chartCount)}
          subtitle={isAdmin ? 'Total (tous utilisateurs)' : 'Total (vos graphiques)'}
        />
        <StatCard
          icon={HiUsers}
          title="Accès admin"
          value={isAdmin ? 'Oui' : 'Non'}
          subtitle={isAdmin ? 'Vous voyez tous les graphiques' : 'Visibilité limitée à votre compte'}
        />
        <StatCard
          icon={HiClock}
          title="Dernière mise à jour"
          value={chartCount > 0 ? formatDate(charts[0].created_at) : '—'}
          subtitle={chartCount > 0 ? 'Graphique le plus récent' : 'En attente de sauvegardes'}
        />
      </div>

      {actionError && (
        <Card variant="elevated" className="mb-6 border border-red-100 bg-red-50 text-red-700 text-sm">
          <p>{actionError}</p>
        </Card>
      )}

      {loading ? (
        <Card variant="elevated" className="py-12 flex justify-center">
          <Loader text="Chargement des graphiques…" />
        </Card>
      ) : fetchError ? (
        <Card variant="elevated" className="py-8 px-4">
          <p className="text-sm text-red-600 text-center">{fetchError}</p>
        </Card>
      ) : chartCount === 0 ? (
        <Card variant="elevated" className="text-center py-12">
          <HiChartBar className="w-16 h-16 mx-auto mb-4 text-primary-300" />
          <h3 className="text-xl font-semibold text-primary-950 mb-2">
            Aucun graphique enregistré pour le moment
          </h3>
          <p className="text-primary-600">
            Générez un graphique dans le chat et sauvegardez-le pour le retrouver ici.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {charts.map(chart => (
            <Card key={chart.id} variant="elevated" className="flex flex-col gap-3 overflow-hidden">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-primary-950">
                    {chart.chart_title || 'Graphique sans titre'}
                  </h3>
                  <p className="text-xs text-primary-500">
                    Enregistré le {formatDate(chart.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={chart.chart_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-lg border-2 border-primary-200 px-3 py-1.5 text-sm text-primary-950 hover:border-primary-300 hover:bg-primary-50 transition-colors"
                  >
                    <HiArrowTopRightOnSquare className="w-4 h-4" />
                  </a>
                  <Button
                    variant="danger"
                    size="sm"
                    type="button"
                    onClick={() => handleDelete(chart.id)}
                    disabled={deletingIds.has(chart.id)}
                    className="h-9 w-9 p-0 flex items-center justify-center"
                    title="Supprimer du dashboard"
                    aria-label="Supprimer du dashboard"
                  >
                    {deletingIds.has(chart.id) ? (
                      <span className="inline-block h-4 w-4 rounded-full border-2 border-white/70 border-t-white animate-spin" />
                    ) : (
                      <HiTrash className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
              {isAdmin && (
                <p className="text-xs text-primary-500">
                  Utilisateur&nbsp;: <span className="font-medium">{chart.owner_username}</span>
                </p>
              )}
              <img
                src={chart.chart_url}
                alt={chart.chart_title || 'Aperçu du graphique'}
                className="w-full rounded-md border border-primary-100 object-cover"
              />
              {chart.chart_description && (
                <p className="text-sm text-primary-700 whitespace-pre-wrap">
                  {chart.chart_description}
                </p>
              )}
              <div className="bg-primary-50 rounded-md p-3 text-xs text-primary-600">
                <p className="font-medium text-primary-700 mb-1">Prompt</p>
                <p className="whitespace-pre-wrap">{chart.prompt}</p>
              </div>
              {chart.tool_name && (
                <p className="text-[11px] uppercase tracking-wide text-primary-400">
                  Outil utilisé : {chart.tool_name}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>
  title: string
  value: string
  subtitle: string
}

function StatCard({ icon: Icon, title, value, subtitle }: StatCardProps) {
  return (
    <Card variant="elevated" className="hover:shadow-xl transition-shadow duration-200">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-primary-950 rounded-lg">
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-primary-600 mb-1">{title}</p>
          <p className="text-2xl font-bold text-primary-950 mb-1">{value}</p>
          <p className="text-xs text-primary-500">{subtitle}</p>
        </div>
      </div>
    </Card>
  )
}

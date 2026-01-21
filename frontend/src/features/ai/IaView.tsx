import { useEffect, useMemo, useRef, useState } from 'react'
import CategoryStackedChart from '@/components/charts/CategoryStackedChart'
import { Card, Loader, Button } from '@/components/ui'
import { apiFetch } from '@/services/api'
import { getAuth } from '@/services/auth'
import type {
  CategorySubCategoryCount,
  DataOverviewResponse,
  DataSourceOverview,
  TableExplorePreview,
  TableRow,
  ColumnRolesResponse,
} from '@/types/data'
import { HiSparkles } from 'react-icons/hi2'

type CategoryNode = {
  name: string
  total: number
  subCategories: { name: string; count: number }[]
}

type Selection = {
  source: string
  category: string
  subCategory: string
}

type ColumnRoleSelection = {
  date_field: string | null
  category_field: string | null
  sub_category_field: string | null
}

const PAGE_SIZE = 25

function buildCategoryNodes(breakdown?: CategorySubCategoryCount[]): CategoryNode[] {
  if (!breakdown?.length) return []

  const categoryMap = new Map<string, Map<string, number>>()
  const totals = new Map<string, number>()

  for (const item of breakdown) {
    const category = item.category?.trim()
    const subCategory = item.sub_category?.trim()
    if (!category || !subCategory) continue

    if (!categoryMap.has(category)) {
      categoryMap.set(category, new Map())
    }
    const subMap = categoryMap.get(category)!
    subMap.set(subCategory, (subMap.get(subCategory) ?? 0) + item.count)
    totals.set(category, (totals.get(category) ?? 0) + item.count)
  }

  return Array.from(categoryMap.entries())
    .map(([category, subMap]) => ({
      name: category,
      total: totals.get(category) ?? 0,
      subCategories: Array.from(subMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

export default function IaView() {
  const [overview, setOverview] = useState<DataOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selection, setSelection] = useState<Selection | null>(null)
  const [preview, setPreview] = useState<TableExplorePreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [matchingRows, setMatchingRows] = useState(0)
  const [globalBounds, setGlobalBounds] = useState<{ min?: string; max?: string }>({})
  const [pendingRange, setPendingRange] = useState<{ from?: string; to?: string } | null>(null)
  const [appliedRange, setAppliedRange] = useState<{ from?: string; to?: string } | null>(null)
  const [columnRoles, setColumnRoles] = useState<Record<string, ColumnRoleSelection>>({})
  const [savingRoles, setSavingRoles] = useState<Set<string>>(() => new Set())
  const [rolesError, setRolesError] = useState<Record<string, string>>({})
  const requestRef = useRef(0)
  const sliderRef = useRef<HTMLDivElement | null>(null)
  const auth = getAuth()
  const isAdmin = Boolean(auth?.isAdmin)

  const computeGlobalBounds = (sources: DataSourceOverview[] | undefined) => {
    let min: string | undefined
    let max: string | undefined
    for (const src of sources ?? []) {
      if (src.date_min && (!min || src.date_min < min)) min = src.date_min
      if (src.date_max && (!max || src.date_max > max)) max = src.date_max
    }
    return { min, max }
  }

  const loadOverview = async (
    range: { from?: string; to?: string } | null = appliedRange,
    withLoader = true
  ) => {
    if (withLoader) {
      setLoading(true)
      setError('')
    }
    const params = new URLSearchParams()
    if (range?.from) params.set('date_from', range.from)
    if (range?.to) params.set('date_to', range.to)
    const url = params.size ? `/data/overview?${params.toString()}` : '/data/overview'
    try {
      const res = await apiFetch<DataOverviewResponse>(url)
      const data = res ?? { generated_at: '', sources: [] }
      setOverview(data)
      const bounds = computeGlobalBounds(data.sources)
      setGlobalBounds(bounds)
      if (!pendingRange && bounds.min && bounds.max) {
        setPendingRange(range ?? { from: bounds.min, to: bounds.max })
      }
      if (!appliedRange && bounds.min && bounds.max) {
        setAppliedRange(range ?? { from: bounds.min, to: bounds.max })
      }
      const nextRoles: Record<string, ColumnRoleSelection> = {}
      data.sources.forEach(src => {
        nextRoles[src.source] = {
          date_field: src.date_field ?? null,
          category_field: src.category_field ?? null,
          sub_category_field: src.sub_category_field ?? null,
        }
      })
      setColumnRoles(nextRoles)
    } catch (err) {
      if (withLoader) {
        setError(err instanceof Error ? err.message : 'Chargement impossible.')
      }
    } finally {
      if (withLoader) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void loadOverview()
  }, [])

  const sourcesWithCategories = useMemo(
    () => (overview?.sources ?? []).filter(src => (src.category_breakdown?.length ?? 0) > 0),
    [overview]
  )
  const hasGlobalDate = Boolean(globalBounds.min && globalBounds.max)

  const sourceHasDate = (sourceName: string) => {
    const src = (overview?.sources ?? []).find(item => item.source === sourceName)
    return Boolean(src?.date_min && src?.date_max)
  }

  const toTimestamp = (date?: string) => {
    if (!date) return undefined
    const ts = Date.parse(`${date}T00:00:00Z`)
    return Number.isNaN(ts) ? undefined : ts
  }

  const minTs = toTimestamp(globalBounds.min)
  const maxTs = toTimestamp(globalBounds.max)
  const startIso = pendingRange?.from ?? globalBounds.min
  const endIso = pendingRange?.to ?? globalBounds.max
  const startTs =
    startIso && minTs !== undefined ? Math.max(minTs, toTimestamp(startIso) ?? minTs) : minTs
  const endTs = endIso && maxTs !== undefined ? Math.min(maxTs, toTimestamp(endIso) ?? maxTs) : maxTs
  const totalSpan = minTs !== undefined && maxTs !== undefined ? Math.max(maxTs - minTs, 1) : 1
  const startPercent =
    startTs !== undefined && minTs !== undefined
      ? Math.max(0, Math.min(100, ((startTs - minTs) / totalSpan) * 100))
      : 0
  const endPercent =
    endTs !== undefined && minTs !== undefined
      ? Math.max(startPercent, Math.min(100, ((endTs - minTs) / totalSpan) * 100))
      : 100

  const clampAndIso = (value: number | undefined, fallback: number | undefined) => {
    if (value === undefined && fallback === undefined) return undefined
    const target = value ?? fallback ?? 0
    return new Date(target).toISOString().slice(0, 10)
  }

  const tsFromPointer = (clientX: number): number | undefined => {
    const rect = sliderRef.current?.getBoundingClientRect()
    if (!rect || minTs === undefined || maxTs === undefined) return undefined
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round(minTs + pct * (maxTs - minTs))
  }

  const handleRangeStartChange = (value: number) => {
    if (minTs === undefined || maxTs === undefined || endTs === undefined) return
    const clamped = Math.min(Math.max(value, minTs), endTs)
    setPendingRange({
      from: clampAndIso(clamped, minTs),
      to: clampAndIso(endTs, maxTs),
    })
  }

  const handleRangeEndChange = (value: number) => {
    if (minTs === undefined || maxTs === undefined || startTs === undefined) return
    const clamped = Math.max(Math.min(value, maxTs), startTs)
    setPendingRange({
      from: clampAndIso(startTs, minTs),
      to: clampAndIso(clamped, maxTs),
    })
  }

  const formatDate = (value?: string) => {
    if (!value) return '—'
    const date = new Date(`${value}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString('fr-FR')
  }

  const fetchPreview = (
    sel: Selection,
    pageIndex: number,
    direction: 'asc' | 'desc',
    range: { from?: string; to?: string } | null = appliedRange
  ) => {
    const offset = pageIndex * PAGE_SIZE
    setPreview(null)
    setPreviewError('')
    setPreviewLoading(true)
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    const includeDate = sourceHasDate(sel.source)

    const params = new URLSearchParams({
      category: sel.category,
      sub_category: sel.subCategory,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    })
    if (includeDate && range?.from) {
      params.set('date_from', range.from)
    }
    if (includeDate && range?.to) {
      params.set('date_to', range.to)
    }
    if (includeDate) {
      params.set('sort_date', direction)
    }

    void (async () => {
      try {
        const res = await apiFetch<TableExplorePreview>(
          `/data/explore/${encodeURIComponent(sel.source)}?${params.toString()}`
        )
        if (requestRef.current !== requestId) return
        setPreview(res ?? null)
        setMatchingRows(res?.matching_rows ?? 0)
        if (range) {
          setAppliedRange(range)
        }
      } catch (err) {
        if (requestRef.current !== requestId) return
        setPreviewError(
          err instanceof Error
            ? err.message
            : "Impossible de charger les données pour cette sélection."
        )
        setMatchingRows(0)
      } finally {
        if (requestRef.current === requestId) {
          setPreviewLoading(false)
        }
      }
    })()
  }

  const handleSelect = (source: string, category: string, subCategory: string) => {
    const nextSelection: Selection = { source, category, subCategory }
    setSelection(nextSelection)
    setPage(0)
    setMatchingRows(0)
    fetchPreview(nextSelection, 0, sortDirection, appliedRange)
  }

  const handlePageChange = (nextPage: number) => {
    if (!selection) return
    if (nextPage < 0) return
    const total = matchingRows || preview?.matching_rows || 0
    const maxPage = total ? Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0) : 0
    const target = Math.min(nextPage, maxPage)
    setPage(target)
    fetchPreview(selection, target, sortDirection, appliedRange)
  }

  const handleToggleSort = () => {
    if (!selection) return
    if (!sourceHasDate(selection.source)) return
    const nextDirection = sortDirection === 'desc' ? 'asc' : 'desc'
    setSortDirection(nextDirection)
    setPage(0)
    fetchPreview(selection, 0, nextDirection, appliedRange)
  }

  const handleApplyRange = () => {
    if (!pendingRange || !hasGlobalDate) return
    setAppliedRange(pendingRange)
    setPage(0)
    void (async () => {
      await loadOverview(pendingRange)
      if (selection) {
        fetchPreview(selection, 0, sortDirection, pendingRange)
      }
    })()
  }

  const handleResetRange = () => {
    if (!hasGlobalDate || !globalBounds.min || !globalBounds.max) return
    const fullRange = { from: globalBounds.min, to: globalBounds.max }
    setPendingRange(fullRange)
    setAppliedRange(fullRange)
    setPage(0)
    void (async () => {
      await loadOverview(fullRange)
      if (selection) {
        fetchPreview(selection, 0, sortDirection, fullRange)
      }
    })()
  }

  const handleSaveColumnRoles = async (source: string, roles: ColumnRoleSelection) => {
    if (!isAdmin) return

    if ((roles.category_field && !roles.sub_category_field) || (roles.sub_category_field && !roles.category_field)) {
      setRolesError(prev => ({ ...prev, [source]: 'Choisissez une catégorie ET une sous-catégorie ou aucune des deux.' }))
      return
    }

    setRolesError(prev => ({ ...prev, [source]: '' }))
    setSavingRoles(prev => new Set(prev).add(source))
    try {
      const response = await apiFetch<ColumnRolesResponse>(
        `/data/overview/${encodeURIComponent(source)}/column-roles`,
        {
          method: 'PUT',
          body: JSON.stringify(roles),
        }
      )
      const updated = response ?? roles
      setColumnRoles(prev => ({
        ...prev,
        [source]: {
          date_field: updated.date_field ?? null,
          category_field: updated.category_field ?? null,
          sub_category_field: updated.sub_category_field ?? null,
        },
      }))
      await loadOverview(appliedRange, false)
      if (selection?.source === source) {
        setSelection(null)
        setPreview(null)
        setPreviewError('')
        setMatchingRows(0)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Mise à jour impossible.'
      setRolesError(prev => ({ ...prev, [source]: message }))
    } finally {
      setSavingRoles(prev => {
        const next = new Set(prev)
        next.delete(source)
        return next
      })
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-900 text-white rounded-lg">
            <HiSparkles className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-primary-950">Explorer</h2>
            <p className="text-primary-600">
              Naviguez par Category / Sub Category pour inspecter les données cliquables.
            </p>
          </div>
        </div>
        <div className="text-right text-sm text-primary-600">
          {overview?.generated_at ? (
            <span className="font-semibold text-primary-900">
              Snapshot : {new Date(overview.generated_at).toLocaleString('fr-FR')}
            </span>
          ) : (
            'Chargement…'
          )}
        </div>
      </div>

      {hasGlobalDate && minTs !== undefined && maxTs !== undefined ? (
        <Card variant="elevated" className="space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-primary-700">
              <span className="font-semibold text-primary-900">Filtre date</span>
            </div>
            <div className="text-[11px] text-primary-600 flex gap-2">
              <span>
                De <span className="font-semibold text-primary-900">{formatDate(pendingRange?.from ?? globalBounds.min)}</span>
              </span>
              <span>
                À <span className="font-semibold text-primary-900">{formatDate(pendingRange?.to ?? globalBounds.max)}</span>
              </span>
            </div>
          </div>
          <div className="relative h-10" ref={sliderRef}>
            <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-primary-100" />
            <div
              className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-primary-900/60 transition-all duration-200"
              style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary-950 border-2 border-primary-100 shadow-sm pointer-events-none transition-transform duration-150"
              style={{ left: `calc(${startPercent}% - 8px)` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary-900 border-2 border-primary-100 shadow-sm pointer-events-none transition-transform duration-150"
              style={{ left: `calc(${endPercent}% - 8px)` }}
            />
            <button
              type="button"
              aria-label="Début de période"
              className="absolute top-0 h-full w-11 -translate-x-1/2"
              onPointerDown={event => {
                event.preventDefault()
                const ts = tsFromPointer(event.clientX)
                if (ts !== undefined) handleRangeStartChange(ts)
                const move = (evt: PointerEvent) => {
                  const next = tsFromPointer(evt.clientX)
                  if (next !== undefined) handleRangeStartChange(next)
                }
                const stop = () => {
                  window.removeEventListener('pointermove', move)
                  window.removeEventListener('pointerup', stop)
                }
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', stop, { once: true })
              }}
              style={{ zIndex: 30, background: 'transparent', left: `${startPercent}%` }}
            />
            <button
              type="button"
              aria-label="Fin de période"
              className="absolute top-0 h-full w-11 -translate-x-1/2"
              onPointerDown={event => {
                event.preventDefault()
                const ts = tsFromPointer(event.clientX)
                if (ts !== undefined) handleRangeEndChange(ts)
                const move = (evt: PointerEvent) => {
                  const next = tsFromPointer(evt.clientX)
                  if (next !== undefined) handleRangeEndChange(next)
                }
                const stop = () => {
                  window.removeEventListener('pointermove', move)
                  window.removeEventListener('pointerup', stop)
                }
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', stop, { once: true })
              }}
              style={{ zIndex: 31, background: 'transparent', left: `${endPercent}%` }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleApplyRange}
              className="!rounded-full"
              disabled={loading}
            >
              Appliquer le filtre
            </Button>
            <Button variant="ghost" size="sm" onClick={handleResetRange} disabled={loading}>
              Réinitialiser
            </Button>
          </div>
        </Card>
      ) : null}

      <SelectionPreview
        selection={selection}
        preview={preview}
        loading={previewLoading}
        error={previewError}
        limit={PAGE_SIZE}
        page={page}
        matchingRows={matchingRows || preview?.matching_rows || 0}
        sortDirection={sortDirection}
        onPageChange={handlePageChange}
        onToggleSort={handleToggleSort}
        canSort={selection ? sourceHasDate(selection.source) : false}
        activeRange={appliedRange}
      />

      {loading ? (
        <Card variant="elevated" className="py-12 flex justify-center">
          <Loader text="Chargement des répartitions Category / Sub Category…" />
        </Card>
      ) : error ? (
        <Card variant="elevated" className="py-6 px-4 text-sm text-red-600">{error}</Card>
      ) : sourcesWithCategories.length === 0 ? (
        <Card variant="elevated" className="py-10 px-4 text-center text-primary-600">
          Aucune source ne contient les colonnes « Category » et « Sub Category » avec des valeurs
          exploitables.
        </Card>
      ) : (
        <div className="space-y-4">
          {sourcesWithCategories.map(source => (
            <SourceCategoryCard
              key={source.source}
              source={source}
              onSelect={handleSelect}
              isAdmin={isAdmin}
              roles={
                columnRoles[source.source] ?? {
                  date_field: source.date_field ?? null,
                  category_field: source.category_field ?? null,
                  sub_category_field: source.sub_category_field ?? null,
                }
              }
              onSaveRoles={handleSaveColumnRoles}
              saving={savingRoles.has(source.source)}
              error={rolesError[source.source] ?? ''}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SourceCategoryCard({
  source,
  onSelect,
  isAdmin,
  roles,
  onSaveRoles,
  saving,
  error,
}: {
  source: DataSourceOverview
  onSelect: (source: string, category: string, subCategory: string) => void
  isAdmin: boolean
  roles: ColumnRoleSelection
  onSaveRoles: (source: string, roles: ColumnRoleSelection) => void
  saving: boolean
  error: string
}) {
  const categoryNodes = useMemo(
    () => buildCategoryNodes(source.category_breakdown),
    [source.category_breakdown]
  )
  const [activeCategory, setActiveCategory] = useState<string>(categoryNodes[0]?.name ?? '')
  const [subFilter, setSubFilter] = useState('')
  const [rolesDraft, setRolesDraft] = useState<ColumnRoleSelection>(roles)

  useEffect(() => {
    if (!activeCategory && categoryNodes[0]) {
      setActiveCategory(categoryNodes[0].name)
    } else if (activeCategory && !categoryNodes.find(node => node.name === activeCategory)) {
      setActiveCategory(categoryNodes[0]?.name ?? '')
    }
  }, [categoryNodes, activeCategory])

  useEffect(() => {
    setRolesDraft(roles)
  }, [roles])

  const selectedNode =
    categoryNodes.find(node => node.name === activeCategory) ?? categoryNodes[0] ?? null
  const filteredSubs =
    selectedNode?.subCategories.filter(sub =>
      sub.name.toLowerCase().includes(subFilter.trim().toLowerCase())
    ) ?? []

  if (!categoryNodes.length) {
    return (
      <Card padding="sm" className="bg-primary-50">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-primary-900">{source.title}</p>
            <p className="text-xs text-primary-600">{source.source}</p>
          </div>
          <span className="text-xs text-primary-600">Aucune répartition Category/Sub Category</span>
        </div>
      </Card>
    )
  }

  const handleChartSelect = (category: string, subCategory?: string) => {
    setActiveCategory(category)
    setSubFilter('')
    const targetSub =
      subCategory ??
      categoryNodes.find(node => node.name === category)?.subCategories[0]?.name ??
      ''
    if (targetSub) {
      onSelect(source.source, category, targetSub)
    }
  }

  return (
    <Card variant="elevated" padding="md" className="space-y-3">
      {isAdmin ? (
        <div className="space-y-2 border border-primary-100 rounded-lg bg-primary-50/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-primary-900">Colonnes clés</p>
              <p className="text-[11px] text-primary-600">Date / Category / Sub Category</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onSaveRoles(source.source, rolesDraft)}
              disabled={saving}
            >
              Enregistrer
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['date_field', 'category_field', 'sub_category_field'] as const).map(key => (
              <label key={key} className="flex flex-col gap-1 text-xs text-primary-700">
                <span className="font-semibold text-primary-800">
                  {key === 'date_field'
                    ? 'Colonne date'
                    : key === 'category_field'
                      ? 'Category'
                      : 'Sub Category'}
                </span>
                <select
                  className="h-9 rounded-md border border-primary-200 bg-white px-2 text-primary-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={rolesDraft[key] ?? ''}
                  onChange={e =>
                    setRolesDraft(prev => ({
                      ...prev,
                      [key]: e.target.value || null,
                    }))
                  }
                  disabled={saving}
                >
                  <option value="">Aucune</option>
                  {(source.fields ?? []).map(field => (
                    <option key={field.field} value={field.field}>
                      {field.field}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-primary-500">{source.source}</p>
          <h3 className="text-lg font-semibold text-primary-950">{source.title}</h3>
          <p className="text-xs text-primary-500">
            {source.total_rows.toLocaleString('fr-FR')} lignes ·{' '}
            {categoryNodes.length.toLocaleString('fr-FR')} catégories
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <select
            value={activeCategory}
            onChange={e => setActiveCategory(e.target.value)}
            className="border border-primary-200 rounded-md px-3 py-2 text-sm text-primary-900 bg-white shadow-inner"
          >
            {categoryNodes.map(node => (
              <option key={node.name} value={node.name}>
                {node.name} ({node.subCategories.length})
              </option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Filtrer les sous-catégories"
            value={subFilter}
            onChange={e => setSubFilter(e.target.value)}
            className="border border-primary-200 rounded-md px-3 py-2 text-sm text-primary-900 bg-white shadow-inner"
          />
        </div>
      </div>

      <CategoryStackedChart
        breakdown={source.category_breakdown ?? []}
        onSelect={handleChartSelect}
        className="bg-primary-50/80"
      />

      {selectedNode ? (
        <div className="overflow-hidden border border-primary-200 rounded-xl bg-white shadow-sm">
          <div className="flex items-start justify-between px-3 py-2 bg-primary-900 text-white">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{selectedNode.name}</p>
              <p className="text-[11px] text-primary-100/80">
                {selectedNode.total.toLocaleString('fr-FR')} lignes ·{' '}
                {selectedNode.subCategories.length.toLocaleString('fr-FR')} sous-catégories
              </p>
            </div>
          </div>
          <div className="flex flex-col divide-y divide-primary-100 max-h-72 overflow-y-auto">
            {filteredSubs.length ? (
              filteredSubs.map(sub => (
                <button
                  key={sub.name}
                  type="button"
                  className="flex items-center justify-between px-3 py-2 text-left hover:bg-primary-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 border-l-4 border-primary-200"
                  onClick={() => onSelect(source.source, selectedNode.name, sub.name)}
                >
                  <p className="text-sm font-semibold text-primary-900 truncate min-w-0">{sub.name}</p>
                  <span className="text-xs font-semibold text-primary-700">
                    {sub.count.toLocaleString('fr-FR')}
                  </span>
                </button>
              ))
            ) : (
              <div className="px-3 py-3 text-sm text-primary-600">
                Aucune sous-catégorie ne correspond à ce filtre.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  )
}

function SelectionPreview({
  selection,
  preview,
  loading,
  error,
  limit,
  page,
  matchingRows,
  sortDirection,
  onPageChange,
  onToggleSort,
  canSort,
  activeRange,
}: {
  selection: Selection | null
  preview: TableExplorePreview | null
  loading: boolean
  error: string
  limit: number
  page: number
  matchingRows: number
  sortDirection: 'asc' | 'desc'
  onPageChange: (nextPage: number) => void
  onToggleSort: () => void
  canSort: boolean
  activeRange: { from?: string; to?: string } | null
}) {
  if (!selection) return null

  const columns = preview?.preview_columns ?? []
  const rows = preview?.preview_rows ?? []
  const totalRows = matchingRows || preview?.matching_rows || 0
  const totalPages = totalRows ? Math.max(1, Math.ceil(totalRows / limit)) : 1
  const currentPage = Math.min(page, totalPages - 1)
  const hasPrev = currentPage > 0
  const hasNext = currentPage < totalPages - 1

  return (
    <Card variant="outlined" className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-primary-700">
          <span className="font-semibold text-primary-900">{selection.source}</span> ·{' '}
          <span className="font-semibold text-primary-900">{selection.category}</span> /{' '}
          <span className="font-semibold text-primary-900">{selection.subCategory}</span>
        </div>
        {preview ? (
          <div className="text-[11px] text-primary-500">
            {preview.matching_rows.toLocaleString('fr-FR')} lignes correspondantes ·{' '}
            {rows.length.toLocaleString('fr-FR')} affichées sur {limit} par page
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onToggleSort}
            disabled={loading || !canSort}
            className="!rounded-full"
          >
            Tri date {sortDirection === 'desc' ? '↓' : '↑'}
          </Button>
          {activeRange?.from || activeRange?.to ? (
            <span className="text-[11px] text-primary-600">
              Filtre appliqué : {activeRange?.from ?? '…'} → {activeRange?.to ?? '…'}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={!hasPrev || loading}
          >
            Précédent
          </Button>
          <span className="text-[11px] text-primary-600">
            Page {currentPage + 1} / {totalPages} · {limit} lignes/page
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={!hasNext || loading}
          >
            Suivant
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-6">
          <Loader text="Chargement de l’aperçu…" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : !preview || rows.length === 0 ? (
        <p className="text-sm text-primary-600">Aucune ligne trouvée pour cette sélection.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-primary-200">
                {columns.map(col => (
                  <th
                    key={col}
                    className="px-2 py-2 font-semibold text-primary-800 whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-b border-primary-100 last:border-0">
                  {columns.map(col => (
                    <td key={col} className="px-2 py-1 text-primary-800 whitespace-nowrap">
                      {String((row as TableRow)[col] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import CategoryStackedChart from '@/components/charts/CategoryStackedChart'
import { Card, Loader, Button } from '@/components/ui'
import { apiFetch } from '@/services/api'
import type {
  CategorySubCategoryCount,
  DataOverviewResponse,
  DataSourceOverview,
  TableExplorePreview,
  TableRow,
} from '@/types/data'
import { HiArrowPath } from 'react-icons/hi2'

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
  const requestRef = useRef(0)
  const overviewRequestRef = useRef(0)
  const sliderRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()

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
    const requestId = overviewRequestRef.current + 1
    overviewRequestRef.current = requestId
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
      if (overviewRequestRef.current !== requestId) return
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
    } catch (err) {
      if (withLoader && overviewRequestRef.current === requestId) {
        setError(err instanceof Error ? err.message : 'Chargement impossible.')
      }
    } finally {
      if (withLoader && overviewRequestRef.current === requestId) {
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

  useEffect(() => {
    if (!pendingRange || !hasGlobalDate) return
    if (
      pendingRange.from === appliedRange?.from &&
      pendingRange.to === appliedRange?.to
    ) {
      return
    }
    const timeoutId = window.setTimeout(() => {
      setAppliedRange(pendingRange)
      setPage(0)
      void (async () => {
        await loadOverview(pendingRange, false)
        if (selection) {
          fetchPreview(selection, 0, sortDirection, pendingRange)
        }
      })()
    }, 180)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [pendingRange, hasGlobalDate, appliedRange?.from, appliedRange?.to, selection, sortDirection])

  const handleDiscussSelection = () => {
    if (!selection) return
    const params = new URLSearchParams()
    params.set('explorer_source', selection.source)
    params.set('explorer_category', selection.category)
    params.set('explorer_sub_category', selection.subCategory)
    if (appliedRange?.from) params.set('explorer_from', appliedRange.from)
    if (appliedRange?.to) params.set('explorer_to', appliedRange.to)
    if (sourceHasDate(selection.source)) {
      params.set('explorer_sort', sortDirection)
    }
    navigate(`/chat?${params.toString()}`)
  }

  const selectionHasDate = selection ? sourceHasDate(selection.source) : false
  const globalDateFilterControl =
    hasGlobalDate && minTs !== undefined && maxTs !== undefined ? (
      <div className="space-y-3 pb-4 border-b border-primary-100">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-primary-700">
            <span className="font-semibold text-primary-900">Filtre date global</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-primary-600">
            <span>
              De{' '}
              <span className="font-semibold text-primary-900">
                {formatDate(pendingRange?.from ?? globalBounds.min)}
              </span>
            </span>
            <span>
              A{' '}
              <span className="font-semibold text-primary-900">
                {formatDate(pendingRange?.to ?? globalBounds.max)}
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetRange}
              disabled={loading}
              className="!rounded-full !p-2"
              aria-label="Réinitialiser le filtre date"
              title="Réinitialiser le filtre date"
            >
              <HiArrowPath className="w-4 h-4" />
            </Button>
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
      </div>
    ) : null

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      {loading ? (
        <Card variant="elevated" className="py-12 flex justify-center">
          <Loader text="Chargement des répartitions Category / Sub Category…" />
        </Card>
      ) : error ? (
        <Card variant="elevated" className="py-6 px-4 text-sm text-danger-dark">{error}</Card>
      ) : sourcesWithCategories.length === 0 ? (
        <Card variant="elevated" className="py-10 px-4 text-center text-primary-600">
          Aucune source ne contient les colonnes « Category » et « Sub Category » avec des valeurs
          exploitables.
        </Card>
      ) : (
        <div className="space-y-4">
          {sourcesWithCategories.map((source, index) => (
            <SourceCategoryCard
              key={source.source}
              source={source}
              dateFilterContent={index === 0 ? globalDateFilterControl : null}
              onSelect={handleSelect}
              selection={selection}
              preview={preview}
              previewLoading={previewLoading}
              previewError={previewError}
              limit={PAGE_SIZE}
              page={page}
              matchingRows={matchingRows || preview?.matching_rows || 0}
              sortDirection={sortDirection}
              onPageChange={handlePageChange}
              onToggleSort={handleToggleSort}
              canSort={selectionHasDate}
              onDiscuss={handleDiscussSelection}
              canDiscuss={selectionHasDate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SourceCategoryCard({
  source,
  dateFilterContent,
  onSelect,
  selection,
  preview,
  previewLoading,
  previewError,
  limit,
  page,
  matchingRows,
  sortDirection,
  onPageChange,
  onToggleSort,
  canSort,
  onDiscuss,
  canDiscuss,
}: {
  source: DataSourceOverview
  dateFilterContent?: ReactNode
  onSelect: (source: string, category: string, subCategory: string) => void
  selection: Selection | null
  preview: TableExplorePreview | null
  previewLoading: boolean
  previewError: string
  limit: number
  page: number
  matchingRows: number
  sortDirection: 'asc' | 'desc'
  onPageChange: (nextPage: number) => void
  onToggleSort: () => void
  canSort: boolean
  onDiscuss: () => void
  canDiscuss: boolean
}) {
  const categoryNodes = useMemo(
    () => buildCategoryNodes(source.category_breakdown),
    [source.category_breakdown]
  )

  const selectionForCard = selection?.source === source.source ? selection : null
  const selectionAnimationKey = selectionForCard
    ? `${selectionForCard.category}::${selectionForCard.subCategory}`
    : 'none'

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
    if (subCategory) {
      onSelect(source.source, category, subCategory)
    }
  }

  return (
    <Card variant="elevated" padding="md" className="space-y-3">
      {dateFilterContent ? <div>{dateFilterContent}</div> : null}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-primary-950">{source.title}</h3>
          <p className="text-xs text-primary-500">
            {source.total_rows.toLocaleString('fr-FR')} lignes ·{' '}
            {categoryNodes.length.toLocaleString('fr-FR')} catégories
          </p>
        </div>
      </div>

      <CategoryStackedChart
        breakdown={source.category_breakdown ?? []}
        onSelect={handleChartSelect}
        selectedCategory={selectionForCard?.category ?? null}
        selectedSubCategory={selectionForCard?.subCategory ?? null}
        actionSlot={
          selectionForCard ? (
            <Button
              variant="primary"
              size="sm"
              onClick={onDiscuss}
              disabled={!canDiscuss || previewLoading}
              className="!rounded-full"
            >
              Discuter avec ces données
            </Button>
          ) : null
        }
        className="bg-primary-50/80"
      />

      <div key={selectionAnimationKey} className={selectionForCard ? 'animate-slide-up' : ''}>
        <SelectionPreview
          selection={selectionForCard}
          preview={selectionForCard ? preview : null}
          loading={selectionForCard ? previewLoading : false}
          error={selectionForCard ? previewError : ''}
          limit={limit}
          page={page}
          matchingRows={matchingRows}
          sortDirection={sortDirection}
          onPageChange={onPageChange}
          onToggleSort={onToggleSort}
          canSort={canSort}
          dateField={source.date_field ?? null}
        />
      </div>
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
  dateField,
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
  dateField: string | null
}) {
  if (!selection) return null

  const columns = preview?.preview_columns ?? []
  const rows = preview?.preview_rows ?? []
  const totalRows = matchingRows || preview?.matching_rows || 0
  const totalPages = totalRows ? Math.max(1, Math.ceil(totalRows / limit)) : 1
  const currentPage = Math.min(page, totalPages - 1)
  const hasPrev = currentPage > 0
  const hasNext = currentPage < totalPages - 1
  const findColumnInsensitive = (target: string) =>
    columns.find(col => col.trim().toLowerCase() === target.trim().toLowerCase()) ?? null
  const sortableDateColumn = canSort
    ? (dateField ? findColumnInsensitive(dateField) : null) ?? findColumnInsensitive('date')
    : null
  const selectionKey = `${selection.category}::${selection.subCategory}`

  return (
    <Card variant="outlined" className="space-y-3">
      <div className="flex flex-col gap-2">
        <div className="space-y-1">
          <div key={selectionKey} className="flex flex-wrap items-center gap-2 text-xs animate-fade-in">
            <span className="font-semibold text-primary-700">Sélection active</span>
            <span className="inline-flex items-center rounded-full border border-primary-200 bg-white px-2.5 py-1 font-semibold text-primary-900">
              Category: {selection.category}
            </span>
            <span className="text-primary-500">→</span>
            <span className="inline-flex items-center rounded-full border border-primary-200 bg-primary-900 px-2.5 py-1 font-semibold text-white">
              Sub Category: {selection.subCategory}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
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
      {loading && preview ? (
        <p className="text-[11px] font-medium text-primary-600 animate-fade-in">Mise à jour…</p>
      ) : null}

      {loading && !preview ? (
        <div className="py-6">
          <Loader text="Chargement de l’aperçu…" />
        </div>
      ) : error ? (
        <p className="text-sm text-danger-darker">{error}</p>
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
                    {sortableDateColumn &&
                    col.trim().toLowerCase() === sortableDateColumn.trim().toLowerCase() ? (
                      <button
                        type="button"
                        onClick={onToggleSort}
                        disabled={loading}
                        className="inline-flex items-center gap-1 hover:text-primary-700 disabled:opacity-50"
                        title="Trier par date"
                      >
                        <span>{col}</span>
                        <span className="text-[11px]">{sortDirection === 'desc' ? '↓' : '↑'}</span>
                      </button>
                    ) : (
                      col
                    )}
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

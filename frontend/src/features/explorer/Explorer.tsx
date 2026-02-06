import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { Card, Loader, Button } from '@/components/ui'
import { apiFetch } from '@/services/api'
import { getAuth } from '@/services/auth'
import type {
  DataOverviewResponse,
  DataSourceOverview,
  FieldBreakdown,
  HiddenFieldsResponse,
  ColumnRolesResponse,
  ValueCount,
  TableExplorePreview,
} from '@/types/data'
import CategoryStackedChart from '@/components/charts/CategoryStackedChart'
import {
  HiChartBar,
  HiOutlineGlobeAlt,
  HiOutlineSquares2X2,
  HiAdjustmentsHorizontal,
  HiEye,
  HiEyeSlash,
  HiChevronDown,
} from 'react-icons/hi2'

type HiddenFieldsState = Record<string, string[]>
type ColumnRoleSelection = {
  date_field: string | null
  category_field: string | null
  sub_category_field: string | null
}
type ColumnRolesState = Record<string, ColumnRoleSelection>

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend)

const CHART_COLORS = ['#2563eb', '#0ea5e9', '#14b8a6', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#f97316']
const LINE_COLOR = '#2563eb'
const LINE_FILL = 'rgba(37,99,235,0.15)'

function pickColor(index: number): string {
  const paletteSize = CHART_COLORS.length
  if (paletteSize === 0) return '#2563eb'
  return CHART_COLORS[index % paletteSize]
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0'
  return value.toLocaleString('fr-FR')
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('fr-FR')
}

export default function Explorer() {
  const [overview, setOverview] = useState<DataOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updateError, setUpdateError] = useState('')
  const [hiddenFields, setHiddenFields] = useState<HiddenFieldsState>({})
  const [columnRoles, setColumnRoles] = useState<ColumnRolesState>({})
  const [savingSources, setSavingSources] = useState<Set<string>>(() => new Set())
  const auth = getAuth()
  const isAdmin = Boolean(auth?.isAdmin)

  const fetchOverview = useCallback(
    async (withLoader = true) => {
      if (withLoader) {
        setLoading(true)
        setError('')
      }
      setUpdateError('')
      try {
        const res = await apiFetch<DataOverviewResponse>(
          '/data/overview?include_disabled=true&lazy_disabled=true&headers_only=true'
        )
        setOverview(res ?? { generated_at: '', sources: [] })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Chargement impossible.'
        if (withLoader) {
          setError(message)
        } else {
          setUpdateError(message)
        }
      } finally {
        if (withLoader) {
          setLoading(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    void fetchOverview()
  }, [fetchOverview])

  useEffect(() => {
    if (!overview || !isAdmin) {
      setHiddenFields({})
      return
    }
    const next: HiddenFieldsState = {}
    overview.sources.forEach(src => {
      const hidden = (src.fields ?? []).filter(field => field.hidden).map(field => field.field)
      if (hidden.length) {
        next[src.source] = hidden
      }
    })
    setHiddenFields(next)
  }, [overview, isAdmin])

  useEffect(() => {
    if (!overview) {
      setColumnRoles({})
      return
    }
    const next: ColumnRolesState = {}
    overview.sources.forEach(src => {
      next[src.source] = {
        date_field: src.date_field ?? null,
        category_field: src.category_field ?? null,
        sub_category_field: src.sub_category_field ?? null,
      }
    })
    setColumnRoles(next)
  }, [overview])

  const sources = overview?.sources ?? []

  const totalRecords = useMemo(
    () => sources.reduce((acc, src) => acc + (src.total_rows ?? 0), 0),
    [sources]
  )

  const totalFields = useMemo(
    () =>
      sources.reduce((acc, src) => {
        const count = isAdmin ? src.field_count ?? src.fields?.length ?? 0 : src.fields?.length ?? 0
        return acc + count
      }, 0),
    [sources, isAdmin]
  )

  const persistHiddenFields = async (source: string, nextHidden: string[]) => {
    if (!isAdmin) return
    setUpdateError('')
    setSavingSources(prev => {
      const next = new Set(prev)
      next.add(source)
      return next
    })
    const uniqueHidden = Array.from(new Set(nextHidden))
    try {
      const response = await apiFetch<HiddenFieldsResponse>(
        `/data/overview/${encodeURIComponent(source)}/hidden-fields`,
        {
          method: 'PUT',
          body: JSON.stringify({ hidden_fields: uniqueHidden }),
        }
      )
      const persisted = response?.hidden_fields ?? uniqueHidden
      setHiddenFields(prev => {
        const next = { ...prev }
        if (persisted.length === 0) {
          delete next[source]
        } else {
          next[source] = persisted
        }
        return next
      })
      setOverview(prev => {
        if (!prev) return prev
        return {
          ...prev,
          sources: prev.sources.map(item =>
            item.source === source
              ? {
                  ...item,
                  fields: (item.fields ?? []).map(field => ({
                    ...field,
                    hidden: persisted.includes(field.field),
                  })),
                }
              : item
          ),
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Mise à jour impossible'
      setUpdateError(message)
    } finally {
      setSavingSources(prev => {
        const next = new Set(prev)
        next.delete(source)
        return next
      })
    }
  }

  const persistColumnRoles = async (source: string, roles: ColumnRoleSelection) => {
    if (!isAdmin) return
    setUpdateError('')
    setSavingSources(prev => {
      const next = new Set(prev)
      next.add(source)
      return next
    })

    const payload: ColumnRoleSelection = {
      date_field: roles.date_field ?? null,
      category_field: roles.category_field ?? null,
      sub_category_field: roles.sub_category_field ?? null,
    }

    try {
      const response = await apiFetch<ColumnRolesResponse>(
        `/data/overview/${encodeURIComponent(source)}/column-roles`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        }
      )
      const updated = response ?? payload
      setColumnRoles(prev => ({
        ...prev,
        [source]: {
          date_field: updated.date_field ?? null,
          category_field: updated.category_field ?? null,
          sub_category_field: updated.sub_category_field ?? null,
        },
      }))
      await fetchOverview(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Mise à jour impossible'
      setUpdateError(message)
    } finally {
      setSavingSources(prev => {
        const next = new Set(prev)
        next.delete(source)
        return next
      })
    }
  }

  const toggleFieldVisibility = (source: string, field: string, visible: boolean) => {
    if (!isAdmin) return
    const current = new Set(hiddenFields[source] ?? [])
    if (visible) {
      current.delete(field)
    } else {
      current.add(field)
    }
    void persistHiddenFields(source, Array.from(current))
  }

  const showAllFields = (source: string) => {
    if (!isAdmin) return
    void persistHiddenFields(source, [])
  }

  const hideAllFields = (source: string, fields: FieldBreakdown[]) => {
    if (!isAdmin) return
    void persistHiddenFields(
      source,
      fields.map(field => field.field)
    )
  }

  return (
    <div className="max-w-7xl mx-auto animate-fade-in space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold text-primary-950">Explorer</h2>
          <p className="text-primary-600 max-w-3xl">
            Vision transverse des sources avec découverte automatique des colonnes. Masquez les
            champs inutiles pour focaliser l’analyse sur ce qui compte.
          </p>
        </div>
        {overview?.generated_at ? (
          <div className="text-xs text-primary-500">
            Mis à jour : <span className="font-semibold text-primary-700">{formatDate(overview.generated_at)}</span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard
          icon={<HiOutlineGlobeAlt className="w-5 h-5" />}
          title="Sources couvertes"
          value={formatNumber(sources.length)}
          subtitle="Tables autorisées pour votre compte"
        />
        <SummaryCard
          icon={<HiChartBar className="w-5 h-5" />}
          title="Données totales"
          value={formatNumber(totalRecords)}
          subtitle="Lignes agrégées toutes sources"
        />
        <SummaryCard
          icon={<HiOutlineSquares2X2 className="w-5 h-5" />}
          title="Colonnes détectées"
          value={formatNumber(totalFields)}
          subtitle="Découverte automatique par table"
        />
      </div>

      {updateError ? (
        <Card variant="elevated" className="py-3 px-4 text-sm text-red-700 border border-red-100 bg-red-50">
          {updateError}
        </Card>
      ) : null}

      {loading ? (
        <Card variant="elevated" className="py-12 flex justify-center">
          <Loader text="Chargement de l’explorateur…" />
        </Card>
      ) : error ? (
        <Card variant="elevated" className="py-6 px-4 text-sm text-red-600">
          {error}
        </Card>
      ) : sources.length === 0 ? (
        <Card variant="elevated" className="py-10 px-4 text-center text-primary-600">
          Aucune source disponible avec vos droits actuels.
        </Card>
      ) : (
        <div className="space-y-4">
          {sources.map(source => (
            <SourceCard
              key={source.source}
              source={source}
              isAdmin={isAdmin}
              isSaving={savingSources.has(source.source)}
              hiddenFields={hiddenFields[source.source] ?? []}
              columnRoles={columnRoles[source.source] ?? {
                date_field: source.date_field ?? null,
                category_field: source.category_field ?? null,
                sub_category_field: source.sub_category_field ?? null,
              }}
              onUpdateRoles={roles => persistColumnRoles(source.source, roles)}
              onToggleField={(field, visible) => toggleFieldVisibility(source.source, field, visible)}
              onHideAll={() => hideAllFields(source.source, source.fields ?? [])}
              onShowAll={() => showAllFields(source.source)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryCard({
  icon,
  title,
  value,
  subtitle,
}: {
  icon: ReactNode
  title: string
  value: string
  subtitle: string
}) {
  return (
    <Card variant="elevated" className="flex items-center gap-3">
      <div className="p-3 bg-primary-950 rounded-md text-white flex items-center justify-center">
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-500">{title}</p>
        <p className="text-2xl font-bold text-primary-950 mt-1">{value}</p>
        <p className="text-xs text-primary-500 mt-1">{subtitle}</p>
      </div>
    </Card>
  )
}

function SourceCard({
  source,
  hiddenFields,
  columnRoles,
  isAdmin,
  isSaving,
  onUpdateRoles,
  onToggleField,
  onHideAll,
  onShowAll,
}: {
  source: DataSourceOverview
  hiddenFields: string[]
  columnRoles: ColumnRoleSelection
  isAdmin: boolean
  isSaving: boolean
  onUpdateRoles: (roles: ColumnRoleSelection) => void
  onToggleField: (field: string, visible: boolean) => void
  onHideAll: () => void
  onShowAll: () => void
}) {
  const hiddenSet = useMemo(() => new Set(hiddenFields), [hiddenFields])
  const visibleFields = source.fields?.filter(field => !hiddenSet.has(field.field)) ?? []
  const totalFieldCount = source.field_count ?? source.fields.length
  const displayedTotal = isAdmin ? totalFieldCount : visibleFields.length
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState<{ category: string; subCategory: string } | null>(null)
  const [preview, setPreview] = useState<TableExplorePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [rolesDraft, setRolesDraft] = useState<ColumnRoleSelection>(columnRoles)
  const [rolesError, setRolesError] = useState('')

  const hasCategoryChart =
    Array.isArray(source.category_breakdown) && (source.category_breakdown?.length ?? 0) > 0

  const handleSelectCategory = (category: string, subCategory?: string) => {
    if (!subCategory) return
    setSelection({ category, subCategory })
    setPreview(null)
    setPreviewError('')
    setPreviewLoading(true)

    void (async () => {
      try {
        const res = await apiFetch<TableExplorePreview>(
          `/data/explore/${encodeURIComponent(source.source)}?category=${encodeURIComponent(
            category
          )}&sub_category=${encodeURIComponent(subCategory)}&limit=50`
        )
        setPreview(res ?? null)
      } catch (err) {
        setPreviewError(
          err instanceof Error ? err.message : "Impossible de charger les données pour cette sélection."
        )
      } finally {
        setPreviewLoading(false)
      }
    })()
  }

  useEffect(() => {
    setRolesDraft(columnRoles)
  }, [columnRoles])

  const handleSaveRoles = () => {
    if ((rolesDraft.category_field && !rolesDraft.sub_category_field) || (rolesDraft.sub_category_field && !rolesDraft.category_field)) {
      setRolesError('Choisissez une catégorie ET une sous-catégorie ou aucune des deux.')
      return
    }
    setRolesError('')
    onUpdateRoles(rolesDraft)
  }

  return (
    <Card variant="elevated" padding="none" className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        aria-controls={`source-${source.source}`}
        className="w-full px-5 py-4 flex flex-col gap-2 text-left bg-primary-50/60 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 transition-colors"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-primary-500">{source.source}</p>
            <h3 className="text-xl font-semibold text-primary-950">{source.title}</h3>
            <p className="text-xs text-primary-500">
              {isAdmin
                ? `${visibleFields.length} / ${displayedTotal} colonnes affichées`
                : `${visibleFields.length} colonnes affichées`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-primary-500">Total données</p>
            <p className="text-2xl font-bold text-primary-950">{formatNumber(source.total_rows)}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-primary-600">
            {open ? 'Masquer les détails' : 'Déplier pour voir les colonnes et statistiques'}
          </p>
          <span className="flex items-center gap-2 rounded-full border border-primary-200 bg-white px-3 py-1 text-primary-800">
            <span className="text-[11px] font-semibold uppercase tracking-wide">Détails</span>
            <HiChevronDown
              className={`w-5 h-5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            />
          </span>
        </div>
      </button>

      {open ? (
        <div
          id={`source-${source.source}`}
          className="px-5 pb-5 pt-4 space-y-4 border-t border-primary-100 bg-white"
        >
          {isAdmin ? (
            <ColumnRolesSelector
              fields={source.fields ?? []}
              value={rolesDraft}
              onChange={next => {
                setRolesError('')
                setRolesDraft(next)
              }}
              onSave={handleSaveRoles}
              disabled={isSaving}
              error={rolesError}
            />
          ) : null}

          {hasCategoryChart ? (
            <div className="space-y-3">
              <CategoryStackedChart
                breakdown={source.category_breakdown ?? []}
                onSelect={handleSelectCategory}
              />
              {selection ? (
                <CategorySelectionPreview
                  selection={selection}
                  preview={preview}
                  loading={previewLoading}
                  error={previewError}
                  totalRows={source.total_rows ?? 0}
                />
              ) : null}
            </div>
          ) : null}

          {isAdmin ? (
            <FieldVisibilitySelector
              fields={source.fields}
              hiddenSet={hiddenSet}
              onToggle={onToggleField}
              onHideAll={onHideAll}
              onShowAll={onShowAll}
              disabled={isSaving}
            />
          ) : null}

          {visibleFields.length === 0 ? (
            <Card padding="sm" className="bg-primary-50">
              <p className="text-sm font-semibold text-primary-800 mb-1">Aucune colonne affichée</p>
              <p className="text-xs text-primary-500">
                Sélectionnez au moins un champ pour voir les statistiques.
              </p>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {visibleFields.map(field => (
                <FieldSection key={field.field} field={field} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Card>
  )
}

function CategorySelectionPreview({
  selection,
  preview,
  loading,
  error,
  totalRows,
}: {
  selection: { category: string; subCategory: string }
  preview: TableExplorePreview | null
  loading: boolean
  error: string
  totalRows: number
}) {
  return (
    <Card padding="sm" className="bg-primary-50/80">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-2">
        <div className="text-xs text-primary-600">
          Sélection&nbsp;:
          <span className="ml-1 font-semibold text-primary-900">
            {selection.category} / {selection.subCategory}
          </span>
        </div>
        {preview ? (
          <div className="text-[11px] text-primary-500">
            {preview.matching_rows.toLocaleString('fr-FR')} lignes correspondantes
            {totalRows ? ` sur ${totalRows.toLocaleString('fr-FR')} au total` : ''}
            {preview.preview_rows.length !== preview.matching_rows
              ? ` (aperçu de ${preview.preview_rows.length.toLocaleString('fr-FR')})`
              : ''}
          </div>
        ) : null}
      </div>

      {loading ? (
        <p className="text-[11px] text-primary-500">Chargement des lignes…</p>
      ) : error ? (
        <p className="text-[11px] text-red-600">{error}</p>
      ) : preview && preview.preview_rows.length > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-[11px] text-left">
            <thead>
              <tr className="border-b border-primary-200">
                {preview.preview_columns.map(col => (
                  <th key={col} className="px-2 py-1 font-semibold text-primary-700 whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.preview_rows.map((row, idx) => (
                <tr key={idx} className="border-b border-primary-100 last:border-0">
                  {preview.preview_columns.map(col => (
                    <td key={col} className="px-2 py-1 text-primary-800 whitespace-nowrap">
                      {String((row as Record<string, unknown>)[col] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[11px] text-primary-500">Aucune ligne trouvée pour cette sélection.</p>
      )}
    </Card>
  )
}

function ColumnRolesSelector({
  fields,
  value,
  onChange,
  onSave,
  disabled,
  error,
}: {
  fields: FieldBreakdown[]
  value: ColumnRoleSelection
  onChange: (roles: ColumnRoleSelection) => void
  onSave: () => void
  disabled: boolean
  error?: string
}) {
  const fieldNames = useMemo(() => fields.map(field => field.field), [fields])

  const handleChange = (key: keyof ColumnRoleSelection, nextValue: string) => {
    onChange({
      ...value,
      [key]: nextValue ? nextValue : null,
    })
  }

  const renderSelect = (label: string, key: keyof ColumnRoleSelection) => (
    <label className="flex flex-col gap-1 text-xs text-primary-700">
      <span className="font-semibold text-primary-800">{label}</span>
      <select
        className="h-9 rounded-md border border-primary-200 bg-white px-2 text-primary-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
        value={value[key] ?? ''}
        onChange={e => handleChange(key, e.target.value)}
        disabled={disabled}
      >
        <option value="">Aucune</option>
        {fieldNames.map(name => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="border border-primary-100 rounded-lg bg-primary-50/60 p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-primary-800">Colonnes clés</p>
          <p className="text-xs text-primary-500">Sélectionnez les colonnes Date / Category / Sub Category.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onSave} disabled={disabled}>
          Enregistrer
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {renderSelect('Colonne date', 'date_field')}
        {renderSelect('Category', 'category_field')}
        {renderSelect('Sub Category', 'sub_category_field')}
      </div>
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
    </div>
  )
}

function FieldVisibilitySelector({
  fields,
  hiddenSet,
  onToggle,
  onHideAll,
  onShowAll,
  disabled,
}: {
  fields: FieldBreakdown[]
  hiddenSet: Set<string>
  onToggle: (field: string, visible: boolean) => void
  onHideAll: () => void
  onShowAll: () => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const visibleCount = Math.max(0, fields.length - hiddenSet.size)

  return (
    <div className="border border-primary-100 rounded-lg bg-primary-50/60 p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-primary-800">Gestion des colonnes</p>
          <p className="text-xs text-primary-500">
            {visibleCount} / {fields.length} affichées
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="flex items-center gap-2"
          onClick={() => setOpen(prev => !prev)}
          disabled={disabled}
        >
          <HiAdjustmentsHorizontal className="w-4 h-4" />
          {open ? 'Fermer' : 'Choisir'}
        </Button>
      </div>

      {open && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-48 overflow-y-auto pr-1">
            {fields.map(field => {
              const isVisible = !hiddenSet.has(field.field)
              return (
                <label
                  key={field.field}
                  className="flex items-center gap-2 text-xs text-primary-700 border border-primary-100 rounded-md bg-white px-2 py-1.5"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-primary-300 text-primary-950 focus:ring-primary-600"
                    checked={isVisible}
                    onChange={e => onToggle(field.field, e.target.checked)}
                    disabled={disabled}
                  />
                  <span className="truncate" title={field.label}>
                    {field.label}
                  </span>
                  <span className="text-[10px] text-primary-500">({formatNumber(field.unique_values)} valeurs)</span>
                </label>
              )
            })}
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="xs"
              className="flex items-center gap-1"
              onClick={onHideAll}
              disabled={disabled}
            >
              <HiEyeSlash className="w-4 h-4" />
              Tout masquer
            </Button>
            <Button
              variant="secondary"
              size="xs"
              className="flex items-center gap-1"
              onClick={onShowAll}
              disabled={disabled}
            >
              <HiEye className="w-4 h-4" />
              Tout afficher
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function FieldSection({ field }: { field: FieldBreakdown }) {
  const counts = field.counts ?? []
  if (!counts || counts.length === 0) {
    return (
      <Card padding="sm" className="h-full bg-primary-50">
        <p className="text-sm font-semibold text-primary-800 mb-1">{field.label}</p>
        <p className="text-xs text-primary-500">
          Aucune valeur renseignée ({field.missing_values} ligne(s) manquante(s)).
        </p>
      </Card>
    )
  }

  const limit = field.kind === 'date' ? 18 : 10
  const slice = field.kind === 'date' ? counts.slice(-limit) : counts.slice(0, limit)
  const hasMore = field.truncated || counts.length > slice.length

  return (
    <Card padding="sm" className="h-full">
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="flex-1">
          <p className="text-sm font-semibold text-primary-800">{field.label}</p>
          <p className="text-[11px] text-primary-500">Champ : {field.field}</p>
        </div>
        <span className="text-[11px] text-primary-500">
          {formatNumber(field.unique_values)} valeurs uniques
        </span>
      </div>

      <div className="text-[11px] text-primary-500 mb-2">
        {field.kind === 'date' ? 'Chronologie par date détectée' : 'Répartition des occurrences'}
      </div>

      {field.kind === 'date' ? <DateTimeline counts={slice} /> : <BarList counts={slice} />}

      {hasMore ? (
        <p className="text-[11px] text-primary-500 mt-2">
          Affichage limité à {slice.length} valeurs (top / dernières selon le type).
        </p>
      ) : null}
    </Card>
  )
}

function DateTimeline({ counts }: { counts: ValueCount[] }) {
  const chartData = useMemo<ChartData<'line'>>(
    () => ({
      labels: counts.map(item => item.label),
      datasets: [
        {
          label: 'Occurrences',
          data: counts.map(item => item.count),
          borderColor: LINE_COLOR,
          backgroundColor: LINE_FILL,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 4,
          pointBackgroundColor: LINE_COLOR,
          tension: 0.25,
          fill: true,
        },
      ],
    }),
    [counts]
  )

  const options = useMemo<ChartOptions<'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: context => {
              const value = typeof context.raw === 'number' ? context.raw : Number(context.raw ?? 0)
              return `${value.toLocaleString('fr-FR')} enregistrements`
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#52525b', maxRotation: 45, minRotation: 45 },
        },
        y: {
          beginAtZero: true,
          grid: { color: '#e5e7eb' },
          ticks: {
            color: '#52525b',
            callback: value => Number(value).toLocaleString('fr-FR'),
          },
        },
      },
    }),
    []
  )

  return (
    <div className="h-48">
      <Line data={chartData} options={options} />
    </div>
  )
}

function BarList({ counts }: { counts: ValueCount[] }) {
  const chartData = useMemo<ChartData<'bar'>>(
    () => ({
      labels: counts.map(item => item.label),
      datasets: [
        {
          label: 'Occurrences',
          data: counts.map(item => item.count),
          backgroundColor: counts.map((_, index) => pickColor(index)),
          borderColor: counts.map((_, index) => pickColor(index)),
          borderRadius: 8,
          barThickness: 18,
          maxBarThickness: 24,
        },
      ],
    }),
    [counts]
  )

  const options = useMemo<ChartOptions<'bar'>>(
    () => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: context => {
              const value = typeof context.raw === 'number' ? context.raw : Number(context.raw ?? 0)
              return `${value.toLocaleString('fr-FR')} enregistrements`
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: '#e5e7eb' },
          ticks: {
            color: '#52525b',
            callback: value => Number(value).toLocaleString('fr-FR'),
          },
        },
        y: {
          grid: { display: false },
          ticks: {
            color: '#52525b',
            autoSkip: false,
          },
        },
      },
      layout: { padding: { top: 4, right: 8, bottom: 4, left: 0 } },
    }),
    []
  )

  const dynamicHeight = Math.max(140, counts.length * 28)

  return (
    <div style={{ height: `${dynamicHeight}px` }}>
      <Bar data={chartData} options={options} />
    </div>
  )
}

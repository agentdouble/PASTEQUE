import { useState, useEffect, useCallback, useRef, FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '@/services/api'
import { getAuth } from '@/services/auth'
import { Button, Input, Card, Loader } from '@/components/ui'
import type {
  CreateUserRequest,
  CreateUserResponse,
  UpdateUserPermissionsRequest,
  UserPermissionsOverviewResponse,
  UserWithPermissionsResponse,
  AdminResetPasswordResponse,
  AdminUsageStatsResponse,
} from '@/types/user'
import type { LoopConfig, LoopOverview, LoopConfigPayload, LoopTableOverview } from '@/types/loop'
import type { DataOverviewResponse, ColumnRolesResponse, ExplorerEnabledResponse } from '@/types/data'
import type { TicketContextConfig } from '@/types/tickets'
import { HiCheckCircle, HiXCircle, HiArrowPath } from 'react-icons/hi2'
import DictionaryManager from './DictionaryManager'
import FeedbackAdmin from './FeedbackAdmin'
import PromptsManager from './PromptsManager'

interface Status {
  type: 'success' | 'error'
  message: string
}

type TableInfo = { name: string; path: string }
type ColumnInfo = { name: string; dtype?: string | null }
type ColumnRoleSelection = {
  date_field: string | null
  category_field: string | null
  sub_category_field: string | null
}
type TicketDraft = {
  textColumn: string
  titleColumn: string
  dateColumn: string
  contextFields: string[]
}

type FeaturePermissionKey = 'can_use_sql_agent' | 'can_generate_chart' | 'can_view_graph'

const FEATURE_PERMISSIONS: { key: FeaturePermissionKey; label: string; title: string }[] = [
  { key: 'can_use_sql_agent', label: 'Agent SQL', title: 'Accès à l’agent SQL' },
  { key: 'can_generate_chart', label: 'Graphiques', title: 'Accès à la génération de graphiques' },
  { key: 'can_view_graph', label: 'Onglet Graph', title: 'Accès à l’onglet Graph' },
]

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0'
  return value.toLocaleString('fr-FR')
}

function formatActivity(value: string | null): string {
  if (!value) return 'Jamais'
  return formatDate(value)
}

type TabKey = 'stats' | 'dictionary' | 'prompts' | 'explorer' | 'radar' | 'chat' | 'users' | 'feedback'

const DEFAULT_TAB: TabKey = 'stats'
const TAB_KEYS = new Set<TabKey>([
  'stats',
  'dictionary',
  'prompts',
  'explorer',
  'radar',
  'chat',
  'users',
  'feedback',
])
const TAB_ITEMS: { key: TabKey; label: string }[] = [
  { key: 'stats', label: 'Statistiques' },
  { key: 'dictionary', label: 'Dictionnaire' },
  { key: 'prompts', label: 'Prompts' },
  { key: 'explorer', label: 'Explorer' },
  { key: 'radar', label: 'Radar' },
  { key: 'chat', label: 'Chat' },
  { key: 'users', label: 'Utilisateurs' },
  { key: 'feedback', label: 'Feedback' },
]

function getValidTab(value: string | null): TabKey | null {
  if (!value) return null
  return TAB_KEYS.has(value as TabKey) ? (value as TabKey) : null
}

export default function AdminPanel() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<TabKey>(() => getValidTab(tabParam) ?? DEFAULT_TAB)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const [loadingUser, setLoadingUser] = useState(false)
  const [overview, setOverview] = useState<UserPermissionsOverviewResponse | null>(null)
  const [permissionsLoading, setPermissionsLoading] = useState(true)
  const [permissionsError, setPermissionsError] = useState('')
  const [stats, setStats] = useState<AdminUsageStatsResponse | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState('')
  const [updatingUsers, setUpdatingUsers] = useState<Set<string>>(() => new Set())
  const [loopItems, setLoopItems] = useState<LoopTableOverview[]>([])
  const [loopTables, setLoopTables] = useState<TableInfo[]>([])
  const [loopColumns, setLoopColumns] = useState<ColumnInfo[]>([])
  const [selectedTable, setSelectedTable] = useState('')
  const [selectedTextColumn, setSelectedTextColumn] = useState('')
  const [selectedDateColumn, setSelectedDateColumn] = useState('')
  const [loopStatus, setLoopStatus] = useState<Status | null>(null)
  const [loopError, setLoopError] = useState('')
  const [loopLoading, setLoopLoading] = useState(true)
  const [loopSaving, setLoopSaving] = useState(false)
  const [loopRegenerating, setLoopRegenerating] = useState<string | null>(null)
  const [loopDeleting, setLoopDeleting] = useState<number | null>(null)
  const [ticketTable, setTicketTable] = useState('')
  const [ticketTextColumn, setTicketTextColumn] = useState('')
  const [ticketTitleColumn, setTicketTitleColumn] = useState('')
  const [ticketDateColumn, setTicketDateColumn] = useState('')
  const [ticketColumns, setTicketColumns] = useState<ColumnInfo[]>([])
  const [ticketStatus, setTicketStatus] = useState<Status | null>(null)
  const [ticketError, setTicketError] = useState('')
  const [ticketSaving, setTicketSaving] = useState(false)
  const [ticketRoles, setTicketRoles] = useState<ColumnRolesResponse | null>(null)
  const [ticketContextFields, setTicketContextFields] = useState<string[]>([])
  const [ticketConfigLoaded, setTicketConfigLoaded] = useState(false)
  const [ticketDrafts, setTicketDrafts] = useState<Record<string, TicketDraft>>({})
  const ticketTableRef = useRef('')
  const ticketConfigRequestRef = useRef(0)
  const [explorerData, setExplorerData] = useState<DataOverviewResponse | null>(null)
  const [explorerLoading, setExplorerLoading] = useState(false)
  const [explorerError, setExplorerError] = useState('')
  const [explorerSaving, setExplorerSaving] = useState<Set<string>>(() => new Set())
  const [explorerToggling, setExplorerToggling] = useState<Set<string>>(() => new Set())
  const [explorerRoles, setExplorerRoles] = useState<Record<string, ColumnRoleSelection>>({})
  const [explorerRoleErrors, setExplorerRoleErrors] = useState<Record<string, string>>({})
  const auth = getAuth()
  const adminUsername = auth?.username ?? ''

  useEffect(() => {
    const tabFromUrl = getValidTab(tabParam)
    if (tabFromUrl && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl)
      return
    }
    if (!tabFromUrl && activeTab !== DEFAULT_TAB) {
      setActiveTab(DEFAULT_TAB)
    }
  }, [tabParam, activeTab])

  const handleTabChange = useCallback(
    (nextTab: TabKey) => {
      if (nextTab === activeTab) return
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set('tab', nextTab)
      setActiveTab(nextTab)
      setSearchParams(nextParams, { replace: true })
    },
    [activeTab, searchParams, setSearchParams]
  )

  const loadPermissions = useCallback(async () => {
    setPermissionsLoading(true)
    setPermissionsError('')
    try {
      const response = await apiFetch<UserPermissionsOverviewResponse>('/auth/users')
      setOverview(response ?? { tables: [], users: [] })
    } catch (err) {
      setPermissionsError(
        err instanceof Error ? err.message : 'Chargement des droits impossible.'
      )
    } finally {
      setPermissionsLoading(false)
    }
  }, [])

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    setStatsError('')
    try {
      const response = await apiFetch<AdminUsageStatsResponse>('/admin/stats')
      setStats(response ?? null)
    } catch (err) {
      setStatsError(
        err instanceof Error ? err.message : 'Chargement des statistiques impossible.'
      )
    } finally {
      setStatsLoading(false)
    }
  }, [])

  const loadTables = useCallback(async () => {
    try {
      const response = await apiFetch<TableInfo[]>('/data/tables')
      setLoopTables(response ?? [])
    } catch (err) {
      setLoopError(err instanceof Error ? err.message : 'Chargement des tables impossible.')
    }
  }, [])

  const loadColumns = useCallback(async (tableName: string) => {
    if (!tableName) {
      setLoopColumns([])
      return
    }
    try {
      const response = await apiFetch<ColumnInfo[]>(`/data/schema/${encodeURIComponent(tableName)}`)
      setLoopColumns(response ?? [])
    } catch (err) {
      setLoopError(err instanceof Error ? err.message : 'Chargement des colonnes impossible.')
    }
  }, [])

  const loadTicketConfig = useCallback(
    async (
      tableName: string,
      opts?: { textColumn?: string; titleColumn?: string; dateColumn?: string; draft?: TicketDraft }
    ) => {
      const requestId = ++ticketConfigRequestRef.current
      if (!tableName) {
        setTicketColumns([])
        setTicketRoles(null)
        setTicketTextColumn('')
        setTicketTitleColumn('')
        setTicketDateColumn('')
        setTicketContextFields([])
        return
      }
      setTicketError('')
      setTicketStatus(null)
      try {
        const [colsResponse, overview] = await Promise.all([
          apiFetch<ColumnInfo[]>(`/data/schema/${encodeURIComponent(tableName)}`),
          apiFetch<DataOverviewResponse>('/data/overview?include_disabled=true&lightweight=true'),
        ])
        if (
          requestId !== ticketConfigRequestRef.current ||
          ticketTableRef.current !== tableName
        ) {
          return
        }
        setTicketColumns(colsResponse ?? [])
        const match = overview?.sources?.find(src => src.source === tableName)
        const columnLookup = new Set((colsResponse ?? []).map(col => col.name.toLowerCase()))
        const roles: ColumnRolesResponse = {
          source: tableName,
          date_field: match?.date_field ?? null,
          category_field: match?.category_field ?? null,
          sub_category_field: match?.sub_category_field ?? null,
          ticket_context_fields: match?.ticket_context_fields ?? [],
        }
        setTicketRoles(roles)
        const draft = opts?.draft
        const hasDraft = Boolean(draft)
        const textFromDraft =
          draft?.textColumn && columnLookup.has(draft.textColumn.toLowerCase())
            ? draft.textColumn
            : ''
        const titleFromDraft =
          draft?.titleColumn && columnLookup.has(draft.titleColumn.toLowerCase())
            ? draft.titleColumn
            : ''
        const dateFromDraft =
          draft?.dateColumn && columnLookup.has(draft.dateColumn.toLowerCase())
            ? draft.dateColumn
            : ''
        const contextFromDraft = (draft?.contextFields ?? []).filter(name =>
          columnLookup.has(name.toLowerCase())
        )
        const textFromConfig =
          opts?.textColumn && columnLookup.has(opts.textColumn.toLowerCase()) ? opts.textColumn : ''
        const titleFromConfig =
          opts?.titleColumn && columnLookup.has(opts.titleColumn.toLowerCase()) ? opts.titleColumn : ''
        const dateFromConfig =
          opts?.dateColumn && columnLookup.has(opts.dateColumn.toLowerCase()) ? opts.dateColumn : ''
        const contextFields = (roles.ticket_context_fields ?? []).filter(name =>
          columnLookup.has(name.toLowerCase())
        )
        setTicketTextColumn(hasDraft ? textFromDraft : textFromConfig)
        setTicketTitleColumn(hasDraft ? titleFromDraft : titleFromConfig)
        setTicketDateColumn(hasDraft ? dateFromDraft : dateFromConfig || roles.date_field || '')
        setTicketContextFields(hasDraft ? contextFromDraft : contextFields)
      } catch (err) {
        if (
          requestId !== ticketConfigRequestRef.current ||
          ticketTableRef.current !== tableName
        ) {
          return
        }
        setTicketColumns([])
        setTicketRoles(null)
        setTicketTextColumn('')
        setTicketTitleColumn('')
        setTicketDateColumn('')
        setTicketContextFields([])
        setTicketError(err instanceof Error ? err.message : 'Chargement impossible.')
      }
    },
    []
  )

  const loadTicketContextConfig = useCallback(async () => {
    setTicketError('')
    setTicketStatus(null)
    try {
      const config = await apiFetch<TicketContextConfig>('/tickets/context/config')
      if (!config?.table_name) {
        setTicketError('Configuration chat introuvable.')
        return
      }
      ticketTableRef.current = config.table_name
      setTicketTable(config.table_name)
      await loadTicketConfig(config.table_name, {
        textColumn: config.text_column,
        titleColumn: config.title_column,
        dateColumn: config.date_column,
      })
    } catch (err) {
      setTicketError(err instanceof Error ? err.message : 'Configuration chat introuvable.')
      setTicketTable('')
      setTicketTextColumn('')
      setTicketTitleColumn('')
      setTicketDateColumn('')
      setTicketContextFields([])
      setTicketRoles(null)
    }
  }, [loadTicketConfig])

  const loadExplorerOverview = useCallback(
    async (withLoader = true) => {
      if (withLoader) {
        setExplorerLoading(true)
      }
      setExplorerError('')
      try {
        const response = await apiFetch<DataOverviewResponse>(
          '/data/overview?include_disabled=true&lazy_disabled=true&lightweight=true'
        )
        const data = response ?? { generated_at: '', sources: [] }
        setExplorerData(data)
        const nextRoles: Record<string, ColumnRoleSelection> = {}
        data.sources.forEach(src => {
          nextRoles[src.source] = {
            date_field: src.date_field ?? null,
            category_field: src.category_field ?? null,
            sub_category_field: src.sub_category_field ?? null,
          }
        })
        setExplorerRoles(nextRoles)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Chargement impossible.'
        setExplorerError(message)
      } finally {
        setExplorerLoading(false)
      }
    },
    []
  )

  const loadLoopOverview = useCallback(async (withLoader = true) => {
    if (withLoader) {
      setLoopLoading(true)
    }
    setLoopError('')
    try {
      const response = await apiFetch<LoopOverview>('/loop/overview')
      setLoopItems(response?.items ?? [])
    } catch (err) {
      setLoopError(err instanceof Error ? err.message : 'Chargement Radar impossible.')
    } finally {
      if (withLoader) {
        setLoopLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void loadPermissions()
    void loadStats()
    void loadTables()
    void loadLoopOverview()
  }, [loadPermissions, loadStats, loadTables, loadLoopOverview])

  useEffect(() => {
    if (activeTab === 'explorer' && !explorerData && !explorerLoading) {
      void loadExplorerOverview()
    }
  }, [activeTab, explorerData, explorerLoading, loadExplorerOverview])

  useEffect(() => {
    if (!selectedTable && loopItems.length > 0) {
      const config = loopItems[0].config
      setSelectedTable(config.table_name)
      setSelectedTextColumn(config.text_column)
      setSelectedDateColumn(config.date_column)
      void loadColumns(config.table_name)
    }
  }, [loopItems, selectedTable, loadColumns])

  useEffect(() => {
    if (activeTab !== 'chat' || ticketConfigLoaded) return
    setTicketConfigLoaded(true)
    void loadTicketContextConfig()
  }, [activeTab, ticketConfigLoaded, loadTicketContextConfig])

  const findLoopConfig = useCallback(
    (tableName: string) =>
      loopItems.find(item => item.config.table_name === tableName)?.config ?? null,
    [loopItems]
  )

  const handleTableChange = useCallback(
    (value: string) => {
      setSelectedTable(value)
      const config = findLoopConfig(value)
      if (config) {
        setSelectedTextColumn(config.text_column)
        setSelectedDateColumn(config.date_column)
      } else {
        setSelectedTextColumn('')
        setSelectedDateColumn('')
      }
      setLoopStatus(null)
      setLoopError('')
      void loadColumns(value)
    },
    [findLoopConfig, loadColumns]
  )

  const handleTicketTableChange = useCallback(
    (value: string) => {
      if (ticketTable) {
        setTicketDrafts(prev => ({
          ...prev,
          [ticketTable]: {
            textColumn: ticketTextColumn,
            titleColumn: ticketTitleColumn,
            dateColumn: ticketDateColumn,
            contextFields: ticketContextFields,
          },
        }))
      }
      setTicketTable(value)
      ticketTableRef.current = value
      setTicketStatus(null)
      setTicketError('')
      setTicketTextColumn('')
      setTicketTitleColumn('')
      setTicketDateColumn('')
      setTicketRoles(null)
      setTicketContextFields([])
      const draft = value ? ticketDrafts[value] : undefined
      void loadTicketConfig(value, { draft })
    },
    [
      loadTicketConfig,
      ticketTable,
      ticketTextColumn,
      ticketTitleColumn,
      ticketDateColumn,
      ticketContextFields,
      ticketDrafts,
    ]
  )

  async function handleSaveLoopConfig() {
    if (!selectedTable || !selectedTextColumn || !selectedDateColumn) {
      setLoopStatus({ type: 'error', message: 'Table, colonne texte et colonne date sont requises.' })
      return
    }
    setLoopError('')
    setLoopSaving(true)
    setLoopStatus(null)
    try {
      const payload: LoopConfigPayload = {
        table_name: selectedTable,
        text_column: selectedTextColumn,
        date_column: selectedDateColumn,
      }
      await apiFetch<LoopConfig>('/loop/config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      await loadLoopOverview(false)
      setLoopStatus({ type: 'success', message: 'Configuration Radar enregistrée.' })
    } catch (err) {
      setLoopStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Sauvegarde impossible.',
      })
    } finally {
      setLoopSaving(false)
    }
  }

  async function handleRegenerateLoop(tableName?: string) {
    if (loopItems.length === 0) {
      setLoopStatus({ type: 'error', message: 'Configurez au moins une table avant de régénérer.' })
      return
    }
    setLoopError('')
    setLoopRegenerating(tableName ?? '*')
    setLoopStatus(null)
    try {
      const query = tableName ? `?table_name=${encodeURIComponent(tableName)}` : ''
      const response = await apiFetch<LoopOverview>(`/loop/regenerate${query}`, {
        method: 'POST',
      })
      setLoopItems(response?.items ?? [])
      setLoopStatus({
        type: 'success',
        message: tableName ? `Résumés Radar régénérés pour ${tableName}.` : 'Résumés Radar régénérés.',
      })
    } catch (err) {
      setLoopStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Régénération impossible.',
      })
    } finally {
      setLoopRegenerating(null)
    }
  }

  async function handleDeleteLoopConfig(config: LoopConfig) {
    const confirmed = window.confirm(
      `Retirer la table "${config.table_name}" du Radar ? Les résumés associés seront supprimés.`
    )
    if (!confirmed) return
    setLoopError('')
    setLoopDeleting(config.id)
    setLoopStatus(null)
    try {
      await apiFetch(`/loop/config/${config.id}`, { method: 'DELETE' })
      setLoopItems(prev => prev.filter(item => item.config.id !== config.id))
      if (selectedTable === config.table_name) {
        setSelectedTable('')
        setSelectedTextColumn('')
        setSelectedDateColumn('')
        setLoopColumns([])
      }
      setLoopStatus({ type: 'success', message: 'Table retirée du Radar.' })
    } catch (err) {
      setLoopStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Suppression impossible.',
      })
    } finally {
      setLoopDeleting(null)
    }
  }

  async function handleSaveTicketRoles() {
    if (!ticketTable) {
      setTicketStatus({ type: 'error', message: 'Choisissez une table de tickets.' })
      return
    }
    if (!ticketTextColumn) {
      setTicketStatus({ type: 'error', message: 'Sélectionnez la colonne texte.' })
      return
    }
    if (!ticketTitleColumn) {
      setTicketStatus({ type: 'error', message: 'Sélectionnez la colonne titre.' })
      return
    }
    if (!ticketDateColumn) {
      setTicketStatus({ type: 'error', message: 'Sélectionnez la colonne date.' })
      return
    }
    const tableBeforeSave = ticketTable
    setTicketSaving(true)
    setTicketStatus(null)
    try {
      const columnLookup = new Set(ticketColumns.map(col => col.name))
      const contextFields = ticketContextFields.filter(name => columnLookup.has(name))
      const payload = {
        table_name: ticketTable,
        text_column: ticketTextColumn,
        title_column: ticketTitleColumn,
        date_column: ticketDateColumn,
        ticket_context_fields: contextFields,
      }
      const response = await apiFetch<TicketContextConfig>(
        '/tickets/context/config',
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        }
      )
      // Abort state update if user switched to a different table during the save
      if (ticketTableRef.current !== tableBeforeSave) {
        return
      }
      const updated = response ?? payload
      setTicketRoles(prev =>
        prev
          ? {
              ...prev,
              date_field: ticketDateColumn,
            }
          : prev
      )
      setTicketContextFields(updated.ticket_context_fields ?? contextFields)
      // Update draft to reflect saved values
      setTicketDrafts(prev => ({
        ...prev,
        [tableBeforeSave]: {
          textColumn: ticketTextColumn,
          titleColumn: ticketTitleColumn,
          dateColumn: ticketDateColumn,
          contextFields: updated.ticket_context_fields ?? contextFields,
        },
      }))
      setTicketStatus({ type: 'success', message: 'Configuration chat enregistrée.' })
    } catch (err) {
      // Only show error if still on the same table
      if (ticketTableRef.current === tableBeforeSave) {
        setTicketStatus({
          type: 'error',
          message: err instanceof Error ? err.message : 'Mise à jour impossible.',
        })
      }
    } finally {
      setTicketSaving(false)
    }
  }

  const ticketContextOptions = ticketColumns.map(col => col.name)

  const handleExplorerRoleChange = (
    source: string,
    key: keyof ColumnRoleSelection,
    value: string
  ) => {
    setExplorerRoles(prev => {
      const current = prev[source] ?? { date_field: null, category_field: null, sub_category_field: null }
      return {
        ...prev,
        [source]: {
          ...current,
          [key]: value || null,
        },
      }
    })
  }

  const handleSaveExplorerRoles = async (source: string) => {
    const draft = explorerRoles[source] ?? { date_field: null, category_field: null, sub_category_field: null }
    if ((draft.category_field && !draft.sub_category_field) || (draft.sub_category_field && !draft.category_field)) {
      setExplorerRoleErrors(prev => ({
        ...prev,
        [source]: 'Choisissez une catégorie ET une sous-catégorie ou aucune des deux.',
      }))
      return
    }

    setExplorerRoleErrors(prev => ({ ...prev, [source]: '' }))
    setExplorerSaving(prev => new Set(prev).add(source))
    try {
      const response = await apiFetch<ColumnRolesResponse>(
        `/data/overview/${encodeURIComponent(source)}/column-roles`,
        {
          method: 'PUT',
          body: JSON.stringify(draft),
        }
      )
      const updated = response ?? draft
      setExplorerRoles(prev => ({
        ...prev,
        [source]: {
          date_field: updated.date_field ?? null,
          category_field: updated.category_field ?? null,
          sub_category_field: updated.sub_category_field ?? null,
        },
      }))
      await loadExplorerOverview(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Mise à jour impossible.'
      setExplorerRoleErrors(prev => ({ ...prev, [source]: message }))
    } finally {
      setExplorerSaving(prev => {
        const next = new Set(prev)
        next.delete(source)
        return next
      })
    }
  }

  const handleToggleExplorer = async (source: string, enabled: boolean) => {
    setExplorerError('')
    setExplorerToggling(prev => new Set(prev).add(source))
    try {
      const response = await apiFetch<ExplorerEnabledResponse>(
        `/data/overview/${encodeURIComponent(source)}/explorer-enabled`,
        {
          method: 'PUT',
          body: JSON.stringify({ enabled }),
        }
      )
      const nextEnabled = response?.enabled ?? enabled
      setExplorerData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          sources: prev.sources.map(item =>
            item.source === source ? { ...item, explorer_enabled: nextEnabled } : item
          ),
        }
      })
    } catch (err) {
      setExplorerError(err instanceof Error ? err.message : 'Mise à jour impossible.')
    } finally {
      setExplorerToggling(prev => {
        const next = new Set(prev)
        next.delete(source)
        return next
      })
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextUsername = username.trim()
    if (!nextUsername || !password) {
      setStatus({ type: 'error', message: 'Utilisateur et mot de passe sont requis.' })
      return
    }
    setLoadingUser(true)
    setStatus(null)
    try {
      const response = await apiFetch<CreateUserResponse>('/auth/users', {
        method: 'POST',
        body: JSON.stringify({ username: nextUsername, password } as CreateUserRequest)
      })
      setStatus({
        type: 'success',
        message: `Utilisateur ${response.username} créé avec succès.`,
      })
      setUsername('')
      setPassword('')
      await Promise.all([loadPermissions(), loadStats()])
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Création impossible.'
      })
    } finally {
      setLoadingUser(false)
    }
  }

  async function handleTogglePermission(username: string, table: string, nextChecked: boolean) {
    if (!overview || updatingUsers.has(username)) return
    const target = overview.users.find(user => user.username === username)
    if (!target || target.is_admin) return

    const tableKey = table.toLowerCase()
    const filtered = target.allowed_tables.filter(value => value.toLowerCase() !== tableKey)
    const nextAllowed = nextChecked ? [...filtered, table] : filtered
    nextAllowed.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
    const payload: UpdateUserPermissionsRequest = {
      allowed_tables: nextAllowed,
      can_use_sql_agent: target.can_use_sql_agent,
      can_generate_chart: target.can_generate_chart,
      can_view_graph: target.can_view_graph,
    }

    setUpdatingUsers(prev => {
      const next = new Set(prev)
      next.add(username)
      return next
    })

    setOverview(prev => {
      if (!prev) return prev
      return {
        ...prev,
        users: prev.users.map(user =>
          user.username === username
            ? { ...user, allowed_tables: nextAllowed }
            : user
        ),
      }
    })

    try {
      const response = await apiFetch<UserWithPermissionsResponse>(
        `/auth/users/${encodeURIComponent(username)}/table-permissions`,
        {
          method: 'PUT',
          body: JSON.stringify(payload)
        }
      )
      setOverview(prev => {
        if (!prev) return prev
        return {
          ...prev,
          users: prev.users.map(user =>
            user.username === username
              ? {
                  ...user,
                  allowed_tables: response.allowed_tables,
                  can_use_sql_agent: response.can_use_sql_agent,
                  can_generate_chart: response.can_generate_chart,
                  can_view_graph: response.can_view_graph,
                }
              : user
          ),
        }
      })
      setStatus({ type: 'success', message: `Droits mis à jour pour ${username}.` })
    } catch (err) {
      await loadPermissions()
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Mise à jour impossible.'
      })
    } finally {
      setUpdatingUsers(prev => {
        const next = new Set(prev)
        next.delete(username)
        return next
      })
    }
  }

  async function handleToggleFeature(
    username: string,
    key: FeaturePermissionKey,
    nextChecked: boolean,
  ) {
    if (!overview || updatingUsers.has(username)) return
    const target = overview.users.find(user => user.username === username)
    if (!target || target.is_admin) return

    const nextUser = {
      ...target,
      [key]: nextChecked,
    } as UserWithPermissionsResponse

    const payload: UpdateUserPermissionsRequest = {
      allowed_tables: nextUser.allowed_tables,
      can_use_sql_agent: nextUser.can_use_sql_agent,
      can_generate_chart: nextUser.can_generate_chart,
      can_view_graph: nextUser.can_view_graph,
    }

    setUpdatingUsers(prev => {
      const next = new Set(prev)
      next.add(username)
      return next
    })

    setOverview(prev => {
      if (!prev) return prev
      return {
        ...prev,
        users: prev.users.map(user =>
          user.username === username ? nextUser : user
        ),
      }
    })

    try {
      const response = await apiFetch<UserWithPermissionsResponse>(
        `/auth/users/${encodeURIComponent(username)}/table-permissions`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        }
      )
      setOverview(prev => {
        if (!prev) return prev
        return {
          ...prev,
          users: prev.users.map(user =>
            user.username === username
              ? {
                  ...user,
                  allowed_tables: response.allowed_tables,
                  can_use_sql_agent: response.can_use_sql_agent,
                  can_generate_chart: response.can_generate_chart,
                  can_view_graph: response.can_view_graph,
                }
              : user
          ),
        }
      })
      setStatus({ type: 'success', message: `Droits mis à jour pour ${username}.` })
    } catch (err) {
      await loadPermissions()
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Mise à jour impossible.'
      })
    } finally {
      setUpdatingUsers(prev => {
        const next = new Set(prev)
        next.delete(username)
        return next
      })
    }
  }

  async function handleDeleteUser(targetUsername: string) {
    if (!overview) return
    const target = overview.users.find(u => u.username === targetUsername)
    if (!target) return
    if (target.is_admin) return

    const confirmed = window.confirm(`Supprimer l'utilisateur "${targetUsername}" ? Cette action est irréversible.`)
    if (!confirmed) return

    setUpdatingUsers(prev => new Set(prev).add(targetUsername))
    try {
      await apiFetch<void>(`/auth/users/${encodeURIComponent(targetUsername)}`, {
        method: 'DELETE',
      })
      setOverview(prev => {
        if (!prev) return prev
        return {
          ...prev,
          users: prev.users.filter(u => u.username !== targetUsername),
        }
      })
      setStatus({ type: 'success', message: `Utilisateur ${targetUsername} supprimé.` })
      await Promise.all([loadPermissions(), loadStats()])
    } catch (err) {
      await Promise.all([loadPermissions(), loadStats()]) // rollback UI if deletion failed
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Suppression impossible.' })
    } finally {
      setUpdatingUsers(prev => {
        const next = new Set(prev)
        next.delete(targetUsername)
        return next
      })
    }
  }

  async function handleResetPassword(targetUsername: string) {
    const target = overview?.users.find(u => u.username === targetUsername)
    if (!target) return
    const confirmed = window.confirm(
      `Réinitialiser le mot de passe de "${targetUsername}" ?\nUn mot de passe temporaire sera généré et l'utilisateur devra le changer à la prochaine connexion.`
    )
    if (!confirmed) return

    setUpdatingUsers(prev => new Set(prev).add(targetUsername))
    try {
      const res = await apiFetch<AdminResetPasswordResponse>(
        `/auth/users/${encodeURIComponent(targetUsername)}/reset-password`,
        { method: 'POST' }
      )
      const temp = res?.temporary_password || ''
      if (temp) {
        setStatus({
          type: 'success',
          message: `Mot de passe temporaire pour ${targetUsername} : ${temp} (copiez et transmettez-le à l'utilisateur).`,
        })
        // Offer quick copy to clipboard
        try {
          await navigator.clipboard.writeText(temp)
        } catch {/* noop */}
      } else {
        setStatus({ type: 'success', message: `Mot de passe de ${targetUsername} réinitialisé.` })
      }
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Réinitialisation impossible.' })
    } finally {
      setUpdatingUsers(prev => {
        const next = new Set(prev)
        next.delete(targetUsername)
        return next
      })
    }
  }

  const tables = overview?.tables ?? []
  const users = overview?.users ?? []
  const totals = stats?.totals ?? null
  const perUserStats = stats?.per_user ?? []
  const statsUpdatedAt = stats?.generated_at ?? ''
  const explorerSources = explorerData?.sources ?? []
  const explorerActiveCount = explorerSources.filter(src => src.explorer_enabled !== false).length
  const metricCards = !totals
    ? []
    : [
        {
          key: 'users',
          label: 'Utilisateurs',
          total: totals.users,
          detailLabel: 'Actifs 7j',
          detailValue: totals.active_users_last_7_days,
        },
        {
          key: 'conversations',
          label: 'Conversations',
          total: totals.conversations,
          detailLabel: '7 derniers jours',
          detailValue: totals.conversations_last_7_days,
        },
        {
          key: 'messages',
          label: 'Messages',
          total: totals.messages,
          detailLabel: '7 derniers jours',
          detailValue: totals.messages_last_7_days,
        },
        {
          key: 'charts',
          label: 'Graphiques',
          total: totals.charts,
          detailLabel: '7 derniers jours',
          detailValue: totals.charts_last_7_days,
        },
      ]

  return (
    <div className="max-w-5xl mx-auto animate-fade-in space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-primary-950 mb-2">Espace admin</h2>
        <p className="text-primary-600">
          Connecté en tant que <strong className="text-primary-950">{adminUsername}</strong>.
          Gérez ici les comptes et leurs accès aux tables de données.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-primary-100 pb-2">
        {TAB_ITEMS.map(tab => {
          const isActive = tab.key === activeTab
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabChange(tab.key)}
              className={`px-3 py-2 text-sm font-semibold rounded-full border transition-colors ${
                isActive
                  ? 'bg-primary-900 text-white border-primary-900 shadow-sm'
                  : 'bg-white text-primary-700 border-primary-200 hover:bg-primary-50'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'users' && status && (
        <div
          className={`flex items-start gap-3 p-4 rounded-lg border-2 animate-fade-in ${
            status.type === 'success'
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200'
          }`}
        >
          {status.type === 'success' ? (
            <HiCheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          ) : (
            <HiXCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          )}
          <p
            className={`text-sm ${
              status.type === 'success' ? 'text-green-800' : 'text-red-800'
            }`}
          >
            {status.message}
          </p>
        </div>
      )}

      {activeTab === 'stats' && (
        <Card variant="elevated">
        <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-primary-950">
              Statistiques d’utilisation
            </h3>
            <p className="text-sm text-primary-600">
              Suivez l’activité globale de la plateforme et des utilisateurs.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { void loadStats() }}
            disabled={statsLoading}
          >
            {statsLoading ? 'Actualisation…' : 'Actualiser'}
          </Button>
        </div>

        {statsLoading ? (
          <div className="py-12 flex justify-center">
            <Loader text="Chargement des statistiques…" />
          </div>
        ) : statsError ? (
          <div className="py-6 text-sm text-red-600">
            {statsError}
          </div>
        ) : !stats || !totals ? (
          <div className="py-6 text-sm text-primary-600">
            Aucune donnée de statistiques disponible.
          </div>
        ) : (
          <>
            <p className="text-xs text-primary-500 mb-4">
              Dernière mise à jour&nbsp;: {formatDate(statsUpdatedAt)}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {metricCards.map(metric => (
                <div
                  key={metric.key}
                  className="border border-primary-100 rounded-lg p-4 bg-white shadow-sm"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary-500">
                    {metric.label}
                  </p>
                  <p className="text-2xl font-bold text-primary-950 mt-2">
                    {formatNumber(metric.total)}
                  </p>
                  <p className="text-xs text-primary-500 mt-1">
                    {metric.detailLabel} : {formatNumber(metric.detailValue)}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <h4 className="text-sm font-semibold text-primary-800 mb-3">
                Statistiques par utilisateur
              </h4>
              {perUserStats.length === 0 ? (
                <div className="text-sm text-primary-600">
                  Aucune activité enregistrée pour le moment.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border border-primary-100 rounded-lg overflow-hidden">
                    <thead className="bg-primary-50">
                      <tr>
                        <th className="text-left text-xs font-semibold uppercase tracking-wide text-primary-600 px-4 py-3 border-b border-primary-100">
                          Utilisateur
                        </th>
                        <th className="text-center text-xs font-semibold uppercase tracking-wide text-primary-600 px-4 py-3 border-b border-primary-100">
                          Conversations
                        </th>
                        <th className="text-center text-xs font-semibold uppercase tracking-wide text-primary-600 px-4 py-3 border-b border-primary-100">
                          Messages
                        </th>
                        <th className="text-center text-xs font-semibold uppercase tracking-wide text-primary-600 px-4 py-3 border-b border-primary-100">
                          Graphiques
                        </th>
                        <th className="text-center text-xs font-semibold uppercase tracking-wide text-primary-600 px-4 py-3 border-b border-primary-100">
                          Dernière activité
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {perUserStats.map(userStats => (
                        <tr
                          key={userStats.username}
                          className="odd:bg-white even:bg-primary-25"
                        >
                          <td className="align-top px-4 py-3 border-b border-primary-100">
                            <div className="flex flex-col gap-1">
                              <span className="text-sm font-medium text-primary-900">
                                {userStats.username}
                              </span>
                              <span className="text-xs text-primary-500">
                                Créé le {formatDate(userStats.created_at)}
                              </span>
                              {userStats.username === adminUsername && (
                                <span className="text-xs font-semibold text-primary-600">
                                  Administrateur
                                </span>
                              )}
                              {!userStats.is_active && (
                                <span className="text-xs font-semibold text-red-500">
                                  Compte inactif
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="text-center px-4 py-3 border-b border-primary-100">
                            {formatNumber(userStats.conversations)}
                          </td>
                          <td className="text-center px-4 py-3 border-b border-primary-100">
                            {formatNumber(userStats.messages)}
                          </td>
                          <td className="text-center px-4 py-3 border-b border-primary-100">
                            {formatNumber(userStats.charts)}
                          </td>
                          <td className="text-center px-4 py-3 border-b border-primary-100">
                            {formatActivity(userStats.last_activity_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
        </Card>
      )}

      {activeTab === 'dictionary' && <DictionaryManager />}

      {activeTab === 'prompts' && <PromptsManager />}

      {activeTab === 'explorer' && (
        <Card variant="elevated" className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-primary-950">Explorer – tables et colonnes</h3>
              <p className="text-sm text-primary-600 max-w-3xl">
                Activez uniquement les tables utiles dans l’Explorer et définissez les colonnes Date / Category / Sub Category.
                Les changements sont globaux pour tous les utilisateurs.
              </p>
              <p className="text-xs text-primary-500 mt-1">
                Tables actives : <span className="font-semibold text-primary-800">{explorerActiveCount}</span> / {explorerSources.length}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { void loadExplorerOverview() }}
                disabled={explorerLoading}
              >
                {explorerLoading ? 'Actualisation…' : 'Actualiser'}
              </Button>
            </div>
          </div>

          {explorerError && (
            <div className="rounded-lg border-2 border-red-200 bg-red-50 text-red-700 text-sm p-3">
              {explorerError}
            </div>
          )}

          {explorerLoading && explorerSources.length === 0 ? (
            <div className="py-8 flex justify-center">
              <Loader text="Chargement des tables Explorer…" />
            </div>
          ) : explorerSources.length === 0 ? (
            <div className="py-6 text-sm text-primary-600">Aucune table détectée.</div>
          ) : (
            <div className="space-y-3">
              {explorerSources.map(source => {
                const fields = source.fields ?? []
                const roles = explorerRoles[source.source] ?? {
                  date_field: source.date_field ?? null,
                  category_field: source.category_field ?? null,
                  sub_category_field: source.sub_category_field ?? null,
                }
                const isEnabled = source.explorer_enabled !== false
                const savingRoles = explorerSaving.has(source.source)
                const toggling = explorerToggling.has(source.source)
                const roleError = explorerRoleErrors[source.source]
                return (
                  <div
                    key={source.source}
                    className={`rounded-xl border ${isEnabled ? 'border-primary-100 bg-white' : 'border-primary-100 bg-primary-25'}`}
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between px-4 py-3 border-b border-primary-100">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-primary-500">{source.source}</p>
                        <p className="text-sm font-semibold text-primary-900">{source.title}</p>
                        <p className="text-[11px] text-primary-600">
                          {formatNumber(source.total_rows)} lignes · {fields.length} colonnes
                        </p>
                      </div>
                      <label className="inline-flex items-center gap-2 text-sm text-primary-800">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-primary-300 text-primary-900 focus:ring-primary-500"
                          checked={isEnabled}
                          onChange={e => handleToggleExplorer(source.source, e.target.checked)}
                          disabled={toggling}
                        />
                        <span className="font-semibold">Inclure dans l’Explorer</span>
                        {!isEnabled && (
                          <span className="text-xs text-primary-500">(désactivée)</span>
                        )}
                      </label>
                    </div>

                    <div className="px-4 py-3 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-3">
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
                              className="h-10 rounded-md border border-primary-200 bg-white px-2 text-primary-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                              value={roles[key] ?? ''}
                              onChange={e => handleExplorerRoleChange(source.source, key, e.target.value)}
                              disabled={savingRoles || fields.length === 0}
                            >
                              <option value="">Aucune</option>
                              {fields.map(field => (
                                <option key={field.field} value={field.field}>
                                  {field.field}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>

                      {roleError ? (
                        <p className="text-xs text-red-600">{roleError}</p>
                      ) : (
                        <p className="text-[11px] text-primary-500">
                          Sélectionnez Category et Sub Category ensemble pour alimenter les répartitions et l’aperçu. Les tables désactivées ne sont pas scannées tant que l’option n’est pas cochée.
                        </p>
                      )}

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => { void handleSaveExplorerRoles(source.source) }}
                          disabled={savingRoles}
                        >
                          {savingRoles ? 'Enregistrement…' : 'Enregistrer les colonnes'}
                        </Button>
                        {!isEnabled && (
                          <span className="text-[11px] text-primary-500">Cette table reste masquée tant qu’elle n’est pas activée.</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'radar' && (
        <Card variant="elevated">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-primary-950">Radar – résumés tickets</h3>
              <p className="text-sm text-primary-600">
                Sélectionnez les tables et colonnes utilisées pour générer les synthèses Radar.
              </p>
            </div>
            <div className="text-sm text-primary-600">
              Tables configurées :{' '}
              <span className="font-medium text-primary-900">
                {loopItems.length}
              </span>
            </div>
          </div>

          {loopError && (
            <div className="mb-4 rounded-lg border-2 border-red-200 bg-red-50 text-red-700 text-sm p-3">
              {loopError}
            </div>
          )}

          {loopStatus && (
            <div
              className={`mb-4 flex items-start gap-2 p-3 rounded-lg border ${
                loopStatus.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {loopStatus.type === 'success' ? (
                <HiCheckCircle className="w-4 h-4 mt-0.5" />
              ) : (
                <HiXCircle className="w-4 h-4 mt-0.5" />
              )}
              <p className="text-sm">{loopStatus.message}</p>
            </div>
          )}

          {loopLoading ? (
            <div className="py-8 flex justify-center">
              <Loader text="Chargement des configurations Radar…" />
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-primary-800 mb-1">
                    Table Radar
                  </label>
                  <select
                    value={selectedTable}
                    onChange={(e) => handleTableChange(e.target.value)}
                    className="w-full rounded-md border border-primary-200 px-3 py-2 text-primary-900 focus:border-primary-400 focus:outline-none"
                    disabled={loopTables.length === 0 || loopSaving}
                  >
                    <option value="">Sélectionner une table…</option>
                    {loopTables.map(table => (
                      <option key={table.name} value={table.name}>
                        {table.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-primary-800 mb-1">
                      Colonne texte
                    </label>
                    <select
                      value={selectedTextColumn}
                      onChange={(e) => setSelectedTextColumn(e.target.value)}
                      className="w-full rounded-md border border-primary-200 px-3 py-2 text-primary-900 focus:border-primary-400 focus:outline-none"
                      disabled={loopColumns.length === 0 || loopSaving}
                    >
                      <option value="">Choisir…</option>
                      {loopColumns.map(col => (
                        <option key={col.name} value={col.name}>
                          {col.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-primary-800 mb-1">
                      Colonne date
                    </label>
                    <select
                      value={selectedDateColumn}
                      onChange={(e) => setSelectedDateColumn(e.target.value)}
                      className="w-full rounded-md border border-primary-200 px-3 py-2 text-primary-900 focus:border-primary-400 focus:outline-none"
                      disabled={loopColumns.length === 0 || loopSaving}
                    >
                      <option value="">Choisir…</option>
                      {loopColumns.map(col => (
                        <option key={col.name} value={col.name}>
                          {col.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleSaveLoopConfig}
                    disabled={loopSaving || loopTables.length === 0 || !selectedTable || !selectedTextColumn || !selectedDateColumn}
                  >
                    {loopSaving ? 'Enregistrement…' : 'Enregistrer la table'}
                  </Button>
                </div>
              </div>
              <div className="space-y-3 md:border-l md:border-primary-100 md:pl-6 pt-4 md:pt-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-primary-700">Tables actives dans le Radar</p>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => handleRegenerateLoop()}
                    disabled={loopRegenerating !== null || loopSaving || loopLoading}
                    className="inline-flex items-center gap-2"
                  >
                    {loopRegenerating === '*' ? (
                      <>
                        <HiArrowPath className="w-4 h-4 animate-spin" />
                        Régénération…
                      </>
                    ) : (
                      <>
                        <HiArrowPath className="w-4 h-4" />
                        Régénérer tout
                      </>
                    )}
                  </Button>
                </div>
                {loopItems.length === 0 ? (
                  <p className="text-xs text-primary-500">
                    Aucune table n&apos;est encore configurée pour le Radar.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {loopItems.map(item => {
                      const config = item.config
                      const isRegenerating = loopRegenerating === config.table_name
                      const isDeleting = loopDeleting === config.id
                      return (
                        <div key={config.id} className="rounded-lg border border-primary-100 bg-white p-3 space-y-2">
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-primary-900">{config.table_name}</p>
                              <p className="text-xs text-primary-600">
                                Texte : {config.text_column} — Date : {config.date_column}
                              </p>
                              <p className="text-xs text-primary-500">
                                Dernière génération : {formatDate(config.last_generated_at)}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => handleTableChange(config.table_name)}
                                disabled={loopSaving || loopLoading}
                              >
                                Modifier
                              </Button>
                              <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                onClick={() => handleRegenerateLoop(config.table_name)}
                                disabled={loopRegenerating !== null || loopSaving || loopLoading}
                                className="inline-flex items-center gap-2"
                              >
                                {isRegenerating ? (
                                  <>
                                    <HiArrowPath className="w-4 h-4 animate-spin" />
                                    Régénération…
                                  </>
                                ) : (
                                  <>
                                    <HiArrowPath className="w-4 h-4" />
                                    Régénérer
                                  </>
                                )}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteLoopConfig(config)}
                                disabled={loopDeleting !== null || loopSaving || loopLoading}
                              >
                                {isDeleting ? 'Suppression…' : 'Retirer'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                <p className="text-xs text-primary-500">
                  Les résultats apparaissent dans l&apos;onglet « Radar ».
                </p>
              </div>
            </div>
          )}
        </Card>
      )}

      {activeTab === 'chat' && (
        <Card variant="elevated">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-primary-950">Contexte tickets (chat)</h3>
              <p className="text-sm text-primary-600">
                Configurez la table et les colonnes texte/date/titre utilisées dans le mode chat « tickets », ainsi que
                les colonnes injectées dans le contexte LLM. Les choix restent alignés avec l&apos;Explorer,
                sans dépendre du Radar.
              </p>
            </div>
          </div>

          {ticketError && (
            <div className="mb-4 rounded-lg border-2 border-red-200 bg-red-50 text-red-700 text-sm p-3">
              {ticketError}
            </div>
          )}

          {ticketStatus && (
            <div
              className={`mb-4 flex items-start gap-2 p-3 rounded-lg border ${
                ticketStatus.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {ticketStatus.type === 'success' ? (
                <HiCheckCircle className="w-4 h-4 mt-0.5" />
              ) : (
                <HiXCircle className="w-4 h-4 mt-0.5" />
              )}
              <p className="text-sm">{ticketStatus.message}</p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-primary-800 mb-1">
                  Table de tickets
                </label>
                <select
                  value={ticketTable}
                  onChange={(e) => handleTicketTableChange(e.target.value)}
                  className="w-full rounded-md border border-primary-200 px-3 py-2 text-primary-900 focus:border-primary-400 focus:outline-none"
                  disabled={loopTables.length === 0 || ticketSaving}
                >
                  <option value="">Sélectionner une table…</option>
                  {loopTables.map(table => (
                    <option key={table.name} value={table.name}>
                      {table.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-primary-800 mb-1">
                  Colonne texte (mode tickets)
                </label>
                <select
                  value={ticketTextColumn}
                  onChange={(e) => setTicketTextColumn(e.target.value)}
                  className="w-full rounded-md border border-primary-200 px-3 py-2 text-primary-900 focus:border-primary-400 focus:outline-none"
                  disabled={ticketColumns.length === 0 || ticketSaving}
                >
                  <option value="">Choisir…</option>
                  {ticketColumns.map(col => (
                    <option key={col.name} value={col.name}>
                      {col.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-primary-800 mb-1">
                  Colonne titre (panneau latéral)
                </label>
                <select
                  value={ticketTitleColumn}
                  onChange={(e) => setTicketTitleColumn(e.target.value)}
                  className="w-full rounded-md border border-primary-200 px-3 py-2 text-primary-900 focus:border-primary-400 focus:outline-none"
                  disabled={ticketColumns.length === 0 || ticketSaving}
                >
                  <option value="">Choisir…</option>
                  {ticketColumns.map(col => (
                    <option key={col.name} value={col.name}>
                      {col.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-primary-800 mb-1">
                  Colonne date (mode tickets)
                </label>
                <select
                  value={ticketDateColumn}
                  onChange={(e) => setTicketDateColumn(e.target.value)}
                  className="w-full rounded-md border border-primary-200 px-3 py-2 text-primary-900 focus:border-primary-400 focus:outline-none"
                  disabled={ticketColumns.length === 0 || ticketSaving}
                >
                  <option value="">Choisir…</option>
                  {ticketColumns.map(col => (
                    <option key={col.name} value={col.name}>
                      {col.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-primary-500 mt-1">
                  Catégorie actuelle : {ticketRoles?.category_field || '—'} / Sous-catégorie :{' '}
                  {ticketRoles?.sub_category_field || '—'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-primary-800 mb-1">
                  Colonnes du contexte LLM
                </label>
                <div className="rounded-md border border-primary-200 bg-white p-2 max-h-48 overflow-auto">
                  {ticketContextOptions.length === 0 ? (
                    <p className="text-xs text-primary-500">Aucune colonne disponible.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {ticketContextOptions.map(name => (
                        <label key={name} className="flex items-center gap-2 text-xs text-primary-800">
                          <input
                            type="checkbox"
                            className="accent-primary-600"
                            checked={ticketContextFields.includes(name)}
                            disabled={ticketSaving}
                            onChange={() => {
                              setTicketContextFields(prev => {
                                const next = new Set(prev)
                                if (next.has(name)) {
                                  next.delete(name)
                                } else {
                                  next.add(name)
                                }
                                return ticketContextOptions.filter(option => next.has(option))
                              })
                            }}
                          />
                          <span>{name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-primary-500 mt-1">
                  Seules les colonnes cochées sont injectées dans le contexte LLM.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleSaveTicketRoles}
                  disabled={ticketSaving || loopTables.length === 0}
                >
                  {ticketSaving ? 'Enregistrement…' : 'Enregistrer la configuration'}
                </Button>
              </div>
            </div>
            <div className="md:border-l md:border-primary-100 md:pl-6 pt-4 md:pt-0 space-y-2 text-sm text-primary-700">
              <p>
                Cette configuration est utilisée par le mode chat « tickets » pour filtrer et ordonner les items.
                Les colonnes du contexte restent alignées avec l&apos;Explorer (column-roles).
              </p>
              <p className="text-xs text-primary-500">
                Pour éviter d&apos;écraser vos catégories existantes, elles sont conservées automatiquement lors de la
                sauvegarde.
              </p>
            </div>
          </div>
        </Card>
      )}

      {activeTab === 'users' && (
        <>
          <Card variant="elevated">
            <h3 className="text-lg font-semibold text-primary-950 mb-4">
              Créer un nouvel utilisateur
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Nouvel utilisateur"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={1}
                maxLength={64}
                autoComplete="off"
                fullWidth
                placeholder="Nom d'utilisateur"
              />

              <Input
                label="Mot de passe"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={1}
                maxLength={128}
                autoComplete="new-password"
                fullWidth
                placeholder="Mot de passe"
              />
              <Button
                type="submit"
                disabled={loadingUser}
                fullWidth
                size="lg"
              >
                {loadingUser ? 'Création en cours…' : 'Créer l\'utilisateur'}
              </Button>
            </form>
          </Card>

          <Card variant="elevated">
            <div className="flex flex-col gap-2 mb-4">
              <h3 className="text-lg font-semibold text-primary-950">
                Droits d’accès aux tables
              </h3>
              <p className="text-sm text-primary-600">
                Activez ou désactivez l’accès aux tables et aux fonctionnalités (SQL, graphiques) pour chaque utilisateur. L’administrateur dispose toujours d’un accès complet.
              </p>
            </div>

            {permissionsLoading ? (
              <div className="py-12 flex justify-center">
                <Loader text="Chargement des droits…" />
              </div>
            ) : permissionsError ? (
              <div className="py-6 text-sm text-red-600">
                {permissionsError}
              </div>
            ) : tables.length === 0 ? (
              <div className="py-6 text-sm text-primary-600">
                Aucune table de données détectée dans le système.
              </div>
            ) : users.length === 0 ? (
              <div className="py-6 text-sm text-primary-600">
                Aucun utilisateur enregistré pour le moment.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border border-primary-100 rounded-lg overflow-hidden">
                  <thead className="bg-primary-50">
                    <tr>
                      <th className="text-left text-xs font-semibold uppercase tracking-wide text-primary-600 px-4 py-3 border-b border-primary-100">
                        Utilisateur
                      </th>
                      {FEATURE_PERMISSIONS.map(permission => (
                        <th
                          key={permission.key}
                          className="text-center text-xs font-semibold uppercase tracking-wide text-primary-600 px-4 py-3 border-b border-primary-100"
                          title={permission.title}
                        >
                          {permission.label}
                        </th>
                      ))}
                      {tables.map(table => (
                        <th
                          key={table}
                          className="text-center text-xs font-semibold uppercase tracking-wide text-primary-600 px-4 py-3 border-b border-primary-100"
                        >
                          {table}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(user => {
                      const isAdminRow = Boolean(user.is_admin)
                      const isUpdating = updatingUsers.has(user.username)
                      const allowedSet = new Set(
                        user.allowed_tables.map(name => name.toLowerCase())
                      )
                      return (
                        <tr
                          key={user.username}
                          className="odd:bg-white even:bg-primary-25"
                        >
                          <td className="align-top px-4 py-3 border-b border-primary-100">
                            <div className="flex flex-col gap-1">
                              <span className="text-sm font-medium text-primary-900">
                                {user.username}
                              </span>
                              <span className="text-xs text-primary-500">
                                Créé le {formatDate(user.created_at)}
                              </span>
                              {isAdminRow && (
                                <span className="text-xs font-semibold text-primary-600">
                                  Accès administrateur
                                </span>
                              )}
                              <div className="pt-1 flex gap-2">
                                <Button
                                  variant="secondary"
                                  size="xs"
                                  onClick={() => handleResetPassword(user.username)}
                                  disabled={isUpdating}
                                >
                                  Réinitialiser mot de passe
                                </Button>
                                {!isAdminRow && (
                                  <Button
                                    variant="danger"
                                    size="xs"
                                    onClick={() => handleDeleteUser(user.username)}
                                    disabled={isUpdating}
                                  >
                                    Supprimer
                                  </Button>
                                )}
                              </div>
                            </div>
                          </td>
                          {FEATURE_PERMISSIONS.map(permission => {
                            const checked = isAdminRow || Boolean(user[permission.key])
                            return (
                              <td
                                key={`${user.username}-${permission.key}`}
                                className="text-center px-4 py-3 border-b border-primary-100"
                              >
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={checked}
                                  disabled={isAdminRow || isUpdating}
                                  onChange={(event) =>
                                    handleToggleFeature(user.username, permission.key, event.target.checked)
                                  }
                                />
                              </td>
                            )
                          })}
                          {tables.map(table => {
                            const checked = isAdminRow || allowedSet.has(table.toLowerCase())
                            return (
                              <td
                                key={`${user.username}-${table}`}
                                className="text-center px-4 py-3 border-b border-primary-100"
                              >
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={checked}
                                  disabled={isAdminRow || isUpdating}
                                  onChange={(event) =>
                                    handleTogglePermission(user.username, table, event.target.checked)
                                  }
                                />
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {activeTab === 'feedback' && <FeedbackAdmin embedded />}
    </div>
  )
}

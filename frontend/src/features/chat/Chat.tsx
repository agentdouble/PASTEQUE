import { useState, useRef, useEffect, useMemo, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { RefObject } from 'react'
import { useSearchParams, useLocation } from 'react-router-dom'
import { TICKETS_CONFIG } from '@/config/tickets'
import { apiFetch, streamSSE } from '@/services/api'
import { Button, Textarea, Loader } from '@/components/ui'
import type {
  Message,
  ChatCompletionRequest,
  ChartDatasetPayload,
  ChartGenerationRequest,
  ChartGenerationResponse,
  ChatStreamMeta,
  ChatStreamDelta,
  ChatStreamDone,
  SavedChartResponse,
  EvidenceSpec,
  EvidenceRowsPayload,
  RetrievalDetails,
  FeedbackResponse,
  FeedbackValue
} from '@/types/chat'
import { HiPaperAirplane, HiChartBar, HiBookmark, HiCheckCircle, HiXMark, HiHandThumbUp, HiHandThumbDown, HiCpuChip } from 'react-icons/hi2'
import clsx from 'clsx'
import { renderMarkdown } from '@/utils/markdown'

//

const DEEPSEARCH_OPENERS = [
  'Retraçage des données',
  'Cartographie des irritants',
  'Clustering des problèmes',
  'Détection des signaux faibles',
  'Segmentation des parcours',
  'Tri des anomalies',
  'Filtrage des doublons',
  'Repérage des pics'
]

const DEEPSEARCH_LATE = [
  'Corrélation des causes racines',
  'Hiérarchisation des urgences',
  'Priorisation des actions',
  'Synthèse des tendances',
  'Consolidation des retours',
  'Qualification des incidents',
  'Profilage des usages',
  'Alignement des recommandations',
  'Mise en évidence des écarts',
  'Fusion des enseignements',
  'Calibration des seuils',
  'Validation des hypothèses',
  'Classification des motifs',
  'Pondération des impacts',
  'Normalisation des libellés',
  'Rapprochement des sources',
  'Distribution des volumes'
]

const DEEPSEARCH_VARIANTS = [...DEEPSEARCH_OPENERS, ...DEEPSEARCH_LATE]

const DEEPSEARCH_STOPWORDS = new Set([
  'de',
  'des',
  'du',
  'la',
  'le',
  'les',
  'un',
  'une',
  'et',
  'en',
  'aux',
  'au',
  'sur',
  'pour',
  'par',
  'd',
  'l',
  'avec',
  'sans',
  'vers',
  'dans',
  'ou',
  'que',
  'qui',
  'quoi',
  'mise'
])

function extractDeepSearchWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zà-ÿ0-9]+/gi, ' ')
    .split(' ')
    .map(word => word.trim())
    .filter(word => word.length > 2 && !DEEPSEARCH_STOPWORDS.has(word))
}

function hasUsedWords(text: string, usedWords: Set<string>): boolean {
  const words = extractDeepSearchWords(text)
  return words.some(word => usedWords.has(word))
}

function markUsedWords(text: string, usedWords: Set<string>): void {
  extractDeepSearchWords(text).forEach(word => usedWords.add(word))
}

function pickDeepSearchVariant(options: {
  previous: string
  usedWords: Set<string>
  allowInitial: boolean
}): string {
  const { previous, usedWords, allowInitial } = options
  const pool = allowInitial ? DEEPSEARCH_OPENERS : DEEPSEARCH_VARIANTS
  const candidates = pool.filter(variant => variant !== previous && !hasUsedWords(variant, usedWords))
  if (candidates.length === 0) return ''
  const choice = candidates[Math.floor(Math.random() * candidates.length)]
  markUsedWords(choice, usedWords)
  return choice
}

function normaliseRows(columns: string[] = [], rows: any[] = []): Record<string, unknown>[] {
  const headings = columns.length > 0 ? columns : ['value']
  return rows.map(row => {
    if (Array.isArray(row)) {
      const obj: Record<string, unknown> = {}
      headings.forEach((col, idx) => {
        obj[col] = row[idx] ?? null
      })
      return obj
    }
    if (row && typeof row === 'object') {
      // Preserve all keys present in object rows to expose every SQL column
      // (do not restrict to LLM-selected headings).
      return { ...(row as Record<string, unknown>) }
    }
    return { [headings[0]]: row }
  })
}

function normalizeRetrievalDetail(raw: unknown): RetrievalDetails | null {
  if (!raw || typeof raw !== 'object' || raw === null) {
    return null
  }
  const rowsCandidate = (raw as { rows?: unknown }).rows
  if (!Array.isArray(rowsCandidate) || rowsCandidate.length === 0) {
    return null
  }
  const normalizedRows: RetrievalDetails['rows'] = []
  for (const item of rowsCandidate) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const tableRaw = entry['table']
    const focusRaw = entry['focus']
    const sourceColumnRaw = entry['source_column']
    const table = typeof tableRaw === 'string' && tableRaw.trim() ? tableRaw : undefined
    const focus = typeof focusRaw === 'string' && focusRaw.trim() ? focusRaw : undefined
    const sourceColumn = typeof sourceColumnRaw === 'string' && sourceColumnRaw.trim()
      ? sourceColumnRaw
      : undefined
    const scoreRaw = entry['score']
    let score: number | undefined
    if (typeof scoreRaw === 'number' && Number.isFinite(scoreRaw)) {
      score = scoreRaw
    } else if (typeof scoreRaw === 'string') {
      const parsed = Number(scoreRaw)
      if (Number.isFinite(parsed)) score = parsed
    }
    const valuesRaw = entry['values']
    let values: Record<string, unknown> | undefined
    if (valuesRaw && typeof valuesRaw === 'object' && !Array.isArray(valuesRaw)) {
      values = { ...(valuesRaw as Record<string, unknown>) }
    }
    normalizedRows.push({
      table,
      score,
      focus,
      source_column: sourceColumn,
      values,
    })
  }
  if (normalizedRows.length === 0) {
    return null
  }
  const detail: RetrievalDetails = { rows: normalizedRows }
  const roundRaw = (raw as { round?: unknown }).round
  if (typeof roundRaw === 'number' && Number.isFinite(roundRaw)) {
    detail.round = roundRaw
  }
  return detail
}

function createMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export default function Chat() {
  const [_searchParams, setSearchParams] = useSearchParams()
  const { search } = useLocation()
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [highlightMessageId, setHighlightMessageId] = useState<number | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<Array<{ id: number; title: string; updated_at: string }>>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [awaitingFirstDelta, setAwaitingFirstDelta] = useState(false)
  const [deepSearchStatus, setDeepSearchStatus] = useState('')
  const [error, setError] = useState('')
  // Statut éphémère en mode ANIMATION=true
  const [animStatus, setAnimStatus] = useState('')
  // Animation de chargement pendant la génération d'un graphique
  const [chartGenerating, setChartGenerating] = useState(false)
  const [chartMode, setChartMode] = useState(false)
  const [ticketMode, setTicketMode] = useState(true)
  const [ticketRanges, setTicketRanges] = useState<Array<{ id: string; from?: string; to?: string }>>([
    { id: createMessageId() }
  ])
  const [extraTicketSources, setExtraTicketSources] = useState<Array<{
    id: string
    table?: string
    ranges: Array<{ id: string; from?: string; to?: string }>
  }>>([])
  const [showTicketPanel, setShowTicketPanel] = useState(true)
  const [ticketMeta, setTicketMeta] = useState<{ min?: string; max?: string; total?: number; table?: string } | null>(null)
  const [ticketMetaByTable, setTicketMetaByTable] = useState<Record<string, { min?: string; max?: string; total?: number }>>({})
  const [ticketMetaLoading, setTicketMetaLoading] = useState(false)
  const [ticketMetaError, setTicketMetaError] = useState('')
  const [ticketStatus, setTicketStatus] = useState('')
  const [ticketTable, setTicketTable] = useState<string>('')
  const [ticketTables, setTicketTables] = useState<string[]>([])
  const [sqlMode, setSqlMode] = useState(false)
  const [evidenceSpec, setEvidenceSpec] = useState<EvidenceSpec | null>(null)
  const [evidenceData, setEvidenceData] = useState<EvidenceRowsPayload | null>(null)
  const [showTicketsSheet, setShowTicketsSheet] = useState(false)
  // Données utilisées (tables accessibles au LLM)
  const [showDataPanel, setShowDataPanel] = useState(false)
  const [dataTables, setDataTables] = useState<string[]>([])
  const [effectiveTables, setEffectiveTables] = useState<string[]>([])
  const [excludedTables, setExcludedTables] = useState<Set<string>>(new Set())
  const [tablesLoading, setTablesLoading] = useState(false)
  // Saving behavior: opt‑in for updating user defaults to avoid cross‑tab races
  const [saveAsDefault, setSaveAsDefault] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const ticketPanelRef = useRef<HTMLDivElement>(null)
  const mobileTicketsRef = useRef<HTMLDivElement>(null)
  const deepSearchStatusRef = useRef('')
  const deepSearchUsedWordsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!ticketMode || !awaitingFirstDelta) {
      deepSearchStatusRef.current = ''
      deepSearchUsedWordsRef.current.clear()
      setDeepSearchStatus('')
      return
    }
    let active = true
    let timeoutId: number | null = null
    const scheduleNext = (allowInitial: boolean) => {
      const delayMs = 3500 + Math.floor(Math.random() * 4200)
      timeoutId = window.setTimeout(() => {
        if (!active) return
        const next = pickDeepSearchVariant({
          previous: deepSearchStatusRef.current,
          usedWords: deepSearchUsedWordsRef.current,
          allowInitial
        })
        if (!next) return
        deepSearchStatusRef.current = next
        setDeepSearchStatus(next)
        scheduleNext(false)
      }, delayMs)
    }
    const initial = pickDeepSearchVariant({
      previous: '',
      usedWords: deepSearchUsedWordsRef.current,
      allowInitial: true
    })
    if (initial) {
      deepSearchStatusRef.current = initial
      setDeepSearchStatus(initial)
      scheduleNext(false)
    }
    return () => {
      active = false
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [ticketMode, awaitingFirstDelta])
  
  // Helpers to open/close history while keeping URL in sync only on explicit actions
  const closeHistory = () => {
    setHistoryOpen(false)
    const sp = new URLSearchParams(search)
    if (sp.has('history')) {
      sp.delete('history')
      setSearchParams(sp, { replace: true })
    }
  }

  useEffect(() => {
    // Auto‑scroll the internal messages list container instead of the window
    const el = listRef.current
    if (!el) return
    try {
      const top = el.scrollHeight
      if (typeof el.scrollTo === 'function') {
        el.scrollTo({ top, behavior: 'smooth' })
      } else {
        el.scrollTop = top
      }
    } catch {
      /* noop */
    }
  }, [messages, loading])

  // Sync local state with URL `?history=1` (URL → state only)
  useEffect(() => {
    const sp = new URLSearchParams(search)
    const wantOpen = sp.has('history') && sp.get('history') !== '0'
    setHistoryOpen(prev => (prev === wantOpen ? prev : wantOpen))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Trigger a fresh session when URL has `?new=1`, then clean the URL (one‑shot)
  useEffect(() => {
    const sp = new URLSearchParams(search)
    const wantNew = sp.has('new') && sp.get('new') !== '0'
    if (wantNew) {
      onNewChat()
      sp.delete('new')
      setSearchParams(sp, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Auto-charger une conversation spécifique (lien admin feedback) et surligner un message précis
  useEffect(() => {
    const sp = new URLSearchParams(search)
    const convRaw = sp.get('conversation_id')
    const msgRaw = sp.get('message_id')
    const convId = convRaw ? Number(convRaw) : NaN
    const msgId = msgRaw ? Number(msgRaw) : NaN
    if (Number.isFinite(convId) && convId > 0) {
      if (conversationId !== convId || messages.length === 0) {
        void loadConversation(convId, { highlightMessageId: Number.isFinite(msgId) ? msgId : null })
      } else if (Number.isFinite(msgId)) {
        setHighlightMessageId(msgId)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Fermer la sheet Tickets avec la touche Escape
  useEffect(() => {
    if (!showTicketsSheet) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowTicketsSheet(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showTicketsSheet])

  // Scroll vers le message ciblé (lien admin feedback)
  useEffect(() => {
    if (highlightMessageId == null) return
    const target = document.querySelector<HTMLElement>(`[data-message-id="${highlightMessageId}"]`)
    if (target) {
      try {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } catch {
        /* noop */
      }
    }
  }, [highlightMessageId, messages.length])

  async function refreshHistory() {
    try {
      const items = await apiFetch<Array<{ id: number; title: string; created_at: string; updated_at: string }>>('/conversations')
      setHistory(items || [])
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refreshHistory()
  }, [])

  // Ticket mode is now default: preload metadata/tables on first render
  useEffect(() => {
    if (ticketMode && !ticketMeta && !ticketMetaLoading) {
      void loadTicketMetadata()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketMode])

  async function loadTicketMetadata(tableOverride?: string, opts?: { target?: 'main' | string }) {
    const target = opts?.target ?? 'main'
    setTicketMetaLoading(true)
    setTicketMetaError('')
    try {
      if (ticketTables.length === 0) {
        try {
          const items = await apiFetch<Array<{ name: string; path: string }>>('/data/tables')
          const names = (items || []).map(it => it?.name).filter((x): x is string => typeof x === 'string')
          setTicketTables(names)
        } catch {
          // ignore table list errors; metadata may still resolve
        }
      }
      const selectedTable = (tableOverride ?? ticketTable)?.trim() || ''
      const params = new URLSearchParams()
      if (selectedTable) params.set('table', selectedTable)
      const meta = await apiFetch<{ table: string; date_min?: string; date_max?: string; total_count: number }>(
        params.size ? `/tickets/context/metadata?${params.toString()}` : '/tickets/context/metadata'
      )
      const metaRecord = {
        min: meta?.date_min,
        max: meta?.date_max,
        total: typeof meta?.total_count === 'number' ? meta.total_count : undefined,
      }
      const resolvedTable = selectedTable || meta?.table || ''
      setTicketMetaByTable(prev => ({
        ...prev,
        ...(resolvedTable ? { [resolvedTable]: metaRecord } : {}),
      }))
      if (target === 'main') {
        setTicketMeta({ ...metaRecord, table: meta?.table })
        setTicketTable(resolvedTable)
        setTicketRanges(prev => {
          const first = prev[0] ?? { id: createMessageId() }
          const updated = {
            ...first,
            from: first.from ?? meta?.date_min ?? undefined,
            to: first.to ?? meta?.date_max ?? undefined,
          }
          const rest = prev.slice(1)
          return [updated, ...rest]
        })
        setTicketStatus(meta?.total_count ? `Tickets prêts (${meta.total_count})` : 'Contexte tickets chargé')
      } else {
        setExtraTicketSources(prev =>
          prev.map(src =>
            src.id === target
              ? {
                  ...src,
                  table: resolvedTable,
                  ranges:
                    src.ranges.length > 0
                      ? src.ranges
                      : [{ id: createMessageId(), from: meta?.date_min ?? undefined, to: meta?.date_max ?? undefined }],
                }
              : src
          )
        )
      }
    } catch (err) {
      setTicketMetaError(err instanceof Error ? err.message : 'Contexte tickets indisponible')
      setTicketStatus('')
    } finally {
      setTicketMetaLoading(false)
    }
  }

  function onToggleChartModeClick() {
    setChartMode(v => {
      const next = !v
      setSqlMode(!next) // SQL actif par défaut hors mode graphique
      return next
    })
    setError('')
  }

  function onToggleTicketModeClick() {
    setTicketMode(v => {
      const next = !v
      // next === true -> mode tickets; next === false -> mode base
      if (next) {
        if (!ticketMeta && !ticketMetaLoading) {
          void loadTicketMetadata()
        }
        setSqlMode(false)
        setChartMode(false)
      } else {
        setSqlMode(true)
        setChartMode(false)
        setTicketStatus('')
      }
      return next
    })
  }

  async function onSend() {
    const text = input.trim()
    if (!text || loading) return
    setError('')
    const userMessage: Message = { id: createMessageId(), role: 'user', content: text }
    const next = [...messages, userMessage]
    setMessages(next)
    setInput('')
    setLoading(true)
    setAwaitingFirstDelta(ticketMode)
    if (ticketMode) {
      deepSearchUsedWordsRef.current.clear()
      deepSearchStatusRef.current = ''
    }
    setDeepSearchStatus('')
    // Reset uniquement l'état d'affichage du chat et du panneau Tickets
    setEvidenceSpec(null)
    setEvidenceData(null)

    const isChartMode = chartMode
    const sqlByStep = new Map<string, { sql: string; purpose?: string }>()
    let latestDataset: ChartDatasetPayload | null = null
    let finalAnswer = ''

    try {
      const controller = new AbortController()
      abortRef.current = controller
      setMessages(prev => [...prev, { role: 'assistant', content: '', ephemeral: true }])

      // Force NL→SQL when SQL toggle or Chart mode is active
      const baseMeta: Record<string, unknown> = {}
      if (sqlMode || isChartMode) baseMeta.nl2sql = true
      if (ticketMode) {
        baseMeta.ticket_mode = true
        const periods = ticketRanges
          .map(p => ({ from: p.from?.trim() || undefined, to: p.to?.trim() || undefined }))
          .filter(p => p.from || p.to)
        const sources = [
          {
            table: ticketTable || undefined,
            periods,
          },
          ...extraTicketSources.map(src => ({
            table: src.table || undefined,
            periods: (src.ranges || [])
              .map(r => ({ from: r.from?.trim() || undefined, to: r.to?.trim() || undefined }))
              .filter(r => r.from || r.to),
          })),
        ].filter(s => s.table || (s.periods && s.periods.length > 0))
        if (periods.length > 0) {
          baseMeta.ticket_periods = periods
          baseMeta.tickets_from = periods[0].from
          baseMeta.tickets_to = periods[0].to
        }
        if (ticketTable) baseMeta.ticket_table = ticketTable
        if (sources.length > 0) {
          baseMeta.ticket_sources = sources
        }
        setTicketStatus('Préparation du contexte tickets…')
      } else {
        setTicketStatus('')
      }
      if (conversationId) baseMeta.conversation_id = conversationId
      // Transmettre les exclusions de tables si présentes
      if (excludedTables.size > 0) {
        baseMeta.exclude_tables = Array.from(excludedTables)
        if (saveAsDefault) baseMeta.save_as_default = true
      }
      const payload: ChatCompletionRequest = { messages: next, metadata: baseMeta }

      await streamSSE('/chat/stream', payload, (type, data) => {
        if (type === 'meta') {
          const meta = data as ChatStreamMeta
          if (typeof meta?.conversation_id === 'number') {
            setConversationId(meta.conversation_id)
          }
          if ((meta as any)?.ticket_context) {
            const tc = (meta as any).ticket_context as Record<string, unknown>
            const label = typeof tc.period_label === 'string' ? tc.period_label : ''
            const count = typeof tc.count === 'number' ? tc.count : undefined
            const total = typeof tc.total === 'number' ? tc.total : undefined
            const parts = []
            if (count !== undefined) parts.push(`${count}${total ? `/${total}` : ''} tickets`)
            if (label) parts.push(label)
            setTicketStatus(parts.join(' — ') || 'Contexte tickets appliqué')
          }
          if ((meta as any)?.ticket_context_error) {
            setTicketStatus(String((meta as any).ticket_context_error))
          }
          // Synchronise la sélection effective côté serveur (affichage et cohérence UI)
          if (Array.isArray(meta?.effective_tables)) {
            const eff = meta.effective_tables.filter(x => typeof x === 'string') as string[]
            setEffectiveTables(eff)
            // Ne pas recalculer excludedTables à partir de effective_tables pour éviter flicker
          }
          const detailUpdates: Partial<NonNullable<Message['details']>> = {}
          if (typeof meta?.request_id === 'string' && meta.request_id) {
            detailUpdates.requestId = meta.request_id
          }
          if (typeof meta?.provider === 'string' && meta.provider) {
            detailUpdates.provider = meta.provider
          }
          if (typeof meta?.model === 'string' && meta.model) {
            detailUpdates.model = meta.model
          }
          const retrievalDetail = normalizeRetrievalDetail(meta?.retrieval)
          if (retrievalDetail) {
            detailUpdates.retrieval = retrievalDetail
          }
          if (Object.keys(detailUpdates).length > 0) {
            setMessages(prev => {
              const copy = [...prev]
              const idx = copy.findIndex(m => m.ephemeral)
              if (idx >= 0) {
                const existingDetails = copy[idx].details ? { ...copy[idx].details } : {}
                copy[idx] = {
                  ...copy[idx],
                  details: {
                    ...existingDetails,
                    ...detailUpdates,
                  }
                }
              }
              return copy
            })
          }
          // Capture la spec pour alimenter les tickets à gauche (si fournie)
          const spec = meta?.evidence_spec as EvidenceSpec | undefined
          if (spec && typeof spec === 'object' && spec.entity_label && spec.pk) {
            setEvidenceSpec(spec)
          }
          // Nouveau flux: réinitialiser le statut animator
          setAnimStatus('')
        } else if (type === 'plan') {
          setMessages(prev => {
            const copy = [...prev]
            const idx = copy.findIndex(m => m.ephemeral)
            if (idx >= 0) {
              copy[idx] = {
                ...copy[idx],
                details: { ...(copy[idx].details || {}), plan: data }
              }
            }
            return copy
          })
        } else if (type === 'sql') {
          const stepKey = typeof data?.step !== 'undefined' ? String(data.step) : 'default'
          const sqlText = String(data?.sql || '')
          const entry = { sql: sqlText, purpose: data?.purpose ? String(data.purpose) : undefined }
          sqlByStep.set(stepKey, entry)
          sqlByStep.set('latest', entry)
          const step = { step: data?.step, purpose: data?.purpose, sql: data?.sql }
          setMessages(prev => {
            const copy = [...prev]
            const idx = copy.findIndex(m => m.ephemeral)
            const target = idx >= 0 ? idx : copy.length - 1
            copy[target] = {
              ...copy[target],
              // Ne pas afficher le SQL inline; stocker uniquement pour "Détail"
              details: {
                ...(copy[target].details || {}),
                steps: [ ...((copy[target].details?.steps) || []), step ]
              }
            }
            return copy
          })
        } else if (type === 'rows') {
          const purpose: string | undefined = typeof (data?.purpose) === 'string' ? String(data.purpose) : undefined
          const columns = Array.isArray(data?.columns)
            ? (data.columns as unknown[]).filter((col): col is string => typeof col === 'string')
            : []
          const rows = Array.isArray(data?.rows) ? data.rows : []
          const normalizedRows = normaliseRows(columns, rows)

          if (purpose === 'evidence') {
            const evid: EvidenceRowsPayload = {
              columns,
              rows: normalizedRows,
              row_count: typeof data?.row_count === 'number' ? data.row_count : normalizedRows.length,
              step: typeof data?.step === 'number' ? data.step : undefined,
              purpose
            }
            setEvidenceData(evid)
          } else {
            // Regular NL→SQL samples for charting/debug
            const sample = { step: data?.step, columns: data?.columns, row_count: data?.row_count }
            setMessages(prev => {
              const copy = [...prev]
              const idx = copy.findIndex(m => m.ephemeral)
              if (idx >= 0) {
                copy[idx] = {
                  ...copy[idx],
                  details: {
                    ...(copy[idx].details || {}),
                    samples: [ ...((copy[idx].details?.samples) || []), sample ]
                  }
                }
              }
              return copy
            })
            const stepKey = typeof data?.step !== 'undefined' ? String(data.step) : 'default'
            const sqlInfo = sqlByStep.get(stepKey) ?? sqlByStep.get('latest') ?? { sql: '' }
            const rowCount = typeof data?.row_count === 'number' ? data.row_count : normalizedRows.length
            latestDataset = {
              sql: sqlInfo.sql,
              columns,
              rows: normalizedRows,
              row_count: rowCount,
              step: typeof data?.step === 'number' ? data.step : undefined,
              description: sqlInfo.purpose,
            }
          }
        } else if (type === 'delta') {
          const delta = data as ChatStreamDelta
          // Dès qu'on commence la réponse, on remplace le contenu éventuel d'Animator
          setAnimStatus('')
          setAwaitingFirstDelta(false)
          setMessages(prev => {
            const copy = [...prev]
            const idx = copy.findIndex(m => m.ephemeral)
            const target = idx >= 0 ? idx : copy.length - 1
            const shouldReplace = Boolean((copy[target] as any).interimSql) || Boolean(animStatus)
            copy[target] = {
              ...copy[target],
              content: shouldReplace ? (delta.content || '') : ((copy[target].content || '') + (delta.content || '')),
              interimSql: undefined,
              ephemeral: true,
            }
            return copy
          })
        } else if (type === 'anim') {
          // Message court côté UI; ne pas écraser un SQL intérimaire
          const msg = typeof (data?.message) === 'string' ? String(data.message) : ''
          if (msg) setAnimStatus(msg)
          setMessages(prev => {
            const copy = [...prev]
            const idx = copy.findIndex(m => m.ephemeral)
            if (idx >= 0) {
              const hasInterim = Boolean(copy[idx].interimSql)
              if (!hasInterim && msg) {
                copy[idx] = { ...copy[idx], content: msg, ephemeral: true }
              }
            }
            return copy
          })
        } else if (type === 'done') {
          setAwaitingFirstDelta(false)
          const done = data as ChatStreamDone
          if (typeof done.conversation_id === 'number' && Number.isFinite(done.conversation_id)) {
            setConversationId(done.conversation_id)
          }
          finalAnswer = done.content_full || ''
          setMessages(prev => {
            const copy = [...prev]
            const idx = copy.findIndex(m => m.ephemeral)
            if (idx >= 0) {
              copy[idx] = {
                id: createMessageId(),
                role: 'assistant',
                content: done.content_full,
                // Attach latest NL→SQL dataset (if any) to allow on-demand charting
                ...(latestDataset ? { chartDataset: latestDataset } : {}),
                messageId: typeof done.message_id === 'number' ? done.message_id : undefined,
                details: {
                  ...(copy[idx].details || {}),
                  elapsed: done.elapsed_s
                }
              }
            } else {
              copy.push({
                id: createMessageId(),
                role: 'assistant',
                content: done.content_full,
                ...(latestDataset ? { chartDataset: latestDataset } : {}),
                messageId: typeof done.message_id === 'number' ? done.message_id : undefined,
              })
            }
            return copy
          })
          // Fin du streaming: message final fixé
          // Refresh history list after message persisted
          refreshHistory()
          setAnimStatus('')
        } else if (type === 'error') {
          setAwaitingFirstDelta(false)
          setError(data?.message || 'Erreur streaming')
        }
      }, { signal: controller.signal })

      abortRef.current = null

      if (isChartMode) {
        if (!latestDataset) {
          setMessages(prev => [
            ...prev,
            {
              id: createMessageId(),
              role: 'assistant',
              content: "Aucun résultat SQL exploitable pour générer un graphique."
            }
          ])
          return
        }

        const dataset = latestDataset as ChartDatasetPayload
        if (!dataset.sql || dataset.columns.length === 0 || dataset.rows.length === 0) {
          setMessages(prev => [
            ...prev,
            {
              id: createMessageId(),
              role: 'assistant',
              content: "Aucun résultat SQL exploitable pour générer un graphique."
            }
          ])
          return
        }

        const chartPayload: ChartGenerationRequest = {
          prompt: text,
          answer: finalAnswer || undefined,
          dataset: latestDataset
        }

        try {
          setChartGenerating(true)
          const res = await apiFetch<ChartGenerationResponse>('/mcp/chart', {
            method: 'POST',
            body: JSON.stringify(chartPayload)
          })
          const chartUrl = typeof res?.chart_url === 'string' ? res.chart_url : ''
          const assistantMessage: Message = chartUrl
            ? {
                id: createMessageId(),
                role: 'assistant',
                content: chartUrl,
                chartUrl,
                chartTitle: res?.chart_title,
                chartDescription: res?.chart_description,
                chartTool: res?.tool_name,
                chartPrompt: text,
                chartSpec: res?.chart_spec
              }
            : {
                id: createMessageId(),
                role: 'assistant',
                content: "Impossible de générer un graphique."
              }
          setMessages(prev => [...prev, assistantMessage])
          setChartGenerating(false)
        } catch (chartErr) {
          console.error(chartErr)
          setMessages(prev => [
            ...prev,
            {
              id: createMessageId(),
              role: 'assistant',
              content: "Erreur lors de la génération du graphique."
            }
          ])
          if (chartErr instanceof Error) {
            setError(chartErr.message)
          }
          setChartGenerating(false)
        }
      }
    } catch (e) {
      console.error(e)
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  async function loadConversation(id: number, opts?: { highlightMessageId?: number | null }) {
    try {
      const data = await apiFetch<{
        id: number
        title: string
        messages: Array<{
          role: 'user' | 'assistant'
          content: string
          created_at: string
          message_id?: number
          feedback?: FeedbackValue
          feedback_id?: number
          details?: {
            plan?: any
            steps?: Array<{ step?: number; purpose?: string; sql?: string }>
            retrieval?: RetrievalDetails
          }
        }>
        evidence_spec?: EvidenceSpec
        evidence_rows?: EvidenceRowsPayload
        settings?: { exclude_tables?: string[] }
      }>(`/conversations/${id}`)
      setConversationId(data.id)
      setMessages(
        (data.messages || []).map(m => {
          const details = m.details
            ? ({ ...(m.details as Message['details']) } as Message['details'])
            : undefined
          if (details?.retrieval) {
            const normalized = normalizeRetrievalDetail(details.retrieval)
            if (normalized) {
              details.retrieval = normalized
            } else {
              delete details.retrieval
            }
          }
          return {
            id: createMessageId(),
            role: m.role,
            content: m.content,
            messageId: typeof (m as any).message_id === 'number' ? (m as any).message_id : undefined,
            feedback: (m as any).feedback === 'up' || (m as any).feedback === 'down' ? (m as any).feedback as FeedbackValue : undefined,
            feedbackId: typeof (m as any).feedback_id === 'number' ? (m as any).feedback_id : undefined,
            details,
            ...(m as any).chart_url ? {
              chartUrl: (m as any).chart_url,
              chartTitle: (m as any).chart_title,
              chartDescription: (m as any).chart_description,
              chartTool: (m as any).chart_tool,
              chartSpec: (m as any).chart_spec,
            } : {}
          }
        })
      )
      setEvidenceSpec(data?.evidence_spec ?? null)
      // Defensive normalization: history may contain array-rows; convert to objects
      const ev = data?.evidence_rows
      if (ev && Array.isArray(ev.rows)) {
        const cols = Array.isArray(ev.columns)
          ? (ev.columns as unknown[]).filter((c): c is string => typeof c === 'string')
          : []
        const rowsNorm = normaliseRows(cols, ev.rows as any[])
        setEvidenceData({
          columns: cols,
          rows: rowsNorm,
          row_count: typeof ev.row_count === 'number' ? ev.row_count : rowsNorm.length,
          step: typeof ev.step === 'number' ? ev.step : undefined,
          purpose: ev.purpose
        })
      } else {
        setEvidenceData(ev ?? null)
      }
      // Persisted per-conversation exclusions (if any)
      const ex = Array.isArray(data?.settings?.exclude_tables)
        ? (data!.settings!.exclude_tables as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      setExcludedTables(new Set(ex))
      setEffectiveTables([])
      setHighlightMessageId(typeof opts?.highlightMessageId === 'number' ? opts?.highlightMessageId : null)
      closeHistory()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible')
    }
  }

  // Reset the chat session state. Used by the `?new=1` URL flow (Layout button)
  function onNewChat() {
    if (loading && abortRef.current) {
      abortRef.current.abort()
    }
    setConversationId(null)
    setMessages([])
    setEvidenceSpec(null)
    setEvidenceData(null)
    setError('')
    setHistoryOpen(false)
    setHighlightMessageId(null)
    setTicketStatus('')
    setAwaitingFirstDelta(false)
  }

  async function onFeedback(messageId: string, vote: FeedbackValue) {
    if (!conversationId) return
    const idx = messages.findIndex(m => m.id === messageId)
    if (idx < 0) return
    const msg = messages[idx]
    if (!msg.messageId || msg.feedbackSaving) return
    const same = msg.feedback === vote
    const targetFeedbackId = msg.feedbackId
    setMessages(prev => {
      const copy = [...prev]
      const i = copy.findIndex(m => m.id === messageId)
      if (i >= 0) {
        copy[i] = { ...copy[i], feedbackSaving: true, feedbackError: undefined }
      }
      return copy
    })
    try {
      if (same && targetFeedbackId) {
        await apiFetch<void>(`/feedback/${targetFeedbackId}`, { method: 'DELETE' })
        setMessages(prev =>
          prev.map(m =>
            m.id === messageId
              ? { ...m, feedbackSaving: false, feedback: undefined, feedbackId: undefined, feedbackError: undefined }
              : m
          )
        )
        return
      }
      const res = await apiFetch<FeedbackResponse>('/feedback', {
        method: 'POST',
        body: JSON.stringify({
          conversation_id: conversationId,
          message_id: msg.messageId,
          value: vote,
        }),
      })
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId
            ? {
                ...m,
                feedback: res?.value ?? vote,
                feedbackId: res?.id ?? targetFeedbackId,
                feedbackSaving: false,
                feedbackError: undefined,
              }
            : m
        )
      )
    } catch (err) {
      const feedbackError = err instanceof Error ? err.message : 'Envoi du feedback impossible'
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId
            ? { ...m, feedbackSaving: false, feedbackError }
            : m
        )
      )
    }
  }

  async function onGenerateChart(messageId: string) {
    const index = messages.findIndex(m => m.id === messageId)
    if (index < 0) return
    const msg = messages[index]
    // Prevent duplicate clicks while in-flight
    if (msg.chartSaving) return
    let dataset = msg.chartDataset
    // If dataset missing (typical when loaded from history), try to hydrate from backend
    if (!dataset && conversationId != null) {
      try {
        setMessages(prev => {
          const copy = [...prev]
          const i = copy.findIndex(m => m.id === messageId)
          if (i >= 0) copy[i] = { ...copy[i], chartSaving: true }
          return copy
        })
        const res = await apiFetch<{ dataset: ChartDatasetPayload }>(`/conversations/${conversationId}/dataset?message_index=${index}`)
        if (res?.dataset && res.dataset.sql && (res.dataset.columns?.length ?? 0) > 0 && (res.dataset.rows?.length ?? 0) > 0) {
          dataset = res.dataset
          setMessages(prev => {
            const copy = [...prev]
            const i = copy.findIndex(m => m.id === messageId)
            if (i >= 0) copy[i] = { ...copy[i], chartDataset: dataset, chartSaving: false }
            return copy
          })
        } else {
          setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, chartSaving: false } : m)))
          setError("Impossible de reconstruire un jeu de données pour ce message.")
          return
        }
      } catch (err) {
        setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, chartSaving: false } : m)))
        setError(err instanceof Error ? err.message : 'Hydratation du dataset échouée')
        return
      }
    }
    if (!dataset || !dataset.sql || (dataset.columns?.length ?? 0) === 0 || (dataset.rows?.length ?? 0) === 0) {
      setError("Aucune donnée SQL exploitable pour ce message.")
      return
    }
    // Derive prompt from the closest preceding user message
    let prompt = ''
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        prompt = messages[i].content || ''
        break
      }
    }
    // Mark generating on the source message
    setMessages(prev => {
      const copy = [...prev]
      const i = copy.findIndex(m => m.id === messageId)
      if (i >= 0) copy[i] = { ...copy[i], chartSaving: true }
      return copy
    })
    try {
      const payload: ChartGenerationRequest = { prompt: prompt || 'Générer un graphique', answer: msg.content, dataset }
      const res = await apiFetch<ChartGenerationResponse>('/mcp/chart', { method: 'POST', body: JSON.stringify(payload) })
      const chartUrl = typeof res?.chart_url === 'string' ? res.chart_url : ''
      const assistantMessage: Message = chartUrl
        ? {
            id: createMessageId(),
            role: 'assistant',
            content: chartUrl,
            chartUrl,
            chartTitle: res?.chart_title,
            chartDescription: res?.chart_description,
            chartTool: res?.tool_name,
            chartPrompt: prompt || undefined,
            chartSpec: res?.chart_spec
          }
        : {
            id: createMessageId(),
            role: 'assistant',
            content: 'Impossible de générer un graphique.'
          }
      setMessages(prev => {
        const copy = [...prev]
        // Clear generating flag on the source message and append the chart message
        const i = copy.findIndex(m => m.id === messageId)
        if (i >= 0) copy[i] = { ...copy[i], chartSaving: false }
        copy.push(assistantMessage)
        return copy
      })
      // Persist as conversation event so chart reappears in history
      if (chartUrl && conversationId) {
        try {
          await apiFetch(`/conversations/${conversationId}/chart`, {
            method: 'POST',
            body: JSON.stringify({
              chart_url: chartUrl,
              tool_name: res?.tool_name,
              chart_title: res?.chart_title,
              chart_description: res?.chart_description,
              chart_spec: res?.chart_spec,
            })
          })
        } catch {
          // non-bloquant
        }
      }
    } catch (err) {
      console.error(err)
      setMessages(prev => {
        const copy = [...prev]
        const i = copy.findIndex(m => m.id === messageId)
        if (i >= 0) copy[i] = { ...copy[i], chartSaving: false }
        return copy
      })
      setError(err instanceof Error ? err.message : 'Erreur lors de la génération du graphique')
    }
  }

  async function onSaveChart(messageId: string) {
    const target = messages.find(m => m.id === messageId)
    if (!target || !target.chartUrl) {
      return
    }
    let prompt = target.chartPrompt || ''
    if (!prompt) {
      const targetIndex = messages.findIndex(m => m.id === messageId)
      for (let i = targetIndex - 1; i >= 0; i -= 1) {
        if (messages[i]?.role === 'user') {
          prompt = messages[i].content
          break
        }
      }
    }
    const payload = {
      prompt,
      chart_url: target.chartUrl,
      tool_name: target.chartTool,
      chart_title: target.chartTitle,
      chart_description: target.chartDescription,
      chart_spec: target.chartSpec
    }
    setMessages(prev =>
      prev.map(msg =>
        msg.id === messageId
          ? { ...msg, chartSaving: true, chartSaveError: undefined }
          : msg
      )
    )
    try {
      const saved = await apiFetch<SavedChartResponse>('/charts', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      setMessages(prev =>
        prev.map(msg =>
          msg.id === messageId
            ? {
                ...msg,
                chartSaving: false,
                chartSaved: true,
                chartRecordId: saved?.id ?? msg.chartRecordId,
                chartSaveError: undefined
              }
            : msg
        )
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sauvegarde impossible'
      setMessages(prev =>
        prev.map(msg =>
          msg.id === messageId
            ? { ...msg, chartSaving: false, chartSaveError: message }
            : msg
        )
      )
    }
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  // reset supprimé

  function onCancel() {
    if (abortRef.current) {
      abortRef.current.abort()
    }
  }

  // Accessibility: focus management for Data panel
  const dataPanelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!showDataPanel) return
    // Focus on open + Escape to close
    dataPanelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDataPanel(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showDataPanel])

  function onDataPanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return
    const root = dataPanelRef.current
    if (!root) return
    const focusables = Array.from(root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    ))
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const current = document.activeElement as HTMLElement | null
    if (e.shiftKey) {
      if (current === first || !root.contains(current)) {
        last.focus(); e.preventDefault()
      }
    } else {
      if (current === last || !root.contains(current)) {
        first.focus(); e.preventDefault()
      }
    }
  }

  function includedTablesCount(total: number, excluded: Set<string>, effective: string[]): number {
    // Prefer server effective tables when available, else derive locally
    if (effective && effective.length > 0) return Math.max(effective.length, 0)
    return total > 0 ? Math.max(total - excluded.size, 0) : 0
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-5">
      {/* Colonne gauche: Ticket exploration */}
      <aside className="hidden lg:block lg:col-span-5 xl:col-span-5 2xl:col-span-5">
        <div ref={ticketPanelRef} className="border rounded-lg bg-white shadow-sm p-3 sticky top-20 max-h-[calc(100vh-120px)] overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-primary-900">{evidenceSpec?.entity_label ?? 'Exploration'}</h2>
          </div>
          <TicketPanel spec={evidenceSpec} data={evidenceData} containerRef={ticketPanelRef} />
        </div>
      </aside>

      {/* Colonne droite: Chat */}
      <section className="lg:col-span-7 xl:col-span-7 2xl:col-span-7">
        <div className="border rounded-lg bg-white shadow-sm p-0 flex flex-col min-h-[calc(100vh-120px)]">
          {/* Messages */}
          <div ref={listRef} className="flex-1 p-4 space-y-4 overflow-auto">
            {/* Mobile toolbar (Exploration uniquement) */}
            <div className="sticky top-0 z-10 -mt-4 -mx-4 mb-2 px-4 pt-3 pb-2 bg-white/95 backdrop-blur border-b lg:hidden">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-primary-500">{conversationId ? `Discussion #${conversationId}` : 'Nouvelle discussion'}</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTicketsSheet(true)}
                    className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs bg-white text-primary-700 border-primary-300 hover:bg-primary-50"
                  >
                    <HiBookmark className="w-4 h-4" />
                    Exploration
                    {(() => {
                      const c = evidenceData?.row_count ?? evidenceData?.rows?.length ?? 0
                      return c > 0 ? (
                        <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] px-1 bg-primary-600 text-white">{c}</span>
                      ) : null
                    })()}
                  </button>
                </div>
              </div>
            </div>
            {/* Desktop toolbar (sans boutons Historique/Chat pour éviter doublons avec le header) */}
            <div className="hidden lg:flex items-center justify-between mb-2">
              <div className="text-xs text-primary-500">{conversationId ? `Discussion #${conversationId}` : 'Nouvelle discussion'}</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setShowDataPanel(true)
                    if (dataTables.length === 0 && !tablesLoading) {
                      setTablesLoading(true)
                      try {
                        const items = await apiFetch<Array<{ name: string; path: string }>>('/data/tables')
                        const names = (items || []).map(it => it?.name).filter((x): x is string => typeof x === 'string')
                        setDataTables(names)
                        // TODO: avoid extra fetch by returning last_conversation_settings in /conversations
                        // Initialiser exclusions en conservant celles déjà cochées
                        setExcludedTables(prev => new Set(Array.from(prev).filter(v => names.includes(v))))
                        // Si nouvelle conversation et aucune exclusion encore définie, préremplir avec la dernière conversation
                        if (!conversationId && excludedTables.size === 0 && history.length > 0) {
                          try {
                            const last = await apiFetch<{ settings?: { exclude_tables?: string[] } }>(`/conversations/${history[0].id}`)
                            const ex = Array.isArray(last?.settings?.exclude_tables)
                              ? (last!.settings!.exclude_tables as unknown[]).filter((x): x is string => typeof x === 'string')
                              : []
                            if (ex.length > 0) {
                              const filtered = ex.filter(name => names.includes(name))
                              setExcludedTables(new Set(filtered))
                            }
                          } catch (err) {
                            // best-effort; ignore
                          }
                        }
                      } catch (err) {
                        console.error('Failed to load tables', err)
                      } finally {
                        setTablesLoading(false)
                      }
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs bg-white text-primary-700 border-primary-300 hover:bg-primary-50"
                  title="Voir et exclure des tables pour cette conversation"
                >
                  Données
                  {(() => {
                    const total = dataTables.length
                    const included = includedTablesCount(total, excludedTables, effectiveTables)
                    return total > 0 ? (
                      <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] px-1 bg-primary-600 text-white">{included}</span>
                    ) : null
                  })()}
                </button>
              </div>
            </div>

            {ticketMode && (
              <>
                {showTicketPanel ? (
                  <div className="mb-3 border rounded-2xl bg-primary-50 p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs text-primary-700">
                      <span>Contexte tickets {ticketMeta?.table ? `(${ticketMeta.table})` : ''}</span>
                      <div className="flex items-center gap-3">
                        <span className={clsx('text-[11px]', ticketMetaError ? 'text-red-600' : 'text-primary-600')}>
                          {ticketMetaError || ticketStatus || (ticketMeta?.total ? `${ticketMeta.total} tickets` : '')}
                        </span>
                        <button
                          type="button"
                          className="text-[11px] text-primary-600 underline"
                          onClick={() => setShowTicketPanel(false)}
                        >
                          Masquer
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="text-[11px] text-primary-600">Table</label>
                      <select
                        value={ticketTable}
                        onChange={e => {
                          const next = e.target.value
                          setTicketTable(next)
                          void loadTicketMetadata(next || undefined, { target: 'main' })
                        }}
                        className="border border-primary-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary-400"
                      >
                        <option value="">Auto (config loop)</option>
                        {ticketTables.map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex flex-col gap-2 w-full">
                        {ticketRanges.map((range, idx) => (
                          <div key={range.id} className="flex items-center gap-2 flex-wrap">
                            <label className="text-[11px] text-primary-600">Du</label>
                            <input
                              type="date"
                              value={range.from ?? ''}
                              min={ticketMeta?.min}
                              max={range.to || ticketMeta?.max}
                              onChange={e => {
                                const value = e.target.value || undefined
                                setTicketRanges(prev => prev.map(r => r.id === range.id ? { ...r, from: value } : r))
                              }}
                              className="border border-primary-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary-400"
                            />
                            <span className="text-primary-400 text-xs">→</span>
                            <label className="text-[11px] text-primary-600">au</label>
                            <input
                              type="date"
                              value={range.to ?? ''}
                              min={range.from || ticketMeta?.min}
                              max={ticketMeta?.max}
                              onChange={e => {
                                const value = e.target.value || undefined
                                setTicketRanges(prev => prev.map(r => r.id === range.id ? { ...r, to: value } : r))
                              }}
                              className="border border-primary-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary-400"
                            />
                            {ticketRanges.length > 1 && (
                              <button
                                type="button"
                                className="text-xs text-red-600 underline"
                                onClick={() => setTicketRanges(prev => prev.filter(r => r.id !== range.id))}
                              >
                                Supprimer
                              </button>
                            )}
                            {idx === ticketRanges.length - 1 && (
                              <button
                                type="button"
                                className="text-xs text-primary-700 underline"
                                onClick={() => setTicketRanges(prev => [...prev, { id: createMessageId() }])}
                              >
                                + Ajouter une période
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          className="text-xs text-primary-700 underline self-start"
                          onClick={() => {
                            if (ticketMeta) {
                              setTicketRanges([{ id: createMessageId(), from: ticketMeta.min, to: ticketMeta.max }])
                              setTicketStatus(ticketMeta.total ? `${ticketMeta.total} tickets` : 'Contexte tickets réinitialisé')
                            } else {
                              setTicketRanges([{ id: createMessageId() }])
                            }
                          }}
                        >
                          Réinitialiser
                        </button>
                      </div>
                    </div>

                {/* Tables supplémentaires */}
                {extraTicketSources.map((source, sourceIdx) => {
                  const meta = source.table ? ticketMetaByTable[source.table] : undefined
                  const minDate = meta?.min ?? ticketMeta?.min
                  const maxDate = meta?.max ?? ticketMeta?.max
                  return (
                    <div key={source.id} className="mt-2 border-t border-primary-100 pt-2">
                      <div className="flex items-center justify-between text-xs text-primary-700 mb-1">
                        <span>Table additionnelle {sourceIdx + 1}</span>
                        <button
                          type="button"
                          className="text-[11px] text-red-600 underline"
                          onClick={() => setExtraTicketSources(prev => prev.filter(s => s.id !== source.id))}
                        >
                          Supprimer
                        </button>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-[11px] text-primary-600">Table</label>
                        <select
                          value={source.table ?? ''}
                          onChange={e => {
                            const next = e.target.value
                            setExtraTicketSources(prev =>
                              prev.map(s => (s.id === source.id ? { ...s, table: next } : s))
                            )
                            if (next) {
                              void loadTicketMetadata(next, { target: source.id })
                            }
                          }}
                          className="border border-primary-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary-400"
                        >
                          <option value="">Auto (config loop)</option>
                          {ticketTables.map(name => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-2 w-full mt-1">
                        {(source.ranges || []).map((range, idx) => (
                          <div key={range.id} className="flex items-center gap-2 flex-wrap">
                            <label className="text-[11px] text-primary-600">Du</label>
                            <input
                              type="date"
                              value={range.from ?? ''}
                              min={minDate}
                              max={range.to || maxDate}
                              onChange={e => {
                                const value = e.target.value || undefined
                                setExtraTicketSources(prev =>
                                  prev.map(s =>
                                    s.id === source.id
                                      ? { ...s, ranges: s.ranges.map(r => r.id === range.id ? { ...r, from: value } : r) }
                                      : s
                                  )
                                )
                              }}
                              className="border border-primary-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary-400"
                            />
                            <span className="text-primary-400 text-xs">→</span>
                            <label className="text-[11px] text-primary-600">au</label>
                            <input
                              type="date"
                              value={range.to ?? ''}
                              min={range.from || minDate}
                              max={maxDate}
                              onChange={e => {
                                const value = e.target.value || undefined
                                setExtraTicketSources(prev =>
                                  prev.map(s =>
                                    s.id === source.id
                                      ? { ...s, ranges: s.ranges.map(r => r.id === range.id ? { ...r, to: value } : r) }
                                      : s
                                  )
                                )
                              }}
                              className="border border-primary-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary-400"
                            />
                            {(source.ranges?.length || 0) > 1 && (
                              <button
                                type="button"
                                className="text-xs text-red-600 underline"
                                onClick={() =>
                                  setExtraTicketSources(prev =>
                                    prev.map(s =>
                                      s.id === source.id
                                        ? { ...s, ranges: s.ranges.filter(r => r.id !== range.id) }
                                        : s
                                    )
                                  )
                                }
                              >
                                Supprimer
                              </button>
                            )}
                            {idx === (source.ranges?.length || 1) - 1 && (
                              <button
                                type="button"
                                className="text-xs text-primary-700 underline"
                                onClick={() =>
                                  setExtraTicketSources(prev =>
                                    prev.map(s =>
                                      s.id === source.id
                                        ? { ...s, ranges: [...s.ranges, { id: createMessageId() }] }
                                        : s
                                    )
                                  )
                                }
                              >
                                + Ajouter une période
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          className="text-xs text-primary-700 underline self-start"
                          onClick={() =>
                            setExtraTicketSources(prev =>
                              prev.map(s =>
                                s.id === source.id
                                  ? {
                                      ...s,
                                      ranges: [
                                        { id: createMessageId(), from: minDate, to: maxDate },
                                      ],
                                    }
                                  : s
                              )
                            )
                          }
                        >
                          Réinitialiser cette table
                        </button>
                      </div>
                    </div>
                  )
                })}

                    <button
                      type="button"
                      className="text-xs text-primary-700 underline self-start"
                      onClick={() => setExtraTicketSources(prev => [...prev, { id: createMessageId(), ranges: [{ id: createMessageId() }] }])}
                    >
                      + Ajouter une table
                    </button>
                  </div>
                ) : (
                  <div className="mb-3 border rounded-2xl bg-primary-50 px-3 py-2 flex items-center justify-between text-xs text-primary-700">
                    <div className="flex items-center gap-2">
                      <span>Contexte tickets masqué</span>
                      <span className={clsx('text-[11px]', ticketMetaError ? 'text-red-600' : 'text-primary-600')}>
                        {ticketMetaError || ticketStatus || (ticketMeta?.total ? `${ticketMeta.total} tickets` : '')}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="text-[11px] text-primary-600 underline"
                      onClick={() => setShowTicketPanel(true)}
                    >
                      Afficher
                    </button>
                  </div>
                )}
              </>
            )}

            {messages.map((message, index) => (
              <MessageBubble
                key={message.id ?? index}
                message={message}
                onSaveChart={onSaveChart}
                onGenerateChart={onGenerateChart}
                onFeedback={onFeedback}
                highlighted={message.messageId != null && highlightMessageId === message.messageId}
              />
            ))}
            {(chartGenerating || messages.some(m => m.chartSaving)) && (
              <div className="flex justify-center py-2"><Loader text="Génération du graphique…" /></div>
            )}
            {messages.length === 0 && loading && (
              <div className="flex justify-center py-2"><Loader text="Streaming…" /></div>
            )}
            {ticketMode && awaitingFirstDelta && (
              <div className="flex items-center gap-2 text-xs text-primary-500 py-2 pl-1">
                <span className="inline-block h-3 w-3 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                <span>
                  <span className="font-semibold text-primary-700">DeepSearch mode :</span> {deepSearchStatus}
                </span>
              </div>
            )}
            {error && (
              <div className="mt-2 bg-red-50 border-2 border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="p-3">
            <div className="relative">
              <div className="absolute left-2 top-1/2 -translate-y-1/2 transform inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleTicketModeClick}
                  aria-pressed={!ticketMode}
                  title={!ticketMode ? 'Mode base actif (agents SQL/RAG)' : 'Activer le contexte tickets par défaut'}
                  className={clsx(
                    'inline-flex items-center justify-center h-10 w-10 rounded-full transition-colors focus:outline-none border-2',
                    !ticketMode
                      ? 'bg-primary-700 text-white hover:bg-primary-800 border-primary-700'
                      : 'bg-white text-primary-700 border-primary-200 hover:bg-primary-50'
                  )}
                >
                  {ticketMetaLoading ? (
                    <span className="inline-block h-4 w-4 border-2 border-primary-200 border-t-primary-700 rounded-full animate-spin" />
                  ) : (
                    <HiCpuChip className="w-5 h-5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={onToggleChartModeClick}
                  aria-pressed={chartMode}
                  title="Activer MCP Chart"
                  className={clsx(
                    'inline-flex items-center justify-center h-10 w-10 rounded-full transition-colors focus:outline-none border-2',
                    chartMode
                      ? 'bg-primary-600 text-white hover:bg-primary-700 border-primary-600'
                      : 'bg-white text-primary-700 border-primary-200 hover:bg-primary-50'
                  )}
                >
                  <HiChartBar className="w-5 h-5" />
                </button>
              </div>
              <Textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Posez votre question"
                rows={1}
                fullWidth
                className={clsx(
                  'pl-28 pr-14 h-12 min-h-[48px] resize-none overflow-x-auto overflow-y-hidden scrollbar-none no-focus-ring !rounded-2xl',
                  'focus:!border-primary-200 focus:!ring-0 focus:!ring-transparent focus:!ring-offset-0 focus:!outline-none',
                  'focus-visible:!border-primary-200 focus-visible:!ring-0 focus-visible:!ring-transparent focus-visible:!ring-offset-0 focus-visible:!outline-none',
                  'leading-[48px] placeholder:text-primary-400',
                  'text-left whitespace-nowrap'
                )}
              />
              {/* Envoyer/Annuler */}
              <button
                type="button"
                onClick={loading ? onCancel : onSend}
                disabled={loading ? false : !input.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 transform inline-flex items-center justify-center h-10 w-10 rounded-full bg-primary-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-700 transition-colors"
                aria-label={loading ? 'Annuler' : 'Envoyer le message'}
                title={loading ? 'Annuler' : 'Envoyer'}
              >
                {loading ? (
                  <HiXMark className="w-5 h-5" />
                ) : (
                  <HiPaperAirplane className="w-5 h-5" />
                )}
              </button>
            </div>
            {null}
          </div>
        </div>
      </section>

      {/* Panel Données utilisées */}
      {showDataPanel && (
        <div className="fixed inset-0 z-50" aria-hidden={false}>
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowDataPanel(false)} />
          <div
            ref={dataPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-panel-title"
            onKeyDown={onDataPanelKeyDown}
            tabIndex={-1}
            className="absolute left-1/2 top-16 -translate-x-1/2 w-[min(92vw,560px)] bg-white rounded-2xl border shadow-lg p-4 outline-none"
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 id="data-panel-title" className="text-sm font-semibold text-primary-900">Données utilisées</h2>
                <div className="text-[11px] text-primary-500">Cochez pour inclure, décochez pour exclure (par conversation)</div>
              </div>
              <button
                type="button"
                onClick={() => setShowDataPanel(false)}
                className="h-7 w-7 inline-flex items-center justify-center rounded-full border border-primary-200 hover:bg-primary-50"
                aria-label="Fermer"
                title="Fermer"
              >
                <HiXMark className="w-4 h-4" />
              </button>
            </div>
            <div className="border rounded-lg p-2 max-h-[50vh] overflow-auto">
              {tablesLoading ? (
                <div className="text-sm text-primary-500">Chargement…</div>
              ) : dataTables.length === 0 ? (
                <div className="text-sm text-primary-500">Aucune table disponible.</div>
              ) : (
                <ul className="space-y-1">
                  {dataTables.map(name => {
                    const key = name.toLowerCase()
                    const included = !excludedTables.has(name)
                    const effective = effectiveTables.length > 0 ? effectiveTables.some(t => t.toLowerCase() === key) : undefined
                    return (
                      <li key={name} className="flex items-center justify-between gap-2">
                        <label className={clsx('flex items-center gap-2 text-sm', loading && 'opacity-60 pointer-events-none')}
                          title={effective === false ? 'Exclue (non utilisée côté serveur)' : effective === true ? 'Incluse (utilisée côté serveur)' : ''}
                        >
                          <input
                            type="checkbox"
                            checked={included}
                            disabled={loading}
                            onChange={(e) => {
                              setExcludedTables(prev => {
                                const next = new Set(prev)
                                if (e.target.checked) {
                                  next.delete(name)
                                } else {
                                  next.add(name)
                                }
                                return next
                              })
                            }}
                          />
                          <span className="text-primary-800">{name}</span>
                        </label>
                        {typeof effective === 'boolean' && (
                          <span className={clsx('text-[11px] rounded-full border px-2 py-[2px]', effective ? 'text-primary-600 border-primary-200' : 'text-primary-400 border-primary-100')}>{effective ? 'actif' : 'exclu'}</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-primary-800">
                <input type="checkbox" checked={saveAsDefault} onChange={e => setSaveAsDefault(e.target.checked)} />
                Sauvegarder ces exclusions comme valeur par défaut
              </label>
              <div className="text-[11px] text-primary-500">Appliquées au prochain message. Pas de fallback.</div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom sheet (mobile) for tickets */}
      {showTicketsSheet && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowTicketsSheet(false)} />
          <div ref={mobileTicketsRef} className="absolute left-0 right-0 bottom-0 max-h-[70vh] bg-white rounded-t-2xl border-t shadow-lg p-3 overflow-auto">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm font-semibold text-primary-900">{evidenceSpec?.entity_label ?? 'Exploration'}</div>
                {evidenceSpec?.period && (
                  <div className="text-[11px] text-primary-500">
                    {typeof evidenceSpec.period === 'string' ? evidenceSpec.period : `${evidenceSpec.period.from ?? ''}${evidenceSpec.period.to ? ` → ${evidenceSpec.period.to}` : ''}`}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowTicketsSheet(false)}
                className="h-7 w-7 inline-flex items-center justify-center rounded-full border border-primary-200 hover:bg-primary-50"
                aria-label="Fermer"
                title="Fermer"
              >
                <HiXMark className="w-4 h-4" />
              </button>
            </div>
            <TicketPanel spec={evidenceSpec} data={evidenceData} containerRef={mobileTicketsRef} />
          </div>
        </div>
      )}

      {/* History modal */}
      {historyOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={closeHistory} />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg border shadow-lg w-[90vw] max-w-xl max-h-[80vh] overflow-auto">
            <div className="p-3 border-b flex items-center justify-between">
              <div className="text-sm font-semibold">Conversations</div>
              <button className="text-xs underline" onClick={refreshHistory}>Rafraîchir</button>
            </div>
            <div className="p-3">
              {history.length === 0 && (
                <div className="text-sm text-primary-500">Aucune conversation</div>
              )}
              <ul className="divide-y">
                {history.map(item => (
                  <li key={item.id} className="py-2 flex items-center justify-between">
                    <button
                      className="text-left text-sm text-primary-900 hover:underline"
                      onClick={() => loadConversation(item.id)}
                    >
                      <div className="font-medium truncate max-w-[42ch]">{item.title || `Discussion #${item.id}`}</div>
                      <div className="text-xs text-primary-500">{new Date(item.updated_at).toLocaleString()}</div>
                    </button>
                    <button
                      className="text-xs border rounded-full px-2 py-1 hover:bg-primary-50"
                      onClick={() => loadConversation(item.id)}
                    >Ouvrir</button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface MessageBubbleProps {
  message: Message
  onSaveChart?: (messageId: string) => void
  onGenerateChart?: (messageId: string) => void
  onFeedback?: (messageId: string, vote: FeedbackValue) => void
  highlighted?: boolean
}

// -------- Left panel: Tickets from evidence --------
type TicketPanelProps = {
  spec: EvidenceSpec | null
  data: EvidenceRowsPayload | null
  containerRef?: RefObject<HTMLDivElement>
}

function TicketPanel({ spec, data, containerRef }: TicketPanelProps) {
  // Preview caps (configurable)
  const PREVIEW_COL_MAX = TICKETS_CONFIG.PREVIEW_COL_MAX
  const PREVIEW_CHAR_MAX = TICKETS_CONFIG.PREVIEW_CHAR_MAX

  const count = data?.row_count ?? data?.rows?.length ?? 0
  const limit = spec?.limit ?? 100
  const allRows: Record<string, unknown>[] = data?.rows ?? []
  const rows = allRows.slice(0, limit)
  const extra = Math.max((count || 0) - rows.length, 0)
  // Derive columns from the union of keys present in rows to ensure
  // all SQL-returned fields are visible, regardless of LLM hints.
  const derivedCols = useMemo(() => {
    // PR#58: derive from a small, stable sample to keep order predictable
    const SAMPLE = Math.min(20, rows.length)
    const sample = rows.slice(0, SAMPLE)
    const ordered = new Set<string>()
    for (const r of sample) {
      for (const k of Object.keys(r || {})) {
        if (!ordered.has(k)) ordered.add(k)
      }
    }
    return Array.from(ordered)
  }, [rows])
  const columns: string[] = (derivedCols.length > 0)
    ? derivedCols
    : (data?.columns ?? spec?.columns ?? [])
  const createdAtKey = spec?.display?.created_at
  const titleKey = spec?.display?.title
  const statusKey = spec?.display?.status
  const pkKey = spec?.pk
  const linkTpl = spec?.display?.link_template

  if (import.meta?.env?.MODE !== 'production') {
    try {
      // Lightweight dev log for diagnostics
      console.info('[evidence_panel] columns', {
        from_spec: spec?.columns?.length ?? 0,
        from_data: data?.columns?.length ?? 0,
        derived: columns.length,
      })
    } catch {}
  }

  // Local focus state: clicked ticket → full detail view
  const [selectedPk, setSelectedPk] = useState<string | null>(null)
  const prevScrollTop = useRef(0)

  function openDetail(pk: unknown) {
    if (containerRef?.current) {
      try { prevScrollTop.current = containerRef.current.scrollTop } catch (err) { if (import.meta?.env?.MODE !== 'production') console.warn('TicketPanel: failed reading scrollTop', err) }
    }
    setSelectedPk(String(pk))
  }

  function backToList() {
    setSelectedPk(null)
    const el = containerRef?.current
    if (el) {
      // Wait next paint to ensure list is rendered
      requestAnimationFrame(() => { try { el.scrollTop = prevScrollTop.current || 0 } catch (err) { if (import.meta?.env?.MODE !== 'production') console.warn('TicketPanel: failed restoring scrollTop', err) } })
    }
  }

  function orderColumns(cols: string[]): string[] {
    const set = new Set<string>()
    const push = (k?: string) => { if (k && cols.includes(k) && !set.has(k)) set.add(k) }
    push(titleKey)
    push(statusKey)
    push(createdAtKey)
    push(pkKey)
    cols.forEach(c => { if (!set.has(c)) set.add(c) })
    return Array.from(set)
  }

  function truncate(val: unknown, max = PREVIEW_CHAR_MAX): string {
    const s = String(val ?? '')
    if (s.length <= max) return s
    return s.slice(0, Math.max(max - 1, 0)) + '…'
  }

  const sorted = useMemo(() => {
    if (!createdAtKey) return rows
    const key = createdAtKey
    return [...rows].sort((a, b) => {
      const va = a[key]
      const vb = b[key]
      const da = va ? new Date(String(va)) : null
      const db = vb ? new Date(String(vb)) : null
      const ta = da && !isNaN(da.getTime()) ? da.getTime() : 0
      const tb = db && !isNaN(db.getTime()) ? db.getTime() : 0
      return tb - ta
    })
  }, [rows, createdAtKey])

  function buildLink(tpl: string | undefined, row: Record<string, unknown>) {
    if (!tpl) return undefined
    try {
      // Encode dynamic values to prevent injection into path/query
      const replaced = tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(row[k] ?? '')))
      // Build URL against current origin to validate protocol and normalize
      const url = new URL(replaced, window.location.origin)
      const allowed = ['http:', 'https:']
      if (!allowed.includes(url.protocol)) return undefined
      // Return relative path when template intended a relative URL
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(replaced)) {
        return url.pathname + url.search + url.hash
      }
      return url.href
    } catch (err) {
      if (import.meta?.env?.MODE !== 'production') {
        // Avertir en dev si le gabarit de lien est invalide
        console.warn('TicketPanel.buildLink: invalid link template', { tpl, err })
      }
      return undefined
    }
  }

  // Stable hooks before any conditional return
  const orderedColumns = useMemo(() => orderColumns(columns), [columns, titleKey, statusKey, createdAtKey, pkKey])
  const previewColumns = useMemo(() => orderedColumns.slice(0, PREVIEW_COL_MAX), [orderedColumns, PREVIEW_COL_MAX])

  if (!spec || !data || (count ?? 0) === 0) {
    return (
      <div className="text-sm text-primary-500">
        Aucun ticket détecté. Posez une question pour afficher les éléments concernés.
      </div>
    )
  }

  // Detail view when a ticket is selected
  if (selectedPk != null) {
    if (!pkKey) {
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-primary-900">Détail</div>
            <button type="button" onClick={backToList} className="text-xs rounded-full border px-2 py-1 hover:bg-primary-50">Tout voir</button>
          </div>
          <div className="text-sm text-red-600">Configuration manquante: clé primaire introuvable.</div>
        </div>
      )
    }
    const row = sorted.find(r => String(r[pkKey]) === selectedPk)
    const link = row ? buildLink(linkTpl, row) : undefined
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-primary-900">Détail du ticket</div>
          <button
            type="button"
            onClick={backToList}
            className="text-xs rounded-full border px-2 py-1 hover:bg-primary-50"
          >
            Tout voir
          </button>
        </div>
        {!row ? (
          <div className="text-sm text-primary-500">Élément introuvable.</div>
        ) : (
          <div className="border border-primary-100 rounded-md p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-primary-900 truncate">
                {String((titleKey && row[titleKey]) ?? row[pkKey] ?? selectedPk)}
              </div>
              {statusKey && row[statusKey] != null ? (
                <span className="text-[11px] rounded-full border px-2 py-[2px] text-primary-600 border-primary-200">{String(row[statusKey])}</span>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-primary-500">
              {createdAtKey && row[createdAtKey] ? new Date(String(row[createdAtKey])).toLocaleString() : null}
            </div>
            {link && (
              <div className="mt-1 text-xs">
                <a href={link} target="_blank" rel="noopener noreferrer" className="underline text-primary-600 break-all">{link}</a>
              </div>
            )}
            <div className="mt-2 overflow-auto">
              <table className="min-w-full text-[11px]">
                <tbody>
                  {orderedColumns.map((c) => (
                    <tr key={c} className="border-t border-primary-100">
                      <td className="pr-2 py-1 text-primary-400 whitespace-nowrap align-top">{c}</td>
                      <td className="py-1 text-primary-800 break-all">{String(row[c] ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    )
  }

  // List view with preview caps
  return (
    <div className="space-y-2">
      {sorted.map((row, idx) => {
        const title = titleKey ? row[titleKey] : undefined
        const status = statusKey ? row[statusKey] : undefined
        const created = createdAtKey ? row[createdAtKey] : undefined
        const pk = pkKey ? row[pkKey] : undefined
        const link = buildLink(linkTpl, row)
        const uniqueKey = pk != null ? String(pk) : `row-${idx}`
        return (
          <div
            key={uniqueKey}
            role="button"
            tabIndex={0}
            onClick={() => pkKey && pk != null && openDetail(pk)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pkKey && pk != null && openDetail(pk) } }}
            className="border border-primary-100 rounded-md p-2 hover:bg-primary-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-300"
            aria-label={`Voir le ticket ${String(title ?? pk ?? `#${idx + 1}`)}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-primary-900 truncate">
                {String(title ?? (pk ?? `#${idx + 1}`))}
              </div>
              {status != null ? (
                <span className="text-[11px] rounded-full border px-2 py-[2px] text-primary-600 border-primary-200">{String(status)}</span>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-primary-500">
              {created ? new Date(String(created)).toLocaleString() : null}
            </div>
            {link && (
              <div className="mt-1 text-xs">
                <a href={link} target="_blank" rel="noopener noreferrer" className="underline text-primary-600 break-all" onClick={e => e.stopPropagation()}>{link}</a>
              </div>
            )}
            {previewColumns && previewColumns.length > 0 && (
              <div className="mt-2 overflow-auto">
                <table className="min-w-full text-[11px]">
                  <tbody>
                    {previewColumns.map((c) => (
                      <tr key={c} className="border-t border-primary-100">
                        <td className="pr-2 py-1 text-primary-400 whitespace-nowrap align-top">{c}</td>
                        <td className="py-1 text-primary-800 break-all" title={String(row[c] ?? '')}>{truncate(row[c])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
      {extra > 0 && (
        <div className="text-[11px] text-primary-500">+{extra} supplémentaires non affichés</div>
      )}
    </div>
  )
}

function MessageBubble({ message, onSaveChart, onGenerateChart, onFeedback, highlighted }: MessageBubbleProps) {
  const {
    id,
    role,
    content,
    chartUrl,
    chartTitle,
    chartDescription,
    chartTool,
    chartSaved,
    chartSaving,
    chartSaveError
  } = message
  const isUser = role === 'user'
  const [showDetails, setShowDetails] = useState(false)
  const renderedContent = useMemo(() => renderMarkdown(content), [content])
  const markdownClass = useMemo(
    () => clsx('message-markdown', isUser && 'message-markdown--user'),
    [isUser]
  )
  const feedbackPending = Boolean(message.feedbackSaving)
  const canFeedback = !isUser && !message.ephemeral && !chartUrl && Boolean(message.messageId)
  const feedbackUp = message.feedback === 'up'
  const feedbackDown = message.feedback === 'down'
  const handleFeedback = (vote: FeedbackValue) => {
    if (!id || !onFeedback) return
    onFeedback(id, vote)
  }
  return (
    <div
      data-message-id={message.messageId ?? undefined}
      className={clsx(
        'flex',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={clsx(
          'animate-slide-up',
          isUser
            ? 'max-w-[75%] rounded-lg px-4 py-3 bg-primary-950 text-white shadow-sm'
            : clsx(
                'max-w-full bg-transparent p-0 rounded-none shadow-none',
                message.ephemeral && 'opacity-70'
              ),
          highlighted && !isUser && 'ring-2 ring-primary-200 ring-offset-2 ring-offset-white rounded-xl'
        )}
      >
        {/* Label d'auteur supprimé (Vous/Assistant) pour une UI plus épurée */}
        {chartUrl && !isUser ? (
          <div className="space-y-3">
            {chartTitle && (
              <div className="text-sm font-semibold text-primary-900">
                {chartTitle}
              </div>
            )}
            <a
              href={chartUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary-600 break-all underline"
            >
              {chartUrl}
            </a>
            <img
              src={chartUrl}
              alt={chartTitle || 'Graphique MCP'}
              className="w-full rounded-md border border-primary-100"
            />
            {chartDescription && (
              <p className="text-xs text-primary-700 whitespace-pre-wrap">
                {chartDescription}
              </p>
            )}
            {chartTool && (
              <p className="text-[11px] uppercase tracking-wide text-primary-400">
                Outil : {chartTool}
              </p>
            )}
            {!chartSaved && onSaveChart && (
              <div className="pt-2">
                <Button
                  size="sm"
                  onClick={() => id && onSaveChart(id)}
                  disabled={chartSaving || !id}
                >
                  <HiBookmark className="w-4 h-4 mr-2" />
                  {chartSaving ? 'Enregistrement…' : 'Enregistrer dans le dashboard'}
                </Button>
              </div>
            )}
            {chartSaved && (
              <div className="flex items-center gap-2 text-xs text-primary-600 pt-2">
                <HiCheckCircle className="w-4 h-4" />
                <span>Graphique enregistré</span>
              </div>
            )}
            {chartSaveError && (
              <p className="text-xs text-red-600 pt-2">
                {chartSaveError}
              </p>
            )}
          </div>
        ) : (
          <div className={clsx(
            'text-sm leading-relaxed',
            markdownClass,
            isUser ? 'text-white' : 'text-primary-950'
          )}>
            <div
              className={clsx(
                'space-y-2',
                isUser ? '[&_a]:text-white [&_code]:bg-primary-900/50' : '[&_a]:text-primary-700',
                '[&_a]:underline [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:p-3 [&_pre]:bg-primary-50 [&_pre]:rounded-md [&_pre]:text-[13px] [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-4 [&_ol]:pl-4'
              )}
              dangerouslySetInnerHTML={{ __html: renderedContent || '' }}
            />
            {/* Actions: Graphique + Détails (affichés uniquement quand le message est finalisé) */}
            {!isUser && !chartUrl && !message.ephemeral && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {canFeedback && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleFeedback('up')}
                      disabled={feedbackPending}
                      aria-pressed={feedbackUp}
                      className={clsx(
                        'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors',
                        feedbackUp
                          ? 'bg-green-100 border-green-200 text-green-800'
                          : 'border-primary-200 text-primary-600 hover:bg-primary-50',
                        feedbackPending && 'opacity-60 cursor-not-allowed'
                      )}
                      title="Pouce en l'air"
                    >
                      <HiHandThumbUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFeedback('down')}
                      disabled={feedbackPending}
                      aria-pressed={feedbackDown}
                      className={clsx(
                        'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors',
                        feedbackDown
                          ? 'bg-red-100 border-red-200 text-red-800'
                          : 'border-primary-200 text-primary-600 hover:bg-primary-50',
                        feedbackPending && 'opacity-60 cursor-not-allowed'
                      )}
                      title="Pouce en bas"
                    >
                      <HiHandThumbDown className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => message.id && onGenerateChart && onGenerateChart(message.id)}
                  disabled={
                    !message.id || Boolean(message.chartSaving) ||
                    !(
                      (message.chartDataset && message.chartDataset.sql &&
                        (message.chartDataset.columns?.length ?? 0) > 0 &&
                        (message.chartDataset.rows?.length ?? 0) > 0) ||
                      (message.details && Array.isArray(message.details.steps) && message.details.steps.some(s => typeof s?.sql === 'string' && s.sql))
                    )
                  }
                  title={
                    message.chartDataset && (message.chartDataset.columns?.length ?? 0) > 0 && (message.chartDataset.rows?.length ?? 0) > 0
                      ? 'Générer un graphique à partir du jeu de données'
                      : 'Aucun jeu de données exploitable pour le graphique'
                  }
                >
                  {message.chartSaving ? (
                    <span className="inline-block h-4 w-4 mr-2 rounded-full border-2 border-primary-300 border-t-primary-900 animate-spin" />
                  ) : (
                    <HiChartBar className="w-4 h-4 mr-2" />
                  )}
                  {message.chartSaving ? 'Génération…' : 'Graphique'}
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => setShowDetails(v => !v)}
                >
                  {showDetails ? 'Masquer' : 'Détails'}
                </Button>
                {message.feedbackError && (
                  <span className="text-[11px] text-red-600">{message.feedbackError}</span>
                )}
              </div>
            )}
          </div>
        )}
        {/* Détails n'apparaissent que lorsque le message est finalisé */}
        {!isUser && !message.ephemeral && message.details && (
          message.details.steps?.length ||
          message.details.plan ||
          message.details.retrieval?.rows?.length
        ) ? (
          <div className="mt-2 text-xs">
            {showDetails && (
              <div className="mt-1 space-y-2 text-primary-700">
                {/* Métadonnées masquées (request_id/provider/model/elapsed) pour alléger l'affichage */}
                {message.details.steps && message.details.steps.length > 0 && (
                  <div className="text-[11px]">
                    <div className="uppercase tracking-wide text-primary-500 mb-1">SQL exécuté</div>
                    <ul className="list-disc ml-5 space-y-1 max-h-40 overflow-auto">
                      {message.details.steps.map((s, i) => (
                        <li key={i} className="break-all">
                          {s.step ? `#${s.step} ` : ''}{s.purpose ? `[${s.purpose}] ` : ''}{s.sql}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {message.details.samples && message.details.samples.length > 0 && (
                  <div className="text-[11px]">
                    <div className="uppercase tracking-wide text-primary-500 mb-1">Échantillons</div>
                    <ul className="grid grid-cols-2 gap-2">
                      {message.details.samples.map((s, i) => (
                        <li key={i} className="truncate">
                          {s.step ? `#${s.step}: ` : ''}{s.columns?.slice(0,3)?.join(', ') || '—'} ({s.row_count ?? 0} lignes)
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {message.details.retrieval?.rows && message.details.retrieval.rows.length > 0 && (
                  <div className="text-[11px]">
                    <div className="uppercase tracking-wide text-primary-500 mb-1 flex items-center justify-between">
                      <span>Lignes RAG</span>
                      {typeof message.details.retrieval.round === 'number' && (
                        <span className="text-[10px] text-primary-400">itération {message.details.retrieval.round}</span>
                      )}
                    </div>
                    <ul className="space-y-1 max-h-48 overflow-auto pr-1">
                      {message.details.retrieval.rows.map((row, i) => {
                        const values = row.values && Object.entries(row.values)
                          .filter(([, value]) => value != null && String(value ?? '').trim() !== '')
                        const formatted = values && values.length > 0
                          ? values.slice(0, 4).map(([key, value]) => `${key}: ${String(value ?? '')}`)
                          : null
                        return (
                          <li
                            key={`${row.table ?? 'row'}-${i}`}
                            className="border border-primary-100 rounded p-2 space-y-1 text-primary-700"
                          >
                            <div className="flex items-center justify-between gap-2 text-[10px]">
                              <span className="font-semibold text-primary-800">
                                {row.table || `Exemple #${i + 1}`}
                              </span>
                              {typeof row.score === 'number' && Number.isFinite(row.score) && (
                                <span className="text-primary-500">score {row.score.toFixed(3)}</span>
                              )}
                            </div>
                            {row.focus && (
                              <div className="text-[11px] text-primary-700 break-words">
                                {(row.source_column || 'Focus')} : {row.focus}
                              </div>
                            )}
                            {formatted && (
                              <div className="text-[10px] text-primary-500 break-words">
                                {formatted.join(' · ')}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// Evidence UI supprimée (panneau remplacé par Ticket exploration à gauche)

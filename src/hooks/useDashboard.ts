import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadDashboardData } from '../adapters/marketData'
import { fetchScanStatus } from '../adapters/providers/liveFetch'
import { ideaMatchesFinvizGroup } from '../lib/groupMatch'
import { GROUP_PERIODS, isGroupPeriod, isGroupSlug } from '../lib/groupPeriod'
import { stageSortRank } from '../lib/setupStage'
import type {
  DashboardData,
  GroupPeriod,
  GroupStocksResponse,
  IdeaFilters,
  IndustryGroup,
  TradingIdea,
} from '../types'
import { DEFAULT_FILTERS } from '../types'
import { useGroups } from './useGroups'
import { useUserWatchlist } from './useUserWatchlist'

const GROUPS_PERIOD_KEY = 'qm-groups-period'

function readStoredPeriod(): GroupPeriod {
  try {
    const raw = localStorage.getItem(GROUPS_PERIOD_KEY)
    if (raw && isGroupPeriod(raw)) return raw
  } catch {
    /* ignore */
  }
  return '3m'
}

function errorText(value: unknown, status: number): string {
  if (value && typeof value === 'object' && 'error' in value) {
    const message = (value as { error?: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  return status ? `HTTP ${status}` : 'group request failed'
}

function isGroupStocksResponse(value: unknown): value is GroupStocksResponse {
  if (!value || typeof value !== 'object') return false
  const body = value as Partial<GroupStocksResponse>
  return (
    (body.source === 'finviz' || body.source === 'snapshot') &&
    typeof body.slug === 'string' &&
    typeof body.label === 'string' &&
    typeof body.period === 'string' &&
    isGroupPeriod(body.period) &&
    typeof body.fetchedAt === 'string' &&
    typeof body.stale === 'boolean' &&
    Array.isArray(body.ideas) &&
    Array.isArray(body.failed) &&
    typeof body.parsedCount === 'number' &&
    body.finvizPerf != null &&
    typeof body.finvizPerf === 'object'
  )
}

const SCAN_POLL_MS = 3000
const SCAN_POLL_CAP_MS = 3 * 60 * 1000

function matchesFilters(
  idea: TradingIdea,
  f: IdeaFilters,
  groupSource: 'finviz' | 'fallback' | null,
  groups: IndustryGroup[],
  groupView = false,
): boolean {
  const below200 = !idea.aboveSma200
  // Hard gate on the normal scan. Group drill-down keeps below-200 names and flags them.
  if (!groupView && below200) return false
  // Below-200 drill-down rows skip the setup-stage and SMA preference gates so the flag stays visible.
  const exemptTrendGates = groupView && below200
  if (!exemptTrendGates) {
    if (f.requireSma50 && !idea.aboveSma50) return false
    if (f.requireSma10 && !idea.aboveSma10) return false
    if (f.requireSma20 && !idea.aboveSma20) return false
    if (f.stages.length && !f.stages.includes(idea.setupStage)) return false
  }
  if (idea.rvol < f.minRvol) return false
  const distance = Math.abs(Math.min(0, idea.pctFrom52wHigh))
  if (distance > f.maxPctFromHigh) return false
  if (!f.setupTypes.includes(idea.setupType)) return false
  if (f.aPlusOnly && !idea.isAPlus) return false
  // A+ only never includes earnings avoid (isAPlus already false); still honor status filter
  if (f.earningsStatuses?.length && !f.earningsStatuses.includes(idea.earningsStatus)) {
    return false
  }
  if (f.hasCatalyst && !idea.catalyst) return false
  if (!groupView && f.groupId) {
    if (groupSource === 'finviz') {
      const group = groups.find((g) => g.id === f.groupId)
      if (!group || !ideaMatchesFinvizGroup(idea, group)) return false
    } else if (idea.groupId !== f.groupId) {
      return false
    }
  }
  if (f.search) {
    const q = f.search.toLowerCase()
    const hay =
      `${idea.ticker} ${idea.name} ${idea.groupName} ${idea.setupStage} ${idea.characteristics.join(' ')}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

export function useDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState<string | null>(null)
  const [mode, setMode] = useState<'live' | 'demo'>('live')
  const [filters, setFilters] = useState<IdeaFilters>({ ...DEFAULT_FILTERS })
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const [period, setPeriodState] = useState<GroupPeriod>(readStoredPeriod)
  const [groupRetry, setGroupRetry] = useState(0)
  const [groupStocks, setGroupStocks] = useState<{
    slug: string
    period: GroupPeriod
    error: string | null
    data: GroupStocksResponse | null
  } | null>(null)
  const groupReq = useRef(0)

  const { ingestScanIdeas, ...userWatchlistRest } = useUserWatchlist()
  const { payload: groupsPayload, loading: groupsFetchLoading } = useGroups()
  const pollStartedAt = useRef<number | null>(null)
  const reloadRef = useRef<(opts?: { refreshScan?: boolean }) => Promise<void>>(
    async () => undefined,
  )

  const reload = useCallback(async (opts?: { refreshScan?: boolean }) => {
    setLoading(true)
    setError(null)
    // Initial page load reads cache only. Explicit Refresh asks the server to rescan.
    if (opts?.refreshScan) {
      try {
        await fetch('/api/market/scan/refresh', { method: 'POST' })
        await new Promise((r) => setTimeout(r, 300))
      } catch {
        // Ignore trigger errors — cache read below reports the real problem.
      }
    }
    const result = await loadDashboardData()
    setMode(result.mode)
    if (result.ok) {
      setData(result.data)
      setError(null)
      setScanning(false)
      setScanMessage(null)
      pollStartedAt.current = null
      ingestScanIdeas(result.data.ideas)
    } else if (result.scanning) {
      // Cold start: do not treat as fatal LIVE ERROR — poll until cache is ready.
      setData(null)
      setError(null)
      setScanning(true)
      setScanMessage(result.error || 'Scanning US market…')
      setSelectedTicker(null)
      if (pollStartedAt.current == null) {
        pollStartedAt.current = Date.now()
      }
    } else {
      setData(null)
      setError(result.error)
      setScanning(false)
      setScanMessage(null)
      pollStartedAt.current = null
      setSelectedTicker(null)
    }
    setLoading(false)
  }, [ingestScanIdeas])

  reloadRef.current = reload

  useEffect(() => {
    void reload()
  }, [reload])

  // Poll scan status while warming; cap ~3 min then surface a clear retry.
  useEffect(() => {
    if (!scanning) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      if (cancelled) return
      const started = pollStartedAt.current ?? Date.now()
      if (pollStartedAt.current == null) pollStartedAt.current = started
      const elapsed = Date.now() - started

      if (elapsed >= SCAN_POLL_CAP_MS) {
        setScanning(false)
        setScanMessage(null)
        setError(
          'Market scan is taking longer than expected. Click Retry — the server may still be warming on a free-tier cold start.',
        )
        pollStartedAt.current = null
        return
      }

      try {
        const status = await fetchScanStatus()
        if (cancelled) return
        const hasCache = Boolean(
          status.hasCache ||
            (status.cacheAsOf && status.cacheAgeMs != null),
        )
        if (!status.scanning && hasCache) {
          await reloadRef.current()
          return
        }
        if (!status.scanning && !hasCache) {
          setScanning(false)
          setScanMessage(null)
          setError(
            status.lastError ||
              'Scan finished but cache is still empty. Click Retry to try again.',
          )
          pollStartedAt.current = null
          return
        }
        setScanMessage(
          status.stage1Count != null
            ? `Scanning US market… Stage 1 found ${status.stage1Count} names`
            : 'Scanning US market…',
        )
      } catch {
        // Keep polling through transient status failures.
      }

      if (!cancelled) {
        timer = setTimeout(() => {
          void tick()
        }, SCAN_POLL_MS)
      }
    }

    timer = setTimeout(() => {
      void tick()
    }, SCAN_POLL_MS)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [scanning])

  const groupsView = useMemo(() => {
    if (!data) return []
    if (mode === 'demo' || !groupsPayload) {
      if (mode !== 'demo' && groupsFetchLoading) return []
      return data.groups
    }
    return groupsPayload.groups
  }, [data, mode, groupsPayload, groupsFetchLoading])

  const groupsMeta = useMemo(() => {
    if (!data) return null
    if (mode !== 'demo' && groupsPayload) {
      return {
        source: groupsPayload.source,
        stale: groupsPayload.stale,
        fetchedAt: groupsPayload.fetchedAt,
        sourceUrl: groupsPayload.sourceUrl,
        membership: groupsPayload.membership,
      }
    }
    if (mode !== 'demo' && groupsFetchLoading) return null
    return {
      source: 'fallback' as const,
      stale: false,
      fetchedAt: data.asOf,
      sourceUrl: '',
    }
  }, [data, mode, groupsPayload, groupsFetchLoading])

  const groupsLoading = Boolean(data) && mode !== 'demo' && groupsFetchLoading

  // Drop a selection that the current group list cannot honor, without a setState effect.
  const filtersForView = useMemo(() => {
    if (!filters.groupId || groupsLoading) return filters
    if (groupsView.some((group) => group.id === filters.groupId)) return filters
    return { ...filters, groupId: null }
  }, [filters, groupsLoading, groupsView])

  const groupSlug = filtersForView.groupId
  const groupViewActive =
    mode !== 'demo' &&
    groupsMeta?.source === 'finviz' &&
    Boolean(groupSlug) &&
    isGroupSlug(groupSlug ?? '')

  useEffect(() => {
    if (!groupViewActive || !groupSlug) return
    const req = ++groupReq.current
    const ac = new AbortController()
    const requestedPeriod = period
    const slug = groupSlug
    void (async () => {
      try {
        const res = await fetch(`/api/groups/${slug}/stocks?period=${requestedPeriod}`, {
          signal: ac.signal,
        })
        let body: unknown = null
        try {
          body = await res.json()
        } catch {
          body = null
        }
        if (req !== groupReq.current) return
        if (!res.ok || !isGroupStocksResponse(body)) {
          setGroupStocks({
            slug,
            period: requestedPeriod,
            error: errorText(body, res.status),
            data: null,
          })
          return
        }
        setGroupStocks({ slug, period: requestedPeriod, error: null, data: body })
      } catch (err) {
        if (req !== groupReq.current) return
        if (err instanceof Error && err.name === 'AbortError') return
        setGroupStocks({
          slug,
          period: requestedPeriod,
          error: err instanceof Error ? err.message : 'group request failed',
          data: null,
        })
      }
    })()
    return () => {
      groupReq.current += 1
      ac.abort()
    }
  }, [groupViewActive, groupSlug, period, groupRetry])

  const groupView = useMemo(() => {
    if (!groupViewActive || !groupSlug) return null
    const group = groupsView.find((item) => item.id === groupSlug)
    const label = group?.name ?? groupSlug
    const match =
      groupStocks && groupStocks.slug === groupSlug && groupStocks.period === period
        ? groupStocks
        : null
    return {
      label,
      periodLabel: GROUP_PERIODS[period].label,
      loading: !match,
      error: match?.error ?? null,
      stale: Boolean(match?.data?.stale),
      failed: match?.data?.failed ?? [],
      parsedCount: match?.data?.parsedCount ?? null,
      finvizPerf: match?.data?.finvizPerf ?? null,
      ideas: match?.data?.ideas ?? null,
      source: match?.data?.source ?? null,
      membershipGeneratedAt: match?.data?.membership?.generatedAt ?? null,
      membershipStale: Boolean(match?.data?.membership?.stale),
    }
  }, [groupViewActive, groupSlug, groupsView, groupStocks, period])

  const filteredIdeas = useMemo(() => {
    const usingGroup = groupView != null
    if (!data && !usingGroup) return []
    const sourceIdeas = usingGroup ? (groupView?.ideas ?? []) : (data?.ideas ?? [])
    const downtrend = data?.marketRegime?.stDirection === 'Downtrend'
    const groupSource = groupsMeta?.source ?? null
    return sourceIdeas
      .filter((i) => matchesFilters(i, filtersForView, groupSource, groupsView, usingGroup))
      .sort((a, b) => {
        if (usingGroup && a.aboveSma200 !== b.aboveSma200) return a.aboveSma200 ? -1 : 1
        // Earnings avoid sinks to bottom (hard fail for entry)
        const ea = a.earningsStatus === 'avoid' ? 1 : 0
        const eb = b.earningsStatus === 'avoid' ? 1 : 0
        if (ea !== eb) return ea - eb
        // Coiled + triggering first (stage rank), then score
        const sr = stageSortRank(a.setupStage) - stageSortRank(b.setupStage)
        if (sr !== 0) return sr
        if (a.isAPlus !== b.isAPlus) return a.isAPlus ? -1 : 1
        if (a.kyleScore !== b.kyleScore) return b.kyleScore - a.kyleScore
        if (a.aboveSma50 !== b.aboveSma50) return a.aboveSma50 ? -1 : 1
        // Soft deprioritize new breakouts in Downtrend: push triggering lower when equal score
        if (downtrend && a.setupStage === 'triggering' && b.setupStage !== 'triggering') return 1
        if (downtrend && b.setupStage === 'triggering' && a.setupStage !== 'triggering') return -1
        return b.rvol - a.rvol
      })
  }, [data, filtersForView, groupsMeta, groupsView, groupView])

  const selectedIdea = useMemo(() => {
    if (!selectedTicker) return null
    if (groupView?.ideas) {
      return groupView.ideas.find((idea) => idea.ticker === selectedTicker) ?? null
    }
    if (!data) return null
    return data.ideas.find((i) => i.ticker === selectedTicker) ?? null
  }, [data, selectedTicker, groupView])

  const userWatchlist = { ingestScanIdeas, ...userWatchlistRest }

  const setPeriod = useCallback((next: GroupPeriod) => {
    setPeriodState(next)
    try {
      localStorage.setItem(GROUPS_PERIOD_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const resetGroup = useCallback(() => {
    setFilters((current) => ({ ...current, groupId: null }))
    setGroupStocks(null)
  }, [])

  const retryGroup = useCallback(() => {
    setGroupStocks(null)
    setGroupRetry((n) => n + 1)
  }, [])

  return {
    data,
    loading,
    error,
    scanning,
    scanMessage,
    mode,
    filters: filtersForView,
    setFilters,
    filteredIdeas,
    selectedIdea,
    selectedTicker,
    setSelectedTicker,
    reload,
    userWatchlist,
    groups: groupsView,
    groupsMeta,
    groupsLoading,
    period,
    setPeriod,
    resetGroup,
    retryGroup,
    groupView,
  }
}

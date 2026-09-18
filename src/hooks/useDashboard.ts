import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadDashboardData } from '../adapters/marketData'
import { stageSortRank } from '../lib/setupStage'
import type { DashboardData, IdeaFilters, TradingIdea } from '../types'
import { DEFAULT_FILTERS } from '../types'
import { useUserWatchlist } from './useUserWatchlist'

function matchesFilters(idea: TradingIdea, f: IdeaFilters): boolean {
  // Hard gate: never show names below the daily 200-SMA as setups.
  if (!idea.aboveSma200) return false
  if (f.requireSma50 && !idea.aboveSma50) return false
  if (f.requireSma10 && !idea.aboveSma10) return false
  if (f.requireSma20 && !idea.aboveSma20) return false
  if (f.stages.length && !f.stages.includes(idea.setupStage)) return false
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
  if (f.groupId && idea.groupId !== f.groupId) return false
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
  const [mode, setMode] = useState<'live' | 'demo'>('live')
  const [filters, setFilters] = useState<IdeaFilters>({ ...DEFAULT_FILTERS })
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)

  const { ingestScanIdeas, ...userWatchlistRest } = useUserWatchlist()

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
      ingestScanIdeas(result.data.ideas)
    } else {
      setData(null)
      setError(result.error)
      setSelectedTicker(null)
    }
    setLoading(false)
  }, [ingestScanIdeas])

  useEffect(() => {
    void reload()
  }, [reload])

  const filteredIdeas = useMemo(() => {
    if (!data) return []
    const downtrend = data.marketRegime?.stDirection === 'Downtrend'
    return data.ideas
      .filter((i) => matchesFilters(i, filters))
      .sort((a, b) => {
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
  }, [data, filters])

  const selectedIdea = useMemo(() => {
    if (!data || !selectedTicker) return null
    return data.ideas.find((i) => i.ticker === selectedTicker) ?? null
  }, [data, selectedTicker])

  const userWatchlist = { ingestScanIdeas, ...userWatchlistRest }

  return {
    data,
    loading,
    error,
    mode,
    filters,
    setFilters,
    filteredIdeas,
    selectedIdea,
    selectedTicker,
    setSelectedTicker,
    reload,
    userWatchlist,
  }
}

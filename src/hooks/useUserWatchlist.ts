import { useCallback, useEffect, useRef, useState } from 'react'
import type { TradingIdea } from '../types'
import {
  AUTO_ADD_MIN_KYLE_SCORE,
  autoAddFromScan,
  loadUserWatchlist,
  removeTicker,
  saveUserWatchlist,
  togglePin,
  upsertTicker,
  type UserWatchlistState,
} from '../lib/userWatchlistStore'

export function useUserWatchlist() {
  const [state, setState] = useState<UserWatchlistState>(() => loadUserWatchlist())
  const [lastAutoAdded, setLastAutoAdded] = useState<string[]>([])
  const persistReady = useRef(false)

  useEffect(() => {
    // Skip the initial mount write (state already from loadUserWatchlist).
    if (!persistReady.current) {
      persistReady.current = true
      return
    }
    saveUserWatchlist(state)
  }, [state])

  /** Call after a successful scan/demo load to auto-add coiled/triggering (kyleScore >= 4). */
  const ingestScanIdeas = useCallback((ideas: TradingIdea[]) => {
    if (!ideas.length) return
    setState((prev) => {
      const result = autoAddFromScan(prev, ideas, AUTO_ADD_MIN_KYLE_SCORE)
      if (result.added.length) {
        setLastAutoAdded(result.added)
      }
      return result.added.length ? result.state : prev
    })
  }, [])

  const pin = useCallback((ticker: string) => {
    setState((prev) => upsertTicker(prev, ticker, { source: 'manual', pinned: true }))
  }, [])

  const unpin = useCallback((ticker: string) => {
    setState((prev) => {
      const entry = prev.entries.find((e) => e.ticker === ticker.toUpperCase())
      if (!entry) return prev
      if (entry.pinned) return togglePin(prev, ticker)
      return removeTicker(prev, ticker)
    })
  }, [])

  const toggle = useCallback((ticker: string) => {
    setState((prev) => {
      const exists = prev.entries.some((e) => e.ticker === ticker.toUpperCase())
      if (!exists) return upsertTicker(prev, ticker, { source: 'manual', pinned: true })
      return togglePin(prev, ticker)
    })
  }, [])

  const remove = useCallback((ticker: string) => {
    setState((prev) => removeTicker(prev, ticker))
  }, [])

  const isOnWatchlist = useCallback(
    (ticker: string) => state.entries.some((e) => e.ticker === ticker.toUpperCase()),
    [state.entries],
  )

  const isPinned = useCallback(
    (ticker: string) =>
      state.entries.some((e) => e.ticker === ticker.toUpperCase() && e.pinned),
    [state.entries],
  )

  return {
    entries: state.entries,
    lastAutoAdded,
    autoAddMinScore: AUTO_ADD_MIN_KYLE_SCORE,
    ingestScanIdeas,
    pin,
    unpin,
    toggle,
    remove,
    isOnWatchlist,
    isPinned,
  }
}

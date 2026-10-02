import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addTickers,
  clearWatchlist,
  formatAddFeedback,
  loadUserWatchlist,
  removeTicker,
  restoreWatchlist,
  saveUserWatchlist,
  toggleTicker,
  USER_WATCHLIST_UNDO_MS,
  type UserWatchlistState,
} from '../lib/userWatchlistStore'

export function useUserWatchlist() {
  const [state, setState] = useState<UserWatchlistState>(() => loadUserWatchlist())
  const [feedback, setFeedback] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ tickers: string[]; count: number } | null>(null)
  const persistReady = useRef(false)
  const tickersRef = useRef(state.tickers)

  useEffect(() => {
    tickersRef.current = state.tickers
  }, [state.tickers])

  useEffect(() => {
    if (!persistReady.current) {
      persistReady.current = true
      return
    }
    saveUserWatchlist(state)
  }, [state])

  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), USER_WATCHLIST_UNDO_MS)
    return () => clearTimeout(timer)
  }, [undo])

  const apply = useCallback((next: UserWatchlistState) => {
    setUndo(null)
    setState(next)
  }, [])

  const addFromInput = useCallback((raw: string) => {
    const result = addTickers({ version: 2, tickers: tickersRef.current }, raw)
    apply(result.state)
    setFeedback(formatAddFeedback(result))
    return result
  }, [apply])

  const pin = useCallback(
    (ticker: string) => {
      const result = addTickers({ version: 2, tickers: tickersRef.current }, ticker)
      apply(result.state)
      if (result.refusedCap.length) setFeedback(formatAddFeedback(result))
      else setFeedback(null)
    },
    [apply],
  )

  const remove = useCallback(
    (ticker: string) => {
      apply(removeTicker({ version: 2, tickers: tickersRef.current }, ticker))
      setFeedback(null)
    },
    [apply],
  )

  const toggle = useCallback(
    (ticker: string) => {
      const result = toggleTicker({ version: 2, tickers: tickersRef.current }, ticker)
      apply(result.state)
      if (result.refusedCap.length || result.rejectedInvalid.length) {
        setFeedback(formatAddFeedback(result))
      } else {
        setFeedback(null)
      }
    },
    [apply],
  )

  const clearAll = useCallback(() => {
    const { state: next, previous } = clearWatchlist({
      version: 2,
      tickers: tickersRef.current,
    })
    if (!previous.length) return
    setState(next)
    setUndo({ tickers: previous, count: previous.length })
    setFeedback(null)
  }, [])

  const undoClear = useCallback(() => {
    if (!undo) return
    setState(restoreWatchlist(undo.tickers))
    setUndo(null)
    setFeedback(null)
  }, [undo])

  const isOnList = useCallback(
    (ticker: string) => state.tickers.includes(ticker.trim().toUpperCase()),
    [state.tickers],
  )

  return {
    tickers: state.tickers,
    feedback,
    undoCount: undo?.count ?? null,
    pin,
    unpin: remove,
    toggle,
    remove,
    addFromInput,
    clearAll,
    undoClear,
    isOnWatchlist: isOnList,
    isPinned: isOnList,
  }
}

/**
 * Persist selected / auto-added scan candidates.
 * Primary: localStorage. Optional seed: src/data/userWatchlist.json (documented; empty by default).
 *
 * Auto-add threshold (documented): kyleScore >= AUTO_ADD_MIN_KYLE_SCORE (4)
 * AND setupStage is coiled or triggering.
 */
import { AUTO_ADD_MIN_KYLE_SCORE } from './setupStage'
import type { SetupStage, TradingIdea } from '../types'

const STORAGE_KEY = 'qullamaggie.userWatchlist.v1'

/** Optional compile-time seed tickers (mirror userWatchlist.json). */
const SEED_TICKERS: string[] = []

export interface UserWatchlistEntry {
  ticker: string
  pinned: boolean
  /** How it landed on the list */
  source: 'manual' | 'auto' | 'seed'
  addedAt: string
}

export interface UserWatchlistState {
  version: 1
  entries: UserWatchlistEntry[]
}

export function loadUserWatchlist(): UserWatchlistState {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as UserWatchlistState
        if (parsed?.version === 1 && Array.isArray(parsed.entries)) {
          return parsed
        }
      }
    } catch {
      /* ignore corrupt storage */
    }
  }

  const now = new Date().toISOString()
  return {
    version: 1,
    entries: SEED_TICKERS.map((ticker) => ({
      ticker: ticker.toUpperCase(),
      pinned: true,
      source: 'seed' as const,
      addedAt: now,
    })),
  }
}

export function saveUserWatchlist(state: UserWatchlistState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* quota / private mode */
  }
}

export function upsertTicker(
  state: UserWatchlistState,
  ticker: string,
  opts: { pinned?: boolean; source: UserWatchlistEntry['source'] },
): UserWatchlistState {
  const t = ticker.toUpperCase()
  const existing = state.entries.find((e) => e.ticker === t)
  if (existing) {
    return {
      ...state,
      entries: state.entries.map((e) =>
        e.ticker === t
          ? {
              ...e,
              pinned: opts.pinned ?? e.pinned,
              source: e.source === 'manual' || e.pinned ? e.source : opts.source,
            }
          : e,
      ),
    }
  }
  return {
    ...state,
    entries: [
      ...state.entries,
      {
        ticker: t,
        pinned: opts.pinned ?? false,
        source: opts.source,
        addedAt: new Date().toISOString(),
      },
    ],
  }
}

export function removeTicker(state: UserWatchlistState, ticker: string): UserWatchlistState {
  const t = ticker.toUpperCase()
  return {
    ...state,
    entries: state.entries.filter((e) => e.ticker !== t),
  }
}

export function togglePin(state: UserWatchlistState, ticker: string): UserWatchlistState {
  const t = ticker.toUpperCase()
  return {
    ...state,
    entries: state.entries.map((e) =>
      e.ticker === t
        ? { ...e, pinned: !e.pinned, source: e.source === 'auto' ? 'manual' : e.source }
        : e,
    ),
  }
}

/**
 * Auto-add coiled/triggering ideas with kyleScore >= AUTO_ADD_MIN_KYLE_SCORE.
 * Does not remove names that fell off — only adds. Existing entries are untouched.
 */
export function autoAddFromScan(
  state: UserWatchlistState,
  ideas: TradingIdea[],
  minScore = AUTO_ADD_MIN_KYLE_SCORE,
): { state: UserWatchlistState; added: string[] } {
  let next = state
  const added: string[] = []
  for (const idea of ideas) {
    if (!idea.aboveSma200) continue
    const stage: SetupStage | undefined = idea.setupStage
    if (stage !== 'coiled' && stage !== 'triggering') continue
    if (idea.kyleScore < minScore) continue
    if (next.entries.some((e) => e.ticker === idea.ticker)) continue
    next = upsertTicker(next, idea.ticker, { source: 'auto', pinned: false })
    added.push(idea.ticker)
  }
  return { state: next, added }
}

export { AUTO_ADD_MIN_KYLE_SCORE }

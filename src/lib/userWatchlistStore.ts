/**
 * Manual watchlist persisted in localStorage.
 *
 * Key: {@link USER_WATCHLIST_STORAGE_KEY} (`qm.userWatchlist.v2`).
 * v1 key `qullamaggie.userWatchlist.v1` is migrated once: keep tickers the
 * user pinned or added (`pinned` or `source === 'manual'`); drop the rest
 * (scan-populated unpinned rows). Corrupt JSON or a wrong shape loads as
 * an empty list and never throws.
 *
 * Store order is insertion order (oldest first). Display newest first.
 */
import {
  readJsonFrom,
  removeKeyFrom,
  writeJsonTo,
  type KeyValueStore,
} from './persist'
import { parseUsEquitySymbol } from './tickerSymbol'

export { US_EQUITY_SYMBOL_PATTERN, US_EQUITY_SYMBOL_RE } from './tickerSymbol'
export type { KeyValueStore } from './persist'

export const USER_WATCHLIST_STORAGE_KEY = 'qm.userWatchlist.v2'
export const USER_WATCHLIST_V1_KEY = 'qullamaggie.userWatchlist.v1'
export const USER_WATCHLIST_CAP = 200
export const USER_WATCHLIST_UNDO_MS = 15_000

export interface UserWatchlistState {
  version: 2
  /** Insertion order, oldest first. */
  tickers: string[]
}

export interface ParseTickersResult {
  valid: string[]
  invalid: string[]
}

export interface MutateResult {
  state: UserWatchlistState
  added: string[]
  skippedDuplicates: string[]
  rejectedInvalid: string[]
  refusedCap: string[]
}

function browserStore(): KeyValueStore | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function resolveStore(store?: KeyValueStore | null): KeyValueStore | null {
  if (store !== undefined) return store
  return browserStore()
}

export function emptyWatchlist(): UserWatchlistState {
  return { version: 2, tickers: [] }
}

/** Dedupe, uppercase, drop invalid, cap. First occurrence wins (insertion order). */
export function normalizeTickers(raw: unknown, cap = USER_WATCHLIST_CAP): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (out.length >= cap) break
    const parsed = typeof item === 'string' ? parseUsEquitySymbol(item) : null
    if (!parsed || seen.has(parsed)) continue
    seen.add(parsed)
    out.push(parsed)
  }
  return out
}

function asV2(tickers: string[]): UserWatchlistState {
  return { version: 2, tickers: normalizeTickers(tickers) }
}

interface V1Entry {
  ticker?: unknown
  pinned?: unknown
  source?: unknown
}

/**
 * v1 → v2: keep only names the user explicitly pinned or added.
 * Scan-populated unpinned rows (`source === 'auto'` and not pinned) are dropped.
 */
export function migrateV1Entries(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const body = raw as { version?: unknown; entries?: unknown }
  if (body.version !== 1 || !Array.isArray(body.entries)) return []
  const kept: string[] = []
  const seen = new Set<string>()
  for (const item of body.entries) {
    if (!item || typeof item !== 'object') continue
    const entry = item as V1Entry
    const ticker = typeof entry.ticker === 'string' ? parseUsEquitySymbol(entry.ticker) : null
    if (!ticker || seen.has(ticker)) continue
    const pinned = entry.pinned === true
    const source = entry.source
    const explicit = pinned || source === 'manual'
    if (!explicit) continue
    seen.add(ticker)
    if (kept.length >= USER_WATCHLIST_CAP) break
    kept.push(ticker)
  }
  return kept
}

function readV2(raw: unknown): string[] | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as { version?: unknown; tickers?: unknown }
  if (body.version !== 2) return null
  if (!Array.isArray(body.tickers)) return null
  return normalizeTickers(body.tickers)
}

function hasKey(store: KeyValueStore, key: string): boolean {
  try {
    return store.getItem(key) != null
  } catch {
    return false
  }
}

export function loadUserWatchlist(store?: KeyValueStore | null): UserWatchlistState {
  const kv = resolveStore(store)
  if (!kv) return emptyWatchlist()

  if (hasKey(kv, USER_WATCHLIST_STORAGE_KEY)) {
    const tickers = readV2(readJsonFrom(kv, USER_WATCHLIST_STORAGE_KEY))
    return tickers ? asV2(tickers) : emptyWatchlist()
  }

  if (hasKey(kv, USER_WATCHLIST_V1_KEY)) {
    const migrated = migrateV1Entries(readJsonFrom(kv, USER_WATCHLIST_V1_KEY))
    const next = asV2(migrated)
    writeJsonTo(kv, USER_WATCHLIST_STORAGE_KEY, next)
    removeKeyFrom(kv, USER_WATCHLIST_V1_KEY)
    return next
  }

  return emptyWatchlist()
}

export function saveUserWatchlist(
  state: UserWatchlistState,
  store?: KeyValueStore | null,
): void {
  const kv = resolveStore(store)
  if (!kv) return
  writeJsonTo(kv, USER_WATCHLIST_STORAGE_KEY, asV2(state.tickers))
}

/**
 * Split on commas, semicolons, or whitespace (spaces / newlines).
 * Strips a leading `$`, uppercases, validates {@link US_EQUITY_SYMBOL_RE},
 * and dedupes within the paste (first occurrence wins).
 */
export function parseTickerInput(raw: string): ParseTickersResult {
  const valid: string[] = []
  const invalid: string[] = []
  const seenValid = new Set<string>()
  const seenInvalid = new Set<string>()
  for (const token of raw.split(/[,;\s]+/)) {
    const trimmed = token.trim()
    if (!trimmed) continue
    const parsed = parseUsEquitySymbol(trimmed)
    if (parsed) {
      if (seenValid.has(parsed)) continue
      seenValid.add(parsed)
      valid.push(parsed)
      continue
    }
    if (seenInvalid.has(trimmed)) continue
    seenInvalid.add(trimmed)
    invalid.push(trimmed)
  }
  return { valid, invalid }
}

export function addTickers(state: UserWatchlistState, raw: string): MutateResult {
  const parsed = parseTickerInput(raw)
  const existing = new Set(state.tickers)
  const added: string[] = []
  const skippedDuplicates: string[] = []
  const refusedCap: string[] = []
  const next = [...state.tickers]

  for (const ticker of parsed.valid) {
    if (existing.has(ticker)) {
      skippedDuplicates.push(ticker)
      continue
    }
    if (next.length >= USER_WATCHLIST_CAP) {
      refusedCap.push(ticker)
      continue
    }
    existing.add(ticker)
    next.push(ticker)
    added.push(ticker)
  }

  return {
    state: asV2(next),
    added,
    skippedDuplicates,
    rejectedInvalid: parsed.invalid,
    refusedCap,
  }
}

export function removeTicker(state: UserWatchlistState, ticker: string): UserWatchlistState {
  const t = parseUsEquitySymbol(ticker) ?? ticker.trim().toUpperCase()
  return asV2(state.tickers.filter((item) => item !== t))
}

export function toggleTicker(state: UserWatchlistState, ticker: string): MutateResult {
  const parsed = parseUsEquitySymbol(ticker)
  if (!parsed) {
    return {
      state,
      added: [],
      skippedDuplicates: [],
      rejectedInvalid: [ticker.trim() || ticker],
      refusedCap: [],
    }
  }
  if (state.tickers.includes(parsed)) {
    return {
      state: removeTicker(state, parsed),
      added: [],
      skippedDuplicates: [],
      rejectedInvalid: [],
      refusedCap: [],
    }
  }
  return addTickers(state, parsed)
}

export function clearWatchlist(state: UserWatchlistState): {
  state: UserWatchlistState
  previous: string[]
} {
  return { state: emptyWatchlist(), previous: [...state.tickers] }
}

export function restoreWatchlist(previous: string[]): UserWatchlistState {
  return asV2(previous)
}

/** Insertion order reversed for the panel (newest first). */
export function displayTickersNewestFirst(tickers: readonly string[]): string[] {
  return [...tickers].reverse()
}

export function formatAddFeedback(result: MutateResult): string | null {
  const parts: string[] = []
  if (result.added.length) {
    parts.push(`Added ${result.added.length}`)
  }
  if (result.skippedDuplicates.length) {
    parts.push(
      `skipped ${result.skippedDuplicates.length} duplicate${
        result.skippedDuplicates.length === 1 ? '' : 's'
      }`,
    )
  }
  if (result.refusedCap.length) {
    parts.push(
      result.added.length === 0 && result.skippedDuplicates.length === 0
        ? `Watchlist is full (${USER_WATCHLIST_CAP} tickers)`
        : `skipped ${result.refusedCap.length} (cap ${USER_WATCHLIST_CAP})`,
    )
  }
  if (result.rejectedInvalid.length) {
    parts.push(`rejected: ${result.rejectedInvalid.join(', ')} (invalid)`)
  }
  if (!parts.length) return null
  return parts.join(', ')
}

export function isOnWatchlist(state: UserWatchlistState, ticker: string): boolean {
  const t = parseUsEquitySymbol(ticker) ?? ticker.trim().toUpperCase()
  return state.tickers.includes(t)
}

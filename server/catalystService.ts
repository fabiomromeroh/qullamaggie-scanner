/**
 * Background catalyst enrichment.
 *
 * The scan cache never stores these fields. Dashboard and group-stock
 * responses merge whatever is already cached, then this module keeps
 * filling candidates without blocking the HTTP handler.
 *
 * Finnhub company-news shares the free-tier 60 calls/min budget with the
 * scan, so catalyst Finnhub calls are capped at 25/min with concurrency 2.
 * Yahoo search does not spend a Finnhub token. A 429 backs off (Retry-After,
 * capped at 60s) and that ticker falls through to Yahoo.
 */
import type { TradingIdea } from '../src/types/index.ts'
import {
  CATALYST_WINDOW_HOURS,
  evaluateCatalyst,
  itemConcernsIssuer,
  type CatalystEvaluation,
  type CatalystNewsInput,
  type NewsFeed,
} from '../src/lib/catalyst.ts'
import { deriveCharacteristics } from '../src/lib/metrics.ts'
import { createJobQueue, maxInAnyWindow, TokenBucket } from './requestBudget.ts'
import {
  fetchFinnhubCompanyNews,
  fetchYahooSearchNews,
  type NewsItem,
} from './tickerNews.ts'

export const CATALYST_FETCH = {
  finnhubPerMinute: 25,
  windowMs: 60_000,
  concurrency: 2,
  candidateCap: 120,
  rvolMin: 1.5,
  absDayPctMin: 4,
  ttlMs: 20 * 60 * 1000,
  negativeTtlMs: 5 * 60 * 1000,
  lookbackDays: 3,
  retryAfterCapMs: 60_000,
} as const

export type CatalystStatus = 'checked' | 'pending' | 'unchecked' | 'error'

export interface CatalystMeta {
  checked: number
  pending: number
  failed: number
  unchecked: number
  /** Ideas in this payload that qualify for a news lookup. */
  candidates: number
  asOf: string
  windowHours: number
  finnhubCalls: number
  yahooCalls: number
  /** Peak Finnhub catalyst calls inside any 60s window since process start. */
  maxFinnhubCallsPer60s: number
}

interface CacheEntry {
  status: 'checked' | 'error'
  evaluation: CatalystEvaluation | null
  storedAt: number
  freshUntil: number
}

export interface CatalystIdeaRef {
  ticker: string
  name?: string
  setupStage?: string
  rvol?: number
  dayPct?: number
  isAPlus?: boolean
  earningsDate?: string | null
}

const store = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<void>>()
const queue = createJobQueue(CATALYST_FETCH.concurrency)
const bucket = new TokenBucket(CATALYST_FETCH.finnhubPerMinute, CATALYST_FETCH.windowMs)
const finnhubStamps: number[] = []
const yahooStamps: number[] = []
let tokenChain: Promise<void> = Promise.resolve()
let finnhubBlockedUntil = 0
let clock: () => number = () => Date.now()

function nowMs(): number {
  return clock()
}

export function setCatalystClock(fn: () => number): void {
  clock = fn
}

export function resetCatalystClock(): void {
  clock = () => Date.now()
}

export function clearCatalystStore(): void {
  store.clear()
  inflight.clear()
  finnhubStamps.length = 0
  yahooStamps.length = 0
  finnhubBlockedUntil = 0
  tokenChain = Promise.resolve()
}

function symbolKey(symbol: string): string {
  return symbol.trim().toUpperCase()
}

export function isCatalystCandidate(idea: CatalystIdeaRef): boolean {
  if (idea.setupStage === 'coiled' || idea.setupStage === 'triggering') return true
  if ((idea.rvol ?? 0) >= CATALYST_FETCH.rvolMin) return true
  if (Math.abs(idea.dayPct ?? 0) >= CATALYST_FETCH.absDayPctMin) return true
  return Boolean(idea.isAPlus)
}

function priorityRank(idea: CatalystIdeaRef): number {
  if (idea.setupStage === 'triggering') return 0
  if (idea.setupStage === 'coiled') return 1
  return 2
}

/** triggering, then coiled, then everyone else; higher RVOL first inside a rank. */
export function selectCatalystCandidates<T extends CatalystIdeaRef>(
  ideas: readonly T[],
  options: { includeAll?: boolean; cap?: number } = {},
): T[] {
  const cap = options.cap ?? CATALYST_FETCH.candidateCap
  const ranked = [...ideas].sort((a, b) => {
    const rank = priorityRank(a) - priorityRank(b)
    if (rank !== 0) return rank
    return (b.rvol ?? 0) - (a.rvol ?? 0)
  })
  const pool = options.includeAll ? ranked : ranked.filter((idea) => isCatalystCandidate(idea))
  return pool.slice(0, cap)
}

function freshEntry(symbol: string, now: number): CacheEntry | null {
  const entry = store.get(symbolKey(symbol))
  if (!entry || now > entry.freshUntil) return null
  return entry
}

export function seedCatalystCache(
  symbol: string,
  evaluation: CatalystEvaluation | null,
  options: { now: number; status: 'checked' | 'error'; freshForMs?: number },
): void {
  const ttl = options.freshForMs ?? (options.status === 'error' ? CATALYST_FETCH.negativeTtlMs : CATALYST_FETCH.ttlMs)
  store.set(symbolKey(symbol), {
    status: options.status,
    evaluation,
    storedAt: options.now,
    freshUntil: options.now + ttl,
  })
}

/** Failed refresh. A previous checked payload stays servable, but only for the short negative TTL. */
export function noteCatalystRefreshFailure(symbol: string, now: number): void {
  const key = symbolKey(symbol)
  const prev = store.get(key)
  if (prev && prev.status === 'checked' && prev.evaluation) {
    store.set(key, {
      ...prev,
      freshUntil: now + CATALYST_FETCH.negativeTtlMs,
    })
    return
  }
  store.set(key, {
    status: 'error',
    evaluation: null,
    storedAt: now,
    freshUntil: now + CATALYST_FETCH.negativeTtlMs,
  })
}

function callStats(): Pick<CatalystMeta, 'finnhubCalls' | 'yahooCalls' | 'maxFinnhubCallsPer60s'> {
  return {
    finnhubCalls: finnhubStamps.length,
    yahooCalls: yahooStamps.length,
    maxFinnhubCallsPer60s: maxInAnyWindow(finnhubStamps, CATALYST_FETCH.windowMs),
  }
}

export function catalystCallStats(): Pick<CatalystMeta, 'finnhubCalls' | 'yahooCalls' | 'maxFinnhubCallsPer60s'> {
  return callStats()
}

function readFinnhubKey(): string | undefined {
  const primary = process.env.FINNHUB_API_KEY?.trim()
  const vite = process.env.VITE_FINNHUB_API_KEY?.trim()
  return primary || vite || undefined
}

function toInputs(items: NewsItem[], feed: NewsFeed): CatalystNewsInput[] {
  const out: CatalystNewsInput[] = []
  for (const item of items) {
    const datetimeMs = Date.parse(item.datetime)
    if (!Number.isFinite(datetimeMs)) continue
    out.push({
      headline: item.headline,
      summary: item.summary,
      source: item.source,
      url: item.url,
      datetimeMs,
      related: item.related,
      sourceFeed: feed,
    })
  }
  return out
}

function blankCatalyst(idea: TradingIdea, status: CatalystStatus): TradingIdea {
  return {
    ...idea,
    hasCatalyst: false,
    catalyst: null,
    catalystCategories: [],
    catalystStatus: status,
  }
}

function applyEvaluation(idea: TradingIdea, evaluation: CatalystEvaluation): TradingIdea {
  const headline = evaluation.hasCatalyst ? (evaluation.topHeadline ?? null) : null
  const characteristics = deriveCharacteristics({
    aboveSma200: idea.aboveSma200,
    pctFrom52wHigh: idea.pctFrom52wHigh,
    catalyst: headline,
    surfer10: idea.surfer10,
    surfer20: idea.surfer20,
    surfer50: idea.surfer50,
  })
  return {
    ...idea,
    hasCatalyst: evaluation.hasCatalyst,
    catalyst: headline,
    catalystCategories: evaluation.categories,
    catalystDirection: evaluation.direction,
    catalystHeadline: evaluation.topHeadline,
    catalystUrl: evaluation.topUrl,
    catalystSource: evaluation.topSource,
    catalystAt: evaluation.topDatetime,
    catalystAgeHours: evaluation.ageHours,
    catalystScore: evaluation.score,
    catalystCount: evaluation.count,
    catalystStatus: 'checked',
    characteristics,
  }
}

export function mergeCatalystIntoIdeas(
  ideas: TradingIdea[],
  now: number = nowMs(),
): { ideas: TradingIdea[]; meta: CatalystMeta } {
  let checked = 0
  let pending = 0
  let failed = 0
  let unchecked = 0
  const candidates = ideas.filter((idea) => isCatalystCandidate(idea)).length
  const next = ideas.map((idea) => {
    const entry = freshEntry(idea.ticker, now)
    if (entry?.status === 'checked' && entry.evaluation) {
      checked += 1
      return applyEvaluation(idea, entry.evaluation)
    }
    if (entry?.status === 'error') {
      failed += 1
      return blankCatalyst(idea, 'error')
    }
    if (isCatalystCandidate(idea)) {
      pending += 1
      return blankCatalyst(idea, 'pending')
    }
    unchecked += 1
    return blankCatalyst(idea, 'unchecked')
  })
  return {
    ideas: next,
    meta: {
      checked,
      pending,
      failed,
      unchecked,
      candidates,
      asOf: new Date(now).toISOString(),
      windowHours: CATALYST_WINDOW_HOURS,
      ...callStats(),
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function takeFinnhubToken(): Promise<void> {
  const run = tokenChain.then(async () => {
    for (;;) {
      const now = Date.now()
      if (now < finnhubBlockedUntil) {
        await sleep(Math.min(finnhubBlockedUntil - now, CATALYST_FETCH.retryAfterCapMs))
        continue
      }
      if (bucket.tryTake(now)) {
        finnhubStamps.push(now)
        return
      }
      await sleep(Math.max(bucket.delayMs(Date.now()), 25))
    }
  })
  tokenChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function aboutIssuer(items: NewsItem[], feed: NewsFeed, symbol: string, name?: string | null): NewsItem[] {
  return items.filter((item) =>
    itemConcernsIssuer({ headline: item.headline, related: item.related, sourceFeed: feed }, symbol, name),
  )
}

async function loadYahoo(symbol: string): Promise<NewsItem[] | null> {
  try {
    const yahoo = await fetchYahooSearchNews(symbol)
    yahooStamps.push(Date.now())
    return yahoo
  } catch {
    return null
  }
}

/**
 * Finnhub company-news often returns wires that are not about the ticker.
 * When every Finnhub row fails the issuer subject check, fall through to
 * Yahoo the same way an empty Finnhub body does. A related-ticker list
 * cannot keep a row on its own. Yahoo does not spend a Finnhub token.
 */
async function loadItems(
  symbol: string,
  name?: string | null,
): Promise<{ items: NewsItem[]; feed: NewsFeed } | null> {
  const key = readFinnhubKey()
  if (key && Date.now() >= finnhubBlockedUntil) {
    await takeFinnhubToken()
    const finnhub = await fetchFinnhubCompanyNews(symbol, key, CATALYST_FETCH.lookbackDays)
    if (finnhub.status === 429) {
      const wait = Math.min(finnhub.retryAfterMs ?? CATALYST_FETCH.retryAfterCapMs, CATALYST_FETCH.retryAfterCapMs)
      finnhubBlockedUntil = Date.now() + wait
    } else if (finnhub.status === 200 && finnhub.items.length) {
      const about = aboutIssuer(finnhub.items, 'finnhub', symbol, name)
      if (about.length) return { items: about, feed: 'finnhub' }
    }
    const yahoo = await loadYahoo(symbol)
    return yahoo ? { items: yahoo, feed: 'yahoo' } : null
  }
  const yahoo = await loadYahoo(symbol)
  return yahoo ? { items: yahoo, feed: 'yahoo' } : null
}

async function enrichSymbol(idea: CatalystIdeaRef): Promise<void> {
  const symbol = symbolKey(idea.ticker)
  const existing = inflight.get(symbol)
  if (existing) return existing
  const job = (async () => {
    await queue.acquire()
    try {
      if (freshEntry(symbol, Date.now())) return
      const loaded = await loadItems(symbol, idea.name)
      const now = Date.now()
      if (loaded == null) {
        noteCatalystRefreshFailure(symbol, now)
        return
      }
      const evaluation = evaluateCatalyst(toInputs(loaded.items, loaded.feed), now, idea.earningsDate, {
        ticker: symbol,
        name: idea.name,
      })
      seedCatalystCache(symbol, evaluation, { now, status: 'checked' })
    } catch {
      noteCatalystRefreshFailure(symbol, Date.now())
    } finally {
      queue.release()
      inflight.delete(symbol)
    }
  })()
  inflight.set(symbol, job)
  return job
}

let draining = false
let queued: CatalystIdeaRef[] = []

async function drain(batch: CatalystIdeaRef[]): Promise<void> {
  const now = Date.now()
  const todo = batch.filter((idea) => idea.ticker && !freshEntry(idea.ticker, now))
  await Promise.all(todo.map((idea) => enrichSymbol(idea)))
  console.log(JSON.stringify({
    catalyst: 'batch',
    requested: todo.length,
    ...callStats(),
  }))
}

/** Fire-and-forget. Safe to call on every dashboard read; fresh cache entries are skipped. */
export function scheduleCatalystEnrichment(
  ideas: readonly CatalystIdeaRef[],
  options: { includeAll?: boolean } = {},
): void {
  const picked = selectCatalystCandidates(ideas, options)
  if (draining) {
    const seen = new Set(queued.map((idea) => symbolKey(idea.ticker)))
    for (const idea of picked) {
      const key = symbolKey(idea.ticker)
      if (seen.has(key)) continue
      seen.add(key)
      queued.push(idea)
    }
    return
  }
  draining = true
  void drain(picked)
    .catch(() => {
      /* per-symbol failures are stored; the batch itself should not throw */
    })
    .finally(() => {
      draining = false
      if (!queued.length) return
      const next = queued
      queued = []
      scheduleCatalystEnrichment(next, { includeAll: true })
    })
}

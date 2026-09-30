/**
 * GET /api/groups/leaders.
 * Default: rank membership-snapshot names with cached market data.
 * Within one call, compute at most ~8s or 40 uncached symbols, then mark the
 * unfinished groups pending so the client can poll. FINVIZ_SCREENER_LIVE=1
 * tries the live screener first and falls back to the snapshot on failure.
 */
import type {
  FinvizLeader,
  GroupLeadersEntry,
  GroupLeadersResponse,
  GroupPeriod,
} from '../src/types/index.ts'
import { groupPending } from '../src/lib/leaderBudget.ts'
import { countGroupLeaders, periodOrder } from '../src/lib/groupPeriod.ts'
import { rankLeaderPool } from '../src/lib/memberPerf.ts'
import { loadScanCache } from './scanCache.ts'
import {
  finvizScreenerLiveEnabled,
  getScreenerPage,
  type ScreenerPage,
} from './finvizScreener.ts'
import { screenerPeriodPerf } from './finvizScreenerParse.ts'
import {
  isMembershipStale,
  loadMembershipSnapshot,
  lookupMembershipGroup,
  type MembershipSnapshot,
  type SnapshotLoad,
} from './groupMembers.ts'
import {
  ensureMemberQuotes,
  LEADER_BUDGET_MS,
  LEADER_MAX_SYMBOLS,
  MEMBER_FETCH_CONCURRENCY,
  MEMBER_FETCH_GAP_MS,
  type MemberQuote,
  type QuoteLoader,
} from './groupPerformance.ts'

export interface GroupLeadersDeps {
  now?: () => number
  budgetMs?: number
  maxSymbols?: number
  concurrency?: number
  gapMs?: number
  loadSnapshot?: () => SnapshotLoad
  fetchQuote?: QuoteLoader
  /** Undefined reads the scan cache. Null means the cache is not ready. */
  scanTickers?: Set<string> | null
  liveEnabled?: boolean
  fetchScreenerPage?: (slug: string, order: string) => Promise<ScreenerPage>
}

function scanTickerSet(deps: GroupLeadersDeps): Set<string> | null {
  if (deps.scanTickers !== undefined) return deps.scanTickers
  const ideas = loadScanCache()?.ideas
  if (!ideas || ideas.length === 0) return null
  return new Set(ideas.map((idea) => idea.ticker.toUpperCase()))
}

function errorEntry(
  slug: string,
  period: GroupPeriod,
  error: string,
  membership?: GroupLeadersEntry['membership'],
): GroupLeadersEntry {
  return {
    slug,
    period,
    fetchedAt: null,
    stale: false,
    error,
    leaders: [],
    top5: [],
    inScanCount: null,
    parsedCount: 0,
    pending: false,
    ...(membership ? { membership, memberCount: 0 } : {}),
  }
}

function leaderRows(
  tickers: string[],
  companies: Record<string, string> | undefined,
  quotes: Map<string, MemberQuote | null>,
  period: GroupPeriod,
  scanTickers: Set<string> | null,
): FinvizLeader[] {
  return tickers.map((ticker) => {
    const quote = quotes.get(ticker) ?? null
    return {
      ticker,
      company: companies?.[ticker] || quote?.name || ticker,
      perf: quote?.perf[period] ?? null,
      price: quote?.price ?? null,
      changePct: quote?.changePct ?? null,
      relVolume: quote?.relVolume ?? null,
      avgVolume: quote?.avgVolume ?? null,
      inScan: scanTickers ? scanTickers.has(ticker) : null,
    }
  })
}

function entryFromSnapshotGroup(
  slug: string,
  period: GroupPeriod,
  snapshot: MembershipSnapshot,
  quotes: Map<string, MemberQuote | null>,
  resolved: Set<string>,
  scanTickers: Set<string> | null,
  now: number,
): GroupLeadersEntry {
  const group = lookupMembershipGroup(snapshot, slug)
  const membership = {
    source: 'snapshot' as const,
    generatedAt: snapshot.generatedAt,
    stale: isMembershipStale(snapshot.generatedAt, now),
  }
  if (!group) {
    return errorEntry(slug, period, 'not in membership snapshot; run npm run build:groups', membership)
  }
  const fetchedAt = new Date().toISOString()
  if (groupPending(group.tickers, resolved)) {
    return {
      slug,
      period,
      fetchedAt,
      stale: false,
      pending: true,
      leaders: [],
      top5: [],
      inScanCount: null,
      parsedCount: 0,
      membership,
      memberCount: group.count,
    }
  }
  const ranked = rankLeaderPool(
    leaderRows(group.tickers, group.companies, quotes, period, scanTickers),
  )
  const withData = ranked.filter((row) => row.perf != null)
  const counted = countGroupLeaders(withData, scanTickers)
  return {
    slug,
    period,
    fetchedAt,
    stale: false,
    pending: false,
    leaders: ranked,
    top5: ranked.slice(0, 5),
    inScanCount: counted.inScanCount,
    parsedCount: counted.parsedCount,
    membership,
    memberCount: group.count,
  }
}

async function leadersFromSnapshot(
  slugs: string[],
  period: GroupPeriod,
  deps: GroupLeadersDeps,
): Promise<GroupLeadersResponse> {
  const order = periodOrder(period)
  const loaded = (deps.loadSnapshot ?? loadMembershipSnapshot)()
  if (!loaded.ok) {
    return {
      period,
      order,
      groups: slugs.map((slug) => errorEntry(slug, period, loaded.error)),
    }
  }
  const now = deps.now ?? Date.now
  const scanTickers = scanTickerSet(deps)
  const tickers: string[] = []
  for (const slug of slugs) {
    const group = lookupMembershipGroup(loaded.snapshot, slug)
    if (group) tickers.push(...group.tickers)
  }
  const { quotes, resolved } = await ensureMemberQuotes(tickers, {
    now,
    budgetMs: deps.budgetMs ?? LEADER_BUDGET_MS,
    maxSymbols: deps.maxSymbols ?? LEADER_MAX_SYMBOLS,
    concurrency: deps.concurrency ?? MEMBER_FETCH_CONCURRENCY,
    gapMs: deps.gapMs ?? MEMBER_FETCH_GAP_MS,
    fetchQuote: deps.fetchQuote,
  })
  const at = now()
  return {
    period,
    order,
    groups: slugs.map((slug) =>
      entryFromSnapshotGroup(slug, period, loaded.snapshot, quotes, resolved, scanTickers, at),
    ),
  }
}

function liveEntry(
  slug: string,
  period: GroupPeriod,
  page: ScreenerPage,
  scanTickers: Set<string> | null,
): GroupLeadersEntry {
  const leaders: FinvizLeader[] = page.rows.map((row) => {
    const ticker = row.ticker.toUpperCase()
    return {
      ticker,
      company: row.company,
      perf: screenerPeriodPerf(row, period),
      price: row.price,
      changePct: row.changePct,
      relVolume: row.relVolume,
      avgVolume: row.avgVolume,
      inScan: scanTickers ? scanTickers.has(ticker) : null,
    }
  })
  const counted = countGroupLeaders(leaders, scanTickers)
  const top5 = [...leaders].sort((a, b) => {
    if (a.perf == null && b.perf == null) return a.ticker.localeCompare(b.ticker)
    if (a.perf == null) return 1
    if (b.perf == null) return -1
    if (a.perf !== b.perf) return b.perf - a.perf
    return a.ticker.localeCompare(b.ticker)
  }).slice(0, 5)
  return {
    slug,
    period,
    fetchedAt: page.fetchedAt,
    stale: page.stale,
    leaders,
    top5,
    inScanCount: counted.inScanCount,
    parsedCount: counted.parsedCount,
  }
}

async function leadersFromScreener(
  slugs: string[],
  period: GroupPeriod,
  deps: GroupLeadersDeps,
): Promise<GroupLeadersResponse> {
  const order = periodOrder(period)
  const scanTickers = scanTickerSet(deps)
  const fetchPage = deps.fetchScreenerPage ?? getScreenerPage
  const groups = await Promise.all(
    slugs.map(async (slug) => {
      try {
        const page = await fetchPage(slug, order)
        return liveEntry(slug, period, page, scanTickers)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Finviz screener failed'
        return errorEntry(slug, period, message)
      }
    }),
  )
  return { period, order, groups }
}

export async function getGroupLeaders(
  slugs: string[],
  period: GroupPeriod,
  deps: GroupLeadersDeps = {},
): Promise<GroupLeadersResponse> {
  const live = deps.liveEnabled ?? finvizScreenerLiveEnabled()
  if (!live) return leadersFromSnapshot(slugs, period, deps)
  const liveBody = await leadersFromScreener(slugs, period, deps)
  const failed = liveBody.groups.filter((group) => group.error).map((group) => group.slug)
  if (failed.length === 0) return liveBody
  const snapBody = await leadersFromSnapshot(failed, period, deps)
  const bySlug = new Map(snapBody.groups.map((group) => [group.slug, group]))
  return {
    ...liveBody,
    groups: liveBody.groups.map((group) => (group.error ? (bySlug.get(group.slug) ?? group) : group)),
  }
}

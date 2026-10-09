/**
 * GET /api/market/idea/:symbol — score one ticker that is not in the
 * leading-groups scan universe. Does not touch the scan cache, caps, or
 * Stage-1 membership.
 */
import type { TradingIdea } from '../src/types/index.ts'
import { IDEA_LOOKUP_TTL_MS } from '../src/lib/ideaLookup.ts'
import { mergeCatalystIntoIdeas } from './catalystService.ts'
import {
  loadMembershipSnapshot,
  type MembershipSnapshot,
  type SnapshotLoad,
} from './groupMembers.ts'
import type { ScoreTickersOptions, ScoreTickersResult } from './scanEngine.ts'
import { createSymbolCache } from './ttlCache.ts'

export { IDEA_LOOKUP_TTL_MS }

export interface IdeaLookupOk {
  ok: true
  idea: TradingIdea
  outsideScan: true
  asOf: string
}

export interface IdeaLookupMiss {
  ok: false
  error: string
}

export type IdeaLookupResult = IdeaLookupOk | IdeaLookupMiss

export type ScoreTickersFn = (
  symbols: string[],
  opts?: ScoreTickersOptions,
) => Promise<ScoreTickersResult>

export type MergeCatalystFn = (ideas: TradingIdea[]) => { ideas: TradingIdea[] }

export interface MembershipGroupLabel {
  groupId: string
  groupName: string
  company?: string
}

const cache = createSymbolCache<IdeaLookupResult>({
  ttlMs: IDEA_LOOKUP_TTL_MS,
  negativeTtlMs: IDEA_LOOKUP_TTL_MS,
  isNegative: (value) => !value.ok,
})

export function ideaLookupMissError(symbol: string): string {
  return `No market data for ${symbol}`
}

/** Finviz industry for a membership ticker. Absent tickers stay unlabeled. */
export function groupLabelFromSnapshot(
  snapshot: MembershipSnapshot,
  symbol: string,
): MembershipGroupLabel | null {
  const ticker = symbol.trim().toUpperCase()
  if (!ticker) return null
  for (const [slug, group] of Object.entries(snapshot.groups)) {
    const match = group.tickers.some((item) => item.trim().toUpperCase() === ticker)
    if (!match) continue
    const company =
      group.companies?.[ticker] ??
      group.companies?.[symbol] ??
      group.companies?.[symbol.trim()]
    return {
      groupId: slug,
      groupName: group.name,
      ...(company ? { company } : {}),
    }
  }
  return null
}

function applyGroupLabel(idea: TradingIdea, label: MembershipGroupLabel | null): TradingIdea {
  if (!label) return idea
  return {
    ...idea,
    groupId: label.groupId,
    groupName: label.groupName,
    ...(label.company ? { name: label.company } : {}),
  }
}

function logMiss(
  log: (payload: unknown) => void,
  symbol: string,
  detail: string,
): IdeaLookupMiss {
  log({ ideaLookup: 'miss', symbol, error: detail })
  return { ok: false, error: ideaLookupMissError(symbol) }
}

async function defaultScoreTickers(
  symbols: string[],
  opts?: ScoreTickersOptions,
): Promise<ScoreTickersResult> {
  const { scoreTickers } = await import('./scanEngine.ts')
  return scoreTickers(symbols, opts)
}

export async function getIdeaForSymbol(
  symbol: string,
  deps: {
    scoreTickers?: ScoreTickersFn
    mergeCatalyst?: MergeCatalystFn
    now?: () => string
    loadSnapshot?: () => SnapshotLoad
    log?: (payload: unknown) => void
  } = {},
): Promise<IdeaLookupResult> {
  const log = deps.log ?? ((payload: unknown) => console.log(JSON.stringify(payload)))
  return cache.get(symbol, async () => {
    const loaded = (deps.loadSnapshot ?? loadMembershipSnapshot)()
    const label = loaded.ok ? groupLabelFromSnapshot(loaded.snapshot, symbol) : null
    const score = deps.scoreTickers ?? defaultScoreTickers
    let scored: ScoreTickersResult
    try {
      scored = await score([symbol], {
        includeBelowSma200: true,
        ...(label
          ? {
              describe: (sym: string) => ({
                name: label.company || sym,
                groupId: label.groupId,
                groupName: label.groupName,
              }),
            }
          : {}),
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      return logMiss(log, symbol, detail)
    }
    const raw = scored.ideas[0]
    if (!raw) {
      const detail = scored.failed[0]?.reason?.trim() || 'No data'
      return logMiss(log, symbol, detail)
    }
    let idea = raw
    const merge = deps.mergeCatalyst ?? mergeCatalystIntoIdeas
    try {
      idea = merge([raw]).ideas[0] ?? raw
    } catch {
      idea = raw
    }
    idea = applyGroupLabel(idea, label)
    return {
      ok: true,
      idea,
      outsideScan: true as const,
      asOf: (deps.now ?? (() => new Date().toISOString()))(),
    }
  })
}

export function clearIdeaLookupCache(): void {
  cache.clear()
}

/**
 * Default Stage-1 universe: members of the top Finviz industry groups
 * for the selected period. The groups page is ranked with the same
 * `rankGroups` helper as the panel. Membership comes from
 * server/data/finviz-group-members.json (manual refresh).
 */
import type { GroupPeriod, IndustryGroup, LeadingGroupsMeta } from '../src/types/index.ts'
import { DEFAULT_GROUP_PERIOD, rankGroups } from '../src/lib/groupPeriod.ts'
import { loadMembershipSnapshot, type MembershipGroup, type MembershipSnapshot } from './groupMembers.ts'
import type { ScreenerHit } from './yahooScreener.ts'

export const LEADING_GROUPS_COUNT = 12
export const LEADING_GROUPS_PERIOD: GroupPeriod = DEFAULT_GROUP_PERIOD
export const LEADING_STAGE1_SOURCE = 'leading-groups-top12'

export interface IdeaGroupLabel {
  groupId: string
  groupName: string
  company?: string
}

export interface LeadingUniverseOk {
  ok: true
  hits: ScreenerHit[]
  meta: LeadingGroupsMeta
  /** Unique members of the selected top groups, before the Stage-1 cap. */
  leadingSymbols: Set<string>
  lookup: (symbol: string) => IdeaGroupLabel | null
}

export interface LeadingUniverseErr {
  ok: false
  error: string
}

export type LeadingUniverseResult = LeadingUniverseOk | LeadingUniverseErr

export interface UniverseOptions {
  count?: number
  period?: GroupPeriod
  /** When set, keep only the first `cap` symbols (group rank order). */
  cap?: number
}

interface MembershipHit {
  slug: string
  name: string
  rank: number | null
  company?: string
}

function groupSlug(group: IndustryGroup): string {
  return (group.slug ?? group.id).trim().toLowerCase()
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function snapshotGroup(snapshot: MembershipSnapshot, slug: string): MembershipGroup | undefined {
  if (snapshot.groups[slug]) return snapshot.groups[slug]
  const key = Object.keys(snapshot.groups).find((item) => item.toLowerCase() === slug)
  return key ? snapshot.groups[key] : undefined
}

function companyOf(group: MembershipGroup, ticker: string): string | undefined {
  const companies = group.companies
  if (!companies) return undefined
  return companies[ticker] ?? companies[ticker.toUpperCase()] ?? companies[ticker.toLowerCase()]
}

function buildIndex(
  snapshot: MembershipSnapshot,
  rankBySlug: Map<string, number>,
): Map<string, MembershipHit[]> {
  const index = new Map<string, MembershipHit[]>()
  for (const [rawSlug, group] of Object.entries(snapshot.groups)) {
    const slug = rawSlug.trim().toLowerCase()
    const rank = rankBySlug.get(slug) ?? null
    for (const raw of group.tickers) {
      const symbol = raw.trim().toUpperCase()
      if (!symbol) continue
      const list = index.get(symbol) ?? []
      list.push({
        slug,
        name: group.name,
        rank,
        company: companyOf(group, raw) ?? companyOf(group, symbol),
      })
      index.set(symbol, list)
    }
  }
  return index
}

/** Prefer a current top-12 group. Otherwise the best-ranked snapshot group. */
function preferMembershipHit(
  hits: readonly MembershipHit[],
  topSlugs: ReadonlySet<string>,
): MembershipHit | null {
  if (!hits.length) return null
  const inTop = hits.filter((hit) => topSlugs.has(hit.slug))
  const pool = inTop.length ? inTop : hits
  let best = pool[0]!
  for (const hit of pool) {
    if (hit.rank == null) continue
    if (best.rank == null || hit.rank < best.rank) best = hit
  }
  return best
}

function toHit(symbol: string, company: string | undefined): ScreenerHit {
  return company
    ? { symbol, shortName: company, quoteType: 'EQUITY' }
    : { symbol, quoteType: 'EQUITY' }
}

/** Keep the first `cap` items. Relative order is unchanged. */
export function capUniverse<T>(items: readonly T[], cap: number): T[] {
  if (!Number.isFinite(cap) || cap < 0) return [...items]
  const limit = Math.floor(cap)
  if (items.length <= limit) return [...items]
  return items.slice(0, limit)
}

export function universeFromGroups(
  response: { source: 'finviz' | 'fallback'; groups: IndustryGroup[] },
  snapshot: MembershipSnapshot | null,
  options: UniverseOptions = {},
): LeadingUniverseResult {
  if (response.source !== 'finviz') {
    return { ok: false, error: 'Finviz groups unavailable (source fallback)' }
  }
  if (!snapshot) {
    return { ok: false, error: 'Membership snapshot missing; run npm run build:groups' }
  }
  const period = options.period ?? LEADING_GROUPS_PERIOD
  const count = options.count ?? LEADING_GROUPS_COUNT

  const ranked = rankGroups(response.groups, period)
  const top = ranked.slice(0, Math.max(0, count))
  const rankBySlug = new Map<string, number>()
  for (const group of ranked) rankBySlug.set(groupSlug(group), group.rsRank)
  const topSlugs = new Set(top.map((group) => groupSlug(group)))
  const index = buildIndex(snapshot, rankBySlug)

  const ordered: ScreenerHit[] = []
  const leadingSymbols = new Set<string>()
  const seen = new Set<string>()
  const metaGroups: LeadingGroupsMeta['groups'] = []

  for (const group of top) {
    const slug = groupSlug(group)
    const mem = snapshotGroup(snapshot, slug)
    const unique = new Set<string>()
    for (const raw of mem?.tickers ?? []) {
      const symbol = raw.trim().toUpperCase()
      if (symbol) unique.add(symbol)
    }
    metaGroups.push({
      slug,
      name: mem?.name ?? group.name,
      rank: group.rsRank,
      memberCount: unique.size,
      perf3m: finiteOrNull(group.perf3m),
    })
    for (const symbol of unique) {
      if (seen.has(symbol)) continue
      seen.add(symbol)
      leadingSymbols.add(symbol)
      ordered.push(toHit(symbol, mem ? companyOf(mem, symbol) : undefined))
    }
  }

  if (!ordered.length) {
    return { ok: false, error: 'leading-groups universe empty' }
  }

  const hits = options.cap == null ? ordered : capUniverse(ordered, options.cap)

  const lookup = (symbol: string): IdeaGroupLabel | null => {
    const hitsFor = index.get(symbol.trim().toUpperCase())
    if (!hitsFor?.length) return null
    const chosen = preferMembershipHit(hitsFor, topSlugs)
    if (!chosen) return null
    return {
      groupId: chosen.slug,
      groupName: chosen.name,
      company: chosen.company,
    }
  }

  return {
    ok: true,
    hits,
    leadingSymbols,
    lookup,
    meta: {
      period,
      groups: metaGroups,
      symbolCount: hits.length,
      snapshotGeneratedAt: snapshot.generatedAt,
    },
  }
}

export async function buildLeadingGroupsUniverse(
  options: UniverseOptions = {},
): Promise<LeadingUniverseResult> {
  const { getIndustryGroups } = await import('./finvizGroups.ts')
  let response: Awaited<ReturnType<typeof getIndustryGroups>>
  try {
    response = await getIndustryGroups()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
  const loaded = loadMembershipSnapshot()
  if (!loaded.ok) return { ok: false, error: loaded.error }
  return universeFromGroups(response, loaded.snapshot, options)
}

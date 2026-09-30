/**
 * Build the membership snapshot from the live Finviz groups page and screener.
 * Uses the shared polite queue. A block, challenge, or exhausted retry aborts
 * before the destination file is replaced.
 */
import { finvizFetchText, looksLikeFinvizChallenge } from './finvizHttp.ts'
import { parseFinvizGroupsPerformance } from './finvizParse.ts'
import { parseFinvizScreenerPerformance } from './finvizScreenerParse.ts'
import { MIN_AVG_DAILY_VOL, MIN_PRICE } from './yahooScreener.ts'
import {
  buildMembershipScreenerUrl,
  collectGroupMembers,
  MEMBERSHIP_SOURCE_NOTE,
  withRetries,
  writeMembershipSnapshotAtomic,
  validateMembershipSnapshot,
  type MembershipGroup,
  type MembershipSnapshot,
} from './groupMembers.ts'
import { finvizLiquidityTokens } from '../src/lib/groupPeriod.ts'

/** Same document as `FINVIZ_GROUPS_URL` in finvizGroups.ts. Kept here so the builder does not import the request server. */
export const MEMBERSHIP_GROUPS_URL =
  'https://finviz.com/groups?g=industry&v=210&o=-perf13w&st=d1'

export class FinvizScreenerBlocked extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FinvizScreenerBlocked'
  }
}

export function screenerRowsFromHtml(
  status: number,
  html: string,
): { ticker: string; company: string }[] {
  if (status === 403 || status === 429 || status === 503) {
    throw new FinvizScreenerBlocked(`Finviz screener blocked (HTTP ${status})`)
  }
  if (status < 200 || status >= 300) throw new Error(`Finviz screener HTTP ${status}`)
  if (looksLikeFinvizChallenge(html) && !html.includes('screener_table')) {
    throw new FinvizScreenerBlocked('Finviz screener blocked (challenge page)')
  }
  const parsed = parseFinvizScreenerPerformance(html)
  if (!parsed.ok) {
    if (parsed.reason === 'blocked') {
      throw new FinvizScreenerBlocked('Finviz screener blocked (challenge page)')
    }
    // A real empty screen omits the table and reports result_count 0.
    if (
      parsed.reason === 'screener table not found' &&
      /"result_count"\s*:\s*0\b/.test(html)
    ) {
      return []
    }
    throw new Error(`Finviz screener parse failed (${parsed.reason})`)
  }
  return parsed.rows.map((row) => ({ ticker: row.ticker, company: row.company }))
}

function appliedFilters(): { minPrice: number; minAvgVolume: number } {
  const tokens = finvizLiquidityTokens(MIN_PRICE, MIN_AVG_DAILY_VOL)
  if (!tokens.mapped) {
    process.stdout.write(
      'liquidity env is not a Finviz bucket; snapshot uses price > 5 and average volume > 750000\n',
    )
    return { minPrice: 5, minAvgVolume: 750_000 }
  }
  return { minPrice: MIN_PRICE, minAvgVolume: MIN_AVG_DAILY_VOL }
}

async function fetchTextRetried(url: string): Promise<{ status: number; html: string }> {
  return withRetries(() => finvizFetchText(url), {
    attempts: 3,
    backoffMs: (failed) => 500 * 2 ** failed,
  })
}

export interface BuildProgress {
  done: number
  total: number
  tickers: number
  slug: string
  added: number
}

export async function buildMembershipSnapshot(opts?: {
  onProgress?: (progress: BuildProgress) => void
  now?: () => Date
}): Promise<MembershipSnapshot> {
  const filters = appliedFilters()
  const groupsPage = await fetchTextRetried(MEMBERSHIP_GROUPS_URL)
  if (groupsPage.status === 403 || groupsPage.status === 429 || groupsPage.status === 503) {
    throw new FinvizScreenerBlocked(`Finviz groups blocked (HTTP ${groupsPage.status})`)
  }
  if (groupsPage.status < 200 || groupsPage.status >= 300) {
    throw new Error(`Finviz groups HTTP ${groupsPage.status}`)
  }
  if (
    looksLikeFinvizChallenge(groupsPage.html) &&
    !groupsPage.html.includes('FinvizInitGroupsPerformance(')
  ) {
    throw new FinvizScreenerBlocked('Finviz groups blocked (challenge page)')
  }
  const rows = parseFinvizGroupsPerformance(groupsPage.html)
  if (rows.length === 0) throw new Error('Finviz groups parse failed')

  const seen = new Set<string>()
  const list: { slug: string; name: string }[] = []
  for (const row of rows) {
    const slug = row.ticker.trim().toLowerCase()
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    list.push({ slug, name: row.label.trim() })
  }
  if (list.length === 0) throw new Error('Finviz groups parse failed')

  const groups: Record<string, MembershipGroup> = {}
  let done = 0
  let tickers = 0
  let next = 0
  let failure: unknown = null

  async function worker(): Promise<void> {
    while (failure == null) {
      const index = next++
      if (index >= list.length) return
      const item = list[index]!
      try {
        const collected = await collectGroupMembers(async (offset) => {
          if (failure) throw new Error('aborted')
          const url = buildMembershipScreenerUrl(
            item.slug,
            offset,
            filters.minPrice,
            filters.minAvgVolume,
          )
          try {
            const page = await fetchTextRetried(url)
            return screenerRowsFromHtml(page.status, page.html)
          } catch (err) {
            const message = err instanceof Error ? err.message : 'page failed'
            throw new Error(`${item.slug} r=${offset}: ${message}`)
          }
        })
        const group: MembershipGroup = {
          name: item.name,
          tickers: collected.tickers,
          count: collected.tickers.length,
        }
        if (Object.keys(collected.companies).length > 0) group.companies = collected.companies
        if (collected.truncated) group.truncated = true
        groups[item.slug] = group
        done += 1
        tickers += collected.tickers.length
        opts?.onProgress?.({
          done,
          total: list.length,
          tickers,
          slug: item.slug,
          added: collected.tickers.length,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'membership build failed'
        failure = new Error(message.includes(item.slug) ? message : `${item.slug}: ${message}`)
        return
      }
    }
  }

  await Promise.all([worker(), worker()])
  if (failure) throw failure instanceof Error ? failure : new Error('membership build failed')
  if (done !== list.length) throw new Error('membership build stopped early')

  const snapshot: MembershipSnapshot = {
    version: 1,
    source: 'finviz',
    sourceNote: MEMBERSHIP_SOURCE_NOTE,
    generatedAt: (opts?.now ?? (() => new Date()))().toISOString(),
    filters,
    groups,
  }
  const check = validateMembershipSnapshot(JSON.parse(JSON.stringify(snapshot)))
  if (!check.ok) throw new Error(check.error)
  return check.snapshot
}

export async function buildAndWriteMembershipSnapshot(dest: string): Promise<MembershipSnapshot> {
  const snapshot = await buildMembershipSnapshot({
    onProgress: (progress) => {
      process.stdout.write(
        `groups ${progress.done}/${progress.total} tickers ${progress.tickers} ${progress.slug} +${progress.added}\n`,
      )
    },
  })
  writeMembershipSnapshotAtomic(snapshot, dest)
  return snapshot
}

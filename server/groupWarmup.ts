/**
 * Background quote warm-up for the top industries by current Finviz 3-month
 * performance. Starts only after a scan cache exists and the scan lock is
 * free. Two workers. GROUP_WARMUP=0 disables it. The scan never awaits this.
 */
import { isGroupSlug, rankGroups } from '../src/lib/groupPeriod.ts'
import { getIndustryGroups } from './finvizGroups.ts'
import { loadMembershipSnapshot, lookupMembershipGroup } from './groupMembers.ts'
import { ensureMemberQuotes, WARM_CONCURRENCY, WARM_GAP_MS } from './groupPerformance.ts'
import { getScanRuntimeStatus, loadScanCache } from './scanCache.ts'

export const WARM_GROUP_LIMIT = 25

let started = false

function warmupDisabled(): boolean {
  return (process.env.GROUP_WARMUP ?? '').trim() === '0'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function startGroupWarmup(): void {
  if (started) return
  if (warmupDisabled()) {
    process.stdout.write(`${JSON.stringify({ groupWarmup: 'disabled' })}\n`)
    return
  }
  started = true
  void runGroupWarmup()
}

async function runGroupWarmup(): Promise<void> {
  try {
    while (!warmupDisabled()) {
      const cache = loadScanCache()
      const status = getScanRuntimeStatus()
      if (cache && cache.ideas.length > 0 && !status.scanning) break
      await sleep(5_000)
    }
    if (warmupDisabled()) return
    const groups = await getIndustryGroups()
    if (groups.source !== 'finviz' || groups.groups.length === 0) {
      process.stdout.write(`${JSON.stringify({ groupWarmup: 'skip', reason: 'no finviz groups' })}\n`)
      return
    }
    const slugs = rankGroups(groups.groups, '3m')
      .slice(0, WARM_GROUP_LIMIT)
      .map((group) => (group.slug || group.id).toLowerCase())
      .filter((slug) => isGroupSlug(slug))
    const loaded = loadMembershipSnapshot()
    if (!loaded.ok) {
      process.stdout.write(`${JSON.stringify({ groupWarmup: 'skip', reason: loaded.error })}\n`)
      return
    }
    const tickers: string[] = []
    for (const slug of slugs) {
      const group = lookupMembershipGroup(loaded.snapshot, slug)
      if (group) tickers.push(...group.tickers)
    }
    process.stdout.write(
      `${JSON.stringify({ groupWarmup: 'start', groups: slugs.length, symbols: tickers.length })}\n`,
    )
    await ensureMemberQuotes(tickers, {
      budgetMs: Number.POSITIVE_INFINITY,
      maxSymbols: Number.POSITIVE_INFINITY,
      concurrency: WARM_CONCURRENCY,
      gapMs: WARM_GAP_MS,
    })
    process.stdout.write(`${JSON.stringify({ groupWarmup: 'done', groups: slugs.length })}\n`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'warmup failed'
    process.stderr.write(`${JSON.stringify({ groupWarmup: 'error', error: message })}\n`)
  }
}

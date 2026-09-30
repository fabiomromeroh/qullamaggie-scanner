/**
 * Live Finviz leading-industry groups.
 * Fetches the public performance page with a normal desktop Chrome User-Agent.
 * In-memory TTL cache; stale payload or internal ranking if Finviz fails.
 */
import type { GroupPeriod, GroupsResponse, IndustryGroup } from '../src/types/index.ts'
import { isGroupPeriod, isGroupSlug, parseSlugList } from '../src/lib/groupPeriod.ts'
import { buildDynamicGroups } from './scanEngine.ts'
import { loadScanCache } from './scanCache.ts'
import { finvizRowsToGroups, parseFinvizGroupsPerformance } from './finvizParse.ts'
import { FINVIZ_CACHE_TTL_MS, finvizFetchText, looksLikeFinvizChallenge } from './finvizHttp.ts'
import { getGroupLeaders } from './groupLeaders.ts'
import { getGroupStocks } from './groupStocks.ts'
import { isMembershipStale, loadMembershipSnapshot } from './groupMembers.ts'

export { finvizRowsToGroups, parseFinvizGroupsPerformance }

export const FINVIZ_GROUPS_URL =
  'https://finviz.com/groups?g=industry&v=210&o=-perf13w&st=d1'

/** Fresh Finviz payload is reused for this long before a refetch. */
export const FINVIZ_GROUPS_CACHE_TTL_MS = FINVIZ_CACHE_TTL_MS

type MiniReq = { url?: string; method?: string }
type MiniRes = {
  statusCode: number
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
}

type CachedFinviz = {
  groups: IndustryGroup[]
  fetchedAt: string
  storedAt: number
}

let cache: CachedFinviz | null = null
let inFlight: Promise<CachedFinviz> | null = null

async function fetchFinvizHtml(): Promise<string> {
  let status: number
  let html: string
  try {
    const fetched = await finvizFetchText(FINVIZ_GROUPS_URL)
    status = fetched.status
    html = fetched.html
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Finviz request failed'
    if (message === 'Finviz request timed out') throw new Error('Finviz groups request timed out')
    if (message === 'Finviz request failed') throw new Error('Finviz groups request failed')
    throw err
  }

  if (status === 403 || status === 429 || status === 503) {
    throw new Error(`Finviz groups blocked (HTTP ${status})`)
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Finviz groups HTTP ${status}`)
  }
  if (looksLikeFinvizChallenge(html) && !html.includes('FinvizInitGroupsPerformance(')) {
    throw new Error('Finviz groups blocked (challenge page)')
  }
  return html
}

async function fetchFresh(): Promise<CachedFinviz> {
  const html = await fetchFinvizHtml()
  const rows = parseFinvizGroupsPerformance(html)
  if (rows.length === 0) {
    throw new Error('Finviz groups parse failed')
  }
  return {
    groups: finvizRowsToGroups(rows),
    fetchedAt: new Date().toISOString(),
    storedAt: Date.now(),
  }
}

function fetchDeduped(): Promise<CachedFinviz> {
  if (!inFlight) {
    inFlight = fetchFresh()
      .then((entry) => {
        cache = entry
        return entry
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

function membershipMeta(): GroupsResponse['membership'] {
  const loaded = loadMembershipSnapshot()
  if (!loaded.ok) return undefined
  return {
    source: 'snapshot',
    generatedAt: loaded.snapshot.generatedAt,
    stale: isMembershipStale(loaded.snapshot.generatedAt),
  }
}

function respondFinviz(entry: CachedFinviz, stale: boolean): GroupsResponse {
  const membership = membershipMeta()
  return {
    source: 'finviz',
    stale,
    fetchedAt: entry.fetchedAt,
    sourceUrl: FINVIZ_GROUPS_URL,
    // In-scan leader counts come from GET /api/groups/leaders, not this list.
    groups: entry.groups,
    ...(membership ? { membership } : {}),
  }
}

function respondFallback(): GroupsResponse {
  const scanned = loadScanCache()
  const computedAt = new Date().toISOString()
  return {
    source: 'fallback',
    stale: false,
    fetchedAt: computedAt,
    sourceUrl: FINVIZ_GROUPS_URL,
    groups: buildDynamicGroups(scanned?.ideas ?? []),
  }
}

export async function getIndustryGroups(): Promise<GroupsResponse> {
  const now = Date.now()
  if (cache && now - cache.storedAt < FINVIZ_GROUPS_CACHE_TTL_MS) {
    return respondFinviz(cache, false)
  }

  try {
    const fresh = await fetchDeduped()
    return respondFinviz(fresh, false)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch failed'
    console.warn(`finviz groups unavailable: ${message}`)
    if (cache) return respondFinviz(cache, true)
    return respondFallback()
  }
}

function sendJson(res: MiniRes, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function readPeriod(url: URL): { ok: true; period: GroupPeriod } | { ok: false; error: string } {
  const raw = url.searchParams.get('period')
  if (raw == null || !raw.trim()) return { ok: false, error: 'period is required' }
  const period = raw.trim().toLowerCase()
  if (!isGroupPeriod(period)) {
    return { ok: false, error: 'period must be one of 1d, 1w, 1m, 3m, 6m' }
  }
  return { ok: true, period }
}

export function createGroupsMiddleware() {
  return async function groupsMiddleware(req: MiniReq, res: MiniRes, next: () => void) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    const leaders = pathname === '/api/groups/leaders'
    const stocksMatch = pathname.match(/^\/api\/groups\/([a-z0-9]+)\/stocks$/i)
    const list = pathname === '/api/groups'
    if (!leaders && !stocksMatch && !list) {
      next()
      return
    }

    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' })
      return
    }

    const periodParsed = leaders || stocksMatch ? readPeriod(url) : null
    if (periodParsed && !periodParsed.ok) {
      sendJson(res, 400, { error: periodParsed.error })
      return
    }

    try {
      if (leaders) {
        const slugs = parseSlugList(url.searchParams.get('slugs'))
        if (!slugs.ok) {
          sendJson(res, 400, { error: slugs.error })
          return
        }
        if (!periodParsed || !periodParsed.ok) {
          sendJson(res, 400, { error: 'period is required' })
          return
        }
        const body = await getGroupLeaders(slugs.slugs, periodParsed.period)
        sendJson(res, 200, body)
        return
      }

      if (stocksMatch) {
        const slug = (stocksMatch[1] ?? '').toLowerCase()
        if (!isGroupSlug(slug)) {
          sendJson(res, 400, { error: 'invalid slug' })
          return
        }
        if (!periodParsed || !periodParsed.ok) {
          sendJson(res, 400, { error: 'period is required' })
          return
        }
        const groups = await getIndustryGroups()
        const match = groups.groups.find((group) => (group.slug || group.id) === slug)
        const label = match?.name ?? slug
        const body = await getGroupStocks(slug, periodParsed.period, label)
        sendJson(res, 200, body)
        return
      }

      const body = await getIndustryGroups()
      sendJson(res, 200, body)
    } catch (err) {
      sendJson(res, 502, {
        error: err instanceof Error ? err.message : 'groups error',
      })
    }
  }
}

/**
 * Live Finviz leading-industry groups.
 * Fetches the public performance page with a normal desktop Chrome User-Agent.
 * In-memory TTL cache; stale payload or internal ranking if Finviz fails.
 */
import type { GroupsResponse, IndustryGroup } from '../src/types/index.ts'
import { ideaMatchesFinvizGroup } from '../src/lib/groupMatch.ts'
import { buildDynamicGroups } from './scanEngine.ts'
import { loadScanCache } from './scanCache.ts'
import { finvizRowsToGroups, parseFinvizGroupsPerformance } from './finvizParse.ts'

export { finvizRowsToGroups, parseFinvizGroupsPerformance }

export const FINVIZ_GROUPS_URL =
  'https://finviz.com/groups?g=industry&v=210&o=-perf13w&st=d1'

/** Fresh Finviz payload is reused for this long before a refetch. */
export const FINVIZ_GROUPS_CACHE_TTL_MS = 12 * 60 * 1000

const FINVIZ_FETCH_TIMEOUT_MS = 10_000

const FINVIZ_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

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

function looksLikeChallenge(html: string): boolean {
  const head = html.slice(0, 20_000).toLowerCase()
  return (
    head.includes('just a moment') ||
    head.includes('cf-browser-verification') ||
    head.includes('challenge-platform') ||
    head.includes('attention required') ||
    head.includes('cf-challenge') ||
    /<title>[^<]{0,80}cloudflare[^<]*<\/title>/.test(head)
  )
}

async function fetchFinvizHtml(): Promise<string> {
  let res: Response
  try {
    res = await fetch(FINVIZ_GROUPS_URL, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(FINVIZ_FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': FINVIZ_USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error('Finviz groups request timed out')
    }
    throw new Error('Finviz groups request failed')
  }

  const html = await res.text()
  if (res.status === 403 || res.status === 429 || res.status === 503) {
    throw new Error(`Finviz groups blocked (HTTP ${res.status})`)
  }
  if (!res.ok) {
    throw new Error(`Finviz groups HTTP ${res.status}`)
  }
  if (looksLikeChallenge(html) && !html.includes('FinvizInitGroupsPerformance(')) {
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

function withLeaderCounts(groups: IndustryGroup[]): IndustryGroup[] {
  const ideas = loadScanCache()?.ideas
  if (!ideas) return groups
  return groups.map((group) => ({
    ...group,
    leaderCount: ideas.filter((idea) => ideaMatchesFinvizGroup(idea, group)).length,
  }))
}

function respondFinviz(entry: CachedFinviz, stale: boolean): GroupsResponse {
  return {
    source: 'finviz',
    stale,
    fetchedAt: entry.fetchedAt,
    sourceUrl: FINVIZ_GROUPS_URL,
    groups: withLeaderCounts(entry.groups),
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

export function createGroupsMiddleware() {
  return async function groupsMiddleware(req: MiniReq, res: MiniRes, next: () => void) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    if (pathname !== '/api/groups') {
      next()
      return
    }

    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
      res.statusCode = 405
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    try {
      const body = await getIndustryGroups()
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(body))
    } catch (err) {
      res.statusCode = 502
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : 'groups error',
        }),
      )
    }
  }
}

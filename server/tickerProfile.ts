/**
 * Ticker profile facts (Finnhub profile2) + a short Wikipedia extract when
 * the page is verified against the company name. No crumb/cookie scraping.
 * Cache 24h; negative results 1h. In-flight de-dup.
 */
import { createSymbolCache } from './ttlCache.ts'

export const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const PROFILE_NEGATIVE_TTL_MS = 60 * 60 * 1000
export const PROFILE_TIMEOUT_MS = 8000
export const WIKIPEDIA_USER_AGENT = 'qullamaggie-scanner/1.0 (personal research tool)'

const DESCRIPTION_MAX_CHARS = 420
const DESCRIPTION_MAX_SENTENCES = 3

export interface FinnhubProfileFacts {
  name?: string
  industry?: string
  exchange?: string
  marketCap?: number
  weburl?: string
}

export interface TickerProfilePayload {
  symbol: string
  source: string
  fetchedAt: string
  name?: string
  industry?: string
  exchange?: string
  marketCap?: number
  weburl?: string
  description?: string
  descriptionSource?: string
  error?: string
}

const CORP_TOKENS =
  /\b(incorporated|inc|corporation|corp|ltd|limited|holdings|holding|group|company|plc|the|co)\b/g

export function normalizeCompanyName(name: string): string {
  let s = name.normalize('NFKD').toLowerCase()
  s = s.replace(/&/g, ' and ')
  s = s.replace(/\bclass\s+[a-z0-9]+\b/g, ' ')
  s = s.replace(/[.,/#'"’`()]/g, ' ')
  s = s.replace(CORP_TOKENS, ' ')
  s = s.replace(/[^a-z0-9]+/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

function significantTokens(name: string): string[] {
  return normalizeCompanyName(name).split(' ').filter((t) => t.length > 1)
}

/**
 * True when the Wikipedia title or extract shares the company's core name.
 * First significant word(s) of the company must appear as whole tokens.
 */
export function coreNameMatches(companyName: string, titleOrExtract: string): boolean {
  const core = normalizeCompanyName(companyName)
  const other = normalizeCompanyName(titleOrExtract)
  if (!core || !other) return false
  if (core === other) return true
  const coreToks = significantTokens(companyName)
  const otherToks = significantTokens(titleOrExtract)
  if (!coreToks.length || !otherToks.length) return false
  const otherJoined = ` ${otherToks.join(' ')} `
  if (otherJoined.includes(` ${coreToks.join(' ')} `)) return true
  if (coreToks.length === 1) {
    return otherToks[0] === coreToks[0]
  }
  const lead = coreToks.slice(0, 2)
  if (otherJoined.includes(` ${lead.join(' ')} `)) return true
  const have = new Set(otherToks)
  return lead.every((t) => have.has(t))
}

const ABBR_RE = /\b(?:Inc|Corp|Ltd|Co|Mr|Mrs|Ms|Dr|Jr|Sr|U\.S|US)\./g

/** First 2–3 sentences, cut at a sentence boundary, cap ~420 chars. */
export function trimToSentences(
  text: string,
  maxSentences = DESCRIPTION_MAX_SENTENCES,
  maxChars = DESCRIPTION_MAX_CHARS,
): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  const placeholders: string[] = []
  const protectedText = cleaned.replace(ABBR_RE, (m) => {
    placeholders.push(m)
    return `__ABBR${placeholders.length - 1}__`
  })
  const parts = protectedText.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [protectedText]
  let out = ''
  let count = 0
  for (const part of parts) {
    const piece = part.replace(/\s+/g, ' ').trim()
    if (!piece) continue
    if (count >= maxSentences) break
    const next = out ? `${out} ${piece}` : piece
    if (next.length > maxChars && out) break
    if (next.length > maxChars && !out) {
      const cut = piece.slice(0, maxChars).replace(/\s+\S*$/, '')
      out = cut
      break
    }
    out = next
    count += 1
  }
  let restored = out
  placeholders.forEach((abbr, i) => {
    restored = restored.replace(`__ABBR${i}__`, abbr)
  })
  return restored.trim()
}

export function parseFinnhubProfile(raw: unknown): FinnhubProfileFacts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  const facts: FinnhubProfileFacts = {}
  if (typeof rec.name === 'string' && rec.name.trim()) facts.name = rec.name.trim()
  if (typeof rec.finnhubIndustry === 'string' && rec.finnhubIndustry.trim()) {
    facts.industry = rec.finnhubIndustry.trim()
  }
  if (typeof rec.exchange === 'string' && rec.exchange.trim()) {
    facts.exchange = rec.exchange.trim()
  }
  const millions =
    typeof rec.marketCapitalization === 'number' && Number.isFinite(rec.marketCapitalization)
      ? rec.marketCapitalization
      : null
  if (millions != null && millions > 0) {
    facts.marketCap = millions * 1_000_000
  }
  if (typeof rec.weburl === 'string' && rec.weburl.trim()) {
    try {
      const u = new URL(rec.weburl.trim())
      if (u.protocol === 'http:' || u.protocol === 'https:') facts.weburl = u.toString()
    } catch {
      /* skip */
    }
  }
  if (!facts.name && !facts.industry && !facts.exchange && facts.marketCap == null && !facts.weburl) {
    return null
  }
  return facts
}

export function parseOpenSearch(raw: unknown): string[] {
  if (!Array.isArray(raw) || !Array.isArray(raw[1])) return []
  return (raw[1] as unknown[]).filter(
    (t): t is string => typeof t === 'string' && t.trim().length > 0,
  )
}

export function parseWikipediaSummary(
  raw: unknown,
  companyName: string,
): { description: string; title: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (rec.type === 'disambiguation') return null
  const title = typeof rec.title === 'string' ? rec.title.trim() : ''
  const extract = typeof rec.extract === 'string' ? rec.extract.trim() : ''
  if (!extract) return null
  const titleOk = title ? coreNameMatches(companyName, title) : false
  const extractOk = coreNameMatches(companyName, extract)
  if (!titleOk && !extractOk) return null
  const description = trimToSentences(extract)
  if (!description) return null
  return { description, title: title || companyName }
}

function isNegativeProfile(payload: TickerProfilePayload): boolean {
  return (
    !payload.name &&
    !payload.industry &&
    !payload.exchange &&
    payload.marketCap == null &&
    !payload.description
  )
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs = PROFILE_TIMEOUT_MS,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  })
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, json }
}

async function loadFinnhubFacts(
  symbol: string,
  token: string,
): Promise<FinnhubProfileFacts> {
  const url =
    `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}` +
    `&token=${encodeURIComponent(token)}`
  const { status, json } = await fetchJson(url, { Accept: 'application/json' })
  if (status === 401 || status === 403) {
    throw new Error(`Finnhub profile HTTP ${status}`)
  }
  if (status === 429) {
    throw new Error('Finnhub profile rate limited (429)')
  }
  if (status !== 200) {
    throw new Error(`Finnhub profile HTTP ${status}`)
  }
  return parseFinnhubProfile(json) ?? {}
}

async function loadWikipediaDescription(companyName: string): Promise<{
  description: string
  title: string
} | null> {
  const searchUrl =
    'https://en.wikipedia.org/w/api.php?action=opensearch' +
    `&search=${encodeURIComponent(companyName)}&limit=5&namespace=0&format=json`
  const search = await fetchJson(searchUrl, {
    Accept: 'application/json',
    'User-Agent': WIKIPEDIA_USER_AGENT,
  })
  if (search.status !== 200) return null
  const titles = parseOpenSearch(search.json)
  for (const title of titles) {
    const summaryUrl =
      'https://en.wikipedia.org/api/rest_v1/page/summary/' +
      encodeURIComponent(title.replace(/ /g, '_'))
    try {
      const summary = await fetchJson(summaryUrl, {
        Accept: 'application/json',
        'User-Agent': WIKIPEDIA_USER_AGENT,
      })
      if (summary.status !== 200) continue
      const parsed = parseWikipediaSummary(summary.json, companyName)
      if (parsed) return parsed
    } catch {
      /* try next title */
    }
  }
  return null
}

const profileCache = createSymbolCache<TickerProfilePayload>({
  ttlMs: PROFILE_CACHE_TTL_MS,
  negativeTtlMs: PROFILE_NEGATIVE_TTL_MS,
  isNegative: isNegativeProfile,
  staleOnError: true,
})

async function loadProfile(
  symbol: string,
  finnhubKey: string | undefined,
): Promise<TickerProfilePayload> {
  const fetchedAt = new Date().toISOString()
  const payload: TickerProfilePayload = {
    symbol,
    source: 'none',
    fetchedAt,
  }
  const errors: string[] = []

  if (!finnhubKey) {
    payload.error = 'no API key (FINNHUB_API_KEY)'
    return payload
  }

  try {
    const facts = await loadFinnhubFacts(symbol, finnhubKey)
    payload.source = 'finnhub'
    if (facts.name) payload.name = facts.name
    if (facts.industry) payload.industry = facts.industry
    if (facts.exchange) payload.exchange = facts.exchange
    if (facts.marketCap != null) payload.marketCap = facts.marketCap
    if (facts.weburl) payload.weburl = facts.weburl
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }

  if (payload.name) {
    try {
      const wiki = await loadWikipediaDescription(payload.name)
      if (wiki) {
        payload.description = wiki.description
        payload.descriptionSource = 'Wikipedia'
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  if (errors.length && isNegativeProfile(payload)) {
    payload.error = errors.join('; ')
  } else if (errors.length && !payload.description && !payload.name) {
    payload.error = errors.join('; ')
  }
  return payload
}

export async function fetchTickerProfile(
  symbol: string,
  finnhubKey: string | undefined,
): Promise<TickerProfilePayload> {
  try {
    return await profileCache.get(symbol, () => loadProfile(symbol, finnhubKey))
  } catch (err) {
    return {
      symbol,
      source: 'none',
      fetchedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'Profile unavailable',
    }
  }
}

export function clearProfileCache(): void {
  profileCache.clear()
}

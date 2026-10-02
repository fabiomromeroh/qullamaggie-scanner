/**
 * Finviz industry membership snapshot: load, validate, staleness.
 * The file is built by `npm run build:groups` where Finviz's screener answers.
 * Request-time handlers only read it.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { finvizLiquidityTokens, isGroupSlug, MEMBERSHIP_STALE_MS } from '../src/lib/groupPeriod.ts'

export const MEMBERSHIP_VERSION = 1
export { MEMBERSHIP_STALE_MS }
export const MEMBERSHIP_PAGE_SIZE = 20
export const MEMBERSHIP_MAX_PAGES = 15

export const MEMBERSHIP_SOURCE_NOTE =
  'Membership from the public Finviz performance screener (v=141) filtered with f=ind_<slug>,sh_price_o5,sh_avgvol_o750 (price > $5, average volume > 750K). Paginated with r=1,21,41… up to 15 pages per group. Built on a host that can reach finviz.com because Render IPs receive HTTP 403 from screener.ashx. Performance is not stored.'

export interface MembershipGroup {
  name: string
  tickers: string[]
  companies?: Record<string, string>
  count: number
  /** Set when the 15-page cap was hit on a full page. */
  truncated?: boolean
}

export interface MembershipSnapshot {
  version: 1
  source: 'finviz'
  sourceNote: string
  generatedAt: string
  filters: { minPrice: number; minAvgVolume: number }
  groups: Record<string, MembershipGroup>
}

export type SnapshotLoad =
  | { ok: true; snapshot: MembershipSnapshot }
  | { ok: false; error: string }

const TICKER_RE = /^[A-Z0-9.-]+$/

export function membershipSnapshotPath(): string {
  return process.env.GROUP_MEMBERS_PATH
    ? resolve(process.env.GROUP_MEMBERS_PATH)
    : resolve(process.cwd(), 'server/data/finviz-group-members.json')
}

export function isMembershipStale(generatedAt: string, now = Date.now()): boolean {
  const parsed = Date.parse(generatedAt)
  if (!Number.isFinite(parsed)) return true
  return now - parsed > MEMBERSHIP_STALE_MS
}

export function buildMembershipScreenerUrl(
  slug: string,
  offset: number,
  minPrice: number,
  minAvgVol: number,
): string {
  const tokens = finvizLiquidityTokens(minPrice, minAvgVol)
  const url = new URL('https://finviz.com/screener.ashx')
  url.searchParams.set('v', '141')
  url.searchParams.set('f', `ind_${slug},${tokens.price},${tokens.avgVol}`)
  url.searchParams.set('r', String(offset))
  return url.toString()
}

export function pageOffset(pageIndex: number, pageSize = MEMBERSHIP_PAGE_SIZE): number {
  return 1 + pageIndex * pageSize
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateMembershipSnapshot(value: unknown): SnapshotLoad {
  if (!isRecord(value)) return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
  if (value.version !== MEMBERSHIP_VERSION || value.source !== 'finviz') {
    return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
  }
  if (typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))) {
    return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
  }
  if (typeof value.sourceNote !== 'string' || !value.sourceNote.trim()) {
    return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
  }
  if (!isRecord(value.filters)) {
    return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
  }
  const minPrice = value.filters.minPrice
  const minAvgVolume = value.filters.minAvgVolume
  if (typeof minPrice !== 'number' || typeof minAvgVolume !== 'number') {
    return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
  }
  if (!isRecord(value.groups)) {
    return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
  }

  const groups: Record<string, MembershipGroup> = {}
  for (const [slug, raw] of Object.entries(value.groups)) {
    if (!isGroupSlug(slug)) {
      return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
    }
    if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name.trim()) {
      return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
    }
    if (!Array.isArray(raw.tickers) || typeof raw.count !== 'number') {
      return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
    }
    const tickers: string[] = []
    const seen = new Set<string>()
    for (const ticker of raw.tickers) {
      if (typeof ticker !== 'string' || !TICKER_RE.test(ticker) || seen.has(ticker)) {
        return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
      }
      seen.add(ticker)
      tickers.push(ticker)
    }
    if (raw.count !== tickers.length) {
      return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
    }
    const group: MembershipGroup = { name: raw.name.trim(), tickers, count: tickers.length }
    if (raw.truncated != null) {
      if (raw.truncated !== true) {
        return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
      }
      group.truncated = true
    }
    if (raw.companies != null) {
      if (!isRecord(raw.companies)) {
        return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
      }
      const companies: Record<string, string> = {}
      for (const [ticker, company] of Object.entries(raw.companies)) {
        if (!seen.has(ticker) || typeof company !== 'string' || !company.trim()) {
          return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
        }
        companies[ticker] = company.trim()
      }
      group.companies = companies
    }
    groups[slug] = group
  }

  return {
    ok: true,
    snapshot: {
      version: 1,
      source: 'finviz',
      sourceNote: value.sourceNote.trim(),
      generatedAt: value.generatedAt,
      filters: { minPrice, minAvgVolume },
      groups,
    },
  }
}

export function lookupMembershipGroup(
  snapshot: MembershipSnapshot,
  slug: string,
): MembershipGroup | null {
  const key = slug.trim().toLowerCase()
  return snapshot.groups[key] ?? null
}

/** One group per line so a refresh stays reviewable in diff. */
export function formatMembershipSnapshot(snapshot: MembershipSnapshot): string {
  const slugs = Object.keys(snapshot.groups).sort()
  const lines = [
    '{',
    `  "version": ${snapshot.version},`,
    `  "source": ${JSON.stringify(snapshot.source)},`,
    `  "sourceNote": ${JSON.stringify(snapshot.sourceNote)},`,
    `  "generatedAt": ${JSON.stringify(snapshot.generatedAt)},`,
    `  "filters": ${JSON.stringify(snapshot.filters)},`,
    '  "groups": {',
  ]
  slugs.forEach((slug, index) => {
    const comma = index === slugs.length - 1 ? '' : ','
    lines.push(`    ${JSON.stringify(slug)}: ${JSON.stringify(snapshot.groups[slug])}${comma}`)
  })
  lines.push('  }', '}', '')
  return lines.join('\n')
}

const loadCache = new Map<string, { mtimeMs: number; snapshot: MembershipSnapshot }>()

export function loadMembershipSnapshot(path = membershipSnapshotPath()): SnapshotLoad {
  if (!existsSync(path)) {
    return { ok: false, error: 'Membership snapshot missing; run npm run build:groups' }
  }
  let mtimeMs = 0
  try {
    mtimeMs = statSync(path).mtimeMs
  } catch {
    return { ok: false, error: 'Membership snapshot missing; run npm run build:groups' }
  }
  const cached = loadCache.get(path)
  if (cached && cached.mtimeMs === mtimeMs) return { ok: true, snapshot: cached.snapshot }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const validated = validateMembershipSnapshot(parsed)
    if (!validated.ok) {
      loadCache.delete(path)
      return validated
    }
    loadCache.set(path, { mtimeMs, snapshot: validated.snapshot })
    return validated
  } catch {
    loadCache.delete(path)
    return { ok: false, error: 'Membership snapshot invalid; run npm run build:groups' }
  }
}

export function clearMembershipSnapshotCache(): void {
  loadCache.clear()
}

/** Write via a temp file in the same directory. Rename only after the bytes are on disk. */
export function writeMembershipSnapshotAtomic(snapshot: MembershipSnapshot, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true })
  const tmp = resolve(dirname(dest), `.${basename(dest)}.${process.pid}.tmp`)
  try {
    writeFileSync(tmp, formatMembershipSnapshot(snapshot))
    renameSync(tmp, dest)
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {
      /* temp already gone */
    }
    throw err
  }
}

export interface CollectedMembers {
  tickers: string[]
  companies: Record<string, string>
  truncated: boolean
}

/** Dedupe tickers. Stop on a short page, a page that adds nothing, or the page cap. */
export async function collectGroupMembers(
  fetchPage: (offset: number) => Promise<{ ticker: string; company: string }[]>,
  opts?: { maxPages?: number; pageSize?: number },
): Promise<CollectedMembers> {
  const maxPages = opts?.maxPages ?? MEMBERSHIP_MAX_PAGES
  const pageSize = opts?.pageSize ?? MEMBERSHIP_PAGE_SIZE
  const tickers: string[] = []
  const companies: Record<string, string> = {}
  const seen = new Set<string>()
  let truncated = false
  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchPage(pageOffset(page, pageSize))
    let added = 0
    for (const row of rows) {
      const ticker = row.ticker.trim().toUpperCase()
      if (!ticker || seen.has(ticker) || !TICKER_RE.test(ticker)) continue
      seen.add(ticker)
      tickers.push(ticker)
      const company = row.company.trim()
      if (company) companies[ticker] = company
      added++
    }
    const full = rows.length >= pageSize
    if (!full || added === 0) {
      truncated = false
      break
    }
    if (page === maxPages - 1) truncated = true
  }
  return { tickers, companies, truncated }
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  opts: {
    attempts: number
    backoffMs: (failedAttempt: number) => number
    sleep?: (ms: number) => Promise<void>
  },
): Promise<T> {
  const sleep =
    opts.sleep ??
    ((ms: number) => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms)))
  let last: unknown
  const attempts = Math.max(1, opts.attempts)
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (attempt === attempts - 1) break
      await sleep(opts.backoffMs(attempt))
    }
  }
  throw last instanceof Error ? last : new Error('request failed')
}

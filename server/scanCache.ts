/**
 * Persistent scan-result cache for the dashboard.
 * Written by the server scan engine; read by GET /api/market/dashboard.
 *
 * Disk cache is lost on Render free restart/sleep. We also keep the last
 * successful payload in process memory so a mid-process miss still serves
 * data until the next rescan finishes.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { DashboardData, LeadingGroupsMeta } from '../src/types/index.ts'

/**
 * Bump when cached idea math changes so old files are not served as fresh.
 * v2: dayPct uses the prior session close. Yahoo `chartPreviousClose` on a
 * 1y chart is the close before that range, not yesterday, and poisoned v1.
 * v3: idea payload adds strict MA-surfer (surfer10/20/50 + surferDetail) and
 * tightConsolidation / tightDetail. Old caches are discarded.
 * v4: surfer detail is ADR-relative distance (no touch counts) and tight
 * consolidation requires price above the 50 and 200 SMAs. Catalyst fields
 * are not written into this file; they are merged onto the HTTP response.
 * v5: idea payload adds extensionAdr50 (ADR multiples from the 50 SMA).
 * v6: Range Breakout gates are ADR%, above the 50 SMA, priorRunPct, range/ADR,
 * and higher lows. Ideas store rangeBreakoutDetail. The previous
 * distance-from-high and relative-volume gates for that label are retired.
 */
export const SCAN_CACHE_SCHEMA = 6

export interface ScanCacheMeta {
  schemaVersion?: number
  stage1Source: string
  /** Top-12 Finviz universe. Null when Stage 1 fell back to Yahoo or the emergency list. */
  leadingGroupsMeta?: LeadingGroupsMeta | null
  stage1Count: number
  /** Survivors after Stage 1.5 SMA prefilter (above 200 AND above 50). */
  stage15Count: number
  shortlistCount: number
  stage1Filters: Record<string, unknown>
  stage15Filters?: Record<string, unknown>
  stage15BelowSma200Count?: number
  stage15BelowSma50Count?: number
  stage15MissingSmaCount?: number
  stage15QuoteFailCount?: number
  scanDurationMs: number
  errors: string[]
  emergencyFallback: boolean
}

export type ScanCachePayload = DashboardData & {
  meta: ScanCacheMeta
}

export type ScanStatus = {
  scanning: boolean
  startedAt: string | null
  finishedAt: string | null
  lastError: string | null
  cacheAgeMs: number | null
  cacheAsOf: string | null
  hasCache: boolean
  stage1Source: string | null
  stage1Count: number | null
  stage15Count: number | null
  shortlistCount: number | null
  emergencyFallback: boolean
}

const DEFAULT_CACHE_PATH = resolve(process.cwd(), 'data', 'scan-cache.json')
const STALE_MS = Number(process.env.SCAN_CACHE_STALE_MS || 45 * 60 * 1000)

/** Last successful dashboard kept in-process (survives disk wipe while process lives). */
let memoryCache: ScanCachePayload | null = null

export function cachePath(): string {
  return process.env.SCAN_CACHE_PATH
    ? resolve(process.env.SCAN_CACHE_PATH)
    : DEFAULT_CACHE_PATH
}

export function getStaleMs(): number {
  return STALE_MS
}

function loadScanCacheFromDisk(): ScanCachePayload | null {
  const path = cachePath()
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf8')
    const data = JSON.parse(raw) as ScanCachePayload
    if (!data || !Array.isArray(data.ideas) || !data.asOf) return null
    if (data.meta?.schemaVersion !== SCAN_CACHE_SCHEMA) return null
    return data
  } catch {
    return null
  }
}

export function loadScanCache(): ScanCachePayload | null {
  const fromDisk = loadScanCacheFromDisk()
  if (fromDisk) {
    memoryCache = fromDisk
    return fromDisk
  }
  if (memoryCache && memoryCache.meta?.schemaVersion !== SCAN_CACHE_SCHEMA) {
    memoryCache = null
  }
  return memoryCache
}

export function saveScanCache(payload: ScanCachePayload): void {
  payload.meta.schemaVersion = SCAN_CACHE_SCHEMA
  memoryCache = payload
  const path = cachePath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(payload))
  renameSync(tmp, path)
}

export function cacheAgeMs(
  cache: ScanCachePayload | null = loadScanCache(),
): number | null {
  if (!cache?.asOf) return null
  const t = Date.parse(cache.asOf)
  if (!Number.isFinite(t)) return null
  return Date.now() - t
}

export function isCacheStale(
  cache: ScanCachePayload | null = loadScanCache(),
): boolean {
  const age = cacheAgeMs(cache)
  if (age == null) return true
  return age > STALE_MS
}

let scanning = false
let startedAt: string | null = null
let finishedAt: string | null = null
let lastError: string | null = null

export function getScanRuntimeStatus(): ScanStatus {
  const cache = loadScanCache()
  return {
    scanning,
    startedAt,
    finishedAt,
    lastError,
    cacheAgeMs: cacheAgeMs(cache),
    cacheAsOf: cache?.asOf ?? null,
    hasCache: Boolean(cache?.ideas?.length),
    stage1Source: cache?.meta?.stage1Source ?? null,
    stage1Count: cache?.meta?.stage1Count ?? null,
    stage15Count: cache?.meta?.stage15Count ?? null,
    shortlistCount: cache?.meta?.shortlistCount ?? null,
    emergencyFallback: Boolean(cache?.meta?.emergencyFallback),
  }
}

export function beginScanLock(): boolean {
  if (scanning) return false
  scanning = true
  startedAt = new Date().toISOString()
  lastError = null
  return true
}

export function endScanLock(error: string | null = null): void {
  scanning = false
  finishedAt = new Date().toISOString()
  if (error) lastError = error
}

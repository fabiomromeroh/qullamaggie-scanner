/**
 * Persistent scan-result cache for the dashboard.
 * Written by the server scan engine; read by GET /api/market/dashboard.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { DashboardData } from '../src/types/index.ts'

export interface ScanCacheMeta {
  stage1Source: string
  stage1Count: number
  shortlistCount: number
  stage1Filters: Record<string, unknown>
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
  stage1Source: string | null
  stage1Count: number | null
  shortlistCount: number | null
  emergencyFallback: boolean
}

const DEFAULT_CACHE_PATH = resolve(process.cwd(), 'data', 'scan-cache.json')
const STALE_MS = Number(process.env.SCAN_CACHE_STALE_MS || 45 * 60 * 1000)

export function cachePath(): string {
  return process.env.SCAN_CACHE_PATH
    ? resolve(process.env.SCAN_CACHE_PATH)
    : DEFAULT_CACHE_PATH
}

export function getStaleMs(): number {
  return STALE_MS
}

export function loadScanCache(): ScanCachePayload | null {
  const path = cachePath()
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf8')
    const data = JSON.parse(raw) as ScanCachePayload
    if (!data || !Array.isArray(data.ideas) || !data.asOf) return null
    return data
  } catch {
    return null
  }
}

export function saveScanCache(payload: ScanCachePayload): void {
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
    stage1Source: cache?.meta?.stage1Source ?? null,
    stage1Count: cache?.meta?.stage1Count ?? null,
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

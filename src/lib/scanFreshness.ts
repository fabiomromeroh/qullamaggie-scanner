/**
 * Pure scan-freshness helpers. Bar dates use America/New_York via Intl so
 * DST transitions stay on the exchange calendar.
 */
import { GROUP_PERIODS } from './groupPeriod'
import type { GroupPeriod, ScanFreshness } from '../types'

export const SCAN_FRESHNESS_ET_ZONE = 'America/New_York'

const ET_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: SCAN_FRESHNESS_ET_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export interface FormatScanFreshnessOptions {
  /**
   * IANA zone for the scan clock. Omit it to use the runtime local zone
   * (the browser zone in the UI).
   */
  timeZone?: string
}

/**
 * `YYYY-MM-DD` in America/New_York for a unix timestamp in milliseconds.
 * Null when `epochMs` is not a finite number. DST-safe: the calendar parts
 * come from `Intl` with `timeZone: America/New_York`, not from a fixed offset.
 */
export function etDateOfEpoch(epochMs: number): string | null {
  if (!Number.isFinite(epochMs)) return null
  const parts = ET_DATE.formatToParts(new Date(epochMs))
  let year = ''
  let month = ''
  let day = ''
  for (const part of parts) {
    if (part.type === 'year') year = part.value
    else if (part.type === 'month') month = part.value
    else if (part.type === 'day') day = part.value
  }
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return null
  return `${year}-${month}-${day}`
}

/**
 * ET session date of the newest scored bar. `epochMs` values are unix
 * milliseconds (daily bar `t` seconds × 1000). Empty or non-finite input is null.
 */
export function barsAsOfFromEpochs(epochMs: readonly number[]): string | null {
  let max = Number.NEGATIVE_INFINITY
  for (const value of epochMs) {
    if (typeof value === 'number' && Number.isFinite(value) && value > max) max = value
  }
  if (max === Number.NEGATIVE_INFINITY) return null
  return etDateOfEpoch(max)
}

function hourMinute(date: Date, timeZone: string | undefined, withZone: boolean): { hm: string; zone: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(withZone ? { timeZoneName: 'short' as const } : {}),
  }).formatToParts(date)
  let hour = ''
  let minute = ''
  let zone = ''
  for (const part of parts) {
    if (part.type === 'hour') hour = part.value
    else if (part.type === 'minute') minute = part.value
    else if (part.type === 'timeZoneName') zone = part.value
  }
  if (hour === '24') hour = '00'
  return { hm: hour && minute ? `${hour}:${minute}` : '', zone }
}

function formatMonthDay(ymd: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) return null
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const label = MONTHS[month - 1]
  if (!label) return null
  return `${label} ${day}`
}

function periodLabel(period: GroupPeriod): string {
  return GROUP_PERIODS[period]?.label ?? period.toUpperCase()
}

/**
 * Compact stats line. Null pieces are left out.
 * `Scan 14:25 GMT+1 (09:25 ET) · bars Oct 15 · universe 254 (top-12 groups, 1M) · membership Oct 12`
 * The zone label is `Intl` `timeZoneName: 'short'` for `options.timeZone` (browser local when omitted).
 * The parenthetical clock is America/New_York and is always labelled ET.
 * Membership uses the ET calendar date of `membershipSnapshotDate`.
 */
export function formatScanFreshnessLine(
  freshness: ScanFreshness | null | undefined,
  options?: FormatScanFreshnessOptions,
): string {
  if (!freshness) return ''
  const parts: string[] = []
  const scannedAt = Date.parse(freshness.asOf)
  if (Number.isFinite(scannedAt)) {
    const when = new Date(scannedAt)
    const local = hourMinute(when, options?.timeZone, true)
    const et = hourMinute(when, SCAN_FRESHNESS_ET_ZONE, false)
    if (local.hm && et.hm) {
      const zone = local.zone ? ` ${local.zone}` : ''
      parts.push(`Scan ${local.hm}${zone} (${et.hm} ET)`)
    }
  }
  if (freshness.barsAsOf) {
    const bars = formatMonthDay(freshness.barsAsOf)
    if (bars) parts.push(`bars ${bars}`)
  }
  if (typeof freshness.universeSize === 'number' && Number.isFinite(freshness.universeSize)) {
    const period = freshness.groupsPeriod ? periodLabel(freshness.groupsPeriod) : null
    parts.push(
      period
        ? `universe ${freshness.universeSize} (top-12 groups, ${period})`
        : `universe ${freshness.universeSize}`,
    )
  }
  if (freshness.membershipSnapshotDate) {
    const ymd = etDateOfEpoch(Date.parse(freshness.membershipSnapshotDate))
    const membership = ymd ? formatMonthDay(ymd) : null
    if (membership) parts.push(`membership ${membership}`)
  }
  return parts.join(' · ')
}

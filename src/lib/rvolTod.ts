/**
 * Time-of-day relative volume (regular-hours 5-minute slots, America/New_York).
 * Pure helpers only — Yahoo I/O lives in server/intradayVolume.ts.
 */

export const INTRADAY_RVOL_CONFIG = {
  slotMinutes: 5,
  sessionsBack: 10,
  fetchRange: '15d',
  minCompletedSlots: 2,
  /** 09:30–16:00 ET is 78 five-minute bars (16:00 itself is not a bar start). */
  fullSessionSlots: 78,
  todayTtlMs: 5 * 60 * 1000,
  concurrency: 5,
  retries: 2,
  backoffMs: [500, 1500],
  phaseTimeoutMs: 25_000,
  dailyFallbackSessions: 10,
} as const

/** Baseline is null when fewer than this many full prior sessions exist. */
export const MIN_FULL_BASELINE_SESSIONS = 5

const ET_ZONE = 'America/New_York'
const OPEN_MINUTES = 9 * 60 + 30
const CLOSE_MINUTES = 16 * 60
/** NYSE early close. A session with no bar starting at or after this is a half-day. */
const EARLY_CLOSE_MINUTES = 13 * 60

const ET_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_ZONE,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export interface EtParts {
  /** YYYY-MM-DD in America/New_York. */
  date: string
  hour: number
  minute: number
  /** Minutes since midnight ET. */
  minutes: number
  weekday: string
}

export interface IntradayBar {
  /** Unix milliseconds. */
  t: number
  v: number
}

export interface SessionSlots {
  date: string
  /** Regular-hours slot index → volume. Duplicate timestamps in one slot are summed. */
  volumes: Map<number, number>
  /** Regular-hours bars that landed in a slot (not pre/post). */
  barCount: number
}

export interface IntradayRvolValue {
  rvolTod: number | null
  /** Last completed slot used in the ratio. Null when no ratio is produced. */
  slot: number | null
  reason?: string
}

export function etParts(epochMs: number): EtParts {
  const parts = ET_FORMAT.formatToParts(new Date(epochMs))
  let year = ''
  let month = ''
  let day = ''
  let hour = 0
  let minute = 0
  let weekday = ''
  for (const part of parts) {
    if (part.type === 'year') year = part.value
    else if (part.type === 'month') month = part.value
    else if (part.type === 'day') day = part.value
    else if (part.type === 'hour') hour = Number(part.value)
    else if (part.type === 'minute') minute = Number(part.value)
    else if (part.type === 'weekday') weekday = part.value
  }
  if (hour === 24) hour = 0
  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute,
    minutes: hour * 60 + minute,
    weekday,
  }
}

export function isWeekdayEt(epochMs: number): boolean {
  const { weekday } = etParts(epochMs)
  return weekday !== 'Sat' && weekday !== 'Sun'
}

/** Weekday and 09:30 <= ET clock < 16:00. */
export function isRegularSession(epochMs: number): boolean {
  if (!isWeekdayEt(epochMs)) return false
  const { minutes } = etParts(epochMs)
  return minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES
}

/**
 * Slot index of a bar timestamp. (minutes since 09:30 ET) / slotMinutes.
 * Null outside 09:30–16:00 ET. DST-safe because the clock is America/New_York.
 */
export function slotIndexAt(epochMs: number): number | null {
  const { minutes } = etParts(epochMs)
  if (minutes < OPEN_MINUTES || minutes >= CLOSE_MINUTES) return null
  const slot = Math.floor((minutes - OPEN_MINUTES) / INTRADAY_RVOL_CONFIG.slotMinutes)
  if (slot < 0 || slot >= INTRADAY_RVOL_CONFIG.fullSessionSlots) return null
  return slot
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function groupBarsIntoSessions(bars: readonly IntradayBar[]): SessionSlots[] {
  const byDate = new Map<string, SessionSlots>()
  for (const bar of bars) {
    if (!Number.isFinite(bar.t) || !Number.isFinite(bar.v) || bar.v < 0) continue
    const slot = slotIndexAt(bar.t)
    if (slot == null) continue
    const date = etParts(bar.t).date
    let session = byDate.get(date)
    if (!session) {
      session = { date, volumes: new Map(), barCount: 0 }
      byDate.set(date, session)
    }
    session.volumes.set(slot, (session.volumes.get(slot) ?? 0) + bar.v)
    session.barCount += 1
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** A full session has a bar in every regular slot (half-days are short of this). */
export function isFullSession(session: SessionSlots): boolean {
  if (session.barCount < INTRADAY_RVOL_CONFIG.fullSessionSlots) return false
  for (let slot = 0; slot < INTRADAY_RVOL_CONFIG.fullSessionSlots; slot++) {
    if (!session.volumes.has(slot)) return false
  }
  return true
}

/**
 * Mean cumulative volume at each slot over the most recent full prior sessions.
 * Half-days and other short sessions are skipped. Null below 5 full sessions.
 */
export function baselineCumulative(
  sessions: readonly SessionSlots[],
  todayDate: string,
): number[] | null {
  const full = sessions
    .filter((session) => session.date < todayDate && isFullSession(session))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, INTRADAY_RVOL_CONFIG.sessionsBack)
  if (full.length < MIN_FULL_BASELINE_SESSIONS) return null

  const slots = INTRADAY_RVOL_CONFIG.fullSessionSlots
  const sums = new Array<number>(slots).fill(0)
  for (const session of full) {
    let cum = 0
    for (let slot = 0; slot < slots; slot++) {
      cum += session.volumes.get(slot) ?? 0
      sums[slot] += cum
    }
  }
  return sums.map((sum) => sum / full.length)
}

function slotStartMinutes(slot: number): number {
  return OPEN_MINUTES + slot * INTRADAY_RVOL_CONFIG.slotMinutes
}

function hasBarAtOrAfter(session: SessionSlots, minuteOfDay: number): boolean {
  for (const slot of session.volumes.keys()) {
    if (slotStartMinutes(slot) >= minuteOfDay) return true
  }
  return false
}

/** A bar is complete only when now is at or past its slot start + slotMinutes. */
function lastCompletedSlot(session: SessionSlots, now: EtParts): number | null {
  let last: number | null = null
  for (const slot of session.volumes.keys()) {
    let complete = false
    if (now.date > session.date) complete = true
    else if (now.date === session.date) {
      complete = now.minutes >= slotStartMinutes(slot) + INTRADAY_RVOL_CONFIG.slotMinutes
    }
    if (!complete) continue
    if (last == null || slot > last) last = slot
  }
  return last
}

export function computeIntradayRvol(input: {
  today: SessionSlots | null
  baselineCum: readonly number[] | null
  nowMs: number
}): IntradayRvolValue {
  const now = etParts(input.nowMs)
  if (!isWeekdayEt(input.nowMs) || now.minutes < OPEN_MINUTES || now.minutes >= CLOSE_MINUTES) {
    return { rvolTod: null, slot: null, reason: 'outside_hours' }
  }

  const today = input.today
  if (!today || today.barCount === 0 || today.date !== now.date) {
    return { rvolTod: null, slot: null, reason: 'no_bars' }
  }

  // Once the 13:00 slot would already be complete and it never printed, the
  // session closed early. Treat that like the cash session being over.
  const earlyCloseConfirmed = EARLY_CLOSE_MINUTES + INTRADAY_RVOL_CONFIG.slotMinutes
  if (now.minutes >= earlyCloseConfirmed && !hasBarAtOrAfter(today, EARLY_CLOSE_MINUTES)) {
    return { rvolTod: null, slot: null, reason: 'half_day' }
  }

  const completed = lastCompletedSlot(today, now)
  if (completed == null || completed + 1 < INTRADAY_RVOL_CONFIG.minCompletedSlots) {
    return { rvolTod: null, slot: completed, reason: 'min_slots' }
  }

  const baseline = input.baselineCum
  if (!baseline || completed >= baseline.length) {
    return { rvolTod: null, slot: completed, reason: 'no_baseline' }
  }
  const base = baseline[completed] ?? 0
  if (!(base > 0)) {
    return { rvolTod: null, slot: completed, reason: 'zero_baseline' }
  }

  let sum = 0
  for (let slot = 0; slot <= completed; slot++) sum += today.volumes.get(slot) ?? 0
  return { rvolTod: round2(sum / base), slot: completed }
}

/** Yahoo v8 chart → intraday bars. Timestamps are unix seconds. */
export function parseYahooIntradayBars(raw: unknown): IntradayBar[] {
  if (!raw || typeof raw !== 'object') throw new Error('Yahoo chart: empty payload')
  const chart = (raw as { chart?: { result?: unknown; error?: { description?: string } | null } }).chart
  if (!chart) throw new Error('Yahoo chart: missing chart')
  if (chart.error) {
    throw new Error(`Yahoo chart: ${chart.error.description || 'error'}`)
  }
  const result = Array.isArray(chart.result) ? chart.result[0] : null
  if (!result || typeof result !== 'object') throw new Error('Yahoo chart: no result')
  const timestamps = (result as { timestamp?: unknown }).timestamp
  const quote = (result as { indicators?: { quote?: Array<{ volume?: unknown }> } }).indicators?.quote?.[0]
  if (!Array.isArray(timestamps) || !quote || !Array.isArray(quote.volume)) {
    throw new Error('Yahoo chart: missing bars')
  }
  const volumes = quote.volume
  const bars: IntradayBar[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i]
    const v = volumes[i]
    if (typeof t !== 'number' || !Number.isFinite(t)) continue
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const ms = t > 1e12 ? t : t * 1000
    bars.push({ t: ms, v })
  }
  return bars
}

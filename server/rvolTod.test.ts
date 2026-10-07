import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import {
  applyIntradayRvol,
  dailyRvolFromVolumes,
  kyleScoreHeuristic,
} from '../src/lib/metrics.ts'
import {
  INTRADAY_RVOL_CONFIG,
  baselineCumulative,
  computeIntradayRvol,
  etParts,
  groupBarsIntoSessions,
  slotIndexAt,
  type IntradayBar,
  type SessionSlots,
} from '../src/lib/rvolTod.ts'
import type { TradingIdea } from '../src/types/index.ts'
import { mergeCatalystIntoIdeas } from './catalystService.ts'
import { clearIntradayVolumeCache, enrichWithIntradayRvol } from './intradayVolume.ts'

/** UTC millis for an America/New_York wall clock. Market hours are not ambiguous. */
function etMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  const parts = etParts(guess)
  const asUtc = Date.UTC(
    Number(parts.date.slice(0, 4)),
    Number(parts.date.slice(5, 7)) - 1,
    Number(parts.date.slice(8, 10)),
    parts.hour,
    parts.minute,
  )
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0)
  return guess + (desired - asUtc)
}

function sessionBars(
  year: number,
  month: number,
  day: number,
  volume: number,
  slots: number = INTRADAY_RVOL_CONFIG.fullSessionSlots,
): IntradayBar[] {
  const bars: IntradayBar[] = []
  for (let slot = 0; slot < slots; slot++) {
    const minutes = 9 * 60 + 30 + slot * INTRADAY_RVOL_CONFIG.slotMinutes
    bars.push({
      t: etMs(year, month, day, Math.floor(minutes / 60), minutes % 60),
      v: volume,
    })
  }
  return bars
}

function yahooChart(bars: readonly IntradayBar[]) {
  return {
    chart: {
      result: [
        {
          timestamp: bars.map((bar) => Math.floor(bar.t / 1000)),
          indicators: { quote: [{ volume: bars.map((bar) => bar.v) }] },
        },
      ],
      error: null,
    },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  clearIntradayVolumeCache()
})

test('slot index is the same ET clock across EST and EDT', () => {
  // 2026-01-14 is EST (UTC-5). 2026-03-09 is the first session after the spring-forward.
  const estOpen = etMs(2026, 1, 14, 9, 30)
  const edtOpen = etMs(2026, 3, 9, 9, 30)
  const estLate = etMs(2026, 1, 14, 15, 55)
  const edtLate = etMs(2026, 7, 15, 15, 55)
  assert.equal(etParts(estOpen).date, '2026-01-14')
  assert.equal(etParts(edtOpen).date, '2026-03-09')
  assert.equal(slotIndexAt(estOpen), 0)
  assert.equal(slotIndexAt(edtOpen), 0)
  assert.equal(slotIndexAt(etMs(2026, 1, 14, 9, 35)), 1)
  assert.equal(slotIndexAt(etMs(2026, 7, 15, 9, 35)), 1)
  assert.equal(slotIndexAt(estLate), 77)
  assert.equal(slotIndexAt(edtLate), 77)
  assert.equal(slotIndexAt(etMs(2026, 1, 14, 9, 29)), null)
  assert.equal(slotIndexAt(etMs(2026, 7, 15, 16, 0)), null)
  assert.equal(slotIndexAt(etMs(2026, 11, 2, 9, 30)), 0)
  // 20:55 UTC on a January afternoon is still 15:55 ET, not the next date.
  assert.equal(etParts(Date.parse('2026-01-14T20:55:00Z')).date, '2026-01-14')
  assert.equal(slotIndexAt(Date.parse('2026-01-14T20:55:00Z')), 77)
  assert.equal(slotIndexAt(Date.parse('2026-07-15T19:55:00Z')), 77)
})

test('in-progress bar is excluded from the cumulative ratio', () => {
  const today = groupBarsIntoSessions([
    ...sessionBars(2026, 7, 14, 200, 3),
  ])[0]!
  today.volumes.set(2, 9000)
  const baseline = new Array<number>(78).fill(0).map((_, slot) => 100 * (slot + 1))
  // 09:42 ET: slot 2 (09:40) completes at 09:45. S = 1. sum = 400 / 200 = 2.
  const now = etMs(2026, 7, 14, 9, 42)
  const value = computeIntradayRvol({ today, baselineCum: baseline, nowMs: now })
  assert.equal(value.slot, 1)
  assert.equal(value.rvolTod, 2)
})

test('fewer than minCompletedSlots completed bars is null', () => {
  const today = groupBarsIntoSessions(sessionBars(2026, 7, 14, 500, 3))[0]!
  const baseline = new Array<number>(78).fill(1000)
  // 09:36 ET: only the 09:30 bar is complete. S+1 = 1 < 2.
  const value = computeIntradayRvol({
    today,
    baselineCum: baseline,
    nowMs: etMs(2026, 7, 14, 9, 36),
  })
  assert.equal(value.rvolTod, null)
  assert.equal(value.reason, 'min_slots')
  assert.equal(value.slot, 0)
})

test('half-days are skipped and five full sessions is the floor', () => {
  const fullDays: Array<[number, number, number]> = [
    [2026, 7, 6],
    [2026, 7, 7],
    [2026, 7, 8],
    [2026, 7, 9],
    [2026, 7, 10],
  ]
  const bars: IntradayBar[] = []
  for (const [year, month, day] of fullDays) bars.push(...sessionBars(year, month, day, 100))
  bars.push(...sessionBars(2026, 7, 13, 10_000, 42))
  const sessions = groupBarsIntoSessions(bars)
  const half = sessions.find((session) => session.date === '2026-07-13')
  assert.ok(half)
  assert.equal(half.barCount < INTRADAY_RVOL_CONFIG.fullSessionSlots, true)

  const baseline = baselineCumulative(sessions, '2026-07-14')
  assert.ok(baseline)
  assert.equal(baseline[0], 100)
  assert.equal(baseline[1], 200)

  const onlyFour = sessions.filter((session) => session.date !== '2026-07-10')
  assert.equal(baselineCumulative(onlyFour, '2026-07-14'), null)

  const today = groupBarsIntoSessions([
    { t: etMs(2026, 7, 14, 9, 30), v: 200 },
    { t: etMs(2026, 7, 14, 9, 35), v: 200 },
    { t: etMs(2026, 7, 14, 9, 40), v: 9000 },
  ])[0]!
  const ratio = computeIntradayRvol({
    today,
    baselineCum: baseline,
    nowMs: etMs(2026, 7, 14, 9, 42),
  })
  assert.equal(ratio.rvolTod, 2)
  assert.equal(ratio.slot, 1)
})

test('outside regular hours and a half-day afternoon are null', () => {
  const today = groupBarsIntoSessions(sessionBars(2026, 7, 14, 100, 42))[0]!
  const baseline = new Array<number>(78).fill(100)
  const closed = computeIntradayRvol({
    today,
    baselineCum: baseline,
    nowMs: etMs(2026, 7, 14, 16, 0),
  })
  assert.equal(closed.rvolTod, null)
  assert.equal(closed.reason, 'outside_hours')

  const early = computeIntradayRvol({
    today,
    baselineCum: baseline,
    nowMs: etMs(2026, 7, 14, 8, 0),
  })
  assert.equal(early.reason, 'outside_hours')

  const weekend = computeIntradayRvol({
    today,
    baselineCum: baseline,
    nowMs: etMs(2026, 7, 12, 11, 0),
  })
  assert.equal(weekend.reason, 'outside_hours')

  const halfDay = computeIntradayRvol({
    today,
    baselineCum: baseline,
    nowMs: etMs(2026, 7, 14, 14, 0),
  })
  assert.equal(halfDay.rvolTod, null)
  assert.equal(halfDay.reason, 'half_day')
})

test('daily fallback is last volume over the prior 10 sessions; rvol20 stays 20', () => {
  const volumes = [...Array(10).fill(50), ...Array(10).fill(100), 250]
  const ratios = dailyRvolFromVolumes(volumes)
  assert.equal(ratios.rvolDaily10, 2.5)
  assert.equal(ratios.rvol20, 3.33)
  assert.equal(dailyRvolFromVolumes([250]).rvolDaily10, 0)
})

function idea(partial: Partial<TradingIdea>): TradingIdea {
  return {
    ticker: 'AAA',
    name: 'Aaa',
    groupId: 'g',
    groupName: 'G',
    price: 20,
    dayPct: 4,
    rvol: 1,
    rvol20: 0.8,
    rvolDaily10: 1,
    rvolTod: null,
    rvolSource: 'daily',
    adrPct: 4,
    pctFrom52wHigh: -20,
    perf1M: 1,
    perf3M: 1,
    avgDollarVol: 1,
    sma200: 10,
    sma50: 12,
    aboveSma200: true,
    aboveSma50: true,
    pctAboveSma200: 10,
    pctAboveSma50: 8,
    extensionAdr50: 1,
    setupType: 'Range Breakout',
    catalyst: null,
    hasCatalyst: false,
    catalystStatus: 'unchecked',
    isA: false,
    isAPlus: false,
    isAPlusPlus: false,
    notes: '',
    whyQualifies: '',
    suggestedEntry: null,
    suggestedStop: null,
    sparkline: [],
    sma10: 18,
    sma20: 17,
    aboveSma10: false,
    aboveSma20: false,
    priorRunPct: 40,
    tightDays: 8,
    baseLengthDays: 10,
    dollarVolume: 1,
    kyleScore: 3,
    characteristics: [],
    setupStage: 'coiled',
    perf6M: 1,
    earningsDate: null,
    daysToEarnings: null,
    earningsStatus: 'clear',
    surfer10: false,
    surfer20: false,
    surfer50: false,
    tightConsolidation: true,
    rangeBaseDetail: {
      ok: true,
      score: 0.9,
      compression: 2,
      containment: 0.9,
      lengthSessions: 63,
      lengthScore: 0.8,
      above50Frac: 0.9,
      higherLows: true,
      failedReasons: [],
    },
    rangeBaseScore: 0.9,
    rangeBreakoutDetail: {
      adrPct: 4,
      aboveSma50: true,
      priorRunPct: 40,
      recentRangePct: 8,
      rangeOverAdr: 2,
      hasHigherLows: true,
      higherLowsRule: 'half',
      passed: true,
    },
    ...partial,
  }
}

test('applyIntradayRvol switches source and re-derives Episodic Pivot and kyleScore', () => {
  const seed = idea({})
  const daily = applyIntradayRvol(seed, null)
  assert.equal(daily.rvolSource, 'daily')
  assert.equal(daily.rvol, 1)
  assert.equal(daily.rvolTod, null)
  assert.equal(daily.rvol20, 0.8)
  assert.equal(daily.rvolDaily10, 1)
  assert.equal(daily.setupType, 'Range Breakout')
  assert.equal(daily.isA, true)

  const tod = applyIntradayRvol(seed, 3)
  assert.equal(tod.rvolSource, 'tod')
  assert.equal(tod.rvol, 3)
  assert.equal(tod.rvolTod, 3)
  assert.equal(tod.rvolDaily10, 1)
  assert.equal(tod.rvol20, 0.8)
  assert.equal(tod.setupType, 'Episodic Pivot')
  assert.equal(tod.isA, false)
  assert.equal(tod.isAPlus, false)
  assert.notEqual(tod.kyleScore, daily.kyleScore)
  assert.notEqual(tod.whyQualifies, daily.whyQualifies)

  const quiet = idea({
    dayPct: 1,
    aboveSma50: false,
    aboveSma10: false,
    aboveSma20: false,
    adrPct: 1,
    priorRunPct: 0,
    pctFrom52wHigh: -30,
    tightConsolidation: false,
    setupType: 'Continuation',
    rvol: 1,
    rvolDaily10: 1,
  })
  const before = applyIntradayRvol(quiet, null)
  const after = applyIntradayRvol(quiet, 1.6)
  assert.equal(before.setupType, 'Continuation')
  assert.equal(after.setupType, 'Continuation')
  assert.equal(after.rvolSource, 'tod')
  const expected = kyleScoreHeuristic({
    aboveSma200: true,
    aboveSma50: false,
    aboveSma10: false,
    aboveSma20: false,
    pctFrom52wHigh: -30,
    rvol: 1.6,
    adrPct: 1,
    priorRunPct: 0,
    isA: false,
    isAPlus: false,
  })
  assert.equal(after.kyleScore, expected)
  assert.equal(Math.round((after.kyleScore - before.kyleScore) * 100) / 100, 0.3)

  const merged = mergeCatalystIntoIdeas([tod], Date.now())
  const kept = merged.ideas[0]!
  assert.equal(kept.rvolSource, 'tod')
  assert.equal(kept.rvolTod, 3)
  assert.equal(kept.rvol, 3)
  assert.equal(kept.rvolDaily10, 1)
  assert.equal(kept.rvol20, 0.8)
  assert.equal(kept.setupType, 'Episodic Pivot')
})

function historyPayload(todayVolume = 200): IntradayBar[] {
  const bars: IntradayBar[] = []
  for (const day of [6, 7, 8, 9, 10]) bars.push(...sessionBars(2026, 7, day, 100))
  bars.push(...sessionBars(2026, 7, 13, 10_000, 42))
  bars.push(
    { t: etMs(2026, 7, 14, 9, 30), v: todayVolume },
    { t: etMs(2026, 7, 14, 9, 35), v: todayVolume },
    { t: etMs(2026, 7, 14, 9, 40), v: 9000 },
  )
  return bars
}

test('Yahoo fetch is mocked: hosts, retries, cache, and the ratio', async () => {
  const calls: string[] = []
  const sleeps: number[] = []
  const logs: string[] = []
  let hit429 = false
  const body = yahooChart(historyPayload())
  const now = new Date(etMs(2026, 7, 14, 9, 42))

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)
    const headers = new Headers(init?.headers)
    assert.match(headers.get('user-agent') ?? '', /Chrome/)
    assert.equal(headers.get('referer'), 'https://finance.yahoo.com/')
    if (!hit429) {
      hit429 = true
      return jsonResponse({ error: 'slow' }, 429)
    }
    return jsonResponse(body)
  }

  const first = await enrichWithIntradayRvol(['aapl'], now, {
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    log: (line) => logs.push(line),
  })
  assert.deepEqual(sleeps, [500])
  assert.equal(calls.length, 2)
  assert.match(calls[0]!, /query1\.finance\.yahoo\.com\/v8\/finance\/chart\/AAPL\?/)
  assert.match(calls[0]!, /interval=5m/)
  assert.match(calls[0]!, /range=15d/)
  assert.match(calls[0]!, /includePrePost=false/)
  assert.match(calls[1]!, /query1\.finance\.yahoo\.com/)
  const row = first.get('AAPL')
  assert.equal(row?.rvolTod, 2)
  assert.equal(row?.slot, 1)
  const summary = JSON.parse(logs[0]!) as {
    intradayRvol: string
    requested: number
    tod: number
    nulls: number
    errors: number
    http429: number
  }
  assert.equal(summary.intradayRvol, 'done')
  assert.equal(summary.requested, 1)
  assert.equal(summary.tod, 1)
  assert.equal(summary.nulls, 0)
  assert.equal(summary.errors, 0)
  assert.equal(summary.http429, 1)

  calls.length = 0
  await enrichWithIntradayRvol(['AAPL'], new Date(now.getTime() + 60_000), {
    fetchImpl,
    sleep: async () => {},
    log: () => {},
  })
  assert.equal(calls.length, 0)

  calls.length = 0
  const later = new Date(now.getTime() + INTRADAY_RVOL_CONFIG.todayTtlMs + 1)
  await enrichWithIntradayRvol(['AAPL'], later, {
    fetchImpl,
    sleep: async () => {},
    log: () => {},
  })
  assert.equal(calls.length, 1)
  assert.match(calls[0]!, /range=1d/)
  assert.doesNotMatch(calls[0]!, /range=15d/)
})

test('query1 network failures fall through to query2; a thrown fetch does not escape', async () => {
  const hosts: string[] = []
  let attempts = 0
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    hosts.push(new URL(url).host)
    attempts += 1
    if (url.includes('query1')) throw new TypeError('network down')
    return jsonResponse(yahooChart(historyPayload()))
  }
  const map = await enrichWithIntradayRvol(['MSFT'], new Date(etMs(2026, 7, 14, 9, 42)), {
    fetchImpl,
    sleep: async () => {},
    log: () => {},
  })
  assert.equal(attempts, INTRADAY_RVOL_CONFIG.retries + 2)
  assert.ok(hosts.every((host, index) => (index < 3 ? host.startsWith('query1') : host.startsWith('query2'))))
  assert.equal(map.get('MSFT')?.rvolTod, 2)

  const failed = await enrichWithIntradayRvol(['ZZZ'], new Date(etMs(2026, 7, 14, 10, 0)), {
    fetchImpl: async () => {
      throw new TypeError('network down')
    },
    sleep: async () => {},
    log: () => {},
  })
  assert.equal(failed.get('ZZZ')?.rvolTod, null)
  assert.equal(failed.get('ZZZ')?.reason, 'error')
})

test('outside hours does not call Yahoo', async () => {
  let fetches = 0
  const map = await enrichWithIntradayRvol(['AAPL'], new Date(etMs(2026, 7, 12, 11, 0)), {
    fetchImpl: async () => {
      fetches += 1
      throw new Error('should not fetch')
    },
    log: () => {},
  })
  assert.equal(fetches, 0)
  assert.equal(map.get('AAPL')?.reason, 'outside_hours')
  assert.equal(map.get('AAPL')?.rvolTod, null)
})

test('phase timeout returns null and does not throw', async () => {
  const map = await enrichWithIntradayRvol(['AAPL'], new Date(etMs(2026, 7, 14, 10, 0)), {
    phaseTimeoutMs: 30,
    sleep: async () => {},
    log: () => {},
    fetchImpl: (_input, init) =>
      new Promise((_resolve, reject) => {
        const onAbort = () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        }
        if (init?.signal?.aborted) onAbort()
        else init?.signal?.addEventListener('abort', onAbort, { once: true })
      }),
  })
  assert.equal(map.get('AAPL')?.rvolTod, null)
  assert.equal(map.get('AAPL')?.reason, 'timeout')
})

test('concurrency stays at the configured cap', async () => {
  let active = 0
  let maxActive = 0
  const empty = yahooChart([])
  const symbols = ['A', 'B', 'C', 'D', 'E', 'F']
  await enrichWithIntradayRvol(symbols, new Date(etMs(2026, 7, 14, 10, 30)), {
    sleep: async () => {},
    log: () => {},
    fetchImpl: async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 40))
      active -= 1
      return jsonResponse(empty)
    },
  })
  assert.equal(maxActive, INTRADAY_RVOL_CONFIG.concurrency)
})

test('baseline helper ignores sessions that are not prior to today', () => {
  const sessions: SessionSlots[] = groupBarsIntoSessions([
    ...sessionBars(2026, 7, 6, 100),
    ...sessionBars(2026, 7, 7, 100),
    ...sessionBars(2026, 7, 8, 100),
    ...sessionBars(2026, 7, 9, 100),
    ...sessionBars(2026, 7, 10, 100),
    ...sessionBars(2026, 7, 14, 999),
  ])
  const baseline = baselineCumulative(sessions, '2026-07-14')
  assert.ok(baseline)
  assert.equal(baseline[0], 100)
})

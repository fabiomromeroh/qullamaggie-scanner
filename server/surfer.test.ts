import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { computeIdeaMetrics, type DailyBar } from '../src/lib/metrics.ts'
import {
  SURFER_CONFIG,
  compactSurferDetail,
  evaluateMaSurfer,
  evaluateSurfer,
  isTouchBar,
  smaAt,
  surferBadgeTitle,
  type SurferConfig,
} from '../src/lib/surfer.ts'

function uptrendCloses(n: number, start = 50, ret = 0.012): number[] {
  const closes: number[] = []
  let p = start
  for (let i = 0; i < n; i += 1) {
    p *= 1 + ret
    closes.push(p)
  }
  return closes
}

function barsFromCloses(
  closes: number[],
  opts: { touchAt?: number[]; period?: number } = {},
): DailyBar[] {
  const touchAt = new Set(opts.touchAt ?? [])
  const period = opts.period ?? 10
  return closes.map((c, i) => {
    const sma = smaAt(closes, i, period)
    const isTouch = touchAt.has(i)
    let o = c
    let h = c * 1.006
    let l = c * 0.996
    if (isTouch && sma != null) {
      l = sma * 0.997
      h = Math.max(c, sma) * 1.012
      o = (c + Math.max(sma, c)) / 2
    }
    l = Math.min(l, o, c)
    h = Math.max(h, o, c)
    return {
      t: 1_700_000_000 + i * 86_400,
      o,
      h,
      l,
      c,
      v: 1_000_000,
    }
  })
}

function ride10(n = 80): { bars: DailyBar[]; touchAt: number[] } {
  const closes = uptrendCloses(n)
  const last = n - 1
  const touchAt = [last - 13, last - 8, last - 4]
  return { bars: barsFromCloses(closes, { touchAt, period: 10 }), touchAt }
}

function withCfg(patch: Partial<SurferConfig> & {
  windowSessions?: Partial<SurferConfig['windowSessions']>
  minTouches?: Partial<SurferConfig['minTouches']>
  slopeLookback?: Partial<SurferConfig['slopeLookback']>
}): SurferConfig {
  return {
    ...SURFER_CONFIG,
    ...patch,
    windowSessions: { ...SURFER_CONFIG.windowSessions, ...patch.windowSessions },
    minTouches: { ...SURFER_CONFIG.minTouches, ...patch.minTouches },
    slopeLookback: { ...SURFER_CONFIG.slopeLookback, ...patch.slopeLookback },
  }
}

/** Independent episode count: consecutive touch bars collapse to one. */
function bruteTouchEpisodes(
  bars: DailyBar[],
  period: number,
  windowSessions: number,
  proximityPct: number,
): number {
  const closes = bars.map((b) => b.c)
  const start = bars.length - windowSessions
  let episodes = 0
  let inEp = false
  for (let i = start; i < bars.length; i += 1) {
    const sma = smaAt(closes, i, period)
    const touch = sma != null && isTouchBar(bars[i]!, sma, proximityPct)
    if (touch && !inEp) {
      episodes += 1
      inEp = true
    } else if (!touch) {
      inEp = false
    }
  }
  return episodes
}

test('SURFER_CONFIG documents the tunable constants', () => {
  assert.equal(SURFER_CONFIG.windowSessions.sma10, 15)
  assert.equal(SURFER_CONFIG.windowSessions.sma20, 15)
  assert.equal(SURFER_CONFIG.windowSessions.sma50, 25)
  assert.equal(SURFER_CONFIG.closeBreakTolerancePct, 0.75)
  assert.equal(SURFER_CONFIG.touchProximityPct, 1.5)
  assert.equal(SURFER_CONFIG.minTouches.sma10, 3)
  assert.equal(SURFER_CONFIG.minTouches.sma20, 3)
  assert.equal(SURFER_CONFIG.minTouches.sma50, 2)
  assert.equal(SURFER_CONFIG.bounceSessions, 3)
  assert.equal(SURFER_CONFIG.slopeLookback.sma10, 5)
  assert.equal(SURFER_CONFIG.slopeLookback.sma20, 5)
  assert.equal(SURFER_CONFIG.slopeLookback.sma50, 10)
})

test('10MA ride with 3+ bounced wick touches is ok', () => {
  const { bars, touchAt } = ride10()
  const result = evaluateMaSurfer(bars, 'sma10')
  assert.equal(result.ok, true, result.reason)
  assert.ok(result.touches >= 3, `touches ${result.touches}`)
  assert.ok(result.bounces >= 2, `bounces ${result.bounces}`)
  assert.ok(result.slopePct > 0, `slope ${result.slopePct}`)
  assert.ok(result.maxCloseBelowPct <= SURFER_CONFIG.closeBreakTolerancePct)
  const brute = bruteTouchEpisodes(
    bars,
    10,
    SURFER_CONFIG.windowSessions.sma10,
    SURFER_CONFIG.touchProximityPct,
  )
  assert.equal(result.touches, brute)
  assert.equal(touchAt.length, 3)
})

test('close below SMA beyond tolerance is not ok', () => {
  const { bars } = ride10()
  const i = bars.length - 10
  const closes = bars.map((b) => b.c)
  const sma = smaAt(closes, i, 10)!
  bars[i] = {
    ...bars[i]!,
    c: sma * 0.98,
    o: sma * 0.985,
    h: sma * 0.99,
    l: sma * 0.97,
  }
  const result = evaluateMaSurfer(bars, 'sma10')
  assert.equal(result.ok, false)
  assert.match(result.reason ?? '', /close-break/)
  assert.ok(result.maxCloseBelowPct > SURFER_CONFIG.closeBreakTolerancePct)
})

test('too few touches is not ok', () => {
  const closes = uptrendCloses(80)
  const last = closes.length - 1
  const bars = barsFromCloses(closes, { touchAt: [last - 6], period: 10 })
  const result = evaluateMaSurfer(bars, 'sma10')
  assert.equal(result.ok, false)
  assert.match(result.reason ?? '', /too-few-touches/)
  assert.ok(result.touches < SURFER_CONFIG.minTouches.sma10)
})

test('touch without a bounce is not ok', () => {
  const n = 80
  const closes = uptrendCloses(n)
  const last = n - 1
  const t0 = last - 13
  const t1 = last - 8
  const t2 = last - 4
  const touchClose = closes[t0]!
  for (let j = 1; j <= 3; j += 1) {
    closes[t0 + j] = touchClose * (1 - 0.004 * j)
  }
  const bars = barsFromCloses(closes, { touchAt: [t0, t1, t2], period: 10 })
  const result = evaluateMaSurfer(bars, 'sma10')
  assert.equal(result.ok, false)
  assert.match(result.reason ?? '', /no-bounce/)
})

test('falling SMA is not ok', () => {
  const n = 80
  const closes = uptrendCloses(n)
  const base = closes[64]!
  const shape = [
    1.0, 1.005, 1.01, 1.015, 1.02, 1.012, 1.01, 1.008, 1.006, 1.004, 1.005, 1.007, 1.009, 1.011,
    1.014,
  ]
  for (let k = 0; k < 15; k += 1) closes[65 + k] = base * shape[k]!
  const bars = barsFromCloses(closes, { touchAt: [66, 68, 70], period: 10 })
  const result = evaluateMaSurfer(bars, 'sma10')
  assert.equal(result.ok, false)
  assert.ok(result.slopePct <= 0, `expected non-positive slope, got ${result.slopePct}`)
})

test('insufficient bars is not ok and does not throw', () => {
  const bars = barsFromCloses([10, 11, 12, 13, 14])
  const result = evaluateMaSurfer(bars, 'sma10')
  assert.equal(result.ok, false)
  assert.match(result.reason ?? '', /insufficient-bars/)
  assert.equal(evaluateMaSurfer([], 'sma50').ok, false)
  assert.doesNotThrow(() => evaluateSurfer([]))
})

test('each SURFER_CONFIG constant is exercised', () => {
  const { bars } = ride10()
  assert.equal(evaluateMaSurfer(bars, 'sma10').ok, true)

  const few = evaluateMaSurfer(
    bars,
    'sma10',
    withCfg({ minTouches: { sma10: 10, sma20: 10, sma50: 10 } }),
  )
  assert.equal(few.ok, false)
  assert.match(few.reason ?? '', /too-few-touches/)

  const looseMin = evaluateMaSurfer(
    barsFromCloses(uptrendCloses(80), { touchAt: [70], period: 10 }),
    'sma10',
    withCfg({ minTouches: { sma10: 1, sma20: 1, sma50: 1 } }),
  )
  assert.equal(looseMin.ok, true, looseMin.reason)

  const tightBreak = evaluateMaSurfer(
    bars,
    'sma10',
    withCfg({ closeBreakTolerancePct: -0.01 }),
  )
  assert.equal(tightBreak.ok, false)
  assert.match(tightBreak.reason ?? '', /close-break/)

  const defaultTouches = evaluateMaSurfer(bars, 'sma10').touches
  const tinyProximity = evaluateMaSurfer(
    bars,
    'sma10',
    withCfg({ touchProximityPct: -0.5 }),
  )
  assert.ok(
    tinyProximity.touches < defaultTouches,
    `proximity -0.5 should drop wick-above-SMA touches (${tinyProximity.touches} vs ${defaultTouches})`,
  )

  const shortWindow = evaluateMaSurfer(
    bars,
    'sma10',
    withCfg({ windowSessions: { sma10: 6, sma20: 6, sma50: 6 } }),
  )
  assert.ok(shortWindow.touches <= 2)

  const noTimeToBounce = evaluateMaSurfer(bars, 'sma10', withCfg({ bounceSessions: 1 }))
  assert.equal(typeof noTimeToBounce.ok, 'boolean')

  const longSlope = evaluateMaSurfer(
    bars,
    'sma10',
    withCfg({ slopeLookback: { sma10: 40, sma20: 40, sma50: 40 } }),
  )
  assert.ok(longSlope.slopePct > 0)
})

test('50MA ride with 2 bounced touches can pass minTouches=2', () => {
  const n = 120
  const closes = uptrendCloses(n, 40, 0.008)
  const last = n - 1
  const touchAt = [last - 18, last - 8]
  const bars = barsFromCloses(closes, { touchAt, period: 50 })
  const result = evaluateMaSurfer(bars, 'sma50')
  assert.equal(result.ok, true, result.reason)
  assert.ok(result.touches >= 2)
  const brute = bruteTouchEpisodes(
    bars,
    50,
    SURFER_CONFIG.windowSessions.sma50,
    SURFER_CONFIG.touchProximityPct,
  )
  assert.equal(result.touches, brute)
})

test('evaluateSurfer + compact detail + badge title', () => {
  const { bars } = ride10()
  const all = evaluateSurfer(bars)
  const detail = compactSurferDetail(all)
  assert.equal(detail.sma10.touches, all.sma10.touches)
  assert.equal(detail.sma10.bounces, all.sma10.bounces)
  assert.equal(detail.sma10.slopePct, all.sma10.slopePct)
  const title = surferBadgeTitle('10MA Surfer', detail)
  assert.match(title, /touches/)
  assert.match(title, /bounces/)
  assert.match(title, /slope/)
  assert.equal(surferBadgeTitle('20MA Surfer', undefined), '20MA Surfer (strict ride)')
})

test('real Yahoo daily bars run without crash and match brute-force touches', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(process.cwd(), 'server/fixtures/yahoo-daily-nvda-amd-aapl-smci.json'), 'utf8'),
  ) as {
    label: string
    fetchedAt: string
    symbols: Record<string, { barCount: number; bars: DailyBar[] }>
  }
  assert.match(fixture.label, /real-data sample/)
  assert.equal(fixture.fetchedAt, '2026-10-02')
  for (const sym of ['NVDA', 'AMD', 'AAPL', 'SMCI'] as const) {
    const bars = fixture.symbols[sym]!.bars
    assert.ok(bars.length >= 260, `${sym} barCount`)
    const result = evaluateSurfer(bars)
    for (const key of ['sma10', 'sma20', 'sma50'] as const) {
      const period = key === 'sma10' ? 10 : key === 'sma20' ? 20 : 50
      const brute = bruteTouchEpisodes(
        bars,
        period,
        SURFER_CONFIG.windowSessions[key],
        SURFER_CONFIG.touchProximityPct,
      )
      assert.equal(result[key].touches, brute, `${sym} ${key} touches vs brute`)
      assert.equal(typeof result[key].ok, 'boolean')
      assert.equal(Number.isFinite(result[key].slopePct), true)
      assert.equal(Number.isFinite(result[key].maxCloseBelowPct), true)
      if (result[key].ok) {
        assert.ok(result[key].touches >= SURFER_CONFIG.minTouches[key])
        assert.ok(result[key].slopePct > 0)
      }
    }
    const idea = computeIdeaMetrics(
      { ticker: sym, name: sym, groupId: 'test', groupName: 'Test' },
      { symbol: sym, bars, provider: 'yahoo-fixture' },
    )
    assert.ok(idea)
    assert.equal(idea!.surfer10, result.sma10.ok)
    assert.equal(idea!.surfer20, result.sma20.ok)
    assert.equal(idea!.surfer50, result.sma50.ok)
    assert.equal(idea!.surferDetail?.sma10.touches, result.sma10.touches)
    const tags = idea!.characteristics
    assert.equal(tags.includes('10MA Surfer'), idea!.surfer10)
    assert.equal(tags.includes('20MA Surfer'), idea!.surfer20)
    assert.equal(tags.includes('50MA Surfer'), idea!.surfer50)
    assert.equal(tags.includes('10MA Surfer') && !idea!.surfer10, false)
  }
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { computeIdeaMetrics, type DailyBar } from '../src/lib/metrics.ts'
import {
  TIGHT_CONFIG,
  compactTightDetail,
  evaluateTightConsolidation,
  type TightConfig,
} from '../src/lib/tightConsolidation.ts'

function withCfg(patch: Partial<TightConfig>): TightConfig {
  return { ...TIGHT_CONFIG, ...patch }
}

function makeBars(opts: {
  n?: number
  contracting?: boolean
  volumeContract?: boolean
  nearHigh?: boolean
  /** up: above 50 and 200. dip-short: under the short averages, still above 50 and 200. */
  trend?: 'up' | 'dip-short' | 'below-50' | 'below-200'
}): DailyBar[] {
  const n = opts.n ?? 260
  const contracting = opts.contracting ?? true
  const volumeContract = opts.volumeContract ?? true
  const nearHigh = opts.nearHigh ?? true
  const trend = opts.trend ?? 'up'
  const bars: DailyBar[] = []
  let c = 100
  for (let i = 0; i < n; i += 1) {
    const inRecent = i >= n - TIGHT_CONFIG.recentWindow
    let ret = 0.003
    if (trend === 'dip-short' && i >= n - 8) ret = -0.004
    if (trend === 'below-50') ret = i < n - 30 ? 0.004 : -0.012
    if (trend === 'below-200') ret = i < 30 ? 0.01 : -0.004
    c *= 1 + ret
    const range = contracting ? (inRecent ? 0.004 : 0.022) : inRecent ? 0.035 : 0.01
    const vol = volumeContract ? (inRecent ? 500_000 : 1_200_000) : inRecent ? 1_600_000 : 900_000
    const h = c * (1 + range / 2)
    const l = c * (1 - range / 2)
    bars.push({
      t: 1_700_000_000 + i * 86_400,
      o: c,
      h,
      l,
      c,
      v: vol,
    })
  }
  if (!nearHigh) {
    const i = n - 40
    bars[i] = { ...bars[i]!, h: bars[n - 1]!.c * 1.25 }
  }
  return bars
}

test('TIGHT_CONFIG documents the tunable constants', () => {
  assert.equal(TIGHT_CONFIG.recentWindow, 7)
  assert.equal(TIGHT_CONFIG.baselineSessions, 30)
  assert.equal(TIGHT_CONFIG.rangeRatioMax, 0.85)
  assert.equal(TIGHT_CONFIG.closeSpreadMaxMultipleOfAdr, 1.5)
  assert.equal(TIGHT_CONFIG.closeSpreadAbsMaxPct, 6)
  assert.equal(TIGHT_CONFIG.volumeRatioMax, 0.9)
  assert.equal(TIGHT_CONFIG.volumeAvgSessions, 50)
  assert.equal(TIGHT_CONFIG.nearHighMaxPct, 10)
  assert.equal(TIGHT_CONFIG.highLookback, 252)
  assert.equal(TIGHT_CONFIG.sma50Period, 50)
  assert.equal(TIGHT_CONFIG.sma200Period, 200)
  assert.equal(TIGHT_CONFIG.useInCoiled, true)
  assert.equal('smaFast' in TIGHT_CONFIG, false)
  assert.equal('smaSlow' in TIGHT_CONFIG, false)
})

test('contracting range and volume near highs above MAs is ok', () => {
  const bars = makeBars({})
  const result = evaluateTightConsolidation(bars)
  assert.equal(result.ok, true, result.failedReasons.join('; '))
  assert.ok(result.rangeRatio <= TIGHT_CONFIG.rangeRatioMax)
  assert.ok(result.volumeRatio <= TIGHT_CONFIG.volumeRatioMax)
  assert.ok(result.closeSpreadPct > 0)
  assert.equal(result.days, 7)
  assert.equal(result.nearHigh, true)
  assert.equal(result.aboveSma50, true)
  assert.equal(result.aboveSma200, true)
  const detail = compactTightDetail(result)
  assert.equal(detail.rangeRatio, result.rangeRatio)
  assert.equal(detail.days, 7)
})

test('expanding range is not ok', () => {
  const result = evaluateTightConsolidation(makeBars({ contracting: false }))
  assert.equal(result.ok, false)
  assert.ok(result.failedReasons.some((r) => r.startsWith('range-ratio')))
  assert.ok(result.rangeRatio > TIGHT_CONFIG.rangeRatioMax)
})

test('volume not contracting is not ok', () => {
  const result = evaluateTightConsolidation(makeBars({ volumeContract: false }))
  assert.equal(result.ok, false)
  assert.ok(result.failedReasons.some((r) => r.startsWith('volume-ratio')))
  assert.ok(result.volumeRatio > TIGHT_CONFIG.volumeRatioMax)
})

test('far from 52-week high is not ok', () => {
  const result = evaluateTightConsolidation(makeBars({ nearHigh: false }))
  assert.equal(result.ok, false)
  assert.ok(result.failedReasons.some((r) => r.startsWith('far-from-high')))
  assert.equal(result.nearHigh, false)
})

test('price under the 10 and 20 SMA is ok when it is still above the 50 and 200', () => {
  const bars = makeBars({ trend: 'dip-short' })
  const result = evaluateTightConsolidation(bars)
  assert.equal(result.aboveSma50, true, result.failedReasons.join('; '))
  assert.equal(result.aboveSma200, true)
  assert.equal(result.failedReasons.some((r) => r === 'below-sma50' || r === 'below-sma200'), false)
  const closes = bars.map((b) => b.c)
  const price = closes[closes.length - 1]!
  const sma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20
  assert.ok(price < sma10, 'fixture should sit under SMA10')
  assert.ok(price < sma20, 'fixture should sit under SMA20')
})

test('below the 50 SMA fails', () => {
  const result = evaluateTightConsolidation(makeBars({ trend: 'below-50' }))
  assert.equal(result.ok, false)
  assert.ok(result.failedReasons.includes('below-sma50'))
  assert.equal(result.aboveSma50, false)
})

test('below the 200 SMA fails', () => {
  const result = evaluateTightConsolidation(makeBars({ trend: 'below-200' }))
  assert.equal(result.ok, false)
  assert.ok(result.failedReasons.includes('below-sma200'))
  assert.equal(result.aboveSma200, false)
})

test('insufficient bars is not ok and does not throw', () => {
  const result = evaluateTightConsolidation([])
  assert.equal(result.ok, false)
  assert.deepEqual(result.failedReasons, ['insufficient-bars'])
  assert.doesNotThrow(() => evaluateTightConsolidation([{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }]))
})

test('each TIGHT_CONFIG constant is exercised', () => {
  const bars = makeBars({})
  assert.equal(evaluateTightConsolidation(bars).ok, true)

  const tightRange = evaluateTightConsolidation(bars, undefined, withCfg({ rangeRatioMax: 0.05 }))
  assert.equal(tightRange.ok, false)
  assert.ok(tightRange.failedReasons.some((r) => r.startsWith('range-ratio')))

  const tightVol = evaluateTightConsolidation(bars, undefined, withCfg({ volumeRatioMax: 0.01 }))
  assert.equal(tightVol.ok, false)
  assert.ok(tightVol.failedReasons.some((r) => r.startsWith('volume-ratio')))

  const tinySpreadCap = evaluateTightConsolidation(
    bars,
    undefined,
    withCfg({ closeSpreadAbsMaxPct: 0.01, closeSpreadMaxMultipleOfAdr: 0.01 }),
  )
  assert.equal(tinySpreadCap.ok, false)
  assert.ok(tinySpreadCap.failedReasons.some((r) => r.startsWith('close-spread')))

  const nearHighZero = evaluateTightConsolidation(bars, undefined, withCfg({ nearHighMaxPct: 0.01 }))
  assert.equal(typeof nearHighZero.ok, 'boolean')

  const shortWindow = evaluateTightConsolidation(bars, undefined, withCfg({ recentWindow: 5 }))
  assert.equal(shortWindow.days, 5)

  const longBaseline = evaluateTightConsolidation(bars, undefined, withCfg({ baselineSessions: 40 }))
  assert.equal(typeof longBaseline.rangeRatio, 'number')

  const volSessions = evaluateTightConsolidation(bars, undefined, withCfg({ volumeAvgSessions: 60 }))
  assert.equal(typeof volSessions.volumeRatio, 'number')

  const lookback = evaluateTightConsolidation(bars, undefined, withCfg({ highLookback: 50 }))
  assert.equal(typeof lookback.nearHigh, 'boolean')

  assert.equal(TIGHT_CONFIG.useInCoiled, true)
})

test('real Yahoo daily bars produce internally consistent tight results', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(process.cwd(), 'server/fixtures/yahoo-daily-nvda-amd-aapl-smci.json'), 'utf8'),
  ) as {
    label: string
    symbols: Record<string, { bars: DailyBar[] }>
  }
  assert.match(fixture.label, /real-data sample/)
  for (const sym of ['NVDA', 'AMD', 'AAPL', 'SMCI'] as const) {
    const bars = fixture.symbols[sym]!.bars
    const result = evaluateTightConsolidation(bars)
    assert.equal(typeof result.ok, 'boolean')
    assert.equal(result.days, TIGHT_CONFIG.recentWindow)
    if (result.ok) {
      assert.equal(result.failedReasons.length, 0)
      assert.ok(result.rangeRatio <= TIGHT_CONFIG.rangeRatioMax)
      assert.ok(result.volumeRatio <= TIGHT_CONFIG.volumeRatioMax)
      assert.equal(result.nearHigh, true)
      assert.equal(result.aboveSma50, true)
      assert.equal(result.aboveSma200, true)
    } else {
      assert.ok(result.failedReasons.length >= 1)
    }
    const idea = computeIdeaMetrics(
      { ticker: sym, name: sym, groupId: 'test', groupName: 'Test' },
      { symbol: sym, bars, provider: 'yahoo-fixture' },
    )
    assert.ok(idea)
    assert.equal(idea!.tightConsolidation, result.ok)
    assert.equal(idea!.tightDetail?.days, result.days)
    assert.equal(idea!.tightDetail?.rangeRatio, result.rangeRatio)
  }
})

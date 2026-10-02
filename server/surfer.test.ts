import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { computeIdeaMetrics, type DailyBar } from '../src/lib/metrics.ts'
import {
  SURFER_CONFIG,
  adrPctFromBars,
  compactSurferDetail,
  evaluateMaSurfer,
  evaluateSurfer,
  smaAt,
  surferBadgeTitle,
  type MaKey,
  type SurferConfig,
} from '../src/lib/surfer.ts'

function barsFromCloses(closes: number[], rangeFrac = 0.004): DailyBar[] {
  return closes.map((c, i) => ({
    t: 1_700_000_000 + i * 86_400,
    o: c,
    h: c * (1 + rangeFrac / 2),
    l: c * (1 - rangeFrac / 2),
    c,
    v: 1_000_000,
  }))
}

/** Lows sit on the SMA so the near test does not depend on ADR. */
function barsPinnedToSma(closes: number[], period: number): DailyBar[] {
  return closes.map((c, i) => {
    const sma = smaAt(closes, i, period)
    const low = sma != null ? Math.min(c, sma) : c * 0.99
    const high = Math.max(c * 1.002, low)
    return { t: 1_700_000_000 + i * 86_400, o: c, h: high, l: low, c, v: 1_000_000 }
  })
}

function rising(n: number, start = 100, daily = 0.002): number[] {
  const closes: number[] = []
  let p = start
  for (let i = 0; i < n; i += 1) {
    p *= 1 + daily
    closes.push(p)
  }
  return closes
}

test('SURFER_CONFIG is ADR-relative and has no touch-count fields', () => {
  assert.equal(SURFER_CONFIG.windowSessions.sma10, 15)
  assert.equal(SURFER_CONFIG.windowSessions.sma20, 15)
  assert.equal(SURFER_CONFIG.windowSessions.sma50, 25)
  assert.equal(SURFER_CONFIG.slopeLookback.sma10, 5)
  assert.equal(SURFER_CONFIG.slopeLookback.sma50, 10)
  assert.equal(SURFER_CONFIG.kProximity.sma10, 0.35)
  assert.equal(SURFER_CONFIG.kProximity.sma20, 0.5)
  assert.equal(SURFER_CONFIG.kProximity.sma50, 0.75)
  assert.equal(SURFER_CONFIG.kBreak.sma10, 0.5)
  assert.equal(SURFER_CONFIG.kBreak.sma20, 0.5)
  assert.equal(SURFER_CONFIG.kBreak.sma50, 0.5)
  assert.equal(SURFER_CONFIG.latestToleranceAdr, 0.05)
  assert.equal(SURFER_CONFIG.maxExtensionAdrMultiple, 1.75)
  assert.equal(SURFER_CONFIG.nearFraction, 0.4)
  assert.equal(SURFER_CONFIG.recentNearSessions, 4)
  assert.equal(SURFER_CONFIG.recoverySessions, 3)
  assert.equal(SURFER_CONFIG.slopeAllowFlat, false)
  assert.equal(SURFER_CONFIG.adrSessions, 20)
  for (const key of Object.keys(SURFER_CONFIG)) {
    assert.equal(/touch|bounce/i.test(key), false, key)
  }
})

test('identical percent distance passes a high-ADR name and fails a low-ADR name', () => {
  const closes = rising(80)
  const last = closes.length - 1
  const sma = smaAt(closes, last, 20)!
  closes[last] = sma * 1.02
  const bars = barsPinnedToSma(closes, 20)
  const high = evaluateMaSurfer(bars, 'sma20', SURFER_CONFIG, 8)
  const low = evaluateMaSurfer(bars, 'sma20', SURFER_CONFIG, 1)
  assert.equal(high.distancePct, low.distancePct)
  assert.equal(high.distancePct, 2)
  assert.equal(high.ok, true, high.reason)
  assert.equal(low.ok, false)
  assert.equal(low.reason, 'extended')
  assert.ok(low.distanceAdr > SURFER_CONFIG.maxExtensionAdrMultiple)
  assert.ok(high.distanceAdr <= SURFER_CONFIG.maxExtensionAdrMultiple)
})

test('a shallow break that recovers counts, an open break does not, a deep break does not', () => {
  const closes = rising(80)
  const last = closes.length - 1
  const adr = 4
  const period = 20
  const dipAt = last - 2
  const smaDip = smaAt(closes, dipAt, period)!
  const shallow = smaDip * (1 - (0.2 * adr) / 100)
  closes[dipAt] = shallow
  const recoveredBars = barsPinnedToSma(closes, period)
  const recovered = evaluateMaSurfer(recoveredBars, 'sma20', SURFER_CONFIG, adr)
  assert.equal(recovered.ok, true, recovered.reason)
  assert.equal(recovered.recovered, true)
  assert.ok(recovered.maxCloseBelowPct > 0)
  assert.ok(recovered.maxCloseBelowPct <= SURFER_CONFIG.kBreak.sma20 * adr)

  const stillDown = closes.slice()
  const smaLast = smaAt(stillDown, last, period)!
  stillDown[last] = smaLast * (1 - (0.2 * adr) / 100)
  const open = evaluateMaSurfer(barsPinnedToSma(stillDown, period), 'sma20', SURFER_CONFIG, adr)
  assert.equal(open.ok, false)
  assert.equal(open.recovered, false)
  assert.equal(open.reason, 'unrecovered-break')

  const deepCloses = rising(80)
  const deepIdx = deepCloses.length - 3
  const smaDeep = smaAt(deepCloses, deepIdx, period)!
  deepCloses[deepIdx] = smaDeep * (1 - (SURFER_CONFIG.kBreak.sma20 * adr + 0.5) / 100)
  const deep = evaluateMaSurfer(barsPinnedToSma(deepCloses, period), 'sma20', SURFER_CONFIG, adr)
  assert.equal(deep.ok, false)
  assert.equal(deep.reason, 'deep-break')
})

test('price extended above the MA fails and a falling SMA fails', () => {
  const closes = rising(80)
  const last = closes.length - 1
  const sma = smaAt(closes, last, 10)!
  const adr = 2
  closes[last] = sma * (1 + ((SURFER_CONFIG.maxExtensionAdrMultiple + 0.25) * adr) / 100)
  const extended = evaluateMaSurfer(barsPinnedToSma(closes, 10), 'sma10', SURFER_CONFIG, adr)
  assert.equal(extended.ok, false)
  assert.equal(extended.reason, 'extended')

  // A steady drop sits under the SMA, so the break check fires first.
  // This grind is shallow enough that every close stays inside the latest-bar
  // tolerance (nothing to recover) while the 5-session SMA change is negative.
  const down: number[] = []
  let price = 120
  for (let i = 0; i < 80; i += 1) {
    price *= 1 - 0.0005
    down.push(price)
  }
  const slope = evaluateMaSurfer(barsPinnedToSma(down, 10), 'sma10', SURFER_CONFIG, 8)
  assert.equal(slope.reason, 'slope-down')
  assert.equal(slope.ok, false)
  assert.ok(slope.slopePct < 0)
  assert.equal(slope.recovered, true)
})

test('adrPctFromBars matches the metrics slice and insufficient bars fail closed', () => {
  const bars = barsFromCloses(rising(40), 0.02)
  const fromHelper = adrPctFromBars(bars, 20)
  const lookback = bars.slice(-(20 + 1), -1)
  const manual = lookback.reduce((sum, b) => sum + ((b.h - b.l) / b.c) * 100, 0) / lookback.length
  assert.ok(Math.abs(fromHelper - manual) < 1e-9)
  const short = evaluateSurfer(bars.slice(0, 10))
  assert.equal(short.sma10.ok, false)
  assert.match(short.sma10.reason ?? '', /insufficient-bars/)
  const detail = compactSurferDetail(evaluateSurfer(bars, SURFER_CONFIG, fromHelper))
  assert.equal(detail.sma20.adrPct, Math.round(fromHelper * 100) / 100)
  assert.equal(surferBadgeTitle('20MA Surfer'), '20MA Surfer (strict ride)')
  assert.match(surferBadgeTitle('20MA Surfer', detail), /ADR/)
  assert.doesNotMatch(surferBadgeTitle('20MA Surfer', detail), /touch/i)
})

interface FixtureFile {
  label: string
  fetchedAt: string
  symbols: Record<string, { bars: DailyBar[] }>
}

function oracle(
  bars: DailyBar[],
  key: MaKey,
  adr: number,
  price: number,
  config: SurferConfig = SURFER_CONFIG,
) {
  const period = key === 'sma10' ? 10 : key === 'sma20' ? 20 : 50
  const windowSessions = config.windowSessions[key]
  const slopeN = config.slopeLookback[key]
  const proximityPct = config.kProximity[key] * adr
  const breakTolerancePct = config.kBreak[key] * adr
  const latestTolPct = config.latestToleranceAdr * adr
  const closes = bars.map((b) => b.c)
  const last = bars.length - 1
  const localSma = (end: number) => {
    const slice = closes.slice(end - period + 1, end + 1)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  }
  const smaNow = localSma(last)
  const smaAgo = localSma(last - slopeN)
  const distRaw = ((price - smaNow) / smaNow) * 100
  let nearBars = 0
  let recentNear = false
  let maxCloseBelow = 0
  let minLow = Number.POSITIVE_INFINITY
  let deep = false
  const dips: number[] = []
  const windowStart = bars.length - windowSessions
  for (let i = windowStart; i <= last; i += 1) {
    const sma = localSma(i)
    const closeBelow = ((sma - bars[i]!.c) / sma) * 100
    maxCloseBelow = Math.max(maxCloseBelow, closeBelow)
    const lowDist = ((bars[i]!.l - sma) / sma) * 100
    minLow = Math.min(minLow, lowDist)
    if (lowDist <= proximityPct) {
      nearBars += 1
      if (i >= last - config.recentNearSessions + 1) recentNear = true
    }
    if (closeBelow > breakTolerancePct) deep = true
    else if (closeBelow > latestTolPct) dips.push(i)
  }
  let recovered = true
  for (const dip of dips) {
    if (dip >= last) {
      recovered = false
      break
    }
    let back = false
    const to = Math.min(last, dip + config.recoverySessions)
    for (let j = dip + 1; j <= to; j += 1) {
      const below = ((localSma(j) - bars[j]!.c) / localSma(j)) * 100
      if (below <= latestTolPct) {
        back = true
        break
      }
    }
    if (!back) {
      recovered = false
      break
    }
  }
  const nearEnough = nearBars / windowSessions >= config.nearFraction || recentNear
  const holding = distRaw >= -latestTolPct
  const extended = distRaw > config.maxExtensionAdrMultiple * adr
  const slopeUp = config.slopeAllowFlat ? smaNow >= smaAgo : smaNow > smaAgo
  let reason: string | undefined
  if (deep) reason = 'deep-break'
  else if (!recovered) reason = 'unrecovered-break'
  else if (!nearEnough) reason = 'not-near'
  else if (!holding) reason = 'not-above-sma'
  else if (extended) reason = 'extended'
  else if (!slopeUp) reason = 'slope-down'
  return {
    ok: reason == null,
    reason,
    nearBars,
    distancePct: Math.round(distRaw * 100) / 100,
    minDistancePct: Math.round(minLow * 100) / 100,
    recovered,
    slopePct: Math.round(((smaNow - smaAgo) / smaAgo) * 100 * 100) / 100,
  }
}

test('real Yahoo daily bars match an independent ADR-proximity recomputation', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(process.cwd(), 'server/fixtures/yahoo-daily-nvda-amd-aapl-smci.json'), 'utf8'),
  ) as FixtureFile
  assert.match(fixture.label, /real-data sample/)
  assert.equal(fixture.fetchedAt, '2026-10-02')
  for (const sym of ['NVDA', 'AMD', 'AAPL', 'SMCI'] as const) {
    const bars = fixture.symbols[sym]!.bars
    assert.ok(bars.length >= 260)
    const adr = adrPctFromBars(bars)
    const price = bars[bars.length - 1]!.c
    const result = evaluateSurfer(bars, SURFER_CONFIG, adr, price)
    for (const key of ['sma10', 'sma20', 'sma50'] as const) {
      const expected = oracle(bars, key, adr, price)
      assert.equal(result[key].ok, expected.ok, `${sym} ${key} ${result[key].reason} vs ${expected.reason}`)
      assert.equal(result[key].nearBars, expected.nearBars, `${sym} ${key} near`)
      assert.equal(result[key].distancePct, expected.distancePct, `${sym} ${key} distance`)
      assert.equal(result[key].recovered, expected.recovered, `${sym} ${key} recovered`)
      assert.equal(result[key].slopePct, expected.slopePct, `${sym} ${key} slope`)
      assert.equal(result[key].minDistancePct, expected.minDistancePct)
    }
    const idea = computeIdeaMetrics(
      { ticker: sym, name: sym, groupId: 'test', groupName: 'Test' },
      { symbol: sym, bars, provider: 'yahoo-fixture' },
    )
    assert.ok(idea)
    assert.equal(idea!.surfer10, result.sma10.ok)
    assert.equal(idea!.surfer20, result.sma20.ok)
    assert.equal(idea!.surfer50, result.sma50.ok)
    assert.equal(idea!.surferDetail?.sma20.nearBars, result.sma20.nearBars)
    assert.equal(Math.abs(idea!.adrPct - Math.round(adr * 100) / 100) < 0.02, true)
  }
})

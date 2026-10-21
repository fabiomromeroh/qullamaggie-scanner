import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  accumulateStock,
  cellTone,
  emptyCounts,
  finalizeRows,
  scaledThreshold,
  type BreadthBar,
  type BreadthRow,
  type DayCounts,
} from '../src/lib/breadth.ts'

const DAY = 86400
const T0 = Date.UTC(2025, 0, 2, 21) / 1000

/** Flat stock at `price`, 1M shares/day; `tweak` edits bar i. */
function series(n: number, price = 50, tweak?: (i: number, b: BreadthBar) => void): BreadthBar[] {
  const out: BreadthBar[] = []
  for (let i = 0; i < n; i++) {
    const b = { t: T0 + i * DAY, o: price, h: price * 1.01, l: price * 0.99, c: price, v: 1_000_000 }
    tweak?.(i, b)
    out.push(b)
  }
  return out
}

function lastRow(bars: BreadthBar[]): DayCounts | undefined {
  const acc = new Map<string, DayCounts>()
  accumulateStock(bars, 1, acc)
  return [...acc.values()][0]
}

test('4% move needs higher volume than the prior day', () => {
  const up = series(30, 50, (i, b) => {
    if (i === 29) {
      b.c = 52.5
      b.h = 53
      b.v = 2_000_000
    }
  })
  assert.equal(lastRow(up)!.up4, 1)
  const lowVol = series(30, 50, (i, b) => {
    if (i === 29) {
      b.c = 52.5
      b.v = 900_000
    }
  })
  assert.equal(lastRow(lowVol)!.up4, 0)
  assert.equal(lastRow(lowVol)!.advancing, 1)
  const down = series(30, 50, (i, b) => {
    if (i === 29) {
      b.c = 47.9
      b.l = 47.5
      b.v = 1_500_000
    }
  })
  assert.equal(lastRow(down)!.down4, 1)
  assert.equal(lastRow(down)!.declining, 1)
})

test('price and dollar-volume floors exclude a stock', () => {
  assert.equal(lastRow(series(30, 4))?.universe ?? 0, 0)
  const thin = series(30, 10, (_i, b) => {
    b.v = 100_000 // $1M/day < $5M
  })
  assert.equal(lastRow(thin)?.universe ?? 0, 0)
})

test('quarter / month / 34-day windows and 50/200 SMA', () => {
  // Linear ramp from 20 to ~ 20 + 0.2*299.
  const bars = series(300, 20, (i, b) => {
    b.c = 20 + 0.2 * i
    b.h = b.c * 1.01
    b.l = b.c * 0.99
  })
  const r = lastRow(bars)!
  const c = bars[299]!.c
  assert.equal(r.up25q, c / bars[299 - 65]!.c - 1 >= 0.25 ? 1 : 0)
  assert.equal(r.up25m, 0)
  assert.equal(r.up13x34, c / bars[299 - 34]!.c - 1 >= 0.13 ? 1 : 0)
  assert.equal(r.above50, 1)
  assert.equal(r.base50, 1)
  assert.equal(r.above200, 1)
  assert.equal(r.newHighs, 1)
  assert.equal(r.newLows, 0)
  assert.equal(r.baseHighLow, 1)
})

test('10x ATR extension above the 50 SMA', () => {
  // Flat at 50 with tiny ranges, then a jump far above the 50 SMA.
  const bars = series(80, 50, (i, b) => {
    b.h = 50.1
    b.l = 49.9
    if (i === 79) {
      b.c = 60
      b.h = 60
      b.l = 59.9
    }
  })
  assert.equal(lastRow(bars)!.atrExt10, 1)
  assert.equal(lastRow(series(80))!.atrExt10, 0)
})

test('ratios sum up/down 4% counts over 5 and 10 sessions, newest first', () => {
  const acc = new Map<string, DayCounts>()
  for (let d = 1; d <= 12; d++) {
    const date = `2026-10-${String(d).padStart(2, '0')}`
    acc.set(date, { ...emptyCounts(date), universe: 100, up4: d, down4: 2 })
  }
  const rows = finalizeRows(acc, 60)
  assert.equal(rows[0]!.date, '2026-10-12')
  assert.equal(rows[0]!.ratio5, (12 + 11 + 10 + 9 + 8) / 10)
  assert.equal(rows[0]!.ratio10, (12 + 11 + 10 + 9 + 8 + 7 + 6 + 5 + 4 + 3) / 20)
  assert.equal(rows[11]!.ratio5, null)
  assert.equal(rows[8]!.ratio10, null)
})

test('colour thresholds', () => {
  const base = (p: Partial<BreadthRow>): BreadthRow => ({
    ...emptyCounts('2026-10-20'),
    universe: 6000,
    ratio5: null,
    ratio10: null,
    pctAbove50: null,
    pctAbove200: null,
    ...p,
  })
  assert.equal(scaledThreshold(300, 6000), 300)
  assert.equal(scaledThreshold(300, 1800), 90)
  assert.equal(cellTone('up4', base({ up4: 300 })), 'strong-green')
  assert.equal(cellTone('up4', base({ up4: 120, down4: 50 })), 'green')
  assert.equal(cellTone('down4', base({ down4: 310 })), 'strong-red')
  assert.equal(cellTone('up4', base({ universe: 1800, up4: 90 })), 'strong-green')
  assert.equal(cellTone('ratio5', base({ ratio5: 2.1 })), 'green')
  assert.equal(cellTone('ratio5', base({ ratio5: 3 })), 'strong-green')
  assert.equal(cellTone('ratio10', base({ ratio10: 0.45 })), 'red')
  assert.equal(cellTone('ratio10', base({ ratio10: 0.3 })), 'strong-red')
  assert.equal(cellTone('ratio10', base({ ratio10: 1 })), null)
  assert.equal(cellTone('pctAbove50', base({ pctAbove50: 85 })), 'strong-green')
  assert.equal(cellTone('pctAbove50', base({ pctAbove50: 35 })), 'red')
  assert.equal(cellTone('up25q', base({ up25q: 150, down25q: 10 })), 'red')
  assert.equal(cellTone('up25q', base({ up25q: 500, down25q: 100 })), 'green')
  assert.equal(cellTone('down25q', base({ up25q: 500, down25q: 600 })), 'red')
  assert.equal(cellTone('atrExt10', base({ atrExt10: 30 })), 'amber')
})

import { breadthNeedsRefresh, chartQuote, lastCloseMs } from '../src/lib/breadth.ts'

test('chart quote: change vs prior close and 20-day dollar volume', () => {
  const bars = Array.from({ length: 25 }, (_, i) => ({ t: T0 + i * DAY, o: 10, h: 10, l: 10, c: 10, v: 1000 }))
  const q = chartQuote('ABC', { price: 11, prevClose: 10, bars })!
  assert.ok(Math.abs(q.changePct - 10) < 1e-9)
  assert.equal(q.dollarVolume20, 10_000)
  assert.equal(chartQuote('X', { price: 0, prevClose: 10, bars }), null)
})

test('breadth refresh policy: 30 min in session, once after the close otherwise', () => {
  // Wed 2026-10-21 14:00 ET = 18:00Z (EDT).
  const inSession = Date.UTC(2026, 9, 21, 18, 0)
  assert.equal(breadthNeedsRefresh(new Date(inSession - 20 * 60_000).toISOString(), inSession), false)
  assert.equal(breadthNeedsRefresh(new Date(inSession - 40 * 60_000).toISOString(), inSession), true)
  // Wed 20:00 ET (00:00Z Thu): fresh if computed after 16:05 ET, stale if before.
  const evening = Date.UTC(2026, 9, 22, 0, 0)
  assert.equal(new Date(lastCloseMs(evening)).toISOString(), '2026-10-21T20:05:00.000Z')
  assert.equal(breadthNeedsRefresh('2026-10-21T20:10:00.000Z', evening), false)
  assert.equal(breadthNeedsRefresh('2026-10-21T19:50:00.000Z', evening), true)
  // Saturday: Friday's post-close run is enough.
  const sat = Date.UTC(2026, 9, 24, 15, 0)
  assert.equal(breadthNeedsRefresh('2026-10-23T20:30:00.000Z', sat), false)
  assert.equal(breadthNeedsRefresh(null, sat), true)
})

import { splitShares } from '../src/lib/breadth.ts'

test('split bar shares always total 100% with no gap', () => {
  const a = splitShares(1366, 427)
  assert.ok(Math.abs(a.leftPct + a.rightPct - 100) < 1e-9)
  assert.ok(Math.abs(a.leftPct - (1366 / 1793) * 100) < 1e-9)
  assert.deepEqual(splitShares(0, 0), { leftPct: 50, rightPct: 50 })
  assert.deepEqual(splitShares(5, 0), { leftPct: 100, rightPct: 0 })
})

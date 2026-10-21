import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compareNullable,
  computePerfRow,
  pickMovers,
  ytdBaseClose,
  type PerfBar,
} from '../src/lib/perfWindows.ts'
import { COUNTRY_ETFS, EQUAL_WEIGHT_ETFS, ETF_LISTS, GROUP_ETFS, SECTOR_ETFS } from '../src/lib/etfLists.ts'

/** n bars, one per weekday-ish day ending 2026-10-20 16:00 ET, close = start + i. */
function bars(n: number, start = 100, endSec = Date.UTC(2026, 9, 20, 20) / 1000): PerfBar[] {
  const out: PerfBar[] = []
  for (let i = 0; i < n; i++) {
    const t = endSec - (n - 1 - i) * 86400
    const c = start + i
    out.push({ t, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 })
  }
  return out
}

test('session windows count back from the last bar', () => {
  const b = bars(300)
  const last = b[b.length - 1]!.c
  const row = computePerfRow(b, last, b[b.length - 2]!.c)
  const pct = (from: number) => (last / from - 1) * 100
  assert.equal(row.perfDay, pct(last - 1))
  assert.equal(row.perfWeek, pct(last - 5))
  assert.equal(row.perfMonth, pct(last - 21))
  assert.equal(row.perf3m, pct(last - 63))
  assert.equal(row.perf6m, pct(last - 126))
  assert.equal(row.perfYear, pct(last - 252))
  assert.equal(row.changeFromOpen, pct(last - 0.5))
})

test('insufficient history gives null, not a guess', () => {
  const b = bars(30)
  const row = computePerfRow(b, 129, 128)
  assert.notEqual(row.perfMonth, null)
  assert.equal(row.perf3m, null)
  assert.equal(row.perf6m, null)
  assert.equal(row.perfYear, null)
  assert.equal(row.perfYtd, null)
})

test('YTD base is the last close of the previous ET calendar year', () => {
  // 2025-12-31 21:00 UTC = 16:00 ET (still 2025); 2026-01-02 close.
  const b: PerfBar[] = [
    { t: Date.UTC(2025, 11, 30, 21) / 1000, o: 1, h: 1, l: 1, c: 90, v: 1 },
    { t: Date.UTC(2025, 11, 31, 21) / 1000, o: 1, h: 1, l: 1, c: 100, v: 1 },
    { t: Date.UTC(2026, 0, 2, 21) / 1000, o: 1, h: 1, l: 1, c: 105, v: 1 },
  ]
  assert.equal(ytdBaseClose(b), 100)
  assert.equal(computePerfRow(b, 110, 105).perfYtd, 10.000000000000009)
})

test('compareNullable keeps nulls last both ways', () => {
  const vals = [3, null, -1, 5]
  assert.deepEqual([...vals].sort((a, b) => compareNullable(a, b, 'desc')), [5, 3, -1, null])
  assert.deepEqual([...vals].sort((a, b) => compareNullable(a, b, 'asc')), [-1, 3, 5, null])
})

test('movers apply the dollar-volume floor', () => {
  const { gainers, losers } = pickMovers(
    [
      { ticker: 'JUNK', price: 6, changePct: 40, avgVolume: 100_000 },
      { ticker: 'BIG', price: 100, changePct: 8, avgVolume: 1_000_000 },
      { ticker: 'MID', price: 50, changePct: 3, avgVolume: 500_000 },
      { ticker: 'DOWN', price: 80, changePct: -6, avgVolume: 1_000_000 },
    ],
    5,
  )
  assert.deepEqual(gainers.map((g) => g.ticker), ['BIG', 'MID'])
  assert.deepEqual(losers.map((g) => g.ticker), ['DOWN'])
})

test('ETF lists are non-empty, unique per list, and the requested names are present', () => {
  for (const [id, list] of Object.entries(ETF_LISTS)) {
    const tickers = list.map((e) => e.ticker)
    assert.equal(new Set(tickers).size, tickers.length, id)
  }
  assert.ok(GROUP_ETFS.length >= 40 && GROUP_ETFS.length <= 80)
  for (const t of ['KBE', 'KRE', 'IWO', 'ESPO', 'CLOU', 'KIE', 'SKYY', 'XSD', 'SMH', 'IBB', 'XBI', 'ITB', 'XHB', 'TAN', 'URA', 'JETS']) {
    assert.ok(GROUP_ETFS.some((e) => e.ticker === t), t)
  }
  for (const t of ['XLK', 'XLF', 'XLV', 'XLE', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC', 'IJT', 'IJS', 'IJH', 'IJJ', 'IJK', 'MDY', 'SPY', 'QQQ', 'IWM']) {
    assert.ok(SECTOR_ETFS.some((e) => e.ticker === t), t)
  }
  for (const t of ['RSP', 'RSPT', 'RSPF', 'RSPH', 'RSPN', 'RSPD', 'RSPS', 'RSPU', 'RSPM', 'RSPR', 'RSPC', 'RSPG', 'QQQE']) {
    assert.ok(EQUAL_WEIGHT_ETFS.some((e) => e.ticker === t), t)
  }
  for (const t of ['EWJ', 'EWZ', 'EWG', 'EWU', 'FXI', 'MCHI', 'INDA', 'EWW', 'EWC', 'EWA', 'EWY', 'EWT']) {
    assert.ok(COUNTRY_ETFS.some((e) => e.ticker === t), t)
  }
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { closeSessionsBeforePrice, resolvePrevClose } from '../src/lib/prevClose.ts'
import {
  memberPeriodReturnPct,
  rankLeaderPool,
  round2,
  type MemberPerfInput,
} from '../src/lib/memberPerf.ts'
import type { GroupPeriod } from '../src/types/index.ts'

interface SampleBar {
  t: number
  c: number
  v: number
}

interface SampleSymbol {
  price: number
  regularMarketTime: number
  gmtoffset: number
  exchangeTimezoneName: string
  previousClose: number | null
  chartPreviousClose: number
  bars: SampleBar[]
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'server/fixtures/yahoo-member-perf-sample.json'), 'utf8'),
) as {
  label: string
  fetchedAt: string
  symbols: Record<string, SampleSymbol>
}

function inputFor(sample: SampleSymbol, bars: SampleBar[] = sample.bars): MemberPerfInput {
  const prevClose = resolvePrevClose({
    bars,
    price: sample.price,
    metaPreviousClose: sample.previousClose,
    metaChartPreviousClose: sample.chartPreviousClose,
    range: '1y',
    regularMarketTime: sample.regularMarketTime,
    gmtoffset: sample.gmtoffset,
    exchangeTimezoneName: sample.exchangeTimezoneName,
  })
  return {
    bars,
    price: sample.price,
    prevClose,
    regularMarketTime: sample.regularMarketTime,
    gmtoffset: sample.gmtoffset,
    exchangeTimezoneName: sample.exchangeTimezoneName,
  }
}

test('real Yahoo sample: 1D uses the prior session, longer windows use completed bars', () => {
  assert.match(fixture.label, /Real Yahoo/)
  for (const symbol of ['XOM', 'MPC'] as const) {
    const sample = fixture.symbols[symbol]!
    const input = inputFor(sample)
    assert.ok(input.prevClose != null && input.prevClose > 0)
    assert.notEqual(input.prevClose, sample.chartPreviousClose)
    const day = memberPeriodReturnPct(input, '1d')
    assert.equal(day, round2((sample.price / input.prevClose! - 1) * 100))
    const fromChart = round2((sample.price / sample.chartPreviousClose - 1) * 100)
    assert.notEqual(day, fromChart)

    const clock = {
      regularMarketTime: sample.regularMarketTime,
      gmtoffset: sample.gmtoffset,
      exchangeTimezoneName: sample.exchangeTimezoneName,
    }
    const windows: [GroupPeriod, number][] = [
      ['1w', 5],
      ['1m', 21],
      ['3m', 63],
      ['6m', 126],
    ]
    for (const [period, sessions] of windows) {
      const base = closeSessionsBeforePrice(sample.bars, sample.price, sessions, clock)
      assert.ok(base != null && base > 0, `${symbol} ${period}`)
      assert.equal(memberPeriodReturnPct(input, period), round2((sample.price / base! - 1) * 100))
    }

    const short = inputFor(sample, sample.bars.slice(-30))
    assert.equal(memberPeriodReturnPct(short, '3m'), null)
    assert.equal(memberPeriodReturnPct(short, '6m'), null)
    assert.notEqual(memberPeriodReturnPct(short, '1w'), null)
  }
})

test('lookback counts completed bars before a price that is newer than the last bar', () => {
  const sample = fixture.symbols.XOM!
  const bars = sample.bars.slice(0, 10)
  const last = bars[bars.length - 1]!
  const price = last.c * 1.05
  const input: MemberPerfInput = {
    bars,
    price,
    prevClose: last.c,
    regularMarketTime: last.t + 3 * 24 * 60 * 60,
    gmtoffset: sample.gmtoffset,
    exchangeTimezoneName: sample.exchangeTimezoneName,
  }
  const base = bars[bars.length - 5]!.c
  assert.equal(memberPeriodReturnPct(input, '1w'), round2((price / base - 1) * 100))
  assert.equal(memberPeriodReturnPct(input, '1d'), round2((price / last.c - 1) * 100))
})

test('rankLeaderPool puts nulls last, breaks ties by ticker, and cuts at the pool size', () => {
  const ranked = rankLeaderPool(
    [
      { ticker: 'BBB', perf: null },
      { ticker: 'CCC', perf: 1 },
      { ticker: 'AAA', perf: null },
      { ticker: 'DDD', perf: 5 },
      { ticker: 'EEE', perf: 5 },
    ],
    3,
  )
  assert.deepEqual(
    ranked.map((row) => row.ticker),
    ['DDD', 'EEE', 'CCC'],
  )

  const many = Array.from({ length: 25 }, (_, index) => ({
    ticker: `T${String(index).padStart(2, '0')}`,
    perf: index,
  }))
  const pool = rankLeaderPool(many)
  assert.equal(pool.length, 20)
  assert.equal(pool[0]?.ticker, 'T24')
  assert.equal(pool[19]?.ticker, 'T05')
})

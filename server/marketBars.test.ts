import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildBarsPayload, MAX_DAILY_BARS, shapeDailyBars } from './marketBars.ts'
import { parseMarketSymbol } from './marketSymbol.ts'

test('parseMarketSymbol accepts listed tickers and rejects junk', () => {
  assert.equal(parseMarketSymbol('amd'), 'AMD')
  assert.equal(parseMarketSymbol(' BRK.B '), 'BRK.B')
  assert.equal(parseMarketSymbol('brk-b'), 'BRK-B')
  assert.equal(parseMarketSymbol('%5EGSPC'), '^GSPC')
  assert.equal(parseMarketSymbol('a'), 'A')
  assert.equal(parseMarketSymbol(null), null)
  assert.equal(parseMarketSymbol(''), null)
  assert.equal(parseMarketSymbol('TOOLONGSYMBOL12'), null)
  assert.equal(parseMarketSymbol('bad/name'), null)
  assert.equal(parseMarketSymbol('AAPL!'), null)
  assert.equal(parseMarketSymbol('NVD A'), null)
})

test('shapeDailyBars drops nulls/NaN, sorts ascending, caps at last 500', () => {
  const shaped = shapeDailyBars([
    { t: 30, o: 3, h: 4, l: 2, c: 3.5, v: 9 },
    { t: 10, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    { t: 20, o: null, h: 2, l: 1, c: 1.5, v: 1 },
    { t: 21, o: 1, h: 2, l: 1, c: Number.NaN, v: 1 },
    { t: 22, o: 1, h: 2, l: 1, c: 1, v: Number.NaN },
    { t: 20, o: 2, h: 3, l: 1, c: 2.5, v: 8 },
  ])
  assert.deepEqual(
    shaped.map((b) => b.t),
    [10, 20, 22, 30],
  )
  assert.equal(shaped[1]?.c, 2.5)
  assert.equal(shaped[1]?.v, 8)
  assert.equal(shaped[2]?.v, 0)
})

test('shapeDailyBars keeps only the last 500 after sort', () => {
  const bars = []
  for (let i = 0; i < 620; i++) {
    bars.push({ t: 1_000 + (619 - i), o: 1, h: 1, l: 1, c: 1, v: i })
  }
  const shaped = shapeDailyBars(bars)
  assert.equal(shaped.length, MAX_DAILY_BARS)
  assert.equal(shaped[0]!.t, 1_000 + 120)
  assert.equal(shaped[shaped.length - 1]!.t, 1_000 + 619)
  for (let i = 1; i < shaped.length; i++) {
    assert.ok(shaped[i]!.t >= shaped[i - 1]!.t)
  }
})

test('buildBarsPayload copies snapshot fields and shaped bars', () => {
  const payload = buildBarsPayload(
    {
      symbol: 'AMD',
      name: 'Advanced Micro Devices, Inc.',
      provider: 'yahoo',
      price: 120.5,
      bars: [
        { t: 2, o: 2, h: 3, l: 1, c: 2, v: 10 },
        { t: 1, o: 1, h: 2, l: 1, c: 1, v: 5 },
      ],
    },
    () => '2026-10-01T00:00:00.000Z',
  )
  assert.equal(payload.symbol, 'AMD')
  assert.equal(payload.name, 'Advanced Micro Devices, Inc.')
  assert.equal(payload.provider, 'yahoo')
  assert.equal(payload.price, 120.5)
  assert.equal(payload.asOf, '2026-10-01T00:00:00.000Z')
  assert.deepEqual(
    payload.bars.map((b) => b.t),
    [1, 2],
  )
})

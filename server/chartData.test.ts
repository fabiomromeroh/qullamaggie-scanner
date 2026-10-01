import assert from 'node:assert/strict'
import { test } from 'node:test'
import { smaSeries, toCandles, toVolume, VOLUME_DOWN, VOLUME_UP } from '../src/lib/chartData.ts'

const sample = [
  { t: 1, o: 2, h: 3, l: 1, c: 2, v: 100 },
  { t: 2, o: 2, h: 4, l: 2, c: 4, v: 110 },
  { t: 3, o: 4, h: 6, l: 4, c: 6, v: 120 },
  { t: 4, o: 6, h: 8, l: 5, c: 8, v: 130 },
  { t: 5, o: 10, h: 10, l: 8, c: 10, v: 140 },
]

test('toCandles maps OHLCV and skips invalid rows', () => {
  const candles = toCandles([
    ...sample,
    { t: 6, o: Number.NaN, h: 1, l: 1, c: 1, v: 1 },
  ])
  assert.equal(candles.length, 5)
  assert.deepEqual(candles[0], { time: 1, open: 2, high: 3, low: 1, close: 2 })
  assert.deepEqual(candles[4], { time: 5, open: 10, high: 10, low: 8, close: 10 })
})

test('toVolume colors up and down bars', () => {
  const vol = toVolume([
    { t: 1, o: 2, h: 3, l: 1, c: 3, v: 50 },
    { t: 2, o: 3, h: 3, l: 1, c: 2, v: 40 },
  ])
  assert.equal(vol[0]?.color, VOLUME_UP)
  assert.equal(vol[1]?.color, VOLUME_DOWN)
  assert.equal(vol[0]?.value, 50)
})

test('smaSeries warm-up is null and later values are exact', () => {
  const sma3 = smaSeries(sample, 3)
  assert.equal(sma3.length, 5)
  assert.equal(sma3[0]!.value, null)
  assert.equal(sma3[1]!.value, null)
  assert.equal(sma3[2]!.value, (2 + 4 + 6) / 3)
  assert.equal(sma3[3]!.value, (4 + 6 + 8) / 3)
  assert.equal(sma3[4]!.value, (6 + 8 + 10) / 3)
  assert.equal(sma3[2]!.time, 3)
})

test('smaSeries n=1 equals closes; n<1 is all nulls', () => {
  const sma1 = smaSeries(sample, 1)
  assert.deepEqual(
    sma1.map((p) => p.value),
    [2, 4, 6, 8, 10],
  )
  const sma0 = smaSeries(sample, 0)
  assert.ok(sma0.every((p) => p.value === null))
})

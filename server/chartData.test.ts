import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CHART_RIGHT_OFFSET_BARS,
  VOLUME_SMA_PERIOD,
  measurePctChange,
  smaSeries,
  toCandles,
  toVolume,
  volumeSmaSeries,
  VOLUME_DOWN,
  VOLUME_UP,
} from '../src/lib/chartData.ts'

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

test('volumeSmaSeries warm-up is null and later values are exact', () => {
  const sma3 = volumeSmaSeries(sample, 3)
  assert.equal(sma3.length, 5)
  assert.equal(sma3[0]!.value, null)
  assert.equal(sma3[1]!.value, null)
  assert.equal(sma3[2]!.value, (100 + 110 + 120) / 3)
  assert.equal(sma3[3]!.value, (110 + 120 + 130) / 3)
  assert.equal(sma3[4]!.value, (120 + 130 + 140) / 3)
  assert.equal(sma3[2]!.time, 3)
})

test('volumeSmaSeries counts missing and negative volume as 0', () => {
  const bars = [
    { t: 1, o: 1, h: 1, l: 1, c: 1, v: 10 },
    { t: 2, o: 1, h: 1, l: 1, c: 1, v: undefined as unknown as number },
    { t: 3, o: 1, h: 1, l: 1, c: 1, v: Number.NaN },
    { t: 4, o: 1, h: 1, l: 1, c: 1, v: -5 },
    { t: 5, o: 1, h: 1, l: 1, c: 1, v: 30 },
  ]
  const sma = volumeSmaSeries(bars, 3)
  assert.equal(sma.length, 5)
  assert.equal(sma[0]!.value, null)
  assert.equal(sma[1]!.value, null)
  assert.equal(sma[2]!.value, (10 + 0 + 0) / 3)
  assert.equal(sma[3]!.value, (0 + 0 + 0) / 3)
  assert.equal(sma[4]!.value, (0 + 0 + 30) / 3)
  assert.equal(sma[4]!.time, 5)
})

test('volumeSmaSeries default period is 20; short history and n<1 are null', () => {
  assert.equal(VOLUME_SMA_PERIOD, 20)
  assert.equal(CHART_RIGHT_OFFSET_BARS, 10)
  const bars = Array.from({ length: 20 }, (_, i) => ({
    t: i + 1,
    o: 1,
    h: 1,
    l: 1,
    c: 1,
    v: 5,
  }))
  const sma = volumeSmaSeries(bars)
  assert.equal(sma[18]!.value, null)
  assert.equal(sma[19]!.value, 5)
  assert.ok(volumeSmaSeries(sample, 20).every((p) => p.value === null))
  assert.ok(volumeSmaSeries(sample, 0).every((p) => p.value === null))
  assert.ok(volumeSmaSeries(sample, Number.NaN).every((p) => p.value === null))
  assert.deepEqual(volumeSmaSeries([], 20), [])
})

test('measurePctChange signs the move and rejects a non-positive start', () => {
  assert.deepEqual(measurePctChange(100, 110), { pct: 10, abs: 10 })
  assert.deepEqual(measurePctChange(80, 60), { pct: -25, abs: -20 })
  assert.deepEqual(measurePctChange(50, 75), { pct: 50, abs: 25 })
  const tiny = measurePctChange(0.5, 1)
  assert.equal(tiny?.pct, 100)
  assert.equal(tiny?.abs, 0.5)
  assert.equal(measurePctChange(0, 10), null)
  assert.equal(measurePctChange(-1, 10), null)
  assert.equal(measurePctChange(Number.NaN, 10), null)
  assert.equal(measurePctChange(10, Number.NaN), null)
  assert.equal(measurePctChange(10, Number.POSITIVE_INFINITY), null)
  assert.equal(measurePctChange(Number.POSITIVE_INFINITY, 1), null)
})

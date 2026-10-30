import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_LIQUIDITY_FILTERS,
  LIQUIDITY_AVG_VOL_FLOOR,
  LIQUIDITY_DOLLAR_VOL_FLOOR,
  LIQUIDITY_FILTERS_KEY,
  LIQUIDITY_PRICE_FLOOR,
  deriveAvgVolume,
  liquidityFilterLabels,
  liquidityRowFromIdea,
  loadLiquidityFilters,
  parseLiquidityFilters,
  passesLiquidityFilters,
  saveLiquidityFilters,
  type LiquidityFilters,
} from '../src/lib/liquidityFilters.ts'
import { formatDollarFloor, formatShareVolume, membershipFilterFootnote } from '../src/lib/membershipFootnote.ts'
import { writeJsonTo, type KeyValueStore } from '../src/lib/persist.ts'
import { cloneIdeaFilters, passesFilters } from '../src/lib/ideaFilters.ts'
import { DEFAULT_FILTERS, DEFAULT_MIN_AVG_DOLLAR_VOL, type IdeaFilters, type TradingIdea } from '../src/types/index.ts'

function memoryStore(init?: Record<string, string>): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init ?? {}))
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

test('liquidity filter defaults are all ON', () => {
  assert.deepEqual(DEFAULT_LIQUIDITY_FILTERS, {
    priceGt5: true,
    avgVol100k: true,
    dollarVol20m: true,
  })
  assert.equal(LIQUIDITY_PRICE_FLOOR, 5)
  assert.equal(LIQUIDITY_AVG_VOL_FLOOR, 100_000)
  assert.equal(LIQUIDITY_DOLLAR_VOL_FLOOR, 20_000_000)
  assert.deepEqual(parseLiquidityFilters(null), DEFAULT_LIQUIDITY_FILTERS)
  assert.deepEqual(parseLiquidityFilters({}), DEFAULT_LIQUIDITY_FILTERS)
  assert.deepEqual(
    parseLiquidityFilters({ priceGt5: false, avgVol100k: true, dollarVol20m: false }),
    { priceGt5: false, avgVol100k: true, dollarVol20m: false },
  )
})

test('liquidity persist round-trips through localStorage-shaped store', () => {
  const store = memoryStore()
  assert.deepEqual(loadLiquidityFilters(store), DEFAULT_LIQUIDITY_FILTERS)
  const next: LiquidityFilters = { priceGt5: false, avgVol100k: true, dollarVol20m: false }
  saveLiquidityFilters(next, store)
  assert.equal(store.getItem(LIQUIDITY_FILTERS_KEY) != null, true)
  assert.deepEqual(loadLiquidityFilters(store), next)
  writeJsonTo(store, LIQUIDITY_FILTERS_KEY, { priceGt5: 'nope' })
  assert.equal(loadLiquidityFilters(store).priceGt5, true)
})

test('unknown liquidity values are kept; known values under the floor are dropped', () => {
  const on = DEFAULT_LIQUIDITY_FILTERS
  const off: LiquidityFilters = { priceGt5: false, avgVol100k: false, dollarVol20m: false }
  assert.equal(passesLiquidityFilters({}, on), true)
  assert.equal(passesLiquidityFilters({ price: null, avgVolume: null, dollarVolume20: null }, on), true)
  assert.equal(passesLiquidityFilters({ price: Number.NaN }, on), true)
  assert.equal(passesLiquidityFilters({ price: 5.01, avgVolume: 100_001, dollarVolume20: 20_000_000 }, on), true)
  assert.equal(passesLiquidityFilters({ price: 5 }, on), false)
  assert.equal(passesLiquidityFilters({ price: 4.99 }, on), false)
  assert.equal(passesLiquidityFilters({ avgVolume: 100_000 }, on), false)
  assert.equal(passesLiquidityFilters({ avgVolume: 99_999 }, on), false)
  assert.equal(passesLiquidityFilters({ dollarVolume20: 19_999_999 }, on), false)
  assert.equal(passesLiquidityFilters({ dollarVolume20: 20_000_000 }, on), true)
  assert.equal(passesLiquidityFilters({ price: 1, avgVolume: 1, dollarVolume20: 1 }, off), true)
  assert.equal(passesLiquidityFilters({ price: 4 }, { ...on, priceGt5: false }), true)
})

test('deriveAvgVolume never invents a number', () => {
  assert.equal(deriveAvgVolume(10, 20_000_000), 2_000_000)
  assert.equal(deriveAvgVolume(0, 20_000_000), null)
  assert.equal(deriveAvgVolume(null, 20_000_000), null)
  assert.equal(deriveAvgVolume(10, null), null)
  assert.equal(deriveAvgVolume(Number.NaN, 20_000_000), null)
})

test('scanner $20M toggle coexists with Min DolVol (stricter floor wins)', () => {
  const idea = {
    ticker: 'AAA',
    name: 'Aaa',
    groupName: 'X',
    aboveSma200: true,
    aboveSma50: true,
    aboveSma10: true,
    aboveSma20: true,
    setupStage: 'coiled',
    rvol: 2,
    price: 20,
    avgDollarVol: 25_000_000,
    pctFrom52wHigh: -1,
    setupType: 'Range Breakout',
    isAPlus: false,
    earningsStatus: 'clear',
    catalyst: null,
  } as TradingIdea
  const filters: IdeaFilters = cloneIdeaFilters(DEFAULT_FILTERS)
  assert.equal(filters.minAvgDollarVol, DEFAULT_MIN_AVG_DOLLAR_VOL)
  const liqOn = DEFAULT_LIQUIDITY_FILTERS
  // 25M fails the $30M Min DolVol even though it passes $20M.
  assert.equal(passesFilters(idea, filters, { liquidity: liqOn }), false)
  assert.equal(
    passesFilters(idea, { ...filters, minAvgDollarVol: 0 }, { liquidity: liqOn }),
    true,
  )
  assert.equal(
    passesFilters(
      { ...idea, avgDollarVol: 10_000_000 } as TradingIdea,
      { ...filters, minAvgDollarVol: 0 },
      { liquidity: liqOn },
    ),
    false,
  )
  const row = liquidityRowFromIdea(idea)
  assert.equal(row.dollarVolume20, 25_000_000)
  assert.equal(row.avgVolume, 25_000_000 / 20)
})

test('compact volume and dollar floors still format', () => {
  assert.equal(formatShareVolume(100_000), '100K')
  assert.equal(formatShareVolume(50_000), '50K')
  assert.equal(formatShareVolume(750_000), '750K')
  assert.equal(formatDollarFloor(20_000_000), '$20M')
})

test('membership footnote reflects the toggles, not a rebuild filter', () => {
  assert.equal(
    membershipFilterFootnote({
      shown: 8,
      total: 12,
      filters: DEFAULT_LIQUIDITY_FILTERS,
    }),
    '8 of 12 shown · filters: Price > $5, Avg vol > 100K, $Vol > $20M',
  )
  assert.equal(
    membershipFilterFootnote({
      shown: 12,
      total: 12,
      filters: { priceGt5: false, avgVol100k: false, dollarVol20m: false },
    }),
    '12 of 12 shown · filters: none',
  )
  assert.deepEqual(liquidityFilterLabels({ priceGt5: true, avgVol100k: false, dollarVol20m: true }), [
    'Price > $5',
    '$Vol > $20M',
  ])
})

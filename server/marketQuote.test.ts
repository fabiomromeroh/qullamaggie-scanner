import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildQuotePayload,
  dayPctFromQuote,
  QUOTE_CACHE_TTL_MS,
  shapeQuotePayload,
} from '../src/lib/marketQuote.ts'
import { parseMarketSymbol, matchMarketSymbolRoute } from './marketSymbol.ts'
import { getQuoteForSymbol, clearQuoteCache } from './marketQuote.ts'

test('QUOTE_CACHE_TTL_MS is 60 seconds', () => {
  assert.equal(QUOTE_CACHE_TTL_MS, 60_000)
})

test('parseMarketSymbol and quote route match the shared validator', () => {
  assert.equal(parseMarketSymbol('f'), 'F')
  assert.equal(parseMarketSymbol('brk.b'), 'BRK.B')
  assert.equal(parseMarketSymbol('FOO$'), null)
  assert.equal(matchMarketSymbolRoute('/api/market/quote/AMD', 'quote'), 'AMD')
  assert.equal(matchMarketSymbolRoute('/api/market/quote/AMD/extra', 'quote'), null)
  assert.equal(matchMarketSymbolRoute('/api/market/bars/AMD', 'quote'), null)
})

test('shapeQuotePayload computes dayPct from price/prevClose and rejects junk', () => {
  const ok = shapeQuotePayload({
    symbol: 'amd',
    price: 110,
    prevClose: 100,
    source: 'yahoo',
    asOf: '2026-10-02T00:00:00.000Z',
  })
  assert.deepEqual(ok, {
    symbol: 'AMD',
    price: 110,
    prevClose: 100,
    dayPct: 10,
    asOf: '2026-10-02T00:00:00.000Z',
    source: 'yahoo',
  })
  assert.equal(dayPctFromQuote(110, 100), 10)
  assert.equal(shapeQuotePayload(null), null)
  assert.equal(shapeQuotePayload({ symbol: 'AMD', price: 1 }), null)
  assert.equal(shapeQuotePayload({ symbol: 'AMD', price: 0, prevClose: 10, source: 'yahoo' }), null)
  assert.equal(shapeQuotePayload({ symbol: 'BAD$', price: 1, prevClose: 1, source: 'yahoo' }), null)
  assert.equal(buildQuotePayload({ symbol: 'AMD', price: Number.NaN, prevClose: 1, source: 'yahoo' }), null)
})

test('getQuoteForSymbol caches and maps snapshot fields', async () => {
  clearQuoteCache()
  let calls = 0
  const load = async (symbol: string) => {
    calls += 1
    return { symbol, price: 50, prevClose: 40, provider: 'yahoo' }
  }
  const first = await getQuoteForSymbol('F', load, () => '2026-10-02T12:00:00.000Z')
  const second = await getQuoteForSymbol('F', load, () => '2026-10-02T12:00:01.000Z')
  assert.equal(calls, 1)
  assert.equal(first.symbol, 'F')
  assert.equal(first.price, 50)
  assert.equal(first.prevClose, 40)
  assert.equal(first.dayPct, 25)
  assert.equal(first.source, 'yahoo')
  assert.equal(first.asOf, '2026-10-02T12:00:00.000Z')
  assert.deepEqual(second, first)
  clearQuoteCache()
})

test('getQuoteForSymbol throws when snapshot cannot shape a quote', async () => {
  clearQuoteCache()
  await assert.rejects(
    () =>
      getQuoteForSymbol('ZZZZ', async () => ({
        symbol: 'ZZZZ',
        price: 0,
        prevClose: 0,
        provider: 'yahoo',
      })),
    /No quote for ZZZZ/,
  )
  clearQuoteCache()
})

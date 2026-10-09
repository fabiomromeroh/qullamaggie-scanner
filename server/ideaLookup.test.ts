import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseIdeaLookupSymbol,
  parseTickerLikeSearch,
  IDEA_LOOKUP_SYMBOL_RE,
  TICKER_LIKE_SEARCH_RE,
} from '../src/lib/tickerSymbol.ts'
import type { TradingIdea } from '../src/types/index.ts'
import type { MembershipSnapshot } from './groupMembers.ts'
import {
  clearIdeaLookupCache,
  getIdeaForSymbol,
  groupLabelFromSnapshot,
  ideaLookupMissError,
  IDEA_LOOKUP_TTL_MS,
} from './ideaLookup.ts'
import { matchMarketSymbolRoute } from './marketSymbol.ts'

function stubIdea(ticker: string): TradingIdea {
  return {
    ticker,
    name: ticker,
    groupId: 'other',
    groupName: 'Other',
  } as TradingIdea
}

function sampleSnapshot(): MembershipSnapshot {
  return {
    version: 1,
    source: 'finviz',
    sourceNote: 'unit sample',
    generatedAt: '2026-10-05T21:06:14.763Z',
    filters: { minPrice: 5, minAvgVolume: 750000 },
    groups: {
      biotechnology: {
        name: 'Biotechnology',
        tickers: ['MRNA', 'VRTX'],
        companies: { MRNA: 'Moderna Inc', VRTX: 'Vertex Pharmaceuticals Inc' },
        count: 2,
      },
    },
  }
}

test('ticker-like search detection is 1-6 letters, digits, dot, or dash', () => {
  assert.equal(parseTickerLikeSearch('MRNA'), 'MRNA')
  assert.equal(parseTickerLikeSearch(' mrna '), 'MRNA')
  assert.equal(parseTickerLikeSearch('BRK.B'), 'BRK.B')
  assert.equal(parseTickerLikeSearch('BRK-B'), 'BRK-B')
  assert.equal(parseTickerLikeSearch('A'), 'A')
  assert.equal(parseTickerLikeSearch('123'), '123')
  assert.equal(parseTickerLikeSearch('ABCDEF'), 'ABCDEF')
  assert.equal(parseTickerLikeSearch('ABCDEFG'), null)
  assert.equal(parseTickerLikeSearch('Moderna'), null)
  assert.equal(parseTickerLikeSearch(''), null)
  assert.equal(parseTickerLikeSearch('MR NA'), null)
  assert.equal(parseTickerLikeSearch('$MRNA'), null)
  assert.ok(TICKER_LIKE_SEARCH_RE.test('MRNA'))
  assert.equal(TICKER_LIKE_SEARCH_RE.test('ABCDEFG'), false)
})

test('idea lookup symbol validation is A then up to 9 alphanumerics/dot/dash', () => {
  assert.equal(parseIdeaLookupSymbol('mrna'), 'MRNA')
  assert.equal(parseIdeaLookupSymbol('BRK.B'), 'BRK.B')
  assert.equal(parseIdeaLookupSymbol('BRK-B'), 'BRK-B')
  assert.equal(parseIdeaLookupSymbol('A'), 'A')
  assert.equal(parseIdeaLookupSymbol('ABCDEFGHIJ'), 'ABCDEFGHIJ')
  assert.equal(parseIdeaLookupSymbol('ABCDEFGHIJK'), null)
  assert.equal(parseIdeaLookupSymbol('1AMD'), null)
  assert.equal(parseIdeaLookupSymbol('^GSPC'), null)
  assert.equal(parseIdeaLookupSymbol('FOO$'), null)
  assert.equal(parseIdeaLookupSymbol(''), null)
  assert.equal(parseIdeaLookupSymbol('  '), null)
  assert.ok(IDEA_LOOKUP_SYMBOL_RE.test('MRNA'))
  assert.equal(IDEA_LOOKUP_SYMBOL_RE.test('1AMD'), false)
  assert.equal(matchMarketSymbolRoute('/api/market/idea/MRNA', 'idea'), 'MRNA')
  assert.equal(matchMarketSymbolRoute('/api/market/idea/MRNA/extra', 'idea'), null)
  assert.equal(matchMarketSymbolRoute('/api/market/quote/MRNA', 'idea'), null)
  assert.equal(IDEA_LOOKUP_TTL_MS, 10 * 60 * 1000)
})

test('groupLabelFromSnapshot maps a membership ticker and leaves others unlabeled', () => {
  const snapshot = sampleSnapshot()
  const mrna = groupLabelFromSnapshot(snapshot, 'mrna')
  assert.deepEqual(mrna, {
    groupId: 'biotechnology',
    groupName: 'Biotechnology',
    company: 'Moderna Inc',
  })
  assert.equal(groupLabelFromSnapshot(snapshot, 'ZZZZ'), null)
})

test('getIdeaForSymbol scores one ticker, labels the Finviz group, and caches 10 minutes', async () => {
  clearIdeaLookupCache()
  const fake = stubIdea('MRNA')
  let calls = 0
  const scoreTickers = async (
    symbols: string[],
    opts?: { includeBelowSma200?: boolean; describe?: (symbol: string) => { name: string; groupId: string; groupName: string } },
  ) => {
    calls += 1
    assert.deepEqual(symbols, ['MRNA'])
    assert.equal(opts?.includeBelowSma200, true)
    const described = opts?.describe?.('MRNA')
    assert.equal(described?.groupId, 'biotechnology')
    assert.equal(described?.groupName, 'Biotechnology')
    return { ideas: [fake], failed: [], belowSma200Count: 0 }
  }
  const mergeCatalyst = (ideas: TradingIdea[]) => ({ ideas })
  const first = await getIdeaForSymbol('MRNA', {
    scoreTickers,
    mergeCatalyst,
    loadSnapshot: () => ({ ok: true, snapshot: sampleSnapshot() }),
    now: () => '2026-10-09T00:00:00.000Z',
  })
  assert.equal(first.ok, true)
  if (first.ok) {
    assert.equal(first.outsideScan, true)
    assert.equal(first.idea.ticker, 'MRNA')
    assert.equal(first.idea.groupId, 'biotechnology')
    assert.equal(first.idea.groupName, 'Biotechnology')
    assert.equal(first.idea.name, 'Moderna Inc')
    assert.equal(first.asOf, '2026-10-09T00:00:00.000Z')
  }
  const second = await getIdeaForSymbol('MRNA', {
    scoreTickers,
    mergeCatalyst,
    loadSnapshot: () => ({ ok: true, snapshot: sampleSnapshot() }),
    now: () => '2026-10-09T00:00:01.000Z',
  })
  assert.equal(calls, 1)
  assert.deepEqual(second, first)
  clearIdeaLookupCache()
})

test('getIdeaForSymbol keeps Other when the ticker is not in the membership snapshot', async () => {
  clearIdeaLookupCache()
  const result = await getIdeaForSymbol('ZZZZ', {
    scoreTickers: async (_symbols, opts) => {
      assert.equal(opts?.describe, undefined)
      return { ideas: [stubIdea('ZZZZ')], failed: [], belowSma200Count: 0 }
    },
    mergeCatalyst: (ideas) => ({ ideas }),
    loadSnapshot: () => ({ ok: true, snapshot: sampleSnapshot() }),
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.idea.groupId, 'other')
    assert.equal(result.idea.groupName, 'Other')
  }
  clearIdeaLookupCache()
})

test('getIdeaForSymbol 404 is a clean miss, logged, and negative-cached for 10 minutes', async () => {
  clearIdeaLookupCache()
  let calls = 0
  const logs: unknown[] = []
  const leak = 'Yahoo chart https://query2.finance.yahoo.com/v8/finance/chart/ZZZZ 404'
  const result = await getIdeaForSymbol('ZZZZ', {
    scoreTickers: async () => {
      calls += 1
      return {
        ideas: [],
        failed: [{ ticker: 'ZZZZ', reason: leak }],
        belowSma200Count: 0,
      }
    },
    log: (payload) => {
      logs.push(payload)
    },
  })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error, ideaLookupMissError('ZZZZ'))
    assert.equal(result.error, 'No market data for ZZZZ')
    assert.equal(result.error.includes('yahoo'), false)
    assert.equal(result.error.includes('http'), false)
  }
  assert.equal(logs.length, 1)
  assert.deepEqual(logs[0], { ideaLookup: 'miss', symbol: 'ZZZZ', error: leak })

  const again = await getIdeaForSymbol('ZZZZ', {
    scoreTickers: async () => {
      calls += 1
      return { ideas: [], failed: [{ ticker: 'ZZZZ', reason: leak }], belowSma200Count: 0 }
    },
    log: (payload) => {
      logs.push(payload)
    },
  })
  assert.equal(calls, 1)
  assert.deepEqual(again, result)

  clearIdeaLookupCache()
  const thrown = await getIdeaForSymbol('BAD', {
    scoreTickers: async () => {
      calls += 1
      throw new Error(leak)
    },
    log: (payload) => {
      logs.push(payload)
    },
  })
  assert.equal(thrown.ok, false)
  if (!thrown.ok) {
    assert.equal(thrown.error, 'No market data for BAD')
  }
  const thrownAgain = await getIdeaForSymbol('BAD', {
    scoreTickers: async () => {
      calls += 1
      throw new Error(leak)
    },
    log: () => undefined,
  })
  assert.equal(calls, 2)
  assert.deepEqual(thrownAgain, thrown)
  clearIdeaLookupCache()
})

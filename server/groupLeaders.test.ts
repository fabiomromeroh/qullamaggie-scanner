import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GroupPeriod } from '../src/types/index.ts'
import { getGroupLeaders, type GroupLeadersDeps } from './groupLeaders.ts'
import {
  clearMemberQuoteCache,
  loadMemberQuote,
  type MemberQuote,
} from './groupPerformance.ts'
import type { MembershipSnapshot, SnapshotLoad } from './groupMembers.ts'

function snapshot(tickers: string[]): MembershipSnapshot {
  return {
    version: 1,
    source: 'finviz',
    sourceNote: 'unit sample',
    generatedAt: '2026-09-30T18:02:02.126Z',
    filters: { minPrice: 5, minAvgVolume: 750000 },
    groups: {
      oilgasrefiningmarketing: {
        name: 'Oil & Gas Refining & Marketing',
        tickers,
        companies: Object.fromEntries(tickers.map((ticker) => [ticker, `${ticker} Co`])),
        count: tickers.length,
      },
    },
  }
}

function quote(ticker: string, perf3m: number | null): MemberQuote {
  const perf: Record<GroupPeriod, number | null> = {
    '1d': 1,
    '1w': 2,
    '1m': 3,
    '3m': perf3m,
    '6m': 4,
  }
  return {
    ticker,
    name: `${ticker} Co`,
    price: 20,
    prevClose: 19,
    changePct: perf['1d'],
    perf,
    relVolume: 1.1,
    avgVolume: 1_000_000,
  }
}

function installScreenerGuard(): { hits: () => number; restore: () => void } {
  let screenerHits = 0
  const original = globalThis.fetch
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    if (url.includes('finviz.com/screener')) {
      screenerHits += 1
      throw new Error(`screener request blocked in test: ${url}`)
    }
    return original(input, init)
  }) as typeof fetch
  return {
    hits: () => screenerHits,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

test('default leaders path does not call the Finviz screener', async () => {
  const previous = process.env.FINVIZ_SCREENER_LIVE
  delete process.env.FINVIZ_SCREENER_LIVE
  clearMemberQuoteCache()
  const guard = installScreenerGuard()
  let quoteCalls = 0
  try {
    const body = await getGroupLeaders(['oilgasrefiningmarketing'], '3m', {
      loadSnapshot: () => ({ ok: true, snapshot: snapshot(['AAA', 'BBB', 'CCC']) }),
      scanTickers: new Set(['AAA']),
      fetchQuote: async (symbol) => {
        quoteCalls += 1
        const perf = symbol === 'CCC' ? null : symbol === 'AAA' ? 12 : 4
        return quote(symbol, perf)
      },
      fetchScreenerPage: async () => {
        throw new Error('live screener must not run')
      },
    })
    assert.equal(guard.hits(), 0)
    assert.equal(quoteCalls, 3)
    const entry = body.groups[0]!
    assert.equal(entry.pending, false)
    assert.equal(entry.error, undefined)
    assert.equal(entry.membership?.source, 'snapshot')
    assert.equal(entry.memberCount, 3)
    assert.equal(entry.inScanCount, 1)
    assert.equal(entry.parsedCount, 2)
    assert.deepEqual(
      entry.top5.map((row) => row.ticker),
      ['AAA', 'BBB', 'CCC'],
    )

    const again = await getGroupLeaders(['oilgasrefiningmarketing'], '1w', {
      loadSnapshot: () => ({ ok: true, snapshot: snapshot(['AAA', 'BBB', 'CCC']) }),
      scanTickers: new Set(['AAA']),
      fetchQuote: async () => {
        quoteCalls += 1
        throw new Error('period change must reuse the quote cache')
      },
    })
    assert.equal(quoteCalls, 3)
    assert.equal(guard.hits(), 0)
    assert.equal(again.groups[0]?.top5[0]?.perf, 2)
  } finally {
    guard.restore()
    if (previous === undefined) delete process.env.FINVIZ_SCREENER_LIVE
    else process.env.FINVIZ_SCREENER_LIVE = previous
    clearMemberQuoteCache()
  }
})

test('a symbol cap leaves the group pending until a later call finishes it', async () => {
  clearMemberQuoteCache()
  const deps: GroupLeadersDeps = {
    maxSymbols: 2,
    budgetMs: 8_000,
    concurrency: 1,
    gapMs: 0,
    loadSnapshot: (): SnapshotLoad => ({ ok: true, snapshot: snapshot(['AAA', 'BBB', 'CCC']) }),
    scanTickers: new Set<string>(),
    liveEnabled: false,
    fetchQuote: async (symbol: string) => quote(symbol, 5),
  }
  const first = await getGroupLeaders(['oilgasrefiningmarketing'], '3m', deps)
  assert.equal(first.groups[0]?.pending, true)
  assert.deepEqual(first.groups[0]?.leaders, [])
  const second = await getGroupLeaders(['oilgasrefiningmarketing'], '3m', deps)
  assert.equal(second.groups[0]?.pending, false)
  assert.equal(second.groups[0]?.parsedCount, 3)
  clearMemberQuoteCache()
})

test('the time budget stops after the clock is spent', async () => {
  clearMemberQuoteCache()
  let clock = 0
  let calls = 0
  const body = await getGroupLeaders(['oilgasrefiningmarketing'], '3m', {
    now: () => clock,
    budgetMs: 8_000,
    maxSymbols: 40,
    concurrency: 1,
    gapMs: 0,
    liveEnabled: false,
    loadSnapshot: () => ({ ok: true, snapshot: snapshot(['AAA', 'BBB', 'CCC']) }),
    scanTickers: new Set<string>(),
    fetchQuote: async (symbol) => {
      calls += 1
      clock = 8_000
      return quote(symbol, 3)
    },
  })
  assert.equal(calls, 1)
  assert.equal(body.groups[0]?.pending, true)
  clearMemberQuoteCache()
})

test('a live screener failure falls back to the snapshot', async () => {
  clearMemberQuoteCache()
  const guard = installScreenerGuard()
  try {
    const body = await getGroupLeaders(['oilgasrefiningmarketing'], '3m', {
      liveEnabled: true,
      loadSnapshot: () => ({ ok: true, snapshot: snapshot(['AAA']) }),
      scanTickers: new Set(['AAA']),
      fetchQuote: async (symbol) => quote(symbol, 8),
      fetchScreenerPage: async () => {
        throw new Error('Finviz screener blocked (HTTP 403)')
      },
    })
    assert.equal(guard.hits(), 0)
    assert.equal(body.groups[0]?.error, undefined)
    assert.equal(body.groups[0]?.membership?.source, 'snapshot')
    assert.equal(body.groups[0]?.top5[0]?.ticker, 'AAA')
    assert.equal(body.groups[0]?.inScanCount, 1)
    assert.equal(body.groups[0]?.parsedCount, 1)
  } finally {
    guard.restore()
    clearMemberQuoteCache()
  }
})

test('missing snapshot and unknown slug are honest errors', async () => {
  clearMemberQuoteCache()
  const missing = await getGroupLeaders(['oilgasrefiningmarketing'], '3m', {
    liveEnabled: false,
    loadSnapshot: () => ({
      ok: false,
      error: 'Membership snapshot missing; run npm run build:groups',
    }),
    fetchQuote: async () => {
      throw new Error('must not fetch')
    },
  })
  assert.equal(missing.groups[0]?.error, 'Membership snapshot missing; run npm run build:groups')

  const unknown = await getGroupLeaders(['notagroup'], '1d', {
    liveEnabled: false,
    loadSnapshot: () => ({ ok: true, snapshot: snapshot(['AAA']) }),
    fetchQuote: async () => quote('AAA', 1),
  })
  assert.equal(unknown.groups[0]?.error, 'not in membership snapshot; run npm run build:groups')
  clearMemberQuoteCache()
})

test('in-flight quote loads share one provider call', async () => {
  clearMemberQuoteCache()
  let calls = 0
  const pending = loadMemberQuote('ZZZ', async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 20))
    return quote('ZZZ', 9)
  })
  const second = loadMemberQuote('ZZZ', async () => {
    calls += 1
    return quote('ZZZ', 9)
  })
  const [firstQuote, secondQuote] = await Promise.all([pending, second])
  assert.equal(calls, 1)
  assert.equal(firstQuote?.perf['3m'], 9)
  assert.equal(secondQuote?.perf['3m'], 9)
  clearMemberQuoteCache()
})

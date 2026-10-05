import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IndustryGroup } from '../src/types/index.ts'
import { loadMembershipSnapshot, type MembershipSnapshot } from './groupMembers.ts'
import {
  LEADING_GROUPS_COUNT,
  LEADING_SCAN_SUPPLEMENT_TICKERS,
  capUniverse,
  supplementScanEnabled,
  universeFromGroups,
} from './leadingGroupsUniverse.ts'

function group(
  slug: string,
  name: string,
  perf3m: number,
  perf1m = 0,
): IndustryGroup {
  return {
    id: slug,
    slug,
    name,
    rsRank: 0,
    perf3m,
    perf1m,
    description: name,
    source: 'finviz',
  }
}

function snapshot(
  groups: Record<string, { name: string; tickers: string[]; companies?: Record<string, string> }>,
): MembershipSnapshot {
  const mapped: MembershipSnapshot['groups'] = {}
  for (const [slug, groupRow] of Object.entries(groups)) {
    mapped[slug] = {
      name: groupRow.name,
      tickers: groupRow.tickers,
      companies: groupRow.companies,
      count: groupRow.tickers.length,
    }
  }
  return {
    version: 1,
    source: 'finviz',
    sourceNote: 'test',
    generatedAt: '2026-09-30T18:02:02.126Z',
    filters: { minPrice: 5, minAvgVolume: 750000 },
    groups: mapped,
  }
}

test('supplement env 0 disables and anything else stays on', () => {
  assert.equal(LEADING_GROUPS_COUNT, 12)
  assert.equal(supplementScanEnabled(undefined), true)
  assert.equal(supplementScanEnabled(''), true)
  assert.equal(supplementScanEnabled('1'), true)
  assert.equal(supplementScanEnabled('0'), false)
  assert.equal(supplementScanEnabled(' 0 '), false)
  assert.ok(LEADING_SCAN_SUPPLEMENT_TICKERS.includes('NVDA'))
  assert.ok(LEADING_SCAN_SUPPLEMENT_TICKERS.includes('AMD'))
})

test('top groups by 3m union the supplement, deduped, with top-12 group names', () => {
  const groups = [
    group('oil', 'Oil & Gas', 40, 1),
    group('software', 'Software', 5, 20),
    group('gold', 'Gold', 30, 1),
  ]
  const file = snapshot({
    oil: { name: 'Oil & Gas', tickers: ['XOM', 'CVX', 'NVDA'], companies: { NVDA: 'NVIDIA' } },
    software: { name: 'Software', tickers: ['NVDA', 'CRWD'], companies: { NVDA: 'NVIDIA Corp' } },
    gold: { name: 'Gold', tickers: ['NEM'] },
    retail: { name: 'Retail', tickers: ['AAPL', 'COST'], companies: { AAPL: 'Apple' } },
  })
  const built = universeFromGroups({ source: 'finviz', groups }, file, {
    count: 2,
    supplementTickers: ['AAPL', 'MSFT', 'NVDA', 'COST'],
  })
  assert.equal(built.ok, true)
  if (!built.ok) return
  assert.deepEqual(
    built.hits.map((hit) => hit.symbol),
    ['XOM', 'CVX', 'NVDA', 'NEM', 'AAPL', 'COST'],
  )
  assert.equal(built.meta.symbolCount, 6)
  assert.equal(built.meta.supplementCount, 2)
  assert.equal(built.meta.snapshotGeneratedAt, '2026-09-30T18:02:02.126Z')
  assert.equal(built.meta.groups.length, 2)
  assert.equal(built.meta.groups[0]?.slug, 'oil')
  assert.equal(built.meta.groups[0]?.rank, 1)
  assert.equal(built.lookup('NVDA')?.groupId, 'oil')
  assert.equal(built.lookup('NVDA')?.groupName, 'Oil & Gas')
  assert.equal(built.lookup('AAPL')?.groupId, 'retail')
  assert.equal(built.lookup('AAPL')?.groupName, 'Retail')
  assert.equal(built.lookup('MSFT'), null)
  assert.equal(built.hits.find((hit) => hit.symbol === 'AAPL')?.shortName, 'Apple')

  const off = universeFromGroups({ source: 'finviz', groups }, file, {
    count: 2,
    supplementEnabled: false,
    supplementTickers: ['AAPL', 'COST'],
  })
  assert.equal(off.ok, true)
  if (!off.ok) return
  assert.deepEqual(
    off.hits.map((hit) => hit.symbol),
    ['XOM', 'CVX', 'NVDA', 'NEM'],
  )
  assert.equal(off.meta.supplementCount, 0)
  assert.equal(off.meta.supplementEnabled, false)
})

test('cap keeps leading members ahead of supplement-only names', () => {
  const items = [
    { symbol: 'SUP1' },
    { symbol: 'LEAD1' },
    { symbol: 'SUP2' },
    { symbol: 'LEAD2' },
  ]
  const leading = new Set(['LEAD1', 'LEAD2'])
  assert.deepEqual(
    capUniverse(items, 2, leading).map((item) => item.symbol),
    ['LEAD1', 'LEAD2'],
  )
  assert.deepEqual(
    capUniverse(items, 3, leading).map((item) => item.symbol),
    ['LEAD1', 'LEAD2', 'SUP1'],
  )
  assert.deepEqual(
    capUniverse(items, 10, leading).map((item) => item.symbol),
    ['SUP1', 'LEAD1', 'SUP2', 'LEAD2'],
  )
})

test('non-finviz groups and an empty union fail closed', () => {
  const file = snapshot({ oil: { name: 'Oil', tickers: ['XOM'] } })
  const fallback = universeFromGroups(
    { source: 'fallback', groups: [group('oil', 'Oil', 10)] },
    file,
  )
  assert.equal(fallback.ok, false)
  const empty = universeFromGroups(
    { source: 'finviz', groups: [group('missing', 'Missing', 10)] },
    file,
    { count: 1, supplementEnabled: false },
  )
  assert.equal(empty.ok, false)
  if (!empty.ok) assert.match(empty.error, /empty/)
})

test('committed snapshot supplies NVDA and AMD only through the supplement when their groups are not leading', () => {
  const loaded = loadMembershipSnapshot()
  assert.equal(loaded.ok, true)
  if (!loaded.ok) return
  const present = new Set<string>()
  for (const row of Object.values(loaded.snapshot.groups)) {
    for (const ticker of row.tickers) present.add(ticker.toUpperCase())
  }
  assert.equal(present.has('NVDA'), true)
  assert.equal(present.has('AMD'), true)
  assert.equal(loaded.snapshot.generatedAt.startsWith('2026-09-30'), true)

  const built = universeFromGroups(
    {
      source: 'finviz',
      groups: [group('not-a-real-slug', 'Nope', 99)],
    },
    loaded.snapshot,
    { count: 1, supplementEnabled: true },
  )
  assert.equal(built.ok, true)
  if (!built.ok) return
  const symbols = new Set(built.hits.map((hit) => hit.symbol))
  assert.equal(symbols.has('NVDA'), true)
  assert.equal(symbols.has('AMD'), true)
  assert.equal(built.lookup('NVDA')?.groupId === 'not-a-real-slug', false)
  assert.ok(built.lookup('NVDA')?.groupName)
  assert.equal(built.meta.supplementCount, built.hits.length)
  assert.ok(built.meta.supplementCount <= LEADING_SCAN_SUPPLEMENT_TICKERS.length)

  const off = universeFromGroups(
    { source: 'finviz', groups: [group('not-a-real-slug', 'Nope', 99)] },
    loaded.snapshot,
    { count: 1, supplementEnabled: false },
  )
  assert.equal(off.ok, false)
})

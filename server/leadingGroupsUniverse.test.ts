import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IndustryGroup } from '../src/types/index.ts'
import { DEFAULT_GROUP_PERIOD } from '../src/lib/groupPeriod.ts'
import { loadMembershipSnapshot, type MembershipSnapshot } from './groupMembers.ts'
import {
  LEADING_GROUPS_COUNT,
  LEADING_GROUPS_PERIOD,
  capUniverse,
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

const fixtureGroups = [
  group('oil', 'Oil & Gas', 40, 1),
  group('software', 'Software', 5, 20),
  group('gold', 'Gold', 30, 2),
]

const fixtureSnapshot = snapshot({
  oil: { name: 'Oil & Gas', tickers: ['XOM', 'CVX', 'NVDA'], companies: { NVDA: 'NVIDIA' } },
  software: { name: 'Software', tickers: ['NVDA', 'CRWD'], companies: { NVDA: 'NVIDIA Corp' } },
  gold: { name: 'Gold', tickers: ['NEM'] },
  retail: { name: 'Retail', tickers: ['AAPL', 'COST'], companies: { AAPL: 'Apple' } },
})

test('default period is 1m and count is 12', () => {
  assert.equal(LEADING_GROUPS_COUNT, 12)
  assert.equal(LEADING_GROUPS_PERIOD, '1m')
  assert.equal(DEFAULT_GROUP_PERIOD, '1m')
})

test('top groups for the default period are snapshot members only', () => {
  const built = universeFromGroups(
    { source: 'finviz', groups: fixtureGroups },
    fixtureSnapshot,
    { count: 2 },
  )
  assert.equal(built.ok, true)
  if (!built.ok) return
  assert.equal(built.meta.period, '1m')
  assert.deepEqual(
    built.hits.map((hit) => hit.symbol),
    ['NVDA', 'CRWD', 'NEM'],
  )
  assert.deepEqual(
    built.meta.groups.map((row) => row.slug),
    ['software', 'gold'],
  )
  assert.equal(built.meta.symbolCount, 3)
  assert.equal(built.meta.snapshotGeneratedAt, '2026-09-30T18:02:02.126Z')
  assert.equal(built.lookup('NVDA')?.groupId, 'software')
  assert.equal(built.lookup('NVDA')?.groupName, 'Software')
  assert.equal(built.lookup('CRWD')?.groupName, 'Software')
  assert.equal(built.hits.some((hit) => hit.symbol === 'AAPL'), false)
  assert.equal(built.lookup('MSFT'), null)
})

test('universe follows 1m vs 3m ranking of the same groups', () => {
  const oneMonth = universeFromGroups(
    { source: 'finviz', groups: fixtureGroups },
    fixtureSnapshot,
    { count: 2, period: '1m' },
  )
  const threeMonth = universeFromGroups(
    { source: 'finviz', groups: fixtureGroups },
    fixtureSnapshot,
    { count: 2, period: '3m' },
  )
  assert.equal(oneMonth.ok, true)
  assert.equal(threeMonth.ok, true)
  if (!oneMonth.ok || !threeMonth.ok) return

  assert.equal(oneMonth.meta.period, '1m')
  assert.deepEqual(
    oneMonth.meta.groups.map((row) => row.slug),
    ['software', 'gold'],
  )
  assert.deepEqual(
    oneMonth.hits.map((hit) => hit.symbol),
    ['NVDA', 'CRWD', 'NEM'],
  )

  assert.equal(threeMonth.meta.period, '3m')
  assert.deepEqual(
    threeMonth.meta.groups.map((row) => row.slug),
    ['oil', 'gold'],
  )
  assert.deepEqual(
    threeMonth.hits.map((hit) => hit.symbol),
    ['XOM', 'CVX', 'NVDA', 'NEM'],
  )
  assert.equal(threeMonth.lookup('NVDA')?.groupId, 'oil')
  assert.equal(threeMonth.lookup('NVDA')?.groupName, 'Oil & Gas')
  assert.equal(oneMonth.lookup('NVDA')?.groupId, 'software')
})

test('cap truncates group-rank order', () => {
  const items = [{ symbol: 'A' }, { symbol: 'B' }, { symbol: 'C' }]
  assert.deepEqual(
    capUniverse(items, 2).map((item) => item.symbol),
    ['A', 'B'],
  )
  assert.deepEqual(
    capUniverse(items, 10).map((item) => item.symbol),
    ['A', 'B', 'C'],
  )
})

test('non-finviz groups and an empty universe fail closed', () => {
  const file = snapshot({ oil: { name: 'Oil', tickers: ['XOM'] } })
  const fallback = universeFromGroups(
    { source: 'fallback', groups: [group('oil', 'Oil', 10)] },
    file,
  )
  assert.equal(fallback.ok, false)
  const empty = universeFromGroups(
    { source: 'finviz', groups: [group('missing', 'Missing', 10)] },
    file,
    { count: 1 },
  )
  assert.equal(empty.ok, false)
  if (!empty.ok) assert.match(empty.error, /empty/)
})

test('NVDA and AMD appear only when their snapshot group is in the top 12', () => {
  const loaded = loadMembershipSnapshot()
  assert.equal(loaded.ok, true)
  if (!loaded.ok) return
  const present = new Set<string>()
  for (const row of Object.values(loaded.snapshot.groups)) {
    for (const ticker of row.tickers) present.add(ticker.toUpperCase())
  }
  assert.equal(present.has('NVDA'), true)
  assert.equal(present.has('AMD'), true)
  assert.equal(loaded.snapshot.groups.semiconductors != null, true)
  assert.equal(loaded.snapshot.generatedAt.startsWith('2026-09-30'), true)

  const otherSlug = Object.keys(loaded.snapshot.groups).find((slug) => slug !== 'semiconductors')
  assert.ok(otherSlug)
  const other = loaded.snapshot.groups[otherSlug!]!

  const off = universeFromGroups(
    {
      source: 'finviz',
      groups: [group(otherSlug!, other.name, 99, 99)],
    },
    loaded.snapshot,
    { count: 1, period: '1m' },
  )
  assert.equal(off.ok, true)
  if (!off.ok) return
  const offSymbols = new Set(off.hits.map((hit) => hit.symbol))
  assert.equal(offSymbols.has('NVDA'), false)
  assert.equal(offSymbols.has('AMD'), false)
  assert.equal(off.lookup('NVDA')?.groupId === otherSlug, false)

  const on = universeFromGroups(
    {
      source: 'finviz',
      groups: [group('semiconductors', 'Semiconductors', 1, 50)],
    },
    loaded.snapshot,
    { count: 1, period: '1m' },
  )
  assert.equal(on.ok, true)
  if (!on.ok) return
  const onSymbols = new Set(on.hits.map((hit) => hit.symbol))
  assert.equal(onSymbols.has('NVDA'), true)
  assert.equal(onSymbols.has('AMD'), true)
  assert.equal(on.lookup('NVDA')?.groupId, 'semiconductors')
  assert.equal(on.meta.period, '1m')
})

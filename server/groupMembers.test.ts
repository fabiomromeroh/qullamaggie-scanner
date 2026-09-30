import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FinvizScreenerBlocked, screenerRowsFromHtml } from './groupMembersBuild.ts'
import {
  buildMembershipScreenerUrl,
  collectGroupMembers,
  formatMembershipSnapshot,
  isMembershipStale,
  loadMembershipSnapshot,
  lookupMembershipGroup,
  validateMembershipSnapshot,
  withRetries,
  MEMBERSHIP_STALE_MS,
  type MembershipSnapshot,
} from './groupMembers.ts'

function sampleSnapshot(): MembershipSnapshot {
  return {
    version: 1,
    source: 'finviz',
    sourceNote: 'unit sample',
    generatedAt: '2026-09-30T18:02:02.126Z',
    filters: { minPrice: 5, minAvgVolume: 750000 },
    groups: {
      oilgasrefiningmarketing: {
        name: 'Oil & Gas Refining & Marketing',
        tickers: ['MPC', 'VLO'],
        companies: { MPC: 'Marathon Petroleum', VLO: 'Valero' },
        count: 2,
      },
    },
  }
}

test('snapshot validation round-trips and rejects a bad count', () => {
  const snapshot = sampleSnapshot()
  const loaded = validateMembershipSnapshot(JSON.parse(formatMembershipSnapshot(snapshot)))
  assert.equal(loaded.ok, true)
  if (!loaded.ok) return
  assert.equal(lookupMembershipGroup(loaded.snapshot, 'OILGASREFININGMARKETING')?.count, 2)
  assert.equal(lookupMembershipGroup(loaded.snapshot, 'missing'), null)

  const broken = structuredClone(snapshot) as MembershipSnapshot
  broken.groups.oilgasrefiningmarketing!.count = 9
  const rejected = validateMembershipSnapshot(broken)
  assert.equal(rejected.ok, false)
  if (!rejected.ok) {
    assert.equal(rejected.error, 'Membership snapshot invalid; run npm run build:groups')
  }
})

test('staleness is strict after 14 days', () => {
  const generatedAt = new Date(1_700_000_000_000).toISOString()
  const at = Date.parse(generatedAt)
  assert.equal(isMembershipStale(generatedAt, at + MEMBERSHIP_STALE_MS), false)
  assert.equal(isMembershipStale(generatedAt, at + MEMBERSHIP_STALE_MS + 1), true)
  assert.equal(isMembershipStale('not-a-date', at), true)
})

test('collectGroupMembers dedupes and stops on a short page', async () => {
  const offsets: number[] = []
  const collected = await collectGroupMembers(async (offset) => {
    offsets.push(offset)
    if (offset === 1) {
      return [
        { ticker: 'aaa', company: 'Alpha' },
        { ticker: 'AAA', company: 'Alpha again' },
        ...Array.from({ length: 18 }, (_, index) => ({
          ticker: `N${index}`,
          company: `Co ${index}`,
        })),
      ]
    }
    if (offset === 21) return [{ ticker: 'CCC', company: '' }]
    throw new Error(`unexpected offset ${offset}`)
  })
  assert.deepEqual(offsets, [1, 21])
  assert.deepEqual(collected.tickers[0], 'AAA')
  assert.equal(collected.tickers.filter((ticker) => ticker === 'AAA').length, 1)
  assert.equal(collected.tickers.at(-1), 'CCC')
  assert.equal(collected.tickers.length, 20)
  assert.equal(collected.companies.AAA, 'Alpha')
  assert.equal(collected.companies.CCC, undefined)
  assert.equal(collected.truncated, false)
})

test('collectGroupMembers marks a full final page as truncated', async () => {
  const collected = await collectGroupMembers(
    async (offset) => [
      { ticker: `T${offset}A`, company: 'A' },
      { ticker: `T${offset}B`, company: 'B' },
    ],
    { maxPages: 2, pageSize: 2 },
  )
  assert.equal(collected.truncated, true)
  assert.equal(collected.tickers.length, 4)
})

test('withRetries returns after two failures', async () => {
  let calls = 0
  const slept: number[] = []
  const value = await withRetries(
    async () => {
      calls += 1
      if (calls < 3) throw new Error(`fail ${calls}`)
      return 'ok'
    },
    {
      attempts: 3,
      backoffMs: (failed) => 500 * 2 ** failed,
      sleep: async (ms) => {
        slept.push(ms)
      },
    },
  )
  assert.equal(value, 'ok')
  assert.deepEqual(slept, [500, 1000])
})

test('membership screener url uses the performance view and liquidity filters', () => {
  const url = buildMembershipScreenerUrl('oilgasrefiningmarketing', 21, 5, 750_000)
  assert.match(url, /finviz\.com\/screener\.ashx/)
  assert.match(url, /v=141/)
  assert.match(url, /r=21/)
  assert.match(url, /sh_price_o5/)
  assert.match(url, /sh_avgvol_o750/)
  assert.match(url, /ind_oilgasrefiningmarketing/)
})

test('an empty Finviz screen is zero members; a missing table still fails', () => {
  assert.deepEqual(screenerRowsFromHtml(200, '<html>"result_count":0</html>'), [])
  assert.throws(
    () => screenerRowsFromHtml(200, '<html>no table here</html>'),
    /screener table not found/,
  )
  assert.throws(
    () => screenerRowsFromHtml(403, '<html>denied</html>'),
    (err: unknown) => err instanceof FinvizScreenerBlocked,
  )
})

test('the built membership file loads', () => {
  const loaded = loadMembershipSnapshot()
  assert.equal(loaded.ok, true)
  if (!loaded.ok) return
  const oil = lookupMembershipGroup(loaded.snapshot, 'oilgasrefiningmarketing')
  assert.ok(oil)
  assert.equal(oil?.count, oil?.tickers.length)
  assert.ok(oil?.tickers.includes('MPC'))
  assert.ok(oil?.tickers.includes('VLO'))
  assert.equal(isMembershipStale(loaded.snapshot.generatedAt, Date.parse(loaded.snapshot.generatedAt)), false)
})

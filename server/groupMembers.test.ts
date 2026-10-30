import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { finvizLiquidityTokens } from '../src/lib/groupPeriod.ts'
import { SCAN_MIN_AVG_VOL_DEFAULT } from '../src/lib/scanDefaults.ts'
import {
  appliedFilters,
  FinvizScreenerBlocked,
  parseScreenerTickerLinks,
  screenerPageFromHtml,
  screenerRowsFromHtml,
} from './groupMembersBuild.ts'
import {
  buildMembershipScreenerUrl,
  collectGroupMembers,
  formatMembershipSnapshot,
  isMembershipStale,
  loadMembershipSnapshot,
  lookupMembershipGroup,
  validateMembershipSnapshot,
  withRetries,
  MEMBERSHIP_MIN_AVG_VOL,
  MEMBERSHIP_MIN_PRICE,
  MEMBERSHIP_SOURCE_NOTE,
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
  assert.match(url, /finviz\.com\/screener\/stocks\?/)
  assert.match(url, /v=141/)
  assert.match(url, /r=21/)
  assert.match(url, /sh_price_o5/)
  assert.match(url, /sh_avgvol_o750/)
  assert.match(url, /industry_oilgasrefiningmarketing/)
})

test('membership snapshot size floor is price > $1 and average volume > 50K', () => {
  assert.equal(MEMBERSHIP_MIN_PRICE, 1)
  assert.equal(MEMBERSHIP_MIN_AVG_VOL, 50_000)
  assert.equal(SCAN_MIN_AVG_VOL_DEFAULT, 100_000)
  const tokens = finvizLiquidityTokens(MEMBERSHIP_MIN_PRICE, MEMBERSHIP_MIN_AVG_VOL)
  assert.equal(tokens.mapped, true)
  assert.deepEqual(tokens, { price: 'sh_price_o1', avgVol: 'sh_avgvol_o50', mapped: true })
  assert.deepEqual(appliedFilters(), { minPrice: 1, minAvgVolume: 50_000 })
  const url = buildMembershipScreenerUrl('semiconductors', 1, MEMBERSHIP_MIN_PRICE, MEMBERSHIP_MIN_AVG_VOL)
  assert.match(url, /sh_price_o1/)
  assert.match(url, /sh_avgvol_o50/)
  assert.doesNotMatch(url, /sh_price_o5/)
  assert.doesNotMatch(url, /sh_avgvol_o750/)
  assert.match(MEMBERSHIP_SOURCE_NOTE, /sh_price_o1/)
  assert.match(MEMBERSHIP_SOURCE_NOTE, /sh_avgvol_o50/)
  assert.match(MEMBERSHIP_SOURCE_NOTE, /price > \$1/)
  assert.match(MEMBERSHIP_SOURCE_NOTE, /average volume > 50K/)
  assert.match(MEMBERSHIP_SOURCE_NOTE, /client-side UI toggles/)
  const build = readFileSync('scripts/buildGroupMembers.ts', 'utf8')
  assert.match(build, /MEMBERSHIP_MIN_AVG_VOL/)
  assert.match(build, /sh_price_o1/)
  assert.match(build, /sh_avgvol_o50/)
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

const V2 = readFileSync('server/fixtures/finviz-screener-v2-sample.html', 'utf8')

test('new Finviz screener: embedded JSON rows and totalCount', () => {
  const page = screenerPageFromHtml(200, V2)
  assert.equal(page.totalCount, 41)
  assert.deepEqual(page.rows.map((r) => r.ticker), ['ADI', 'ALAB', page.rows[2]!.ticker])
  assert.equal(page.rows[0]!.company, 'Analog Devices Inc')
})

test('new Finviz screener: falls back to ticker cells / quote links without the JSON', () => {
  const noJson = V2.replace(/<script[\s\S]*?<\/script>/, '')
  const page = screenerPageFromHtml(200, noJson)
  assert.equal(page.rows.length, 3)
  assert.equal(page.rows[0]!.ticker, 'ADI')
  assert.deepEqual(parseScreenerTickerLinks('<a href="/quote?t=NVDA">x</a><a href="/quote?t=NVDA">'), [{ ticker: 'NVDA', company: '' }])
})

test('new Finviz screener: empty, blocked, challenge, and unparseable pages', () => {
  assert.deepEqual(screenerPageFromHtml(200, '<html>{"rows":[],"totalCount":0}</html>'), { rows: [], totalCount: 0 })
  assert.throws(() => screenerPageFromHtml(429, ''), (err: unknown) => err instanceof FinvizScreenerBlocked)
  assert.throws(
    () => screenerPageFromHtml(200, '<html><title>Just a moment...</title></html>'),
    (err: unknown) => err instanceof FinvizScreenerBlocked,
  )
  assert.throws(() => screenerPageFromHtml(200, '<html>nothing</html>'), /parse failed/)
})

test('collectGroupMembers stops once totalCount is covered (no extra request)', async () => {
  const offsets: number[] = []
  const mk = (from: number) => Array.from({ length: 20 }, (_, i) => ({ ticker: `T${from + i}`, company: '' }))
  const got = await collectGroupMembers(async (offset) => {
    offsets.push(offset)
    return { rows: mk(offset), totalCount: 40 }
  })
  assert.deepEqual(offsets, [1, 21])
  assert.equal(got.tickers.length, 40)
  assert.equal(got.truncated, false)
  const capped = await collectGroupMembers(async (offset) => ({ rows: mk(offset), totalCount: 500 }), { maxPages: 2 })
  assert.equal(capped.truncated, true)
})

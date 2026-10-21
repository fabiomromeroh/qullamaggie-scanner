import assert from 'node:assert/strict'
import { test } from 'node:test'
import { finnhubToFundamentals } from '../src/lib/finnhubFundamentals.ts'

test('Finnhub fundamentals mapping: millions, metrics, next earnings, deduped EPS', () => {
  const f = finnhubToFundamentals(
    'NVDA',
    { name: 'NVIDIA Corp', country: 'US', finnhubIndustry: 'Semiconductors', marketCapitalization: 5216926.9, shareOutstanding: 24200, floatingShare: 23228.1, weburl: 'https://www.nvidia.com/' },
    { metric: { peTTM: 26.7, forwardPE: 17.0, revenueGrowthQuarterlyYoy: 105.85, epsGrowthQuarterlyYoy: 128.21, grossMarginTTM: 74.67, operatingMarginTTM: 65.17 } },
    [
      { period: '2026-09-30', actual: 2.22, estimate: 2.14 },
      { period: '2026-09-30', actual: 2.22, estimate: 2.14 },
      { period: '2026-06-30', actual: 1.8, estimate: 1.7 },
    ],
    { earningsCalendar: [{ date: '2027-02-23' }, { date: '2026-11-18' }, { date: '2026-08-20' }] },
    '2026-10-21T08:00:00Z',
  )
  assert.equal(f.source, 'finnhub')
  assert.equal(f.marketCap, 5216926.9e6)
  assert.equal(f.sharesOutstanding, 24200e6)
  assert.equal(f.industry, 'Semiconductors')
  assert.equal(f.sector, null)
  assert.equal(f.shortPctFloat, null)
  assert.equal(f.revenueGrowthYoyPct, 105.85)
  assert.equal(f.nextEarningsDate, '2026-11-18')
  assert.deepEqual(f.quarterlyEps.map((q) => q.period), ['2026-06-30', '2026-09-30'])
})

test('missing Finnhub data stays null', () => {
  const f = finnhubToFundamentals('X', {}, {}, null, null, '2026-10-21')
  assert.equal(f.name, null)
  assert.equal(f.marketCap, null)
  assert.equal(f.nextEarningsDate, null)
  assert.deepEqual(f.quarterlyEps, [])
})

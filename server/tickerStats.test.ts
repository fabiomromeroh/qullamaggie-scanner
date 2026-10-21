import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  adrPct,
  avgDollarVolume,
  buildTickerCikMap,
  filingUrl,
  isTrackedForm,
  parseRecentFilings,
} from '../src/lib/tickerStats.ts'

const bar = (h: number, l: number, c = 10, v = 100) => ({ t: 1, o: c, h, l, c, v })

test('ADR% is the mean of high/low − 1 over the window', () => {
  const bars = [bar(11, 10), bar(10.5, 10), ...Array.from({ length: 30 }, () => bar(10.4, 10))]
  assert.ok(Math.abs((adrPct(bars, 20) ?? 0) - 4) < 1e-9)
  assert.equal(adrPct([bar(11, 10)], 20), null)
})

test('average dollar volume uses close × volume', () => {
  assert.equal(avgDollarVolume([bar(1, 1, 10, 100), bar(1, 1, 20, 100)], 20), 1500)
  assert.equal(avgDollarVolume([], 20), null)
})

test('filings parser keeps tracked forms with archive links', () => {
  const submissions = {
    filings: {
      recent: {
        form: ['8-K', 'SC 13G/A', '424B2', '10-Q', '4', '10-K/A'],
        accessionNumber: ['0000320193-26-000001', 'a2', 'a3', '0000320193-26-000004', '0000320193-26-000005', 'a6'],
        filingDate: ['2026-10-01', '2026-09-30', '2026-09-29', '2026-08-01', '2026-07-01', '2026-06-01'],
        reportDate: ['', '', '', '2026-06-30', '', ''],
        primaryDocument: ['aapl-8k.htm', 'x.htm', 'y.htm', 'aapl-10q.htm', '', 'z.htm'],
        primaryDocDescription: ['8-K', '', '', '10-Q', '', ''],
      },
    },
  }
  const rows = parseRecentFilings(submissions, 320193)
  assert.deepEqual(rows.map((r) => r.form), ['8-K', 'SC 13G/A', '10-Q', '4', '10-K/A'])
  assert.equal(rows[0]!.url, 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-8k.htm')
  assert.equal(rows[3]!.url, 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000005/0000320193-26-000005-index.htm')
  assert.equal(rows[2]!.reportDate, '2026-06-30')
  assert.equal(parseRecentFilings({}, 1).length, 0)
  assert.equal(isTrackedForm('424B2'), false)
  assert.equal(filingUrl(1, '0000000001-26-000001'), 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/0000000001-26-000001-index.htm')
})

test('ticker → CIK map handles class-share dashes', () => {
  const map = buildTickerCikMap({ 0: { cik_str: 320193, ticker: 'AAPL' }, 1: { cik_str: 1067983, ticker: 'BRK-B' } })
  assert.equal(map.get('AAPL'), 320193)
  assert.equal(map.get('BRK.B'), 1067983)
  assert.equal(map.get('BRK-B'), 1067983)
})

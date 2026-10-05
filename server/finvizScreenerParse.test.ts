import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  countGroupLeaders,
  DEFAULT_GROUP_PERIOD,
  finvizLiquidityTokens,
  isGroupPeriod,
  isGroupSlug,
  parseGroupPeriod,
  parseSlugList,
  periodOrder,
  GROUP_PERIODS,
} from '../src/lib/groupPeriod.ts'
import {
  parseFinvizPercent,
  parseFinvizScreenerPerformance,
  parseFinvizVolume,
} from './finvizScreenerParse.ts'
import { buildFinvizScreenerUrl } from './finvizScreener.ts'

const fixturePath = resolve(process.cwd(), 'server/fixtures/finviz-screener-performance-sample.html')
const fixture = readFileSync(fixturePath, 'utf8')

test('maps performance-view columns from header text on the real sample', () => {
  const parsed = parseFinvizScreenerPerformance(fixture)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.rows.length, 3)
  assert.deepEqual(
    parsed.rows.map((row) => row.ticker),
    ['CVI', 'PBF', 'MPC'],
  )
  assert.deepEqual(
    parsed.rows.map((row) => row.company),
    ['CVR Energy Inc', 'PBF Energy Inc', 'Marathon Petroleum Corp'],
  )

  const cvi = parsed.rows[0]!
  assert.equal(cvi.perfWeek, 1)
  assert.equal(cvi.perfMonth, 24.98)
  assert.equal(cvi.perfQuart, 82.6)
  assert.equal(cvi.perfHalf, 55.47)
  assert.equal(cvi.perfYtd, 105.64)
  assert.equal(cvi.perfYear, 43.41)
  assert.equal(cvi.perf3y, 61.5)
  assert.equal(cvi.perf5y, 277.34)
  assert.equal(cvi.perf10y, 476.86)
  assert.equal(cvi.volatilityW, 5.12)
  assert.equal(cvi.volatilityM, 5.45)
  assert.equal(cvi.avgVolume, 1_030_000)
  assert.equal(cvi.relVolume, 0.68)
  assert.equal(cvi.price, 52.32)
  assert.equal(cvi.changePct, 3.45)
  assert.equal(cvi.volume, 285_552)

  const pbf = parsed.rows[1]!
  assert.equal(pbf.perfQuart, 64.06)
  assert.equal(pbf.avgVolume, 3_310_000)
  assert.equal(pbf.volume, 783_520)
  assert.equal(pbf.price, 78.82)
})

test('parses percents and volumes, and treats a dash as null', () => {
  assert.equal(parseFinvizPercent('12.14%'), 12.14)
  assert.equal(parseFinvizPercent('-3.2%'), -3.2)
  assert.equal(parseFinvizPercent('-'), null)
  assert.equal(parseFinvizPercent('—'), null)
  assert.equal(parseFinvizPercent('1,234.5%'), 1234.5)
  assert.equal(parseFinvizVolume('1.03M'), 1_030_000)
  assert.equal(parseFinvizVolume('750K'), 750_000)
  assert.equal(parseFinvizVolume('1.2B'), 1_200_000_000)
  assert.equal(parseFinvizVolume('285,552'), 285_552)
  assert.equal(parseFinvizVolume('-'), null)

  const html = screenerHtml(
    ['No.', 'Ticker', 'Perf Week', 'Perf Month', 'Perf Quart', 'Perf Half', 'Perf YTD', 'Perf Year', 'Perf 3Y', 'Perf 5Y', 'Perf 10Y', 'Volatility W', 'Volatility M', 'Avg Volume', 'Rel Volume', 'Price', 'Change %', 'Volume'],
    [
      ['1', tickerCell('DK', 'Delek US Holdings Inc'), '-', '2.5%', '10%', '3%', '4%', '5%', '6%', '7%', '8%', '1%', '1.2%', '-', '0.4', '20.5', '-1.5%', '-'],
    ],
  )
  const parsed = parseFinvizScreenerPerformance(html)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.rows[0]?.perfWeek, null)
  assert.equal(parsed.rows[0]?.avgVolume, null)
  assert.equal(parsed.rows[0]?.volume, null)
  assert.equal(parsed.rows[0]?.changePct, -1.5)
  assert.equal(parsed.rows[0]?.ticker, 'DK')
  assert.equal(parsed.rows[0]?.company, 'Delek US Holdings Inc')
})

test('reads ticker and company from data-boxover attributes, not the logo letter', () => {
  const parsed = parseFinvizScreenerPerformance(fixture)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.rows[0]?.ticker, 'CVI')
  assert.notEqual(parsed.rows[0]?.ticker, 'CCVI')
  assert.equal(parsed.rows[2]?.company, 'Marathon Petroleum Corp')
})

test('a challenge page is a parse failure', () => {
  const html = '<html><head><title>Just a moment...</title></head><body>cf-browser-verification</body></html>'
  const parsed = parseFinvizScreenerPerformance(html)
  assert.equal(parsed.ok, false)
  if (parsed.ok) return
  assert.equal(parsed.reason, 'blocked')
})

test('missing expected headers is a parse failure and does not guess columns', () => {
  const html = screenerHtml(
    ['No.', 'Ticker', 'Price'],
    [['1', tickerCell('XOM', 'Exxon Mobil Corp'), '100']],
  )
  const parsed = parseFinvizScreenerPerformance(html)
  assert.equal(parsed.ok, false)
  if (parsed.ok) return
  assert.match(parsed.reason, /missing headers: .*Perf Week/)
})

test('a shifted header still maps Price and Change by name', () => {
  const headers = [
    'No.',
    'Ticker',
    'Price',
    'Change %',
    'Perf Week',
    'Perf Month',
    'Perf Quart',
    'Perf Half',
    'Perf YTD',
    'Perf Year',
    'Perf 3Y',
    'Perf 5Y',
    'Perf 10Y',
    'Volatility W',
    'Volatility M',
    'Avg Volume',
    'Rel Volume',
    'Volume',
  ]
  const html = screenerHtml(headers, [
    ['1', tickerCell('VLO', 'Valero Energy Corp'), '180.25', '1.10%', '4%', '5%', '30%', '20%', '10%', '9%', '8%', '7%', '6%', '2%', '2.2%', '1.5M', '1.1', '900K'],
  ])
  const parsed = parseFinvizScreenerPerformance(html)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.rows[0]?.ticker, 'VLO')
  assert.equal(parsed.rows[0]?.company, 'Valero Energy Corp')
  assert.equal(parsed.rows[0]?.price, 180.25)
  assert.equal(parsed.rows[0]?.changePct, 1.1)
  assert.equal(parsed.rows[0]?.perfWeek, 4)
  assert.equal(parsed.rows[0]?.avgVolume, 1_500_000)
  assert.equal(parsed.rows[0]?.volume, 900_000)
})

test('a non-numeric cell is a parse failure', () => {
  const headers = [
    'No.', 'Ticker', 'Perf Week', 'Perf Month', 'Perf Quart', 'Perf Half', 'Perf YTD', 'Perf Year',
    'Perf 3Y', 'Perf 5Y', 'Perf 10Y', 'Volatility W', 'Volatility M', 'Avg Volume', 'Rel Volume', 'Price', 'Change %', 'Volume',
  ]
  const html = screenerHtml(headers, [
    ['1', tickerCell('VLO', 'Valero Energy Corp'), 'n/a', '1%', '1%', '1%', '1%', '1%', '1%', '1%', '1%', '1%', '1%', '1M', '1', '10', '1%', '1M'],
  ])
  const parsed = parseFinvizScreenerPerformance(html)
  assert.equal(parsed.ok, false)
  if (parsed.ok) return
  assert.match(parsed.reason, /perfWeek/)
})

test('period order, slug validation, liquidity tokens, and leader count', () => {
  assert.equal(periodOrder('1d'), '-change')
  assert.equal(periodOrder('1w'), '-perf1w')
  assert.equal(periodOrder('1m'), '-perf4w')
  assert.equal(periodOrder('3m'), '-perf13w')
  assert.equal(periodOrder('6m'), '-perf26w')
  assert.equal(GROUP_PERIODS['3m'].label, '3M')
  assert.equal(DEFAULT_GROUP_PERIOD, '1m')
  assert.equal(GROUP_PERIODS[DEFAULT_GROUP_PERIOD].label, '1M')
  assert.equal(isGroupPeriod('3m'), true)
  assert.equal(isGroupPeriod('1y'), false)
  assert.equal(parseGroupPeriod('1M'), '1m')
  assert.equal(parseGroupPeriod(' 3m '), '3m')
  assert.equal(parseGroupPeriod('1y'), null)
  assert.equal(parseGroupPeriod(null), null)
  assert.equal(isGroupSlug('oilgasrefiningmarketing'), true)
  assert.equal(isGroupSlug('OilGas'), false)
  assert.equal(isGroupSlug('bad-slug'), false)
  assert.equal(isGroupSlug(''), false)

  const ok = parseSlugList('oilgasrefiningmarketing, uranium,oilgasrefiningmarketing')
  assert.equal(ok.ok, true)
  if (ok.ok) assert.deepEqual(ok.slugs, ['oilgasrefiningmarketing', 'uranium'])

  const tooMany = parseSlugList(Array.from({ length: 13 }, (_, i) => `g${i}`).join(','))
  assert.equal(tooMany.ok, false)

  const bad = parseSlugList('oil&gas')
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.error, /invalid slug/)

  const empty = parseSlugList('  ')
  assert.equal(empty.ok, false)

  const tokens = finvizLiquidityTokens(5, 750_000)
  assert.deepEqual(tokens, { price: 'sh_price_o5', avgVol: 'sh_avgvol_o750', mapped: true })
  const fallback = finvizLiquidityTokens(6, 750_000)
  assert.equal(fallback.mapped, false)
  assert.equal(fallback.price, 'sh_price_o5')
  assert.equal(fallback.avgVol, 'sh_avgvol_o750')

  const url = new URL(buildFinvizScreenerUrl('oilgasrefiningmarketing', '-perf13w'))
  assert.equal(url.pathname, '/screener.ashx')
  assert.equal(url.searchParams.get('v'), '141')
  assert.equal(url.searchParams.get('o'), '-perf13w')
  assert.equal(
    url.searchParams.get('f'),
    'ind_oilgasrefiningmarketing,sh_price_o5,sh_avgvol_o750',
  )

  const rows = [
    { ticker: 'aaa', perf: 10 },
    { ticker: 'BBB', perf: -1 },
    { ticker: 'CCC', perf: 0 },
    { ticker: 'DDD', perf: null },
    { ticker: 'EEE', perf: 4 },
  ]
  const counted = countGroupLeaders(rows, new Set(['AAA', 'BBB', 'CCC', 'DDD']))
  assert.equal(counted.parsedCount, 5)
  assert.equal(counted.inScanCount, 1)
  assert.deepEqual(counted.leaderTickers, ['AAA'])

  const unknown = countGroupLeaders(rows, null)
  assert.equal(unknown.inScanCount, null)
  assert.equal(unknown.parsedCount, 5)
  assert.deepEqual(unknown.leaderTickers, [])
})

function tickerCell(ticker: string, company: string): string {
  return `<td data-boxover-ticker="${ticker}" data-boxover-company="${company}"><a class="tab-link">${ticker}</a></td>`
}

function screenerHtml(headers: string[], rows: string[][]): string {
  const th = headers
    .map((header) => `<th class="table-header">${header}</th>`)
    .join('')
  const body = rows
    .map((cells) => {
      const tds = cells
        .map((cell) => (cell.startsWith('<td') ? cell : `<td>${cell}</td>`))
        .join('')
      return `<tr class="styled-row">${tds}</tr>`
    })
    .join('')
  return `<table class="styled-table-new is-rounded screener_table"><thead><tr>${th}</tr></thead>${body}</table>`
}

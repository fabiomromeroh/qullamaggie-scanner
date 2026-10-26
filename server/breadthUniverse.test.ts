import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBreadthUniverse, parseNasdaqTraderList } from './breadthUniverse.ts'

const NASDAQ = `Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
QQQ|Invesco QQQ Trust, Series 1|G|N|N|100|Y|N
ZXZZT|NASDAQ TEST STOCK|G|Y|N|100|N|N
ABCDW|Abcd Corp - Warrant|G|N|N|100|N|N
BRGT|Bright Horizons Common Stock|Q|N|N|100|N|N
File Creation Time: 1026202608:00|||||||`
const OTHER = `ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
BRK.B|Berkshire Hathaway Inc. Class B|N|BRK.B|N|100|N|BRK=B
JPM$D|JPMorgan Depositary Shares Preferred|N|JPMpD|N|100|N|JPM-D
SPY|SPDR S&P 500|P|SPY|Y|100|N|SPY
XYZU|XYZ Acquisition Units|N|XYZU|N|100|N|XYZU
F|Ford Motor Company Common Stock|N|F|N|100|N|F
File Creation Time: 1026202608:00|||||||`

test('Nasdaq Trader lists → common stocks only, Yahoo symbols', () => {
  assert.deepEqual(parseNasdaqTraderList(NASDAQ), ['AAPL', 'BRGT'])
  assert.deepEqual(parseNasdaqTraderList(OTHER), ['BRK-B', 'F'])
  assert.deepEqual(parseNasdaqTraderList('garbage'), [])
})

test('universe falls back to the Finviz snapshot when the lists cannot be fetched', async () => {
  process.env.BREADTH_UNIVERSE_PATH = join(mkdtempSync(join(tmpdir(), 'bu-')), 'u.json')
  const failing = (async () => {
    throw new Error('offline')
  }) as unknown as typeof fetch
  const r = await loadBreadthUniverse(() => ['NVDA'], { fetchImpl: failing })
  assert.equal(r.source, 'finviz-snapshot')
  assert.deepEqual(r.tickers, ['NVDA'])
  assert.match(r.error ?? '', /offline/)
  const many = Array.from({ length: 1200 }, (_, i) => `${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i % 26]}${String.fromCharCode(65 + Math.floor(i / 26) % 26)}${String.fromCharCode(65 + Math.floor(i / 676))}|X Common Stock|Q|N|N|100|N|N`)
  const ok = (async (url: string) =>
    new Response(String(url).includes('nasdaqlisted') ? `Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\n${many.join('\n')}` : OTHER)) as unknown as typeof fetch
  const fresh = await loadBreadthUniverse(() => [], { fetchImpl: ok })
  assert.equal(fresh.source, 'nasdaqtrader')
  assert.ok(fresh.tickers.includes('F'))
  const again = await loadBreadthUniverse(() => [], { fetchImpl: failing })
  assert.equal(again.source, 'nasdaqtrader-cache')
  delete process.env.BREADTH_UNIVERSE_PATH
})

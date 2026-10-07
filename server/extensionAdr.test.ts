import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  EXTENSION_ADR50_FORMULA,
  EXTENSION_ADR50_FORMULA_EQUIV,
  extensionAdrFrom50,
  formatExtensionAdr50,
  roundExtensionAdr50,
} from '../src/lib/extensionAdr.ts'
import { adrPctFromBars, computeIdeaMetrics, smaClose, SMA_PERIODS, type DailyBar } from '../src/lib/metrics.ts'
import { SCAN_CACHE_SCHEMA } from './scanCache.ts'

test('extensionAdrFrom50 canonical formula and realistic numbers', () => {
  assert.equal(extensionAdrFrom50(100, 90, 5), 2)
  assert.equal(extensionAdrFrom50(100, 100, 5), 0)
  assert.equal(extensionAdrFrom50(100, 110, 5), -2)
  // Equivalent form: ((price - sma50) / price) * 100 / adrPct
  const pctFromPrice = ((100 - 90) / 100) * 100
  assert.equal(pctFromPrice / 5, 2)
  assert.equal(extensionAdrFrom50(100, 90, 5), pctFromPrice / 5)
})

test('extensionAdrFrom50 edge cases return null or signed values', () => {
  assert.equal(extensionAdrFrom50(100, 90, 0), null)
  assert.equal(extensionAdrFrom50(100, 90, -1), null)
  assert.equal(extensionAdrFrom50(100, 90, null), null)
  assert.equal(extensionAdrFrom50(100, 90, Number.NaN), null)
  assert.equal(extensionAdrFrom50(100, 90, Number.POSITIVE_INFINITY), null)
  assert.equal(extensionAdrFrom50(0, 90, 5), null)
  assert.equal(extensionAdrFrom50(-10, 90, 5), null)
  assert.equal(extensionAdrFrom50(null, 90, 5), null)
  assert.equal(extensionAdrFrom50(Number.NaN, 90, 5), null)
  assert.equal(extensionAdrFrom50(100, null, 5), null)
  assert.equal(extensionAdrFrom50(100, Number.NaN, 5), null)
  assert.equal(extensionAdrFrom50(100, Number.POSITIVE_INFINITY, 5), null)
  assert.equal(extensionAdrFrom50(undefined, 90, 5), null)
  assert.equal(extensionAdrFrom50(50, 50, 3), 0)
  assert.ok((extensionAdrFrom50(110, 100, 4) ?? 0) > 0)
  assert.ok((extensionAdrFrom50(90, 100, 4) ?? 0) < 0)
})

test('roundExtensionAdr50 stores 2 decimals; helper keeps higher precision', () => {
  const raw = extensionAdrFrom50(100, 91, 5)
  assert.ok(raw != null)
  assert.equal(raw, (100 - 91) / (100 * 0.05))
  assert.equal(roundExtensionAdr50(raw), 1.8)
  assert.equal(roundExtensionAdr50(null), null)
  assert.equal(formatExtensionAdr50(2.3), '+2.3')
  assert.equal(formatExtensionAdr50(-0.4), '-0.4')
  assert.equal(formatExtensionAdr50(null), '—')
})

test('SCAN_CACHE_SCHEMA is 10 and extensionAdr50 is wired through', () => {
  assert.equal(SCAN_CACHE_SCHEMA, 10)
  const root = process.cwd()
  const cache = readFileSync(resolve(root, 'server/scanCache.ts'), 'utf8')
  assert.match(cache, /export const SCAN_CACHE_SCHEMA = 10/)
  assert.match(cache, /rangeBaseDetail/)
  assert.match(cache, /isA/)
  assert.match(cache, /rangeBreakoutDetail/)
  assert.match(cache, /extensionAdr50/)
  const types = readFileSync(resolve(root, 'src/types/index.ts'), 'utf8')
  assert.match(types, /extensionAdr50: number \| null/)
  const metrics = readFileSync(resolve(root, 'src/lib/metrics.ts'), 'utf8')
  assert.match(metrics, /extensionAdrFrom50/)
  assert.match(metrics, /extensionAdr50/)
  const helper = readFileSync(resolve(root, 'src/lib/extensionAdr.ts'), 'utf8')
  assert.match(helper, new RegExp(EXTENSION_ADR50_FORMULA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(helper, new RegExp(EXTENSION_ADR50_FORMULA_EQUIV.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
  assert.match(readme, /extensionAdr50/)
  assert.match(readme, /\(price - sma50\) \/ \(price \* \(adrPct \/ 100\)\)/)
  assert.match(readme, /Max ADR extension from 50 SMA/)
  assert.match(readme, /Any \| < 5 ADR \| < 4 \| < 3 \| < 2 \| < 1/)
  assert.match(readme, /GROUP_VIEW_MAX_EXTENSION_ADR50/)
  assert.match(readme, /Group view default \*\*< 4\*\*/)
})

interface FixtureFile {
  symbols: Record<string, { bars: DailyBar[] }>
}

test('computeIdeaMetrics writes rounded extensionAdr50 from the canonical helper', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(process.cwd(), 'server/fixtures/yahoo-daily-nvda-amd-aapl-smci.json'), 'utf8'),
  ) as FixtureFile
  const bars = [...fixture.symbols.NVDA!.bars].sort((a, b) => a.t - b.t)
  const idea = computeIdeaMetrics(
    { ticker: 'NVDA', name: 'NVIDIA', groupId: 'test', groupName: 'Test' },
    { symbol: 'NVDA', bars, provider: 'yahoo-fixture' },
  )
  assert.ok(idea)
  assert.ok('extensionAdr50' in idea!)
  assert.ok('pctAboveSma50' in idea!)
  const price = bars[bars.length - 1]!.c
  const sma50 = smaClose(bars.map((b) => b.c), SMA_PERIODS.sma50)
  const adrPct = adrPctFromBars(bars)
  assert.equal(
    idea!.extensionAdr50,
    roundExtensionAdr50(extensionAdrFrom50(price, sma50, adrPct)),
  )
})

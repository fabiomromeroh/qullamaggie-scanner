import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { marketCapTag, resolveSummaryMarketCap, MARKET_CAP_TAG_USD } from '../src/lib/marketCapTag.ts'

test('market cap tag is >$10B, <$10B, or hidden when unknown', () => {
  assert.equal(MARKET_CAP_TAG_USD, 10_000_000_000)
  assert.equal(marketCapTag(10_000_000_000), '>$10B')
  assert.equal(marketCapTag(10_000_000_001), '>$10B')
  assert.equal(marketCapTag(9_999_999_999), '<$10B')
  assert.equal(marketCapTag(1), '<$10B')
  assert.equal(marketCapTag(null), null)
  assert.equal(marketCapTag(undefined), null)
  assert.equal(marketCapTag(Number.NaN), null)
  assert.equal(marketCapTag(0), null)
  assert.equal(marketCapTag(-5), null)
  assert.equal(marketCapTag(Number.POSITIVE_INFINITY), null)
})

test('summary market cap uses the first known positive source and never guesses', () => {
  assert.equal(resolveSummaryMarketCap(null, 12e9), 12e9)
  assert.equal(resolveSummaryMarketCap(undefined, 0, 4e9), 4e9)
  assert.equal(resolveSummaryMarketCap(8e9, 99e9), 8e9)
  assert.equal(resolveSummaryMarketCap(null, undefined, Number.NaN), null)
  assert.equal(resolveSummaryMarketCap(), null)
})

test('ticker header badge is shared by the modal and the docked panel', () => {
  const modal = readFileSync('src/components/TickerModal.tsx', 'utf8')
  const badgeStart = modal.indexOf('function MarketCapBadge')
  const shellStart = modal.indexOf('function TickerModalBody')
  assert.ok(badgeStart >= 0 && shellStart > badgeStart)
  const detail = modal.slice(badgeStart, shellStart)
  assert.match(detail, /marketCapTag/)
  assert.match(detail, /MarketCapBadge/)
  assert.doesNotMatch(detail, /Escape/)
  assert.doesNotMatch(detail, /aria-modal/)
  const shell = modal.slice(shellStart)
  assert.match(shell, /Escape/)
  assert.match(shell, /aria-modal="true"/)
  const dock = readFileSync('src/components/DockedTickerPanel.tsx', 'utf8')
  assert.match(dock, /TickerDetail/)
  assert.doesNotMatch(dock, /Escape/)
  assert.doesNotMatch(dock, /aria-modal/)
  const pulse = readFileSync('src/modules/MarketPulseModule.tsx', 'utf8')
  assert.match(pulse, /TickerModalContext\.Provider/)
  assert.match(pulse, /min-width: 1024px/)
  assert.match(pulse, /parent\.close\(\)/)
  assert.match(pulse, /parent\.open\(target\)/)
})

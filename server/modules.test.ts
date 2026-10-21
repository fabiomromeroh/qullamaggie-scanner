import assert from 'node:assert/strict'
import { test } from 'node:test'
import { moduleFromHash, subFromHash } from '../src/lib/modules.ts'
import { fmtCompact, fmtPct, pctClass } from '../src/lib/pulseFormat.ts'

test('module routing from hash defaults to the scanner', () => {
  assert.equal(moduleFromHash(''), 'scanner')
  assert.equal(moduleFromHash('#pulse'), 'pulse')
  assert.equal(moduleFromHash('#PULSE/sectors'), 'pulse')
  assert.equal(moduleFromHash('#nope'), 'scanner')
  assert.equal(subFromHash('#pulse/sectors'), 'sectors')
  assert.equal(subFromHash('#pulse'), null)
})

test('percent formatting and green/red classes', () => {
  assert.equal(fmtPct(1.234), '+1.23%')
  assert.equal(fmtPct(-0.5), '-0.50%')
  assert.equal(fmtPct(null), '—')
  assert.equal(pctClass(2), 'text-terminal-green')
  assert.equal(pctClass(-2), 'text-terminal-red')
  assert.equal(pctClass(0), 'text-terminal-muted')
  assert.equal(fmtCompact(2_500_000_000), '2.50B')
})

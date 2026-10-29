import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('docked market pulse chart fills leftover width and the grid stays content-sized', () => {
  const dock = readFileSync('src/components/DockedTickerPanel.tsx', 'utf8')
  const pulse = readFileSync('src/modules/MarketPulseModule.tsx', 'utf8')
  assert.match(dock, /min-w-\[420px\] flex-1/)
  assert.match(dock, /ResizeHandle/)
  assert.doesNotMatch(dock, /style=\{\{ width/)
  assert.match(pulse, /CHART_MIN_PX = 420/)
  assert.match(pulse, /w-max min-w-0 shrink-0/)
  assert.match(pulse, /w-max shrink-0/)
  assert.match(pulse, /overflow-x-auto/)
  assert.match(pulse, /flex min-h-0 min-w-0 flex-1 flex-col/)
  assert.match(pulse, /min-width: 1024px/)
})

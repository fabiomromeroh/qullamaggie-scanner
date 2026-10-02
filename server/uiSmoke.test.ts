import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { surferBadgeTitle, type SurferDetail } from '../src/lib/surfer.ts'
import { tightBadgeTitle } from '../src/lib/tightConsolidation.ts'

test('badge titles and detail-panel copy for strict surfer + tight', () => {
  const detail: SurferDetail = {
    sma10: { touches: 3, bounces: 3, slopePct: 0.42 },
    sma20: { touches: 3, bounces: 2, slopePct: 0.61 },
    sma50: { touches: 1, bounces: 0, slopePct: -0.1 },
  }
  assert.equal(
    surferBadgeTitle('10MA Surfer', detail),
    '10MA Surfer: 3 touches, 3 bounces, slope 0.42%',
  )
  assert.match(surferBadgeTitle('20MA Surfer', detail), /2 bounces/)
  assert.match(
    tightBadgeTitle({ rangeRatio: 0.44, closeSpreadPct: 2.1, volumeRatio: 0.7, days: 7 }),
    /range 0\.44/,
  )

  const table = readFileSync(resolve(process.cwd(), 'src/components/IdeasTable.tsx'), 'utf8')
  const drawer = readFileSync(resolve(process.cwd(), 'src/components/DetailDrawer.tsx'), 'utf8')
  assert.match(table, /surferBadgeTitle/)
  assert.match(table, /tightBadgeTitle/)
  assert.match(table, /Tight/)
  assert.match(drawer, /Strict MA surfer/)
  assert.match(drawer, /Tight consolidation/)
  assert.match(drawer, /Range contraction/)
  assert.match(drawer, /Volume ratio/)
  assert.match(drawer, /Close spread/)
  assert.match(drawer, /SurferDetailSection/)
  assert.match(drawer, /TightDetailSection/)
})

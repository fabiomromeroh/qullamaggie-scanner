import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { surferBadgeTitle, type SurferDetail, type SurferMaDetail } from '../src/lib/surfer.ts'
import { tightBadgeTitle } from '../src/lib/tightConsolidation.ts'

function ma(partial: Partial<SurferMaDetail>): SurferMaDetail {
  return {
    ok: true,
    distancePct: 0.8,
    distanceAdr: 0.2,
    nearBars: 6,
    windowBars: 15,
    minDistancePct: -0.2,
    maxCloseBelowPct: 0.1,
    recovered: true,
    slopePct: 1.2,
    adrPct: 4,
    proximityPct: 2,
    ...partial,
  }
}

test('badge titles and detail-panel copy for strict surfer + tight', () => {
  const detail: SurferDetail = {
    sma10: ma({ slopePct: 0.42, nearBars: 8 }),
    sma20: ma({ distancePct: 0.8, distanceAdr: 0.2, slopePct: 1.2 }),
    sma50: ma({ ok: false, distancePct: -0.4, distanceAdr: -0.1, recovered: false, slopePct: -0.1, windowBars: 25 }),
  }
  assert.equal(
    surferBadgeTitle('20MA Surfer', detail),
    '20MA Surfer: +0.8% above 20MA = 0.2 ADR · near 6/15 · slope 1.2% · recovered',
  )
  assert.match(surferBadgeTitle('10MA Surfer', detail), /near 8\/15/)
  assert.match(surferBadgeTitle('50MA Surfer', detail), /not recovered/)
  assert.match(
    tightBadgeTitle({
      rangeRatio: 0.44,
      closeSpreadPct: 2.1,
      volumeRatio: 0.7,
      days: 7,
      nearHigh: true,
      aboveSma50: true,
      aboveSma200: true,
    }),
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
  assert.match(drawer, /Range Breakout gates/)
  assert.match(drawer, /RangeBreakoutGatesSection/)
  assert.match(drawer, /rangeBreakoutDetail/)
  assert.match(drawer, /Ext\. 50SMA/)
  assert.match(table, /Ext50/)
  assert.match(table, /extensionAdr50/)
})

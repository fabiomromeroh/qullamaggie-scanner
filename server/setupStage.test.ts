import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  coiledByLegacyRule,
  coiledByTightRoute,
  setupStageHeuristic,
} from '../src/lib/setupStage.ts'
import { TIGHT_CONFIG } from '../src/lib/tightConsolidation.ts'

const base = {
  aboveSma200: true,
  aboveSma10: true,
  aboveSma20: true,
  pctFrom52wHigh: -3,
  tightDays: 8,
  rvol: 1.0,
  dayPct: 0.2,
  priorRunPct: 20,
  tightConsolidation: false,
}

test('legacy coiled rule is unchanged (loose surfer, tightDays)', () => {
  assert.equal(setupStageHeuristic(base), 'coiled')
  assert.equal(coiledByLegacyRule(base), true)
  assert.equal(
    setupStageHeuristic({ ...base, aboveSma10: false, aboveSma20: false }),
    'watching',
  )
  assert.equal(setupStageHeuristic({ ...base, tightDays: 4 }), 'watching')
  assert.equal(setupStageHeuristic({ ...base, pctFrom52wHigh: -12 }), 'watching')
  assert.equal(
    setupStageHeuristic({ ...base, priorRunPct: 5, pctFrom52wHigh: -8 }),
    'watching',
  )
  assert.equal(setupStageHeuristic({ ...base, aboveSma200: false }), null)
})

test('tightConsolidation OR-route is on (live scan inflation 1.5%)', () => {
  assert.equal(TIGHT_CONFIG.useInCoiled, true)
  const tightOnly = {
    ...base,
    tightDays: 0,
    aboveSma10: false,
    aboveSma20: false,
    tightConsolidation: true,
    pctFrom52wHigh: -4,
    rvol: 0.8,
    dayPct: 0,
    priorRunPct: 5,
  }
  assert.equal(coiledByLegacyRule(tightOnly), false)
  assert.equal(coiledByTightRoute(tightOnly, true, false), false)
  assert.equal(coiledByTightRoute(tightOnly, true, true), true)
  assert.equal(setupStageHeuristic(tightOnly), 'coiled')
  assert.equal(
    setupStageHeuristic({ ...tightOnly, tightConsolidation: false }),
    'watching',
  )
  assert.equal(
    setupStageHeuristic({ ...tightOnly, pctFrom52wHigh: -12, tightConsolidation: true }),
    'watching',
  )
})

test('triggering still wins over coiled', () => {
  assert.equal(
    setupStageHeuristic({ ...base, rvol: 2.0, dayPct: 2, pctFrom52wHigh: -2 }),
    'triggering',
  )
})

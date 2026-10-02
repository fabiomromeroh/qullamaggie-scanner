import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SPLIT_FLOOR_CHART,
  SPLIT_FLOOR_PANEL,
  SPLIT_MIN_CHART,
  SPLIT_MIN_PANEL,
  SPLIT_RESULTS_STRIP,
  SPLIT_SHEET_RATIO,
  clampSheetWidth,
  clampSplitWidths,
  defaultSheetWidth,
  escClosesSheet,
  isTypingTarget,
  maxSheetWidth,
  nextTickerIndex,
  splitReservedLeft,
} from '../src/lib/splitLayout.ts'

const MINS = { chart: SPLIT_MIN_CHART, panel: SPLIT_MIN_PANEL }

test('clampSplitWidths honors a request that already fits both minimums', () => {
  assert.deepEqual(clampSplitWidths(1200, 800, 400, MINS), { chart: 800, panel: 400 })
})

test('clampSplitWidths raises a panel that would fall under its minimum', () => {
  assert.deepEqual(clampSplitWidths(1200, 1100, 100, MINS), { chart: 820, panel: 380 })
})

test('clampSplitWidths keeps the chart minimum when the panel request is too wide', () => {
  assert.deepEqual(clampSplitWidths(1200, 100, 1100, MINS), { chart: 560, panel: 640 })
})

test('clampSplitWidths scales a request that does not already sum to the total', () => {
  assert.deepEqual(clampSplitWidths(800, 200, 200, { chart: 100, panel: 100 }), {
    chart: 400,
    panel: 400,
  })
})

test('clampSplitWidths uses absolute floors when the preferred minimums cannot fit', () => {
  assert.deepEqual(clampSplitWidths(400, 300, 100, MINS), { chart: 240, panel: 160 })
  assert.equal(SPLIT_FLOOR_CHART, 200)
  assert.equal(SPLIT_FLOOR_PANEL, 160)
})

test('clampSplitWidths keeps a chart floor when a stored panel would crush it', () => {
  assert.deepEqual(clampSplitWidths(444, 44, 400, MINS), { chart: 200, panel: 244 })
})

test('clampSplitWidths keeps the requested ratio only when even the floors cannot fit', () => {
  assert.deepEqual(clampSplitWidths(100, 80, 20, MINS), { chart: 80, panel: 20 })
  assert.deepEqual(clampSplitWidths(100, 0, 0, MINS), { chart: 60, panel: 40 })
})

test('clampSplitWidths returns zeros for an empty or invalid total', () => {
  assert.deepEqual(clampSplitWidths(0, 200, 200, MINS), { chart: 0, panel: 0 })
  assert.deepEqual(clampSplitWidths(-40, 200, 200, MINS), { chart: 0, panel: 0 })
  assert.deepEqual(clampSplitWidths(Number.NaN, 200, 200, MINS), { chart: 0, panel: 0 })
})

test('clampSplitWidths sums to the rounded total and stays non-negative', () => {
  const samples: Array<[number, number, number]> = [
    [940, 560, 380],
    [1000, 10, 10],
    [1500, 900, 200],
    [700, 560, 380],
    [333, 100, 50],
    [2000, 0, 400],
  ]
  for (const [total, chart, panel] of samples) {
    const got = clampSplitWidths(total, chart, panel, MINS)
    assert.equal(got.chart + got.panel, total)
    assert.ok(got.chart >= 0)
    assert.ok(got.panel >= 0)
    if (total >= SPLIT_MIN_CHART + SPLIT_MIN_PANEL) {
      assert.ok(got.chart >= SPLIT_MIN_CHART)
      assert.ok(got.panel >= SPLIT_MIN_PANEL)
    }
  }
})

test('clampSheetWidth leaves the reserved strip and respects the preferred minimum', () => {
  assert.equal(maxSheetWidth(2000, 580), 1420)
  assert.equal(clampSheetWidth(1400, 2000, 580), 1400)
  assert.equal(clampSheetWidth(5000, 2000, 580), 1420)
  assert.equal(clampSheetWidth(100, 2000, 580), SPLIT_MIN_CHART + SPLIT_MIN_PANEL)
})

test('clampSheetWidth shrinks to the viewport when the strip consumes the preferred minimum', () => {
  assert.equal(clampSheetWidth(900, 1024, 580), 444)
  assert.equal(clampSheetWidth(Number.NaN, 0, 0), 0)
})

test('defaultSheetWidth is about 70% of the viewport until the strip clamps it', () => {
  const wide = defaultSheetWidth(2000, 400)
  assert.equal(wide, Math.round(2000 * SPLIT_SHEET_RATIO))
  assert.equal(defaultSheetWidth(1600, 580), 1020)
  assert.equal(defaultSheetWidth(1024, 580), 444)
})

test('splitReservedLeft adds the results strip to the groups column', () => {
  assert.equal(splitReservedLeft(340), 340 + SPLIT_RESULTS_STRIP)
  assert.equal(splitReservedLeft(-10), SPLIT_RESULTS_STRIP)
  assert.equal(splitReservedLeft(Number.NaN), SPLIT_RESULTS_STRIP)
})

test('nextTickerIndex wraps at the ends and handles an empty list', () => {
  const rows = ['AAA', 'BBB', 'CCC']
  assert.equal(nextTickerIndex([], 'AAA', 1), -1)
  assert.equal(nextTickerIndex([], null, -1), -1)
  assert.equal(nextTickerIndex(rows, 'AAA', 1), 1)
  assert.equal(nextTickerIndex(rows, 'BBB', -1), 0)
  assert.equal(nextTickerIndex(rows, 'CCC', 1), 0)
  assert.equal(nextTickerIndex(rows, 'AAA', -1), 2)
  assert.equal(nextTickerIndex(['ONLY'], 'ONLY', 1), 0)
  assert.equal(nextTickerIndex(['ONLY'], 'ONLY', -1), 0)
})

test('nextTickerIndex starts at an edge when the current ticker is not in the list', () => {
  const rows = ['AAA', 'BBB', 'CCC']
  assert.equal(nextTickerIndex(rows, null, 1), 0)
  assert.equal(nextTickerIndex(rows, null, -1), 2)
  assert.equal(nextTickerIndex(rows, 'ZZZ', 1), 0)
  assert.equal(nextTickerIndex(rows, 'ZZZ', -1), 2)
  assert.equal(nextTickerIndex(['AAA', 'BBB', 'AAA'], 'AAA', 1), 1)
})

test('isTypingTarget matches inputs, textareas, selects, and contentEditable', () => {
  assert.equal(isTypingTarget(null), false)
  assert.equal(isTypingTarget(undefined), false)
  assert.equal(isTypingTarget('input'), false)
  assert.equal(isTypingTarget({ tagName: 'input' }), true)
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true)
  assert.equal(isTypingTarget({ tagName: 'select' }), true)
  assert.equal(isTypingTarget({ tagName: 'button' }), false)
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: false }), false)
  assert.equal(isTypingTarget({ isContentEditable: true }), true)
})

test('escClosesSheet skips native popups and still closes from plain text fields', () => {
  assert.equal(escClosesSheet(null), true)
  assert.equal(escClosesSheet({ tagName: 'INPUT' }), true)
  assert.equal(escClosesSheet({ tagName: 'INPUT', type: 'text' }), true)
  assert.equal(escClosesSheet({ tagName: 'INPUT', type: 'search' }), true)
  assert.equal(escClosesSheet({ tagName: 'INPUT', type: 'number' }), true)
  assert.equal(escClosesSheet({ tagName: 'INPUT', type: 'text', list: null }), true)
  assert.equal(escClosesSheet({ tagName: 'TEXTAREA' }), true)
  assert.equal(escClosesSheet({ tagName: 'BUTTON' }), true)
  assert.equal(escClosesSheet({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(escClosesSheet({ tagName: 'SELECT' }), false)
  assert.equal(escClosesSheet({ tagName: 'INPUT', type: 'text', list: {} }), false)
  for (const type of ['date', 'datetime-local', 'month', 'time', 'week', 'color']) {
    assert.equal(escClosesSheet({ tagName: 'INPUT', type }), false, type)
  }
})

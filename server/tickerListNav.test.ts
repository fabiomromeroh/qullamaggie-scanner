import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  normalizeTickerList,
  stepTickerIndex,
  tickerIndexInList,
  tickerListPosition,
  tickerNamesMap,
} from '../src/lib/tickerListNav.ts'

test('normalizeTickerList uppercases, trims, and dedupes', () => {
  assert.deepEqual(normalizeTickerList(['aaa', ' BBB ', 'aaa', '', 'ccc']), ['AAA', 'BBB', 'CCC'])
  assert.deepEqual(normalizeTickerList(null), [])
  assert.deepEqual(normalizeTickerList([]), [])
})

test('stepTickerIndex stops at the ends', () => {
  const rows = ['AAA', 'BBB', 'CCC']
  assert.equal(stepTickerIndex([], 'AAA', 1), -1)
  assert.equal(stepTickerIndex([], null, -1), -1)
  assert.equal(stepTickerIndex(rows, 'AAA', 1), 1)
  assert.equal(stepTickerIndex(rows, 'BBB', -1), 0)
  assert.equal(stepTickerIndex(rows, 'CCC', 1), -1)
  assert.equal(stepTickerIndex(rows, 'AAA', -1), -1)
  assert.equal(stepTickerIndex(['ONLY'], 'ONLY', 1), -1)
  assert.equal(stepTickerIndex(['ONLY'], 'ONLY', -1), -1)
})

test('stepTickerIndex starts at an edge when the current ticker is not in the list', () => {
  const rows = ['AAA', 'BBB', 'CCC']
  assert.equal(stepTickerIndex(rows, null, 1), 0)
  assert.equal(stepTickerIndex(rows, null, -1), 2)
  assert.equal(stepTickerIndex(rows, 'ZZZ', 1), 0)
  assert.equal(stepTickerIndex(rows, 'ZZZ', -1), 2)
  assert.equal(tickerIndexInList(rows, 'bbb'), 1)
  assert.deepEqual(tickerListPosition(rows, 'CCC'), { index: 2, total: 3 })
  assert.deepEqual(tickerListPosition(rows, 'ZZZ'), { index: -1, total: 3 })
  assert.deepEqual(tickerNamesMap([{ ticker: 'aaa', name: 'Alpha' }, { ticker: 'BBB' }]), {
    AAA: 'Alpha',
  })
})

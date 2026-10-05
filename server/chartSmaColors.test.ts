import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readJsonFrom, writeJsonTo, type KeyValueStore } from '../src/lib/persist.ts'
import {
  CHART_SMA_COLORS_KEY,
  CHART_SMA_COLORS_V0_KEY,
  DEFAULT_SMA_COLORS,
  defaultSmaColors,
  loadSmaColors,
  parseSmaColors,
  saveSmaColors,
  type SmaColorMap,
} from '../src/lib/chartSmaColors.ts'

function memoryStore(init?: Record<string, string>): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init ?? {}))
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

test('save and load round-trip the colour map', () => {
  const store = memoryStore()
  const custom: SmaColorMap = { ...defaultSmaColors(), '20': '#112233', vol20: '#abcdef' }
  saveSmaColors(custom, store)
  assert.deepEqual(loadSmaColors(store), custom)
  assert.deepEqual(readJsonFrom(store, CHART_SMA_COLORS_KEY), custom)
  assert.equal(store.getItem(CHART_SMA_COLORS_V0_KEY), null)
})

test('save normalizes case and drops invalid entries back to defaults', () => {
  const store = memoryStore()
  saveSmaColors({ ...defaultSmaColors(), '10': '#AABBCC', vol20: 'blue' }, store)
  const loaded = loadSmaColors(store)
  assert.equal(loaded['10'], '#aabbcc')
  assert.equal(loaded.vol20, DEFAULT_SMA_COLORS.vol20)
  assert.equal(loaded['20'], DEFAULT_SMA_COLORS['20'])
})

test('partial v1 keeps defaults for missing and invalid keys', () => {
  const store = memoryStore()
  writeJsonTo(store, CHART_SMA_COLORS_KEY, { '200': '#010203', extra: '#ffffff', '50': '#xyzxyz' })
  const loaded = loadSmaColors(store)
  assert.equal(loaded['200'], '#010203')
  assert.equal(loaded['10'], DEFAULT_SMA_COLORS['10'])
  assert.equal(loaded['50'], DEFAULT_SMA_COLORS['50'])
  assert.equal(loaded.vol20, DEFAULT_SMA_COLORS.vol20)
  assert.equal('extra' in loaded, false)
  assert.deepEqual(parseSmaColors(null), defaultSmaColors())
  assert.deepEqual(parseSmaColors(['#112233']), defaultSmaColors())
  assert.equal(parseSmaColors({ '10': '#11223' })['10'], DEFAULT_SMA_COLORS['10'])
  assert.equal(parseSmaColors({ '10': '#11223344' })['10'], DEFAULT_SMA_COLORS['10'])
})

test('corrupt v1 JSON loads defaults and does not throw', () => {
  const store = memoryStore({
    [CHART_SMA_COLORS_KEY]: '{not json',
    [CHART_SMA_COLORS_V0_KEY]: JSON.stringify({ '10': '#123456' }),
  })
  assert.doesNotThrow(() => loadSmaColors(store))
  assert.deepEqual(loadSmaColors(store), defaultSmaColors())
  assert.equal(readJsonFrom(store, CHART_SMA_COLORS_KEY), null)
  assert.ok(store.getItem(CHART_SMA_COLORS_V0_KEY))
})

test('v0 key migrates into v1 and is removed', () => {
  const store = memoryStore()
  writeJsonTo(store, CHART_SMA_COLORS_V0_KEY, { '50': '#abcdef', vol20: 'nope' })
  const loaded = loadSmaColors(store)
  assert.equal(loaded['50'], '#abcdef')
  assert.equal(loaded.vol20, DEFAULT_SMA_COLORS.vol20)
  assert.equal(loaded['10'], DEFAULT_SMA_COLORS['10'])
  assert.equal(store.getItem(CHART_SMA_COLORS_V0_KEY), null)
  assert.deepEqual(readJsonFrom(store, CHART_SMA_COLORS_KEY), loaded)
})

test('corrupt v0 migrates to defaults', () => {
  const store = memoryStore({ [CHART_SMA_COLORS_V0_KEY]: '{not json' })
  assert.deepEqual(loadSmaColors(store), defaultSmaColors())
  assert.equal(store.getItem(CHART_SMA_COLORS_V0_KEY), null)
  assert.deepEqual(readJsonFrom(store, CHART_SMA_COLORS_KEY), defaultSmaColors())
})

test('a present v1 key wins over v0', () => {
  const store = memoryStore()
  writeJsonTo(store, CHART_SMA_COLORS_KEY, { '10': '#111111' })
  writeJsonTo(store, CHART_SMA_COLORS_V0_KEY, { '10': '#222222' })
  assert.equal(loadSmaColors(store)['10'], '#111111')
  assert.ok(store.getItem(CHART_SMA_COLORS_V0_KEY))
})

test('a null store loads defaults and save is a no-op', () => {
  assert.deepEqual(loadSmaColors(null), defaultSmaColors())
  assert.doesNotThrow(() => saveSmaColors(defaultSmaColors(), null))
  assert.deepEqual(loadSmaColors(null), defaultSmaColors())
})

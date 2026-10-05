import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readJsonFrom, writeJsonTo, type KeyValueStore } from '../src/lib/persist.ts'
import {
  CHART_SMA_COLORS_KEY,
  CHART_SMA_COLORS_V0_KEY,
  CHART_SMA_PREFS_KEY,
  DEFAULT_SMA_COLORS,
  DEFAULT_SMA_ENABLED,
  defaultChartSmaPrefs,
  defaultSmaColors,
  defaultSmaEnabled,
  loadChartSmaPrefs,
  loadSmaColors,
  parseChartSmaPrefs,
  parseSmaColors,
  saveChartSmaPrefs,
  saveSmaColors,
  type ChartSmaPrefs,
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

test('SMA 10 starts enabled with the other price SMAs', () => {
  assert.equal(DEFAULT_SMA_ENABLED['10'], true)
  assert.equal(DEFAULT_SMA_ENABLED['20'], true)
  assert.equal(DEFAULT_SMA_ENABLED['50'], true)
  assert.equal(DEFAULT_SMA_ENABLED['200'], true)
  assert.equal(DEFAULT_SMA_ENABLED.vol20, true)
  assert.equal(CHART_SMA_PREFS_KEY, 'qm.chartSmaPrefs.v2')
})

test('save and load round-trip chart prefs', () => {
  const store = memoryStore()
  const custom: ChartSmaPrefs = {
    colors: { ...defaultSmaColors(), '10': '#112233' },
    enabled: { ...defaultSmaEnabled(), '10': false, vol20: false },
  }
  saveChartSmaPrefs(custom, store)
  assert.deepEqual(loadChartSmaPrefs(store), custom)
  assert.deepEqual(readJsonFrom(store, CHART_SMA_PREFS_KEY), custom)
})

test('invalid colour and enabled entries fall back per key', () => {
  const parsed = parseChartSmaPrefs({
    colors: { '20': '#AABBCC', '50': 'gold', extra: '#ffffff' },
    enabled: { '10': false, '20': 'yes', vol20: true },
  })
  assert.equal(parsed.colors['20'], '#aabbcc')
  assert.equal(parsed.colors['50'], DEFAULT_SMA_COLORS['50'])
  assert.equal(parsed.colors['10'], DEFAULT_SMA_COLORS['10'])
  assert.equal('extra' in parsed.colors, false)
  assert.equal(parsed.enabled['10'], false)
  assert.equal(parsed.enabled['20'], DEFAULT_SMA_ENABLED['20'])
  assert.equal(parsed.enabled.vol20, true)
  assert.equal(parsed.enabled['50'], true)
  assert.deepEqual(parseChartSmaPrefs(null), defaultChartSmaPrefs())
  assert.deepEqual(parseChartSmaPrefs(['nope']), defaultChartSmaPrefs())
  const partial = parseChartSmaPrefs({ colors: { '200': '#010203' } })
  assert.equal(partial.colors['200'], '#010203')
  assert.equal(partial.enabled['10'], true)
  assert.equal(partial.colors['10'], DEFAULT_SMA_COLORS['10'])
})

test('corrupt v2 JSON loads defaults and does not consume v1', () => {
  const store = memoryStore({
    [CHART_SMA_PREFS_KEY]: '{not json',
    [CHART_SMA_COLORS_KEY]: JSON.stringify({ '10': '#123456' }),
  })
  assert.doesNotThrow(() => loadChartSmaPrefs(store))
  assert.deepEqual(loadChartSmaPrefs(store), defaultChartSmaPrefs())
  assert.equal(store.getItem(CHART_SMA_COLORS_KEY), JSON.stringify({ '10': '#123456' }))
})

test('v1 colours migrate into v2 with default enabled and v1 is left in place', () => {
  const store = memoryStore()
  writeJsonTo(store, CHART_SMA_COLORS_KEY, { '50': '#abcdef', vol20: 'nope' })
  const loaded = loadChartSmaPrefs(store)
  assert.equal(loaded.colors['50'], '#abcdef')
  assert.equal(loaded.colors.vol20, DEFAULT_SMA_COLORS.vol20)
  assert.deepEqual(loaded.enabled, defaultSmaEnabled())
  assert.deepEqual(readJsonFrom(store, CHART_SMA_PREFS_KEY), loaded)
  assert.deepEqual(readJsonFrom(store, CHART_SMA_COLORS_KEY), { '50': '#abcdef', vol20: 'nope' })
})

test('v0 colours migrate into v2 when v1 is absent', () => {
  const store = memoryStore()
  writeJsonTo(store, CHART_SMA_COLORS_V0_KEY, { '10': '#445566' })
  const loaded = loadChartSmaPrefs(store)
  assert.equal(loaded.colors['10'], '#445566')
  assert.deepEqual(loaded.enabled, defaultSmaEnabled())
  assert.ok(store.getItem(CHART_SMA_COLORS_V0_KEY))
  assert.ok(store.getItem(CHART_SMA_PREFS_KEY))
})

test('a present v2 key wins over v1', () => {
  const store = memoryStore()
  writeJsonTo(store, CHART_SMA_PREFS_KEY, {
    colors: { '10': '#111111' },
    enabled: { '200': false },
  })
  writeJsonTo(store, CHART_SMA_COLORS_KEY, { '10': '#222222' })
  const loaded = loadChartSmaPrefs(store)
  assert.equal(loaded.colors['10'], '#111111')
  assert.equal(loaded.enabled['200'], false)
  assert.equal(loaded.enabled['10'], true)
  assert.ok(store.getItem(CHART_SMA_COLORS_KEY))
})

test('a null store loads default prefs and save is a no-op', () => {
  assert.deepEqual(loadChartSmaPrefs(null), defaultChartSmaPrefs())
  assert.doesNotThrow(() => saveChartSmaPrefs(defaultChartSmaPrefs(), null))
  assert.deepEqual(loadChartSmaPrefs(null), defaultChartSmaPrefs())
})

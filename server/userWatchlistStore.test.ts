import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readJsonFrom, writeJsonTo, type KeyValueStore } from '../src/lib/persist.ts'
import {
  addTickers,
  clearWatchlist,
  displayTickersNewestFirst,
  formatAddFeedback,
  loadUserWatchlist,
  parseTickerInput,
  removeTicker,
  restoreWatchlist,
  saveUserWatchlist,
  toggleTicker,
  USER_WATCHLIST_CAP,
  USER_WATCHLIST_STORAGE_KEY,
  USER_WATCHLIST_V1_KEY,
  type UserWatchlistState,
} from '../src/lib/userWatchlistStore.ts'

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

function excelTicker(n: number): string {
  let s = ''
  let x = n
  do {
    s = String.fromCharCode(65 + (x % 26)) + s
    x = Math.floor(x / 26) - 1
  } while (x >= 0)
  return s
}

test('persist/restore round-trips insertion order', () => {
  const store = memoryStore()
  const state: UserWatchlistState = { version: 2, tickers: ['NVDA', 'AMD'] }
  saveUserWatchlist(state, store)
  const loaded = loadUserWatchlist(store)
  assert.deepEqual(loaded.tickers, ['NVDA', 'AMD'])
  assert.equal(loaded.version, 2)
  assert.deepEqual(displayTickersNewestFirst(loaded.tickers), ['AMD', 'NVDA'])
})

test('invalid JSON loads as empty and never throws', () => {
  const store = memoryStore({ [USER_WATCHLIST_STORAGE_KEY]: '{not json' })
  assert.doesNotThrow(() => loadUserWatchlist(store))
  assert.deepEqual(loadUserWatchlist(store).tickers, [])
  assert.equal(readJsonFrom(store, USER_WATCHLIST_STORAGE_KEY), null)
})

test('invalid v2 JSON does not fall back to v1', () => {
  const store = memoryStore({ [USER_WATCHLIST_STORAGE_KEY]: '{not json' })
  writeJsonTo(store, USER_WATCHLIST_V1_KEY, {
    version: 1,
    entries: [{ ticker: 'AMD', pinned: true, source: 'manual' }],
  })
  assert.deepEqual(loadUserWatchlist(store).tickers, [])
})

test('wrong v2 shape loads as empty', () => {
  const store = memoryStore()
  writeJsonTo(store, USER_WATCHLIST_STORAGE_KEY, { version: 2, tickers: 'NVDA' })
  assert.deepEqual(loadUserWatchlist(store).tickers, [])
  writeJsonTo(store, USER_WATCHLIST_STORAGE_KEY, { version: 2 })
  assert.deepEqual(loadUserWatchlist(store).tickers, [])
  writeJsonTo(store, USER_WATCHLIST_STORAGE_KEY, { version: 3, tickers: ['NVDA'] })
  assert.deepEqual(loadUserWatchlist(store).tickers, [])
})

test('v1 migration keeps pinned/manual and drops scan-populated auto-added rows', () => {
  const store = memoryStore()
  writeJsonTo(store, USER_WATCHLIST_V1_KEY, {
    version: 1,
    entries: [
      { ticker: 'nvda', pinned: true, source: 'auto', addedAt: '2020-01-01T00:00:00.000Z' },
      { ticker: 'AMD', pinned: false, source: 'manual', addedAt: '2020-01-02T00:00:00.000Z' },
      { ticker: 'TSLA', pinned: false, source: 'auto', addedAt: '2020-01-03T00:00:00.000Z' },
      { ticker: 'META', pinned: false, source: 'seed', addedAt: '2020-01-04T00:00:00.000Z' },
      { ticker: 'brk.b', pinned: true, source: 'manual', addedAt: '2020-01-05T00:00:00.000Z' },
    ],
  })
  const loaded = loadUserWatchlist(store)
  assert.deepEqual(loaded.tickers, ['NVDA', 'AMD', 'BRK.B'])
  assert.equal(store.getItem(USER_WATCHLIST_V1_KEY), null)
  const v2 = JSON.parse(store.getItem(USER_WATCHLIST_STORAGE_KEY) ?? 'null') as UserWatchlistState
  assert.equal(v2.version, 2)
  assert.deepEqual(v2.tickers, ['NVDA', 'AMD', 'BRK.B'])
})

test('corrupt v2 does not fall back to v1', () => {
  const store = memoryStore()
  writeJsonTo(store, USER_WATCHLIST_STORAGE_KEY, { version: 2, tickers: { nope: true } })
  writeJsonTo(store, USER_WATCHLIST_V1_KEY, {
    version: 1,
    entries: [{ ticker: 'AMD', pinned: true, source: 'manual' }],
  })
  assert.deepEqual(loadUserWatchlist(store).tickers, [])
})

test('dedupe, uppercase, and cap on normalize/add', () => {
  const store = memoryStore()
  writeJsonTo(store, USER_WATCHLIST_STORAGE_KEY, {
    version: 2,
    tickers: ['amd', 'AMD', ' nvda ', 'FOO$', 'AMD'],
  })
  assert.deepEqual(loadUserWatchlist(store).tickers, ['AMD', 'NVDA'])

  const filled = Array.from({ length: USER_WATCHLIST_CAP }, (_, i) => excelTicker(i))
  let state: UserWatchlistState = { version: 2, tickers: filled }
  const over = addTickers(state, 'ZZZZZ')
  assert.equal(over.added.length, 0)
  assert.deepEqual(over.refusedCap, ['ZZZZZ'])
  assert.equal(over.state.tickers.length, USER_WATCHLIST_CAP)
  assert.match(formatAddFeedback(over) ?? '', /full \(200/)
})

test('parseTickerInput accepts paste separators, $ prefix, class suffix; rejects invalid', () => {
  const parsed = parseTickerInput('$nvda, amd; brk.b\nbrk-b pbr-a  amd  FOO$ TOOLONG GOOGLX')
  assert.deepEqual(parsed.valid, ['NVDA', 'AMD', 'BRK.B', 'BRK-B', 'PBR-A'])
  assert.ok(parsed.invalid.includes('FOO$'))
  assert.ok(parsed.invalid.includes('TOOLONG'))
  assert.ok(parsed.invalid.includes('GOOGLX'))

  const spaces = parseTickerInput('  nvda   amd  ')
  assert.deepEqual(spaces.valid, ['NVDA', 'AMD'])

  const newlines = parseTickerInput('F\nAAPL')
  assert.deepEqual(newlines.valid, ['F', 'AAPL'])
})

test('pin toggle shares the same stored list', () => {
  let state: UserWatchlistState = { version: 2, tickers: [] }
  state = addTickers(state, 'AMD').state
  const pinned = toggleTicker(state, 'nvda')
  assert.deepEqual(pinned.state.tickers, ['AMD', 'NVDA'])
  const unpinned = toggleTicker(pinned.state, 'AMD')
  assert.deepEqual(unpinned.state.tickers, ['NVDA'])
  assert.deepEqual(removeTicker(unpinned.state, 'NVDA').tickers, [])
})

test('clear + undo restore previous insertion order', () => {
  const original: UserWatchlistState = { version: 2, tickers: ['NVDA', 'AMD', 'F'] }
  const cleared = clearWatchlist(original)
  assert.deepEqual(cleared.state.tickers, [])
  assert.deepEqual(cleared.previous, ['NVDA', 'AMD', 'F'])
  const restored = restoreWatchlist(cleared.previous)
  assert.deepEqual(restored.tickers, ['NVDA', 'AMD', 'F'])
})

test('add feedback matches Added / skipped duplicates / rejected invalid', () => {
  const state: UserWatchlistState = { version: 2, tickers: ['NVDA'] }
  const result = addTickers(state, 'nvda, amd, FOO$, brk.b')
  assert.deepEqual(result.added, ['AMD', 'BRK.B'])
  assert.deepEqual(result.skippedDuplicates, ['NVDA'])
  assert.deepEqual(result.rejectedInvalid, ['FOO$'])
  assert.equal(
    formatAddFeedback(result),
    'Added 2, skipped 1 duplicate, rejected: FOO$ (invalid)',
  )
})

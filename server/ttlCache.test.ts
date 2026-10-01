import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSymbolCache, isFresh } from './ttlCache.ts'

test('isFresh is true inside the TTL and false after', () => {
  assert.equal(isFresh(1000, 500, 1499), true)
  assert.equal(isFresh(1000, 500, 1500), false)
  assert.equal(isFresh(1000, 500, 2000), false)
})

test('createSymbolCache returns the cached value within TTL', async () => {
  let now = 1_000
  let calls = 0
  const cache = createSymbolCache<number>({ ttlMs: 500 })
  const clock = () => now
  const first = await cache.get('AMD', async () => {
    calls += 1
    return 42
  }, clock)
  now = 1_400
  const second = await cache.get('AMD', async () => {
    calls += 1
    return 99
  }, clock)
  assert.equal(first, 42)
  assert.equal(second, 42)
  assert.equal(calls, 1)
})

test('createSymbolCache refreshes after TTL', async () => {
  let now = 1_000
  let calls = 0
  const cache = createSymbolCache<number>({ ttlMs: 500 })
  const clock = () => now
  await cache.get('AMD', async () => {
    calls += 1
    return 1
  }, clock)
  now = 1_501
  const next = await cache.get('AMD', async () => {
    calls += 1
    return 2
  }, clock)
  assert.equal(next, 2)
  assert.equal(calls, 2)
})

test('in-flight loads share one loader call', async () => {
  let calls = 0
  const cache = createSymbolCache<string>({ ttlMs: 10_000 })
  const loader = async () => {
    calls += 1
    await new Promise((r) => setTimeout(r, 20))
    return 'ok'
  }
  const [a, b] = await Promise.all([cache.get('AMD', loader), cache.get('AMD', loader)])
  assert.equal(a, 'ok')
  assert.equal(b, 'ok')
  assert.equal(calls, 1)
})

test('stale-on-error returns the previous value when refresh throws', async () => {
  let now = 1_000
  const cache = createSymbolCache<string>({ ttlMs: 100, staleOnError: true })
  const clock = () => now
  await cache.get('AMD', async () => 'live', clock)
  now = 1_500
  const stale = await cache.get('AMD', async () => {
    throw new Error('provider down')
  }, clock)
  assert.equal(stale, 'live')
})

test('negative TTL is shorter than the positive TTL', async () => {
  let now = 1_000
  let calls = 0
  const cache = createSymbolCache<{ empty: boolean }>({
    ttlMs: 10_000,
    negativeTtlMs: 100,
    isNegative: (v) => v.empty,
  })
  const clock = () => now
  await cache.get('X', async () => {
    calls += 1
    return { empty: true }
  }, clock)
  now = 1_050
  await cache.get('X', async () => {
    calls += 1
    return { empty: true }
  }, clock)
  assert.equal(calls, 1)
  now = 1_101
  await cache.get('X', async () => {
    calls += 1
    return { empty: true }
  }, clock)
  assert.equal(calls, 2)
})

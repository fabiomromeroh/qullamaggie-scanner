import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupPending, remainingSymbolBudget } from '../src/lib/leaderBudget.ts'

const budget = { budgetMs: 8_000, maxSymbols: 40 }

test('remainingSymbolBudget stops on the time budget or the symbol cap', () => {
  const names = ['A', 'B', 'C', 'D']
  assert.deepEqual(remainingSymbolBudget(names, { elapsedMs: 0, startedCount: 0 }, budget), {
    take: 4,
    deferred: [],
  })
  assert.deepEqual(remainingSymbolBudget(names, { elapsedMs: 7_999, startedCount: 38 }, budget), {
    take: 2,
    deferred: ['C', 'D'],
  })
  assert.deepEqual(remainingSymbolBudget(names, { elapsedMs: 8_000, startedCount: 0 }, budget), {
    take: 0,
    deferred: names,
  })
  assert.deepEqual(remainingSymbolBudget(names, { elapsedMs: 0, startedCount: 40 }, budget), {
    take: 0,
    deferred: names,
  })
})

test('groupPending is true until every member is resolved', () => {
  const tickers = ['AAA', 'BBB']
  assert.equal(groupPending(tickers, new Set()), true)
  assert.equal(groupPending(tickers, new Set(['AAA'])), true)
  assert.equal(groupPending(tickers, new Set(['AAA', 'BBB'])), false)
  assert.equal(groupPending([], new Set()), false)
})

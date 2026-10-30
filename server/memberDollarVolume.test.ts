import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enrichMembersWithLiquidity, MEMBER_MIN_DOLLAR_VOLUME_20 } from './memberDollarVolume.ts'

test('member liquidity enrich attaches known $vol and derived 20d shares without dropping anyone', () => {
  const members = [
    { ticker: 'BIG', company: 'Big Co' },
    { ticker: 'SMALL', company: 'Small Co' },
    { ticker: 'NEW', company: 'No quote yet' },
    { ticker: 'eq', company: 'Exact floor' },
  ]
  const quotes = new Map<string, { price: number; dollarVolume20: number }>([
    ['BIG', { price: 50, dollarVolume20: 25_000_000 }],
    ['small', { price: 10, dollarVolume20: 19_999_999 }],
    ['EQ', { price: 20, dollarVolume20: 20_000_000 }],
  ])
  const out = enrichMembersWithLiquidity(members, quotes)
  assert.equal(MEMBER_MIN_DOLLAR_VOLUME_20, 20_000_000)
  assert.equal(out.totalMembers, 4)
  assert.equal(out.members.length, 4)
  assert.deepEqual(
    out.members.map((member) => member.ticker),
    ['BIG', 'SMALL', 'NEW', 'eq'],
  )
  assert.equal(out.members[0]?.dollarVolume20, 25_000_000)
  assert.equal(out.members[0]?.price, 50)
  assert.equal(out.members[0]?.avgVolume, 25_000_000 / 50)
  assert.equal(out.members[0]?.company, 'Big Co')
  assert.equal(out.members[1]?.dollarVolume20, 19_999_999)
  assert.equal(out.members[2]?.dollarVolume20, undefined)
  assert.equal(out.members[2]?.avgVolume, undefined)
  assert.equal(out.members[3]?.dollarVolume20, 20_000_000)
})

test('member liquidity enrich is a no-op when breadth quotes are missing', () => {
  const members = [{ ticker: 'A' }, { ticker: 'B' }]
  const out = enrichMembersWithLiquidity(members, null)
  assert.equal(out.totalMembers, 2)
  assert.deepEqual(
    out.members.map((member) => member.ticker),
    ['A', 'B'],
  )
  assert.equal(out.members[0]?.dollarVolume20, undefined)
})

test('non-finite dollar volume is treated as unknown and kept', () => {
  const out = enrichMembersWithLiquidity(
    [{ ticker: 'NAN' }, { ticker: 'ZERO' }],
    new Map([
      ['NAN', { dollarVolume20: Number.NaN }],
      ['ZERO', { price: 5, dollarVolume20: 0 }],
    ]),
  )
  assert.deepEqual(
    out.members.map((member) => member.ticker),
    ['NAN', 'ZERO'],
  )
  assert.equal(out.members[0]?.dollarVolume20, undefined)
  assert.equal(out.members[1]?.dollarVolume20, 0)
  assert.equal(out.members[1]?.avgVolume, 0)
})

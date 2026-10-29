import assert from 'node:assert/strict'
import { test } from 'node:test'
import { membershipFilterFootnote } from '../src/lib/membershipFootnote.ts'
import { filterMembersByDollarVolume, MEMBER_MIN_DOLLAR_VOLUME_20 } from './memberDollarVolume.ts'

test('$20M member filter drops known names under the floor and keeps unknowns', () => {
  const members = [
    { ticker: 'BIG', company: 'Big Co' },
    { ticker: 'SMALL', company: 'Small Co' },
    { ticker: 'NEW', company: 'No quote yet' },
    { ticker: 'eq', company: 'Exact floor' },
  ]
  const quotes = new Map<string, { dollarVolume20: number }>([
    ['BIG', { dollarVolume20: 25_000_000 }],
    ['small', { dollarVolume20: 19_999_999 }],
    ['EQ', { dollarVolume20: 20_000_000 }],
  ])
  const out = filterMembersByDollarVolume(members, quotes)
  assert.equal(MEMBER_MIN_DOLLAR_VOLUME_20, 20_000_000)
  assert.equal(out.dollarVolumeFilterApplied, true)
  assert.equal(out.minDollarVolume20, 20_000_000)
  assert.equal(out.totalMembers, 4)
  assert.equal(out.filteredOut, 1)
  assert.equal(out.members.length + out.filteredOut, out.totalMembers)
  assert.deepEqual(
    out.members.map((member) => member.ticker),
    ['BIG', 'NEW', 'eq'],
  )
  assert.equal(out.members[0]?.dollarVolume20, 25_000_000)
  assert.equal(out.members[0]?.company, 'Big Co')
  assert.equal(out.members[1]?.dollarVolume20, undefined)
  assert.equal(out.members[2]?.dollarVolume20, 20_000_000)
})

test('$20M member filter is not applied when breadth quotes are missing', () => {
  const members = [{ ticker: 'A' }, { ticker: 'B' }]
  const out = filterMembersByDollarVolume(members, null)
  assert.equal(out.dollarVolumeFilterApplied, false)
  assert.equal(out.filteredOut, 0)
  assert.equal(out.totalMembers, 2)
  assert.deepEqual(
    out.members.map((member) => member.ticker),
    ['A', 'B'],
  )
  assert.equal(out.members[0]?.dollarVolume20, undefined)
})

test('non-finite dollar volume is treated as unknown and kept', () => {
  const out = filterMembersByDollarVolume(
    [{ ticker: 'NAN' }, { ticker: 'ZERO' }],
    new Map([
      ['NAN', { dollarVolume20: Number.NaN }],
      ['ZERO', { dollarVolume20: 0 }],
    ]),
  )
  assert.equal(out.dollarVolumeFilterApplied, true)
  assert.deepEqual(
    out.members.map((member) => member.ticker),
    ['NAN'],
  )
  assert.equal(out.filteredOut, 1)
})

test('theme tracker footnote uses snapshot filters and the dollar-volume status', () => {
  assert.equal(
    membershipFilterFootnote({
      filters: { minPrice: 5, minAvgVolume: 100_000 },
      dollarVolumeFilterApplied: true,
      filteredOut: 4,
      minDollarVolume20: 20_000_000,
    }),
    'price > $5, avg vol > 100K, 20d $vol ≥ $20M (4 hidden)',
  )
  assert.equal(
    membershipFilterFootnote({
      filters: { minPrice: 5, minAvgVolume: 750_000 },
      dollarVolumeFilterApplied: false,
    }),
    'price > $5, avg vol > 750K, 20d $vol filter pending',
  )
  assert.equal(
    membershipFilterFootnote({ dollarVolumeFilterApplied: false }),
    'price filter unknown, avg vol unknown, 20d $vol filter pending',
  )
})

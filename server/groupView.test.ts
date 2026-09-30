import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { matchesFilters } from '../src/lib/ideaFilters.ts'
import { groupViewFilterNote, selectGroupViewRows, type GroupViewRow } from '../src/lib/groupView.ts'
import { DEFAULT_FILTERS, type IdeaFilters, type SetupStage, type TradingIdea } from '../src/types/index.ts'

/**
 * Real-data sample trimmed from
 * GET /api/groups/semiconductors/stocks?period=3m
 * (qullamaggie-scanner-b29q.onrender.com). Finviz 3M order.
 */
const FINVIZ_3M_ORDER = [
  'SWKS',
  'QRVO',
  'SMTC',
  'NVDA',
  'AMD',
  'ASX',
  'MU',
  'TSM',
  'ADI',
  'QCOM',
  'MPWR',
  'HIMX',
  'MRVL',
  'AVGO',
  'UMC',
  'TXN',
  'INTC',
  'TSEM',
  'MCHP',
  'SIMO',
] as const

interface SampleIdea extends GroupViewRow {
  groupId: string
  aboveSma200: boolean
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'server/fixtures/semiconductors-3m-group.sample.json'), 'utf8'),
) as {
  label: string
  finvizPerf: Record<string, number | null>
  ideas: SampleIdea[]
}

function asScannerIdea(row: SampleIdea): TradingIdea {
  return row as unknown as TradingIdea
}

function row(ticker: string, extra: Partial<GroupViewRow> = {}): GroupViewRow {
  return {
    ticker,
    name: ticker,
    groupName: 'Semiconductors',
    setupStage: 'watching',
    aboveSma50: true,
    aboveSma10: true,
    aboveSma20: true,
    rvol: 1,
    pctFrom52wHigh: -1,
    setupType: 'Continuation',
    isAPlus: false,
    earningsStatus: 'clear',
    catalyst: null,
    characteristics: [],
    ...extra,
  }
}

function scannerIdea(partial: Partial<TradingIdea>): TradingIdea {
  return {
    ticker: 'AAA',
    name: 'Aaa Corp',
    groupId: 'semiconductors',
    groupName: 'Semiconductors',
    aboveSma200: true,
    aboveSma50: true,
    aboveSma10: true,
    aboveSma20: true,
    setupStage: 'coiled',
    rvol: 2,
    pctFrom52wHigh: -1,
    setupType: 'Continuation',
    isAPlus: false,
    earningsStatus: 'clear',
    catalyst: null,
    characteristics: [],
    ...partial,
  } as TradingIdea
}

test('real semiconductor sample: default filters keep all 20 in Finviz 3M order', () => {
  assert.match(fixture.label, /Real-data sample/)
  assert.equal(fixture.ideas.length, 20)
  const shuffled = [...fixture.ideas].reverse()
  const selected = selectGroupViewRows(shuffled, DEFAULT_FILTERS, fixture.finvizPerf)
  assert.equal(selected.total, 20)
  assert.equal(selected.hiddenCount, 0)
  assert.deepEqual(
    selected.rows.map((idea) => idea.ticker),
    [...FINVIZ_3M_ORDER],
  )
  assert.equal(selected.rows[4]?.ticker, 'AMD')
  const avgo = selected.rows.findIndex((idea) => idea.ticker === 'AVGO')
  const umc = selected.rows.findIndex((idea) => idea.ticker === 'UMC')
  assert.ok(avgo !== -1 && avgo < umc)
  assert.equal(selected.rows[avgo]?.aboveSma200, false)
  assert.deepEqual(
    shuffled.map((idea) => idea.ticker),
    [...FINVIZ_3M_ORDER].reverse(),
  )
})

test('real semiconductor sample: a changed minRvol hides rows and reports hiddenCount', () => {
  const filters: IdeaFilters = { ...DEFAULT_FILTERS, minRvol: 1.5 }
  const selected = selectGroupViewRows(fixture.ideas, filters, fixture.finvizPerf)
  assert.deepEqual(
    selected.rows.map((idea) => idea.ticker),
    ['QRVO'],
  )
  assert.equal(selected.total, 20)
  assert.equal(selected.hiddenCount, 19)
  assert.equal(selected.rows.length + selected.hiddenCount, selected.total)
  assert.ok(selected.rows.every((idea) => idea.rvol >= 1.5))
  assert.equal(
    groupViewFilterNote(selected.rows.length, selected.total, selected.hiddenCount),
    'Showing 1 of 20 group stocks (filters hiding 19)',
  )
})

test('real semiconductor sample: search always applies and a changed stage list filters', () => {
  const searched = selectGroupViewRows(
    fixture.ideas,
    { ...DEFAULT_FILTERS, search: 'amd' },
    fixture.finvizPerf,
  )
  assert.deepEqual(
    searched.rows.map((idea) => idea.ticker),
    ['AMD'],
  )
  assert.equal(searched.hiddenCount, 19)

  const stages: SetupStage[] = ['watching']
  const staged = selectGroupViewRows(
    fixture.ideas,
    { ...DEFAULT_FILTERS, stages },
    fixture.finvizPerf,
  )
  assert.ok(staged.rows.some((idea) => idea.ticker === 'AMD'))
  assert.ok(!staged.rows.some((idea) => idea.ticker === 'SWKS'))
  assert.ok(staged.hiddenCount > 0)
  assert.ok(staged.rows.every((idea) => idea.setupStage === 'watching'))
})

test('copied default stage list is not treated as a user change', () => {
  const filters: IdeaFilters = {
    ...DEFAULT_FILTERS,
    stages: ['triggering', 'coiled'],
    setupTypes: [...DEFAULT_FILTERS.setupTypes],
    earningsStatuses: [...DEFAULT_FILTERS.earningsStatuses],
  }
  const selected = selectGroupViewRows(fixture.ideas, filters, fixture.finvizPerf)
  assert.equal(selected.hiddenCount, 0)
  assert.equal(selected.rows[4]?.ticker, 'AMD')
  assert.equal(groupViewFilterNote(20, 20, 0), null)
})

test('group view orders null performance last and breaks ties by ticker', () => {
  const ideas = [row('ZZZ'), row('MMM'), row('AAA'), row('BBB')]
  const perf: Record<string, number | null> = { ZZZ: 5, MMM: null, AAA: 5 }
  const selected = selectGroupViewRows(ideas, DEFAULT_FILTERS, perf)
  assert.deepEqual(
    selected.rows.map((idea) => idea.ticker),
    ['AAA', 'ZZZ', 'BBB', 'MMM'],
  )
  assert.equal(selected.hiddenCount, 0)

  const zeros = selectGroupViewRows(
    [row('NIL'), row('NEG'), row('ZERO'), row('HIGH')],
    DEFAULT_FILTERS,
    { NIL: null, NEG: -2, ZERO: 0, HIGH: 3 },
  )
  assert.deepEqual(
    zeros.rows.map((idea) => idea.ticker),
    ['HIGH', 'ZERO', 'NEG', 'NIL'],
  )
})

test('normal scanner filters (groupView=false) are unchanged', () => {
  const groups = [{ id: 'semiconductors', name: 'Semiconductors', rsRank: 1, description: 'Semiconductors' }]
  assert.equal(
    matchesFilters(
      scannerIdea({ aboveSma200: false, aboveSma50: true, setupStage: 'coiled' }),
      DEFAULT_FILTERS,
      null,
      [],
      false,
    ),
    false,
  )
  assert.equal(
    matchesFilters(
      scannerIdea({ aboveSma200: true, aboveSma50: true, setupStage: 'watching' }),
      DEFAULT_FILTERS,
      null,
      [],
      false,
    ),
    false,
  )
  assert.equal(
    matchesFilters(
      scannerIdea({ aboveSma200: true, aboveSma50: false, setupStage: 'coiled' }),
      DEFAULT_FILTERS,
      null,
      [],
      false,
    ),
    false,
  )
  assert.equal(
    matchesFilters(
      scannerIdea({ aboveSma200: true, aboveSma50: true, setupStage: 'coiled' }),
      DEFAULT_FILTERS,
      null,
      [],
      false,
    ),
    true,
  )
  assert.equal(
    matchesFilters(
      scannerIdea({ ticker: 'AMD', name: 'Advanced Micro Devices, Inc.' }),
      { ...DEFAULT_FILTERS, search: 'nope' },
      null,
      [],
      false,
    ),
    false,
  )
  assert.equal(
    matchesFilters(
      scannerIdea({ ticker: 'AMD', name: 'Advanced Micro Devices, Inc.' }),
      { ...DEFAULT_FILTERS, search: 'amd' },
      null,
      [],
      false,
    ),
    true,
  )
  assert.equal(
    matchesFilters(
      scannerIdea({ groupId: 'other', groupName: 'Other', setupStage: 'coiled' }),
      { ...DEFAULT_FILTERS, groupId: 'semiconductors' },
      'fallback',
      groups,
      false,
    ),
    false,
  )
  assert.equal(
    matchesFilters(
      scannerIdea({ groupId: 'semiconductors', groupName: 'Semiconductors', setupStage: 'coiled' }),
      { ...DEFAULT_FILTERS, groupId: 'semiconductors' },
      'fallback',
      groups,
      false,
    ),
    true,
  )

  const amd = fixture.ideas.find((idea) => idea.ticker === 'AMD')
  const avgo = fixture.ideas.find((idea) => idea.ticker === 'AVGO')
  const swks = fixture.ideas.find((idea) => idea.ticker === 'SWKS')
  assert.ok(amd && avgo && swks)
  assert.equal(matchesFilters(asScannerIdea(amd), DEFAULT_FILTERS, null, [], false), false)
  assert.equal(matchesFilters(asScannerIdea(avgo), DEFAULT_FILTERS, null, [], false), false)
  assert.equal(matchesFilters(asScannerIdea(swks), DEFAULT_FILTERS, null, [], false), true)
  // Historical groupView=true path still exempts below-200 and still drops watching names.
  assert.equal(matchesFilters(asScannerIdea(amd), DEFAULT_FILTERS, null, [], true), false)
  assert.equal(matchesFilters(asScannerIdea(avgo), DEFAULT_FILTERS, null, [], true), true)
  const oldShown = fixture.ideas.filter((idea) =>
    matchesFilters(asScannerIdea(idea), DEFAULT_FILTERS, null, [], true),
  )
  assert.equal(oldShown.length, 8)
  assert.deepEqual(
    oldShown.map((idea) => idea.ticker).sort(),
    ['ASX', 'AVGO', 'MCHP', 'NVDA', 'QRVO', 'SMTC', 'SWKS', 'TSM'],
  )
})

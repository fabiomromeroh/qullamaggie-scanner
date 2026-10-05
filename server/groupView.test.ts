import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { passesFilters } from '../src/lib/ideaFilters.ts'
import { groupViewFilterNote, selectGroupViewRows, type GroupViewRow } from '../src/lib/groupView.ts'
import {
  ALL_SETUP_TYPES,
  DEFAULT_FILTERS,
  GROUP_VIEW_DEFAULT_FILTERS,
  type IdeaFilters,
  type SetupStage,
  type TradingIdea,
} from '../src/types/index.ts'

/**
 * Real-data sample trimmed from
 * GET /api/groups/semiconductors/stocks?period=3m
 * (qullamaggie-scanner-b29q.onrender.com). Finviz 3M order.
 *
 * PR #5 applied a group filter only when it differed from DEFAULT_FILTERS, so
 * a control that landed back on the scanner default (stages coiled+triggering,
 * Require 50 SMA, every setup type) did nothing. Group view now starts from
 * GROUP_VIEW_DEFAULT_FILTERS and passesFilters applies every control immediately.
 * Above 200 DMA is on in that baseline, so AVGO and MCHP (below the 200-day SMA)
 * are hidden until the chip is turned off.
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

const ABOVE_200_ORDER = FINVIZ_3M_ORDER.filter((ticker) => ticker !== 'AVGO' && ticker !== 'MCHP')

interface SampleIdea extends GroupViewRow {
  groupId: string
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'server/fixtures/semiconductors-3m-group.sample.json'), 'utf8'),
) as {
  label: string
  finvizPerf: Record<string, number | null>
  ideas: SampleIdea[]
}

function tickers(rows: readonly { ticker: string }[]): string[] {
  return rows.map((idea) => idea.ticker)
}

function hiddenTickers(selected: { rows: readonly { ticker: string }[] }): string[] {
  const shown = new Set(tickers(selected.rows))
  return fixture.ideas.map((idea) => idea.ticker).filter((ticker) => !shown.has(ticker)).sort()
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
    aboveSma200: true,
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
    surfer10: false,
    surfer20: false,
    surfer50: false,
    tightConsolidation: false,
    setupStage: 'coiled',
    rvol: 2,
    pctFrom52wHigh: -1,
    setupType: 'Range Breakout',
    isAPlus: false,
    earningsStatus: 'clear',
    catalyst: null,
    characteristics: [],
    ...partial,
  } as TradingIdea
}

test('group-view baseline shows 18 of 20 and keeps Finviz 3M order', () => {
  assert.match(fixture.label, /Real-data sample/)
  assert.equal(fixture.ideas.length, 20)
  const shuffled = [...fixture.ideas].reverse()
  const selected = selectGroupViewRows(shuffled, GROUP_VIEW_DEFAULT_FILTERS, fixture.finvizPerf)
  assert.equal(selected.total, 20)
  assert.equal(selected.rows.length, 18)
  assert.equal(selected.hiddenCount, 2)
  assert.deepEqual(hiddenTickers(selected), ['AVGO', 'MCHP'])
  assert.deepEqual(tickers(selected.rows), [...ABOVE_200_ORDER])
  assert.equal(selected.rows[4]?.ticker, 'AMD')
  assert.equal(
    groupViewFilterNote(selected.rows.length, selected.total, selected.hiddenCount),
    'Showing 18 of 20 group stocks (filters hiding 2)',
  )
  for (const ticker of ['AVGO', 'MCHP'] as const) {
    const idea = fixture.ideas.find((row) => row.ticker === ticker)
    assert.equal(idea?.aboveSma200, false)
    assert.ok(idea?.characteristics.includes('Below 200MA'))
  }
  assert.deepEqual(
    shuffled.map((idea) => idea.ticker),
    [...FINVIZ_3M_ORDER].reverse(),
  )
  for (const idea of fixture.ideas) {
    const pass = passesFilters(idea, GROUP_VIEW_DEFAULT_FILTERS, { groupView: true })
    const one = selectGroupViewRows([idea], GROUP_VIEW_DEFAULT_FILTERS, fixture.finvizPerf)
    assert.equal(one.rows.length === 1, pass, idea.ticker)
  }
})

test('requireAbove200 off shows all 20 group members', () => {
  const selected = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, requireAbove200: false },
    fixture.finvizPerf,
  )
  assert.equal(selected.rows.length, 20)
  assert.equal(selected.hiddenCount, 0)
  assert.equal(selected.total, 20)
  assert.deepEqual(tickers(selected.rows), [...FINVIZ_3M_ORDER])
  assert.equal(groupViewFilterNote(20, 20, 0), null)
  assert.equal(selected.rows.find((idea) => idea.ticker === 'AVGO')?.aboveSma200, false)
  assert.equal(selected.rows.find((idea) => idea.ticker === 'MCHP')?.aboveSma200, false)
})

test('group view applies a value equal to the scanner default and a non-default', () => {
  // stages coiled+triggering equals DEFAULT_FILTERS.stages. PR #5 skipped that,
  // so watching names stayed visible. It now hides them immediately.
  const stagesBack = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, stages: ['coiled', 'triggering'] },
    fixture.finvizPerf,
  )
  assert.ok(stagesBack.rows.every((idea) => idea.setupStage !== 'watching'))
  assert.ok(stagesBack.rows.some((idea) => idea.ticker === 'NVDA'))
  assert.ok(!stagesBack.rows.some((idea) => idea.ticker === 'AMD'))
  assert.ok(stagesBack.hiddenCount > 2)

  const stagesDefault = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, stages: ['watching', 'coiled', 'triggering'] },
    fixture.finvizPerf,
  )
  assert.equal(stagesDefault.rows.length, 18)
  assert.ok(stagesDefault.rows.some((idea) => idea.ticker === 'AMD'))

  const coiled: SetupStage[] = ['coiled']
  const staged = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, stages: coiled },
    fixture.finvizPerf,
  )
  assert.ok(staged.rows.length > 0)
  assert.ok(staged.rows.every((idea) => idea.setupStage === 'coiled'))
  assert.ok(staged.rows.some((idea) => idea.ticker === 'SWKS'))
  assert.ok(!staged.rows.some((idea) => idea.ticker === 'AMD'))
  assert.ok(staged.hiddenCount > 0)

  // Require 50 SMA equals the scanner default (true). With Above 200 DMA off,
  // AVGO (below 50 and below 200) hides and MCHP (above 50, below 200) stays.
  const smaOff = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, requireAbove200: false, requireSma50: false },
    fixture.finvizPerf,
  )
  assert.ok(smaOff.rows.some((idea) => idea.ticker === 'AVGO'))
  const smaOn = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, requireAbove200: false, requireSma50: true },
    fixture.finvizPerf,
  )
  assert.ok(!smaOn.rows.some((idea) => idea.ticker === 'AVGO'))
  assert.ok(smaOn.rows.some((idea) => idea.ticker === 'MCHP'))
  assert.equal(smaOn.rows.length, 19)
})

test('group view: min RVOL, search, and the other controls apply at once', () => {
  const minDefault = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, minRvol: 0 },
    fixture.finvizPerf,
  )
  assert.equal(minDefault.rows.length, 18)
  const minTight = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, minRvol: 1.5 },
    fixture.finvizPerf,
  )
  assert.deepEqual(tickers(minTight.rows), ['QRVO'])
  assert.equal(minTight.hiddenCount, 19)
  assert.equal(
    groupViewFilterNote(minTight.rows.length, minTight.total, minTight.hiddenCount),
    'Showing 1 of 20 group stocks (filters hiding 19)',
  )

  const searched = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, search: 'amd' },
    fixture.finvizPerf,
  )
  assert.deepEqual(tickers(searched.rows), ['AMD'])
  assert.equal(searched.hiddenCount, 19)
  const searchCleared = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, search: '' },
    fixture.finvizPerf,
  )
  assert.equal(searchCleared.rows.length, 18)

  const nearHigh = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, maxPctFromHigh: 5 },
    fixture.finvizPerf,
  )
  assert.ok(nearHigh.rows.some((idea) => idea.ticker === 'NVDA'))
  assert.ok(!nearHigh.rows.some((idea) => idea.ticker === 'QCOM'))
  const anyDistance = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, maxPctFromHigh: null },
    fixture.finvizPerf,
  )
  assert.ok(anyDistance.rows.some((idea) => idea.ticker === 'QCOM'))

  const continuation = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, setupTypes: ['Continuation'] },
    fixture.finvizPerf,
  )
  assert.ok(!continuation.rows.some((idea) => idea.ticker === 'QRVO'))
  const allTypes = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, setupTypes: [...ALL_SETUP_TYPES] },
    fixture.finvizPerf,
  )
  assert.ok(allTypes.rows.some((idea) => idea.ticker === 'QRVO'))
  assert.equal(allTypes.rows.length, 18)

  const aPlus = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, requireAPlus: true },
    fixture.finvizPerf,
  )
  assert.ok(aPlus.rows.some((idea) => idea.ticker === 'QRVO'))
  assert.ok(!aPlus.rows.some((idea) => idea.ticker === 'SWKS'))
  assert.ok(aPlus.rows.every((idea) => idea.isAPlus))
  const notAPlus = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, requireAPlus: false },
    fixture.finvizPerf,
  )
  assert.ok(notAPlus.rows.some((idea) => idea.ticker === 'SWKS'))

  const clearOnly = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, earningsStatuses: ['clear'] },
    fixture.finvizPerf,
  )
  assert.ok(!clearOnly.rows.some((idea) => idea.ticker === 'MU'))
  const allEarnings = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, earningsStatuses: ['clear', 'alert', 'avoid'] },
    fixture.finvizPerf,
  )
  assert.ok(allEarnings.rows.some((idea) => idea.ticker === 'MU'))

  const catalyst = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, hasCatalyst: true },
    fixture.finvizPerf,
  )
  assert.equal(catalyst.rows.length, 0)
  assert.equal(catalyst.hiddenCount, 20)
  const noCatalystGate = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, hasCatalyst: false },
    fixture.finvizPerf,
  )
  assert.equal(noCatalystGate.rows.length, 18)

  const surfer = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, requireSma10: true },
    fixture.finvizPerf,
  )
  assert.ok(!surfer.rows.some((idea) => idea.ticker === 'SWKS'))
  assert.ok(surfer.rows.every((idea) => idea.aboveSma10))
  const surferOff = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, requireSma10: false },
    fixture.finvizPerf,
  )
  assert.ok(surferOff.rows.some((idea) => idea.ticker === 'SWKS'))

  const sma20 = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, requireAbove200: false, requireSma20: true },
    fixture.finvizPerf,
  )
  assert.ok(!sma20.rows.some((idea) => idea.ticker === 'AVGO'))
  assert.ok(sma20.rows.some((idea) => idea.ticker === 'MCHP'))
  const sma20Off = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, requireAbove200: false, requireSma20: false },
    fixture.finvizPerf,
  )
  assert.ok(sma20Off.rows.some((idea) => idea.ticker === 'AVGO'))

  const strict10 = selectGroupViewRows(
    [
      scannerIdea({ ticker: 'YES10', surfer10: true }),
      scannerIdea({ ticker: 'NO10', surfer10: false }),
    ],
    { ...GROUP_VIEW_DEFAULT_FILTERS, requireSurfer10: true },
    { YES10: 2, NO10: 1 },
  )
  assert.deepEqual(tickers(strict10.rows), ['YES10'])
  const strict20 = selectGroupViewRows(
    [
      scannerIdea({ ticker: 'YES20', surfer20: true }),
      scannerIdea({ ticker: 'NO20', surfer20: false }),
    ],
    { ...GROUP_VIEW_DEFAULT_FILTERS, requireSurfer20: true },
    { YES20: 2, NO20: 1 },
  )
  assert.deepEqual(tickers(strict20.rows), ['YES20'])
  const strict50 = selectGroupViewRows(
    [
      scannerIdea({ ticker: 'YES50', surfer50: true }),
      scannerIdea({ ticker: 'NO50', surfer50: false }),
    ],
    { ...GROUP_VIEW_DEFAULT_FILTERS, requireSurfer50: true },
    { YES50: 2, NO50: 1 },
  )
  assert.deepEqual(tickers(strict50.rows), ['YES50'])
  const tightOn = selectGroupViewRows(
    [
      scannerIdea({ ticker: 'TIGHT', tightConsolidation: true }),
      scannerIdea({ ticker: 'LOOSE', tightConsolidation: false }),
    ],
    { ...GROUP_VIEW_DEFAULT_FILTERS, requireTight: true },
    { TIGHT: 2, LOOSE: 1 },
  )
  assert.deepEqual(tickers(tightOn.rows), ['TIGHT'])
  const strictOff = selectGroupViewRows(
    [
      scannerIdea({ ticker: 'NO10', surfer10: false, tightConsolidation: false }),
    ],
    {
      ...GROUP_VIEW_DEFAULT_FILTERS,
      requireSurfer10: false,
      requireSurfer20: false,
      requireSurfer50: false,
      requireTight: false,
    },
    { NO10: 1 },
  )
  assert.deepEqual(tickers(strictOff.rows), ['NO10'])

  // groupId selects the payload; it is not a second row filter.
  const wrongGroup = selectGroupViewRows(
    fixture.ideas,
    { ...GROUP_VIEW_DEFAULT_FILTERS, groupId: 'not-a-real-group' },
    fixture.finvizPerf,
  )
  assert.deepEqual(tickers(wrongGroup.rows), [...ABOVE_200_ORDER])
})

test('group view orders null performance last and breaks ties by ticker', () => {
  const ideas = [row('ZZZ'), row('MMM'), row('AAA'), row('BBB')]
  const perf: Record<string, number | null> = { ZZZ: 5, MMM: null, AAA: 5 }
  const selected = selectGroupViewRows(ideas, GROUP_VIEW_DEFAULT_FILTERS, perf)
  assert.deepEqual(tickers(selected.rows), ['AAA', 'ZZZ', 'BBB', 'MMM'])
  assert.equal(selected.hiddenCount, 0)

  const zeros = selectGroupViewRows(
    [row('NIL'), row('NEG'), row('ZERO'), row('HIGH')],
    GROUP_VIEW_DEFAULT_FILTERS,
    { NIL: null, NEG: -2, ZERO: 0, HIGH: 3 },
  )
  assert.deepEqual(tickers(zeros.rows), ['HIGH', 'ZERO', 'NEG', 'NIL'])
})

test('normal scanner defaults still hide below-200, watching, and below-50', () => {
  const groups = [{ id: 'semiconductors', name: 'Semiconductors', rsRank: 1, description: 'Semiconductors' }]
  assert.equal(
    passesFilters(
      scannerIdea({ aboveSma200: false, aboveSma50: true, setupStage: 'coiled' }),
      DEFAULT_FILTERS,
    ),
    false,
  )
  assert.equal(
    passesFilters(
      scannerIdea({ aboveSma200: true, aboveSma50: true, setupStage: 'watching' }),
      DEFAULT_FILTERS,
    ),
    false,
  )
  assert.equal(
    passesFilters(
      scannerIdea({ aboveSma200: true, aboveSma50: false, setupStage: 'coiled' }),
      DEFAULT_FILTERS,
    ),
    false,
  )
  assert.equal(
    passesFilters(
      scannerIdea({ aboveSma200: true, aboveSma50: true, setupStage: 'coiled' }),
      DEFAULT_FILTERS,
    ),
    true,
  )
  assert.equal(
    passesFilters(
      scannerIdea({ groupId: 'other', groupName: 'Other', setupStage: 'coiled' }),
      { ...DEFAULT_FILTERS, groupId: 'semiconductors' },
      { groupSource: 'fallback', groups },
    ),
    false,
  )
  assert.equal(
    passesFilters(
      scannerIdea({ groupId: 'semiconductors', groupName: 'Semiconductors', setupStage: 'coiled' }),
      { ...DEFAULT_FILTERS, groupId: 'semiconductors' },
      { groupView: true, groupSource: 'fallback', groups },
    ),
    true,
  )

  const amd = fixture.ideas.find((idea) => idea.ticker === 'AMD')
  const avgo = fixture.ideas.find((idea) => idea.ticker === 'AVGO')
  const swks = fixture.ideas.find((idea) => idea.ticker === 'SWKS')
  assert.ok(amd && avgo && swks)
  assert.equal(passesFilters(asScannerIdea(amd), DEFAULT_FILTERS), false)
  assert.equal(passesFilters(asScannerIdea(avgo), DEFAULT_FILTERS), false)
  assert.equal(passesFilters(asScannerIdea(swks), DEFAULT_FILTERS), false)
  // groupView no longer exempts below-200 names from stage or SMA gates.
  assert.equal(passesFilters(asScannerIdea(amd), DEFAULT_FILTERS, { groupView: true }), false)
  assert.equal(passesFilters(asScannerIdea(avgo), DEFAULT_FILTERS, { groupView: true }), false)
  const normalDefaults = fixture.ideas.filter((idea) =>
    passesFilters(asScannerIdea(idea), DEFAULT_FILTERS, { groupView: true }),
  )
  assert.deepEqual(
    normalDefaults.map((idea) => idea.ticker).sort(),
    ['QRVO'],
  )
})

test('passing the scanner defaults into group view now filters, it does not no-op', () => {
  const filters: IdeaFilters = {
    ...DEFAULT_FILTERS,
    stages: ['triggering', 'coiled'],
    setupTypes: [...DEFAULT_FILTERS.setupTypes],
    earningsStatuses: [...DEFAULT_FILTERS.earningsStatuses],
  }
  const selected = selectGroupViewRows(fixture.ideas, filters, fixture.finvizPerf)
  assert.deepEqual(tickers(selected.rows), ['QRVO'])
  assert.equal(selected.hiddenCount, 19)
})

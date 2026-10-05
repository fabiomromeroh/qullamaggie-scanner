import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { readJsonFrom, writeJsonTo, type KeyValueStore } from '../src/lib/persist.ts'
import {
  ABOVE_200_DMA_LABEL,
  ABOVE_200_DMA_TOOLTIP,
  FILTERS_STORAGE_KEY,
  FILTERS_STORAGE_V1_KEY,
  FILTERS_STORAGE_VERSION,
  SHOW_ALL_GROUP_LABEL,
  applyClearGroup,
  applyFilterChange,
  applyFilterReset,
  applyShowAllGroup,
  cloneIdeaFilters,
  countActiveFilters,
  countCatalystUnchecked,
  loadStoredScanFilters,
  matchesFilters,
  migrateStoredFilters,
  passesFilters,
  resetFilters,
  saveStoredScanFilters,
  showAllGroupFilters,
  type DashboardFilterState,
} from '../src/lib/ideaFilters.ts'
import { BAR_WINDOWS } from '../src/lib/metrics.ts'
import {
  ALL_EARNINGS_STATUSES,
  ALL_SETUP_TYPES,
  DEFAULT_FILTERS,
  DEFAULT_MIN_AVG_DOLLAR_VOL,
  GROUP_VIEW_DEFAULT_FILTERS,
  NEAR_HIGHS_PRESETS,
  type IdeaFilters,
  type TradingIdea,
} from '../src/types/index.ts'

function idea(partial: Partial<TradingIdea> = {}): TradingIdea {
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
    avgDollarVol: 100_000_000,
    pctFrom52wHigh: -1,
    setupType: 'Range Breakout',
    isAPlus: false,
    earningsStatus: 'clear',
    catalyst: null,
    characteristics: ['20MA Surfer'],
    ...partial,
  } as TradingIdea
}

function filters(partial: Partial<IdeaFilters> = {}): IdeaFilters {
  return { ...cloneIdeaFilters(DEFAULT_FILTERS), ...partial }
}

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

test('passesFilters truth table for each normal-scan control', () => {
  const groups = [{ id: 'semiconductors', name: 'Semiconductors', rsRank: 1, description: 'Semiconductors' }]
  const cases: { name: string; row: TradingIdea; f: IdeaFilters; pass: boolean; groupView?: boolean }[] = [
    { name: 'defaults pass a coiled name above 200 and 50', row: idea(), f: filters(), pass: true },
    {
      name: 'requireAbove200 on hides below 200',
      row: idea({ aboveSma200: false }),
      f: filters({ requireAbove200: true }),
      pass: false,
    },
    {
      name: 'requireAbove200 off shows below 200 when other gates pass',
      row: idea({ aboveSma200: false, aboveSma50: true, setupStage: 'coiled' }),
      f: filters({ requireAbove200: false }),
      pass: true,
    },
    {
      name: 'requireSma50 on',
      row: idea({ aboveSma50: false }),
      f: filters({ requireSma50: true }),
      pass: false,
    },
    {
      name: 'requireSma50 off',
      row: idea({ aboveSma50: false }),
      f: filters({ requireSma50: false }),
      pass: true,
    },
    {
      name: 'requireSma10 on',
      row: idea({ aboveSma10: false }),
      f: filters({ requireSma10: true }),
      pass: false,
    },
    {
      name: 'requireSma10 off',
      row: idea({ aboveSma10: false }),
      f: filters({ requireSma10: false }),
      pass: true,
    },
    {
      name: 'requireSma20 on',
      row: idea({ aboveSma20: false }),
      f: filters({ requireSma20: true }),
      pass: false,
    },
    {
      name: 'requireSma20 off',
      row: idea({ aboveSma20: false }),
      f: filters({ requireSma20: false }),
      pass: true,
    },
    {
      name: 'requireSurfer10 on hides non-strict',
      row: idea({ surfer10: false, aboveSma10: true }),
      f: filters({ requireSurfer10: true }),
      pass: false,
    },
    {
      name: 'requireSurfer10 on allows strict',
      row: idea({ surfer10: true }),
      f: filters({ requireSurfer10: true }),
      pass: true,
    },
    {
      name: 'requireSurfer10 off',
      row: idea({ surfer10: false }),
      f: filters({ requireSurfer10: false }),
      pass: true,
    },
    {
      name: 'requireSurfer20 on hides',
      row: idea({ surfer20: false }),
      f: filters({ requireSurfer20: true }),
      pass: false,
    },
    {
      name: 'requireSurfer20 on allows',
      row: idea({ surfer20: true }),
      f: filters({ requireSurfer20: true }),
      pass: true,
    },
    {
      name: 'requireSurfer50 on hides',
      row: idea({ surfer50: false }),
      f: filters({ requireSurfer50: true }),
      pass: false,
    },
    {
      name: 'requireSurfer50 on allows',
      row: idea({ surfer50: true }),
      f: filters({ requireSurfer50: true }),
      pass: true,
    },
    {
      name: 'requireTight on hides',
      row: idea({ tightConsolidation: false }),
      f: filters({ requireTight: true }),
      pass: false,
    },
    {
      name: 'requireTight on allows',
      row: idea({ tightConsolidation: true }),
      f: filters({ requireTight: true }),
      pass: true,
    },
    {
      name: 'requireTight off',
      row: idea({ tightConsolidation: false }),
      f: filters({ requireTight: false }),
      pass: true,
    },
    {
      name: 'stages exclude watching',
      row: idea({ setupStage: 'watching' }),
      f: filters({ stages: ['coiled', 'triggering'] }),
      pass: false,
    },
    {
      name: 'stages include watching',
      row: idea({ setupStage: 'watching' }),
      f: filters({ stages: ['watching', 'coiled', 'triggering'] }),
      pass: true,
    },
    {
      name: 'empty stages do not hide',
      row: idea({ setupStage: 'watching' }),
      f: filters({ stages: [] }),
      pass: true,
    },
    {
      name: 'minRvol hides',
      row: idea({ rvol: 1 }),
      f: filters({ minRvol: 1.5 }),
      pass: false,
    },
    {
      name: 'minRvol allows',
      row: idea({ rvol: 2 }),
      f: filters({ minRvol: 1.5 }),
      pass: true,
    },
    {
      name: 'minRvol 0 allows',
      row: idea({ rvol: 0 }),
      f: filters({ minRvol: 0 }),
      pass: true,
    },
    {
      name: 'default min dollar volume hides a name under $30M',
      row: idea({ avgDollarVol: DEFAULT_MIN_AVG_DOLLAR_VOL - 1 }),
      f: filters(),
      pass: false,
    },
    {
      name: 'default min dollar volume keeps a name at $30M',
      row: idea({ avgDollarVol: DEFAULT_MIN_AVG_DOLLAR_VOL }),
      f: filters(),
      pass: true,
    },
    {
      name: 'dollarVolume alias is used when avgDollarVol is missing',
      row: idea({ avgDollarVol: undefined, dollarVolume: 1_000_000 }),
      f: filters(),
      pass: false,
    },
    {
      name: 'missing dollar volume is kept',
      row: idea({ avgDollarVol: undefined }),
      f: filters(),
      pass: true,
    },
    {
      name: 'group-view floor of 0 keeps a thin name',
      row: idea({ avgDollarVol: 1_000_000 }),
      f: filters({ minAvgDollarVol: 0 }),
      pass: true,
    },
    {
      name: 'near highs 5 hides a name 10% under',
      row: idea({ pctFrom52wHigh: -10 }),
      f: filters({ maxPctFromHigh: 5 }),
      pass: false,
    },
    {
      name: 'near highs 5 allows a name 5% under',
      row: idea({ pctFrom52wHigh: -5 }),
      f: filters({ maxPctFromHigh: 5 }),
      pass: true,
    },
    {
      name: 'near highs 5 allows a print above the high',
      row: idea({ pctFrom52wHigh: 1.2 }),
      f: filters({ maxPctFromHigh: 5 }),
      pass: true,
    },
    {
      name: 'near highs 10 hides a name 15% under',
      row: idea({ pctFrom52wHigh: -15 }),
      f: filters({ maxPctFromHigh: 10 }),
      pass: false,
    },
    {
      name: 'near highs 10 allows a name 10% under',
      row: idea({ pctFrom52wHigh: -10 }),
      f: filters({ maxPctFromHigh: 10 }),
      pass: true,
    },
    {
      name: 'near highs Any (null) allows a deep name',
      row: idea({ pctFrom52wHigh: -80 }),
      f: filters({ maxPctFromHigh: null }),
      pass: true,
    },
    {
      name: 'maxExtensionAdr50 Any keeps a large extension',
      row: idea({ extensionAdr50: 6.2 }),
      f: filters({ maxExtensionAdr50: null }),
      pass: true,
    },
    {
      name: 'maxExtensionAdr50 hides above T',
      row: idea({ extensionAdr50: 3.1 }),
      f: filters({ maxExtensionAdr50: 3 }),
      pass: false,
    },
    {
      name: 'maxExtensionAdr50 keeps equal to T',
      row: idea({ extensionAdr50: 3 }),
      f: filters({ maxExtensionAdr50: 3 }),
      pass: true,
    },
    {
      name: 'maxExtensionAdr50 keeps below T',
      row: idea({ extensionAdr50: 1.2 }),
      f: filters({ maxExtensionAdr50: 3 }),
      pass: true,
    },
    {
      name: 'maxExtensionAdr50 keeps null unknown',
      row: idea({ extensionAdr50: null }),
      f: filters({ maxExtensionAdr50: 2 }),
      pass: true,
    },
    {
      name: 'maxExtensionAdr50 keeps missing unknown',
      row: idea({ extensionAdr50: undefined }),
      f: filters({ maxExtensionAdr50: 2 }),
      pass: true,
    },
    {
      name: 'maxExtensionAdr50 keeps negative (below 50 SMA)',
      row: idea({ extensionAdr50: -1.4, aboveSma50: false }),
      f: filters({ maxExtensionAdr50: 1, requireSma50: false }),
      pass: true,
    },
    {
      name: 'setup type mismatch',
      row: idea({ setupType: 'Continuation' }),
      f: filters({ setupTypes: ['Range Breakout'] }),
      pass: false,
    },
    {
      name: 'setup type match',
      row: idea({ setupType: 'Continuation' }),
      f: filters({ setupTypes: [...ALL_SETUP_TYPES] }),
      pass: true,
    },
    {
      name: 'A chip hides a name that is not A',
      row: idea({ isA: false, isAPlus: false }),
      f: filters({ requireA: true }),
      pass: false,
    },
    {
      name: 'A chip keeps isA, including when it is not A+',
      row: idea({ isA: true, isAPlus: false }),
      f: filters({ requireA: true }),
      pass: true,
    },
    {
      name: 'A+ chip hides a plain A',
      row: idea({ isA: true, isAPlus: false }),
      f: filters({ requireAPlus: true }),
      pass: false,
    },
    {
      name: 'A+ chip keeps isAPlus',
      row: idea({ isA: true, isAPlus: true, isAPlusPlus: true }),
      f: filters({ requireAPlus: true }),
      pass: true,
    },
    {
      name: 'A++ chip hides a plain A+',
      row: idea({ isA: true, isAPlus: true, isAPlusPlus: false }),
      f: filters({ requireAPlusPlus: true }),
      pass: false,
    },
    {
      name: 'A++ chip keeps isAPlusPlus',
      row: idea({ isA: true, isAPlus: true, isAPlusPlus: true }),
      f: filters({ requireAPlusPlus: true }),
      pass: true,
    },
    {
      name: 'A++ chip treats a missing flag as false',
      row: idea({ isA: true, isAPlus: true }),
      f: filters({ requireAPlusPlus: true }),
      pass: false,
    },
    {
      name: 'both quality chips off does not filter on the flags',
      row: idea({ isA: false, isAPlus: false }),
      f: filters({ requireA: false, requireAPlus: false }),
      pass: true,
    },
    {
      name: 'both quality chips keep A+ and also plain A',
      row: idea({ isA: true, isAPlus: false }),
      f: filters({ requireA: true, requireAPlus: true }),
      pass: true,
    },
    {
      name: 'earnings status hides avoid',
      row: idea({ earningsStatus: 'avoid' }),
      f: filters({ earningsStatuses: ['clear'] }),
      pass: false,
    },
    {
      name: 'earnings status all allows avoid',
      row: idea({ earningsStatus: 'avoid' }),
      f: filters({ earningsStatuses: [...ALL_EARNINGS_STATUSES] }),
      pass: true,
    },
    {
      name: 'catalyst required and missing',
      row: idea({ catalyst: null }),
      f: filters({ hasCatalyst: true }),
      pass: false,
    },
    {
      name: 'catalyst present',
      row: idea({ catalyst: 'FDA' }),
      f: filters({ hasCatalyst: true }),
      pass: true,
    },
    {
      name: 'hasCatalyst boolean wins over an empty string',
      row: idea({ catalyst: null, hasCatalyst: true, catalystStatus: 'checked' }),
      f: filters({ hasCatalyst: true }),
      pass: true,
    },
    {
      name: 'pending catalyst is excluded',
      row: idea({ catalyst: 'leftover', hasCatalyst: true, catalystStatus: 'pending' }),
      f: filters({ hasCatalyst: true }),
      pass: false,
    },
    {
      name: 'unchecked catalyst is excluded',
      row: idea({ hasCatalyst: false, catalystStatus: 'unchecked' }),
      f: filters({ hasCatalyst: true }),
      pass: false,
    },
    {
      name: 'catalyst not required',
      row: idea({ catalyst: null }),
      f: filters({ hasCatalyst: false }),
      pass: true,
    },
    {
      name: 'search miss',
      row: idea({ ticker: 'AMD', name: 'Advanced Micro Devices' }),
      f: filters({ search: 'nope' }),
      pass: false,
    },
    {
      name: 'search hit on ticker',
      row: idea({ ticker: 'AMD', name: 'Advanced Micro Devices' }),
      f: filters({ search: 'amd' }),
      pass: true,
    },
    {
      name: 'search hit on characteristic',
      row: idea({ characteristics: ['Below 200MA'] }),
      f: filters({ search: 'below 200' }),
      pass: true,
    },
    {
      name: 'empty search allows',
      row: idea(),
      f: filters({ search: '' }),
      pass: true,
    },
    {
      name: 'fallback groupId mismatch',
      row: idea({ groupId: 'other', groupName: 'Other' }),
      f: filters({ groupId: 'semiconductors' }),
      pass: false,
    },
    {
      name: 'fallback groupId match',
      row: idea({ groupId: 'semiconductors' }),
      f: filters({ groupId: 'semiconductors' }),
      pass: true,
    },
  ]

  for (const entry of cases) {
    const options = entry.f.groupId
      ? { groupView: entry.groupView, groupSource: 'fallback' as const, groups }
      : { groupView: entry.groupView }
    assert.equal(passesFilters(entry.row, entry.f, options), entry.pass, entry.name)
    assert.equal(
      matchesFilters(entry.row, entry.f, options.groupSource ?? null, groups, entry.groupView ?? false),
      entry.pass,
      `${entry.name} matchesFilters`,
    )
  }

  assert.equal(
    passesFilters(
      idea({ groupId: 'other', groupName: 'Other' }),
      filters({ groupId: 'semiconductors' }),
      { groupView: true, groupSource: 'fallback', groups },
    ),
    true,
  )
  assert.equal(
    passesFilters(
      idea({ surfer10: false, groupId: 'other' }),
      filters({ requireSurfer10: true, groupId: 'semiconductors' }),
      { groupView: true, groupSource: 'fallback', groups },
    ),
    false,
  )
  assert.equal(
    passesFilters(
      idea({ surfer10: true, groupId: 'other' }),
      filters({ requireSurfer10: true, groupId: 'semiconductors' }),
      { groupView: true, groupSource: 'fallback', groups },
    ),
    true,
  )
  assert.equal(
    passesFilters(
      idea({ surfer20: true, groupId: 'other' }),
      filters({ requireSurfer20: true, groupId: 'semiconductors' }),
      { groupView: true, groupSource: 'fallback', groups },
    ),
    true,
  )
  assert.equal(
    passesFilters(
      idea({ surfer50: false, groupId: 'other' }),
      filters({ requireSurfer50: true, groupId: 'semiconductors' }),
      { groupView: true, groupSource: 'fallback', groups },
    ),
    false,
  )
  assert.equal(
    passesFilters(
      idea({ tightConsolidation: true, groupId: 'other' }),
      filters({ requireTight: true, groupId: 'semiconductors' }),
      { groupView: true, groupSource: 'fallback', groups },
    ),
    true,
  )
  assert.equal(
    passesFilters(
      idea({ groupId: 'semiconductors', groupName: 'Semiconductors' }),
      filters({ groupId: 'semiconductors' }),
      { groupSource: 'finviz', groups },
    ),
    true,
  )
  assert.equal(
    passesFilters(
      idea({ groupId: 'other', groupName: 'Other Industry' }),
      filters({ groupId: 'semiconductors' }),
      { groupSource: 'finviz', groups },
    ),
    false,
  )
})

test('maxExtensionAdr50 Any keeps all; threshold excludes only known values above T', () => {
  const any = filters({ maxExtensionAdr50: null })
  for (const ext of [null, -2, 0, 1.5, 4.9, 12]) {
    assert.equal(
      passesFilters(idea({ extensionAdr50: ext, aboveSma50: true }), any),
      true,
      `Any should keep extensionAdr50=${String(ext)}`,
    )
  }
  const cap = filters({ maxExtensionAdr50: 2, requireSma50: false })
  assert.equal(passesFilters(idea({ extensionAdr50: 2.01 }), cap), false)
  assert.equal(passesFilters(idea({ extensionAdr50: 2 }), cap), true)
  assert.equal(passesFilters(idea({ extensionAdr50: null }), cap), true)
  assert.equal(passesFilters(idea({ extensionAdr50: -0.5, aboveSma50: false }), cap), true)
})

test('requireAbove200 and aboveSma200 missing fields do not throw', () => {
  const below = idea()
  delete (below as { aboveSma200?: boolean }).aboveSma200
  assert.equal(passesFilters(below, filters({ requireAbove200: true })), false)
  assert.equal(passesFilters(below, filters({ requireAbove200: false })), true)

  const legacy = filters()
  delete (legacy as { requireAbove200?: boolean }).requireAbove200
  assert.equal(passesFilters(idea({ aboveSma200: false }), legacy), false)
  assert.equal(passesFilters(idea({ aboveSma200: true }), legacy), true)
  assert.equal(passesFilters(idea({ characteristics: undefined }), filters({ search: 'aaa' })), true)
})

test('migrateStoredFilters fills requireAbove200 and rejects bad shapes', () => {
  const stored: Record<string, unknown> = { ...DEFAULT_FILTERS, minRvol: 1.25, search: 'nvda' }
  delete stored.requireAbove200
  delete stored.requireSurfer10
  delete stored.requireSurfer20
  delete stored.requireSurfer50
  delete stored.requireTight
  const migrated = migrateStoredFilters(stored)
  assert.equal(migrated.requireAbove200, true)
  assert.equal(migrated.minRvol, 1.25)
  assert.equal(migrated.search, 'nvda')
  assert.equal(migrated.requireSma50, true)
  assert.equal(migrated.requireSurfer10, false)
  assert.equal(migrated.requireSurfer20, false)
  assert.equal(migrated.requireSurfer50, false)
  assert.equal(migrated.requireTight, false)
  assert.deepEqual(migrated.stages, ['coiled', 'triggering'])
  assert.equal(countActiveFilters(migrated), 2)

  assert.equal(migrateStoredFilters({ requireAbove200: false }).requireAbove200, false)
  assert.equal(migrateStoredFilters({ requireAbove200: true }).requireAbove200, true)
  assert.equal(migrateStoredFilters({ requireAbove200: 'yes' }).requireAbove200, true)
  assert.equal(migrateStoredFilters({ requireAbove200: 0 }).requireAbove200, true)
  assert.equal(migrateStoredFilters(null).requireAbove200, true)
  assert.equal(migrateStoredFilters(undefined).minRvol, 0)
  assert.equal(migrateStoredFilters('nope').requireAbove200, true)
  assert.equal(migrateStoredFilters([]).requireSma50, true)
  assert.deepEqual(migrateStoredFilters({ stages: 'coiled' }).stages, ['coiled', 'triggering'])
  assert.deepEqual(migrateStoredFilters({ stages: ['watching', 'nope'] }).stages, ['watching'])
  assert.deepEqual(migrateStoredFilters({ stages: [] }).stages, ['coiled', 'triggering'])
  assert.equal(migrateStoredFilters({ groupId: '' }).groupId, null)
  assert.equal(migrateStoredFilters({ groupId: 4 }).groupId, null)
  assert.equal(migrateStoredFilters({ minRvol: Number.NaN }).minRvol, 0)
  assert.equal(BAR_WINDOWS.dolVolSessions, 20)
  assert.equal(DEFAULT_MIN_AVG_DOLLAR_VOL, 30_000_000)
  assert.equal(DEFAULT_FILTERS.minAvgDollarVol, DEFAULT_MIN_AVG_DOLLAR_VOL)
  assert.equal(GROUP_VIEW_DEFAULT_FILTERS.minAvgDollarVol, 0)
  assert.equal(migrateStoredFilters({}).minAvgDollarVol, DEFAULT_MIN_AVG_DOLLAR_VOL)
  assert.equal(migrateStoredFilters({ minAvgDollarVol: 0 }).minAvgDollarVol, 0)
  assert.equal(migrateStoredFilters({ minAvgDollarVol: Number.NaN }).minAvgDollarVol, DEFAULT_MIN_AVG_DOLLAR_VOL)
  assert.equal(migrateStoredFilters({ minAvgDollarVol: -5 }).minAvgDollarVol, 0)
  assert.equal(showAllGroupFilters().minAvgDollarVol, 0)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, minAvgDollarVol: 0 }), 1)
  assert.equal(migrateStoredFilters({}).maxExtensionAdr50, 5)
  assert.equal(migrateStoredFilters({ maxExtensionAdr50: 3 }).maxExtensionAdr50, 3)
  assert.equal(migrateStoredFilters({ maxExtensionAdr50: null }).maxExtensionAdr50, null)
  assert.equal(migrateStoredFilters({ maxExtensionAdr50: '2' }).maxExtensionAdr50, 5)
  assert.equal(migrateStoredFilters({ aPlusOnly: true }).requireAPlus, true)
  assert.equal(migrateStoredFilters({ aPlusOnly: true }).requireA, false)
  assert.equal(migrateStoredFilters({ aPlusOnly: false }).requireAPlus, false)
  assert.equal(migrateStoredFilters({ aPlusOnly: true, requireAPlus: false }).requireAPlus, false)
  assert.equal(migrateStoredFilters({ requireA: true }).requireA, true)
  assert.equal(migrateStoredFilters({}).maxPctFromHigh, null)
  assert.equal(migrateStoredFilters({ maxPctFromHigh: 100 }).maxPctFromHigh, null)
  assert.equal(migrateStoredFilters({ maxPctFromHigh: 150 }).maxPctFromHigh, null)
  assert.equal(migrateStoredFilters({ maxPctFromHigh: 10 }).maxPctFromHigh, 10)
  assert.equal(migrateStoredFilters({ maxPctFromHigh: 5 }).maxPctFromHigh, 5)
  assert.equal(migrateStoredFilters({ maxPctFromHigh: 8 }).maxPctFromHigh, 8)
  assert.equal(migrateStoredFilters({ maxPctFromHigh: 15 }).maxPctFromHigh, 15)
  assert.equal(migrateStoredFilters({ maxPctFromHigh: 20 }).maxPctFromHigh, 20)
  assert.equal(migrateStoredFilters({ maxPctFromHigh: null }).maxPctFromHigh, null)
  assert.equal(migrateStoredFilters({ maxPctFromHigh: 7 }).maxPctFromHigh, 8)
  assert.equal(migrateStoredFilters({ maxPctFromHigh: 9 }).maxPctFromHigh, 8)
  assert.equal(migrateStoredFilters({ maxPctFromHigh: 12 }).maxPctFromHigh, 10)
  assert.equal(migrateStoredFilters({ maxPctFromHigh: 99 }).maxPctFromHigh, 20)
  assert.equal(migrateStoredFilters({ maxPctFromHigh: '10' }).maxPctFromHigh, null)

  const explicit = migrateStoredFilters({
    ...DEFAULT_FILTERS,
    requireAbove200: false,
    stages: ['watching'],
    requireSma50: false,
  })
  assert.equal(explicit.requireAbove200, false)
  assert.deepEqual(explicit.stages, ['watching'])
  assert.equal(explicit.requireSma50, false)
  assert.deepEqual(migrateStoredFilters(explicit), explicit)
})

test('active-filter counter and reset include > 200 SMA', () => {
  assert.equal(ABOVE_200_DMA_LABEL, '> 200 SMA')
  assert.equal(countActiveFilters(DEFAULT_FILTERS), 0)
  assert.equal(countActiveFilters(GROUP_VIEW_DEFAULT_FILTERS, GROUP_VIEW_DEFAULT_FILTERS), 0)

  const off = { ...DEFAULT_FILTERS, requireAbove200: false }
  assert.equal(countActiveFilters(off), 1)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, requireAbove200: false, minRvol: 2 }), 2)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, requireSurfer10: true }), 1)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, requireSurfer20: true }), 1)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, requireSurfer50: true }), 1)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, requireTight: true }), 1)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, maxExtensionAdr50: 3 }), 1)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, maxExtensionAdr50: null }), 1)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, maxExtensionAdr50: 5 }), 0)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, requireA: true }), 1)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, requireAPlus: true }), 1)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, requireAPlusPlus: true }), 1)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, setupTypes: [...ALL_SETUP_TYPES] }), 1)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, setupTypes: ['Range Breakout'] }), 0)
  assert.deepEqual(DEFAULT_FILTERS.setupTypes, ['Range Breakout'])
  assert.deepEqual(GROUP_VIEW_DEFAULT_FILTERS.setupTypes, [...ALL_SETUP_TYPES])
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, maxPctFromHigh: 10 }), 1)
  assert.equal(countActiveFilters({ ...DEFAULT_FILTERS, maxPctFromHigh: null }), 0)
  assert.equal(DEFAULT_FILTERS.maxPctFromHigh, null)
  assert.equal(GROUP_VIEW_DEFAULT_FILTERS.maxPctFromHigh, null)
  assert.equal(
    countActiveFilters(
      { ...GROUP_VIEW_DEFAULT_FILTERS, maxExtensionAdr50: 2 },
      GROUP_VIEW_DEFAULT_FILTERS,
    ),
    1,
  )
  assert.equal(
    countActiveFilters(
      { ...DEFAULT_FILTERS, requireSurfer10: true, requireTight: true },
      DEFAULT_FILTERS,
    ),
    2,
  )
  assert.equal(
    countActiveFilters(
      { ...GROUP_VIEW_DEFAULT_FILTERS, requireSurfer50: true },
      GROUP_VIEW_DEFAULT_FILTERS,
    ),
    1,
  )

  const legacy = { ...DEFAULT_FILTERS } as IdeaFilters
  delete (legacy as { requireAbove200?: boolean }).requireAbove200
  assert.equal(countActiveFilters(legacy), 0)

  const restored = resetFilters(off)
  assert.equal(restored.requireAbove200, true)
  assert.equal(countActiveFilters(restored), 0)

  const groupDirty: IdeaFilters = {
    ...GROUP_VIEW_DEFAULT_FILTERS,
    requireAbove200: false,
    groupId: 'semiconductors',
    minRvol: 1.5,
  }
  assert.equal(countActiveFilters(groupDirty, GROUP_VIEW_DEFAULT_FILTERS), 3)
  const groupRestored = resetFilters(groupDirty, GROUP_VIEW_DEFAULT_FILTERS)
  assert.equal(groupRestored.requireAbove200, true)
  assert.equal(groupRestored.requireSma50, false)
  assert.equal(groupRestored.minRvol, 0)
  assert.equal(groupRestored.groupId, 'semiconductors')
  assert.deepEqual([...groupRestored.stages].sort(), ['coiled', 'triggering', 'watching'])
  assert.equal(countActiveFilters(groupRestored, GROUP_VIEW_DEFAULT_FILTERS), 1)

  const showAll = showAllGroupFilters()
  assert.equal(showAll.requireAbove200, false)
  assert.equal(showAll.requireSma50, false)
  assert.equal(showAll.requireSma10, false)
  assert.equal(showAll.requireSma20, false)
  assert.equal(showAll.requireSurfer10, false)
  assert.equal(showAll.requireSurfer20, false)
  assert.equal(showAll.requireSurfer50, false)
  assert.equal(showAll.requireTight, false)
  assert.equal(showAll.minRvol, 0)
  assert.equal(showAll.maxPctFromHigh, null)
  assert.equal(showAll.maxExtensionAdr50, null)
  assert.equal(DEFAULT_FILTERS.maxExtensionAdr50, 5)
  assert.equal(GROUP_VIEW_DEFAULT_FILTERS.maxExtensionAdr50, null)
  assert.equal(showAll.requireA, false)
  assert.equal(showAll.requireAPlus, false)
  assert.equal(showAll.requireAPlusPlus, false)
  assert.equal(DEFAULT_FILTERS.requireAPlusPlus, false)
  assert.equal(GROUP_VIEW_DEFAULT_FILTERS.requireAPlusPlus, false)
  assert.equal(DEFAULT_FILTERS.requireA, false)
  assert.equal(DEFAULT_FILTERS.requireAPlus, false)
  assert.equal(showAll.hasCatalyst, false)
  assert.equal(showAll.search, '')
  assert.equal(showAll.setupTypes.length, ALL_SETUP_TYPES.length)
  assert.equal(showAll.stages.length, 3)
  assert.equal(showAll.earningsStatuses.length, ALL_EARNINGS_STATUSES.length)
  assert.equal(countActiveFilters(showAll, GROUP_VIEW_DEFAULT_FILTERS), 1)
})

test('group edits do not clobber scan filters; reset and show-all are separate', () => {
  let state: DashboardFilterState = {
    scan: cloneIdeaFilters({ ...DEFAULT_FILTERS, minRvol: 2, stages: ['coiled'] }),
    group: cloneIdeaFilters(GROUP_VIEW_DEFAULT_FILTERS),
  }
  state = applyFilterChange(state, { ...state.scan, groupId: 'semiconductors' }, false)
  assert.equal(state.scan.minRvol, 2)
  assert.deepEqual(state.scan.stages, ['coiled'])
  assert.equal(state.scan.groupId, 'semiconductors')
  assert.equal(state.group.requireAbove200, true)
  assert.equal(state.group.requireSma50, false)
  assert.equal(state.group.minRvol, 0)
  assert.deepEqual([...state.group.stages].sort(), ['coiled', 'triggering', 'watching'])

  state = applyFilterChange(
    state,
    { ...state.group, groupId: 'semiconductors', minRvol: 1.5, requireAbove200: false },
    true,
  )
  assert.equal(state.scan.minRvol, 2)
  assert.equal(state.scan.requireAbove200, true)
  assert.equal(state.group.minRvol, 1.5)
  assert.equal(state.group.requireAbove200, false)
  assert.equal(state.group.groupId, null)

  state = applyFilterChange(state, { ...state.group, groupId: 'software', minRvol: 9 }, true)
  assert.equal(state.scan.groupId, 'software')
  assert.equal(state.scan.minRvol, 2)
  assert.equal(state.group.minRvol, 0)
  assert.equal(state.group.requireAbove200, true)

  state = applyShowAllGroup(state)
  assert.equal(state.group.requireAbove200, false)
  assert.equal(state.scan.minRvol, 2)
  assert.equal(state.scan.groupId, 'software')

  state = applyFilterReset(state)
  assert.equal(state.scan.minRvol, 0)
  assert.equal(state.scan.requireSma50, true)
  assert.equal(state.scan.requireAbove200, true)
  assert.deepEqual(state.scan.stages, ['coiled', 'triggering'])
  assert.equal(state.scan.groupId, 'software')
  assert.equal(state.group.requireAbove200, true)
  assert.equal(state.group.requireSma50, false)

  state = applyClearGroup(state)
  assert.equal(state.scan.groupId, null)
  assert.equal(state.scan.requireSma50, true)
  assert.equal(state.group.requireAbove200, true)
  assert.equal(state.group.requireSma50, false)
})

test('UI copy and README use the single > 200 SMA filter label', () => {
  const root = process.cwd()
  const bar = readFileSync(resolve(root, 'src/components/FiltersBar.tsx'), 'utf8')
  const table = readFileSync(resolve(root, 'src/components/IdeasTable.tsx'), 'utf8')
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
  assert.equal(ABOVE_200_DMA_LABEL, '> 200 SMA')
  assert.match(ABOVE_200_DMA_TOOLTIP, /Price above the 200-day SMA — below-200 names are not valid setups/)
  assert.match(
    ABOVE_200_DMA_TOOLTIP,
    /normal scan prefilters below-200 names server-side; toggle off only reveals names present in the payload, group view includes them/,
  )
  assert.match(bar, /ABOVE_200_DMA_LABEL/)
  assert.match(bar, /ABOVE_200_DMA_TOOLTIP/)
  assert.equal(SHOW_ALL_GROUP_LABEL, 'Show all (incl. below 200 DMA)')
  assert.match(table, /SHOW_ALL_GROUP_LABEL/)
  assert.match(bar, /> 10 SMA/)
  assert.match(bar, /> 20 SMA/)
  assert.match(bar, /> 50 SMA/)
  assert.match(bar, /10MA Surfer/)
  assert.match(bar, /20MA Surfer/)
  assert.match(bar, /50MA Surfer/)
  assert.doesNotMatch(bar, /Surfer \(strict\)/)
  assert.match(bar, /Tight consolidation/)
  assert.deepEqual([...NEAR_HIGHS_PRESETS], [5, 8, 10, 15, 20])
  assert.match(bar, /Min DolVol/)
  assert.match(bar, /aria-label="Min DolVol"/)
  assert.match(bar, /filterMinDollarVol/)
  assert.match(readme, /Min DolVol/)
  assert.match(readme, /LEADING_GROUPS_PERIOD/)
  assert.match(readme, /leading-groups-top12/)
  assert.match(bar, /Near highs ≤/)
  assert.match(bar, /aria-label="Near highs ≤"/)
  assert.match(bar, /NEAR_HIGHS_PRESETS/)
  assert.match(bar, /\{t\}%/)
  assert.doesNotMatch(bar, /Max % from high/)
  assert.match(bar, /Max ADR extension from 50 SMA/)
  assert.match(readme, /Near highs ≤/)
  assert.match(readme, /Any \| 5% \| 8% \| 10% \| 15% \| 20%/)
  assert.doesNotMatch(readme, /Max % from high/)
  assert.match(bar, /filterMaxExtensionAdr50/)
  assert.match(bar, /return 'Clear'/)
  assert.match(bar, /return 'Alert'/)
  assert.match(bar, /return 'Avoid'/)
  assert.match(bar, /\['watching', 'coiled', 'triggering'\]/)
  let cursor = -1
  for (const label of [
    'Search',
    'Group',
    'Numeric',
    'SMA',
    'Surfer (ADR-based)',
    'Tight consolidation',
    'Stage',
    'Setup type',
    'Earnings',
    'Other',
  ]) {
    const at = bar.indexOf(`<FilterGroup label="${label}"`, cursor + 1)
    assert.ok(at > cursor, label)
    cursor = at
  }
  assert.match(readme, /Above 200 DMA/)
  assert.match(readme, /ONE filter/)
  assert.match(
    readme,
    /normal scan prefilters below-200 names server-side; toggle off only reveals names present in the payload, group view includes them/,
  )
})

test('has-catalyst filter excludes pending and unchecked in both views', () => {
  const rows = [
    idea({ ticker: 'PEN', catalystStatus: 'pending', hasCatalyst: false, catalyst: 'leftover' }),
    idea({ ticker: 'CHK', catalystStatus: 'checked', hasCatalyst: true, catalyst: 'FDA approval' }),
    idea({ ticker: 'OLD', catalyst: 'FDA' }),
    idea({ ticker: 'UN', catalystStatus: 'unchecked', hasCatalyst: false }),
  ]
  const on = filters({ hasCatalyst: true })
  assert.equal(passesFilters(rows[0]!, on), false)
  assert.equal(passesFilters(rows[1]!, on), true)
  assert.equal(passesFilters(rows[2]!, on), true)
  assert.equal(passesFilters(rows[0]!, on, { groupView: true }), false)
  assert.equal(passesFilters(rows[1]!, on, { groupView: true }), true)
  assert.equal(countCatalystUnchecked(rows, on), 2)
  assert.equal(countCatalystUnchecked(rows, on, { groupView: true }), 2)
  assert.equal(countCatalystUnchecked(rows, filters({ hasCatalyst: false })), 0)
  const migrated = migrateStoredFilters({ hasCatalyst: true, requireSurfer10: true })
  assert.equal(migrated.hasCatalyst, true)
  assert.equal(migrated.requireSurfer10, true)
})

test('stored scan filters collapse the old all-three setup list once', () => {
  const legacyAll = {
    ...DEFAULT_FILTERS,
    setupTypes: [...ALL_SETUP_TYPES],
    minRvol: 1.5,
  }
  const collapsed = migrateStoredFilters(legacyAll)
  assert.deepEqual(collapsed.setupTypes, ['Range Breakout'])
  assert.equal(collapsed.minRvol, 1.5)

  const keptSubset = migrateStoredFilters({
    ...legacyAll,
    setupTypes: ['Episodic Pivot'],
    filtersVersion: 1,
  })
  assert.deepEqual(keptSubset.setupTypes, ['Episodic Pivot'])

  const explicit = migrateStoredFilters({
    ...legacyAll,
    filtersVersion: FILTERS_STORAGE_VERSION,
  })
  assert.deepEqual(explicit.setupTypes, [...ALL_SETUP_TYPES])

  const store = memoryStore()
  writeJsonTo(store, FILTERS_STORAGE_V1_KEY, legacyAll)
  const loaded = loadStoredScanFilters(store)
  assert.deepEqual(loaded.setupTypes, ['Range Breakout'])
  assert.equal(loaded.minRvol, 1.5)
  assert.equal(store.getItem(FILTERS_STORAGE_V1_KEY), null)
  const saved = readJsonFrom(store, FILTERS_STORAGE_KEY) as { filtersVersion: number; setupTypes: string[] }
  assert.equal(saved.filtersVersion, FILTERS_STORAGE_VERSION)
  assert.deepEqual(saved.setupTypes, ['Range Breakout'])

  saveStoredScanFilters({ ...loaded, setupTypes: [...ALL_SETUP_TYPES] }, store)
  assert.deepEqual(loadStoredScanFilters(store).setupTypes, [...ALL_SETUP_TYPES])

  const corrupt = memoryStore({
    [FILTERS_STORAGE_KEY]: '{not json',
    [FILTERS_STORAGE_V1_KEY]: JSON.stringify({ ...legacyAll, setupTypes: ['Episodic Pivot'], minRvol: 4 }),
  })
  assert.doesNotThrow(() => loadStoredScanFilters(corrupt))
  assert.deepEqual(loadStoredScanFilters(corrupt).setupTypes, ['Range Breakout'])
  assert.equal(loadStoredScanFilters(corrupt).minRvol, DEFAULT_FILTERS.minRvol)
  assert.ok(corrupt.getItem(FILTERS_STORAGE_V1_KEY))
  assert.equal(loadStoredScanFilters(null).requireAPlusPlus, false)
})

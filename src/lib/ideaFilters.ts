import { ideaMatchesFinvizGroup } from './groupMatch'
import {
  ALL_EARNINGS_STATUSES,
  ALL_SETUP_TYPES,
  DEFAULT_FILTERS,
  GROUP_VIEW_DEFAULT_FILTERS,
  NEAR_HIGHS_PRESETS,
  type EarningsStatus,
  type IdeaFilters,
  type IndustryGroup,
  type SetupStage,
  type SetupType,
  type TradingIdea,
} from '../types'

/** Chip label. One filter — not a set of moving-average variants. */
export const ABOVE_200_DMA_LABEL = 'Above 200 DMA'

/**
 * Hover text for the Above 200 DMA chip.
 * The second sentence is the normal-scan payload limit (Stage 1.5 drops
 * below-200 names before they are scored).
 */
export const ABOVE_200_DMA_TOOLTIP =
  'Price above the 200-day SMA — below-200 names are not valid setups. normal scan prefilters below-200 names server-side; toggle off only reveals names present in the payload, group view includes them.'

/** Group banner control: most permissive group filters, including below-200 names. */
export const SHOW_ALL_GROUP_LABEL = 'Show all (incl. below 200 DMA)'

const SETUP_STAGES: readonly SetupStage[] = ['watching', 'coiled', 'triggering']

/**
 * Row fields the shared predicate reads. `aboveSma200` may be missing on an
 * older payload; a missing flag fails the Above 200 DMA gate (no throw).
 */
export interface FilterableIdea {
  ticker: string
  name: string
  groupId?: string
  groupName: string
  setupStage: SetupStage
  aboveSma200?: boolean
  aboveSma50: boolean
  aboveSma10: boolean
  aboveSma20: boolean
  /** Strict ride flags. Missing is treated as false (fail closed when required). */
  surfer10?: boolean
  surfer20?: boolean
  surfer50?: boolean
  tightConsolidation?: boolean
  rvol: number
  /** Average dollar volume. Missing is kept when a floor is set. */
  avgDollarVol?: number
  /** Alias of avgDollarVol. Used when avgDollarVol is absent. */
  dollarVolume?: number
  pctFrom52wHigh: number
  /**
   * ADR multiples from the 50 SMA. Missing/null is treated as unknown and
   * kept when a max-extension threshold is set.
   */
  extensionAdr50?: number | null
  setupType: SetupType
  /** Missing is treated as false when the A chip is on. */
  isA?: boolean
  isAPlus: boolean
  earningsStatus: EarningsStatus
  catalyst: string | null
  /** Present on merged payloads. Undefined falls back to a non-null `catalyst` string. */
  hasCatalyst?: boolean
  /** pending/unchecked are not a catalyst yet; the Has-catalyst chip excludes them. */
  catalystStatus?: 'checked' | 'pending' | 'unchecked' | 'error'
  characteristics?: readonly string[]
}

export interface PassesFiltersOptions {
  /** When true, `groupId` is not applied. Every other field still applies. */
  groupView?: boolean
  groupSource?: 'finviz' | 'fallback' | null
  groups?: readonly IndustryGroup[]
}

export interface DashboardFilterState {
  scan: IdeaFilters
  group: IdeaFilters
}

/** Missing `requireAbove200` stays ON so an older filter object keeps today's gate. */
export function requireAbove200On(filters: { requireAbove200?: boolean } | null | undefined): boolean {
  return filters?.requireAbove200 !== false
}

export function cloneIdeaFilters(filters: IdeaFilters): IdeaFilters {
  return {
    minRvol: filters.minRvol,
    minAvgDollarVol: filters.minAvgDollarVol,
    maxPctFromHigh: filters.maxPctFromHigh ?? null,
    maxExtensionAdr50: filters.maxExtensionAdr50 ?? null,
    setupTypes: [...(filters.setupTypes ?? [])],
    requireA: Boolean(filters.requireA),
    requireAPlus: Boolean(filters.requireAPlus),
    hasCatalyst: filters.hasCatalyst,
    requireAbove200: requireAbove200On(filters),
    requireSma50: filters.requireSma50,
    requireSma10: filters.requireSma10,
    requireSma20: filters.requireSma20,
    requireSurfer10: Boolean(filters.requireSurfer10),
    requireSurfer20: Boolean(filters.requireSurfer20),
    requireSurfer50: Boolean(filters.requireSurfer50),
    requireTight: Boolean(filters.requireTight),
    stages: [...(filters.stages ?? [])],
    earningsStatuses: [...(filters.earningsStatuses ?? [])],
    groupId: filters.groupId ?? null,
    search: filters.search ?? '',
  }
}

/**
 * Most permissive group-view filters: Above 200 DMA off, and every other
 * control wide open. Not the group baseline (that baseline still hides below-200).
 */
export function showAllGroupFilters(): IdeaFilters {
  return cloneIdeaFilters({
    ...GROUP_VIEW_DEFAULT_FILTERS,
    requireAbove200: false,
    requireSma50: false,
    requireSma10: false,
    requireSma20: false,
    requireSurfer10: false,
    requireSurfer20: false,
    requireSurfer50: false,
    requireTight: false,
    minRvol: 0,
    minAvgDollarVol: 0,
    maxPctFromHigh: null,
    maxExtensionAdr50: null,
    requireA: false,
    requireAPlus: false,
    hasCatalyst: false,
    search: '',
    groupId: null,
    setupTypes: [...ALL_SETUP_TYPES],
    stages: [...SETUP_STAGES],
    earningsStatuses: [...ALL_EARNINGS_STATUSES],
  })
}

function sameMembers(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = [...(a ?? [])].sort()
  const right = [...(b ?? [])].sort()
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

/**
 * How many controls differ from `baseline` (normal defaults, or the group-view
 * baseline while a group is selected). Above 200 DMA counts when it is off
 * relative to a baseline that has it on.
 */
export function countActiveFilters(
  filters: IdeaFilters,
  baseline: IdeaFilters = DEFAULT_FILTERS,
): number {
  let n = 0
  if ((filters.search ?? '').trim() !== (baseline.search ?? '').trim()) n += 1
  if (filters.minRvol !== baseline.minRvol) n += 1
  if (filters.minAvgDollarVol !== baseline.minAvgDollarVol) n += 1
  if ((filters.maxPctFromHigh ?? null) !== (baseline.maxPctFromHigh ?? null)) n += 1
  if ((filters.maxExtensionAdr50 ?? null) !== (baseline.maxExtensionAdr50 ?? null)) n += 1
  if ((filters.groupId ?? null) !== (baseline.groupId ?? null)) n += 1
  if (!sameMembers(filters.setupTypes, baseline.setupTypes)) n += 1
  if (!sameMembers(filters.stages, baseline.stages)) n += 1
  if (Boolean(filters.requireSma50) !== Boolean(baseline.requireSma50)) n += 1
  if (Boolean(filters.requireSma10) !== Boolean(baseline.requireSma10)) n += 1
  if (Boolean(filters.requireSma20) !== Boolean(baseline.requireSma20)) n += 1
  if (Boolean(filters.requireSurfer10) !== Boolean(baseline.requireSurfer10)) n += 1
  if (Boolean(filters.requireSurfer20) !== Boolean(baseline.requireSurfer20)) n += 1
  if (Boolean(filters.requireSurfer50) !== Boolean(baseline.requireSurfer50)) n += 1
  if (Boolean(filters.requireTight) !== Boolean(baseline.requireTight)) n += 1
  if (requireAbove200On(filters) !== requireAbove200On(baseline)) n += 1
  if (!sameMembers(filters.earningsStatuses, baseline.earningsStatuses)) n += 1
  if (Boolean(filters.requireA) !== Boolean(baseline.requireA)) n += 1
  if (Boolean(filters.requireAPlus) !== Boolean(baseline.requireAPlus)) n += 1
  if (Boolean(filters.hasCatalyst) !== Boolean(baseline.hasCatalyst)) n += 1
  return n
}

/** Copy `baseline`, keeping the current group selection. */
export function resetFilters(
  current: IdeaFilters,
  baseline: IdeaFilters = DEFAULT_FILTERS,
): IdeaFilters {
  return {
    ...cloneIdeaFilters(baseline),
    groupId: current.groupId ?? null,
  }
}

function pickList<T extends string>(value: unknown, allowed: readonly T[], fallback: readonly T[]): T[] {
  if (!Array.isArray(value)) return [...fallback]
  const ok = new Set<string>(allowed)
  const next: T[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !ok.has(item) || next.includes(item as T)) continue
    next.push(item as T)
  }
  return next.length ? next : [...fallback]
}

function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function pickNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function pickNumOrNull(value: unknown, fallback: number | null): number | null {
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return fallback
}

/**
 * Stored near-highs threshold → preset or Any.
 * 100 and any value >= 100 become null (the old free-number default hid nothing).
 * Exact presets 5, 8, 10, 15, and 20 are kept. Any other finite number snaps to
 * the nearest preset; an equal distance keeps the lower preset. Missing or
 * non-numeric values are Any.
 */
function migrateMaxPctFromHigh(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value >= 100) return null
  let best: number = NEAR_HIGHS_PRESETS[0]
  let bestDist = Math.abs(value - best)
  for (const preset of NEAR_HIGHS_PRESETS) {
    if (value === preset) return preset
    const dist = Math.abs(value - preset)
    if (dist < bestDist) {
      best = preset
      bestDist = dist
    }
  }
  return best
}

/**
 * Filters are not stored in localStorage. This still accepts an older object
 * (for example one read from storage later) that has no `requireAbove200` and
 * fills that field with true. Explicit `false` is kept. Invalid shapes fall
 * back field-by-field and do not throw.
 */
export function migrateStoredFilters(raw: unknown): IdeaFilters {
  const base = cloneIdeaFilters(DEFAULT_FILTERS)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const src = raw as Record<string, unknown>
  return {
    minRvol: pickNum(src.minRvol, base.minRvol),
    minAvgDollarVol: Math.max(0, pickNum(src.minAvgDollarVol, base.minAvgDollarVol)),
    maxPctFromHigh: migrateMaxPctFromHigh(src.maxPctFromHigh),
    maxExtensionAdr50: pickNumOrNull(src.maxExtensionAdr50, base.maxExtensionAdr50),
    setupTypes: pickList(src.setupTypes, ALL_SETUP_TYPES, base.setupTypes),
    requireA: pickBool(src.requireA, base.requireA),
    // A stored aPlusOnly: true (the old single chip) becomes requireAPlus
    // when the new field is absent. An explicit requireAPlus boolean wins.
    requireAPlus:
      typeof src.requireAPlus === 'boolean'
        ? src.requireAPlus
        : src.aPlusOnly === true
          ? true
          : base.requireAPlus,
    hasCatalyst: pickBool(src.hasCatalyst, base.hasCatalyst),
    requireAbove200: src.requireAbove200 === false ? false : true,
    requireSma50: pickBool(src.requireSma50, base.requireSma50),
    requireSma10: pickBool(src.requireSma10, base.requireSma10),
    requireSma20: pickBool(src.requireSma20, base.requireSma20),
    requireSurfer10: pickBool(src.requireSurfer10, false),
    requireSurfer20: pickBool(src.requireSurfer20, false),
    requireSurfer50: pickBool(src.requireSurfer50, false),
    requireTight: pickBool(src.requireTight, false),
    stages: pickList(src.stages, SETUP_STAGES, base.stages),
    earningsStatuses: pickList(src.earningsStatuses, ALL_EARNINGS_STATUSES, base.earningsStatuses),
    groupId: typeof src.groupId === 'string' && src.groupId.trim() ? src.groupId : null,
    search: typeof src.search === 'string' ? src.search : '',
  }
}

/**
 * Has-catalyst predicate. A real `hasCatalyst` boolean wins. Older payloads
 * that only have the display string still match. Pending and unchecked rows
 * never match, so the chip does not treat "not looked up yet" as a no.
 */
export function ideaHasCatalyst(idea: {
  catalyst?: string | null
  hasCatalyst?: boolean
  catalystStatus?: 'checked' | 'pending' | 'unchecked' | 'error'
}): boolean {
  if (idea.catalystStatus === 'pending' || idea.catalystStatus === 'unchecked') return false
  if (idea.hasCatalyst !== undefined) return idea.hasCatalyst
  return Boolean(idea.catalyst)
}

/**
 * Rows that pass every other filter but have not been news-checked yet.
 * Shown next to the Has-catalyst chip so those names are not silently dropped.
 */
export function countCatalystUnchecked(
  ideas: readonly FilterableIdea[],
  filters: IdeaFilters,
  options: PassesFiltersOptions = {},
): number {
  if (!filters.hasCatalyst) return 0
  const relaxed: IdeaFilters = { ...filters, hasCatalyst: false }
  return ideas.filter((idea) => {
    if (!passesFilters(idea, relaxed, options)) return false
    return idea.catalystStatus === 'pending' || idea.catalystStatus === 'unchecked'
  }).length
}

/**
 * Shared predicate for the scanner table and group drill-down.
 * Every filter value is applied as written. `groupView` skips only `groupId`.
 * Above 200 DMA replaces the old normal-scan hard gate (`requireAbove200`
 * missing means on). Group view does not exempt below-200 names from the
 * other gates; its baseline is just more permissive.
 */
export function passesFilters(
  idea: FilterableIdea,
  f: IdeaFilters,
  options: PassesFiltersOptions = {},
): boolean {
  const groupView = options.groupView === true
  if (requireAbove200On(f) && !idea.aboveSma200) return false
  if (f.requireSma50 && !idea.aboveSma50) return false
  if (f.requireSma10 && !idea.aboveSma10) return false
  if (f.requireSma20 && !idea.aboveSma20) return false
  if (f.requireSurfer10 && !idea.surfer10) return false
  if (f.requireSurfer20 && !idea.surfer20) return false
  if (f.requireSurfer50 && !idea.surfer50) return false
  if (f.requireTight && !idea.tightConsolidation) return false
  if (f.stages?.length && !f.stages.includes(idea.setupStage)) return false
  if (typeof f.minRvol === 'number' && idea.rvol < f.minRvol) return false
  if (
    typeof f.minAvgDollarVol === 'number' &&
    Number.isFinite(f.minAvgDollarVol) &&
    f.minAvgDollarVol > 0
  ) {
    const raw = idea.avgDollarVol ?? idea.dollarVolume
    const dol = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
    if (dol != null && dol < f.minAvgDollarVol) return false
  }
  const pct = typeof idea.pctFrom52wHigh === 'number' ? idea.pctFrom52wHigh : 0
  const distance = Math.abs(Math.min(0, pct))
  // Near highs: null is Any (no filter). A print above the high has distance 0.
  if (
    typeof f.maxPctFromHigh === 'number' &&
    Number.isFinite(f.maxPctFromHigh) &&
    distance > f.maxPctFromHigh
  ) {
    return false
  }
  // Max ADR extension from 50 SMA: exclude known values strictly above T.
  // Unknown (null/missing/non-finite) is kept. Negative (below the 50 SMA) always passes.
  if (typeof f.maxExtensionAdr50 === 'number' && Number.isFinite(f.maxExtensionAdr50)) {
    const ext = idea.extensionAdr50
    if (typeof ext === 'number' && Number.isFinite(ext) && ext > f.maxExtensionAdr50) return false
  }
  if (f.setupTypes && !f.setupTypes.includes(idea.setupType)) return false
  // Quality chips are a union. Both off skips the gate. A+ implies A, so
  // turning both on keeps every A, including A+.
  if (f.requireA || f.requireAPlus) {
    const keepA = f.requireA && idea.isA === true
    const keepPlus = f.requireAPlus && idea.isAPlus === true
    if (!keepA && !keepPlus) return false
  }
  if (f.earningsStatuses?.length && !f.earningsStatuses.includes(idea.earningsStatus)) return false
  if (f.hasCatalyst && !ideaHasCatalyst(idea)) return false
  if (!groupView && f.groupId) {
    const groups = options.groups ?? []
    if (options.groupSource === 'finviz') {
      const group = groups.find((item) => item.id === f.groupId)
      if (!group || !ideaMatchesFinvizGroup(
        { groupId: idea.groupId ?? '', groupName: idea.groupName },
        group,
      )) {
        return false
      }
    } else if (idea.groupId !== f.groupId) {
      return false
    }
  }
  if (f.search) {
    const q = f.search.toLowerCase()
    const hay =
      `${idea.ticker} ${idea.name} ${idea.groupName} ${idea.setupStage} ${(idea.characteristics ?? []).join(' ')}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

/** Normal-scan wrapper. `groupView` is retained so older callers keep compiling. */
export function matchesFilters(
  idea: TradingIdea,
  f: IdeaFilters,
  groupSource: 'finviz' | 'fallback' | null,
  groups: IndustryGroup[],
  groupView = false,
): boolean {
  return passesFilters(idea, f, { groupView, groupSource, groups })
}

/**
 * Route a filter-bar edit to the scan state or the group-view state.
 * Changing `groupId` resets group filters to {@link GROUP_VIEW_DEFAULT_FILTERS}
 * and does not copy group-view fields onto the scan filters.
 */
export function applyFilterChange(
  state: DashboardFilterState,
  next: IdeaFilters,
  groupViewActive: boolean,
): DashboardFilterState {
  const nextGroupId = next.groupId ?? null
  const groupChanged = nextGroupId !== (state.scan.groupId ?? null)
  if (groupChanged) {
    const scan = groupViewActive
      ? { ...state.scan, groupId: nextGroupId }
      : cloneIdeaFilters({ ...next, groupId: nextGroupId })
    return {
      scan,
      group: cloneIdeaFilters(GROUP_VIEW_DEFAULT_FILTERS),
    }
  }
  if (groupViewActive) {
    return {
      scan: state.scan,
      group: cloneIdeaFilters({ ...next, groupId: null }),
    }
  }
  return {
    scan: cloneIdeaFilters(next),
    group: state.group,
  }
}

/** Filter-bar Reset: normal scan back to defaults (group kept); group baseline restored. */
export function applyFilterReset(state: DashboardFilterState): DashboardFilterState {
  return {
    scan: { ...cloneIdeaFilters(DEFAULT_FILTERS), groupId: state.scan.groupId ?? null },
    group: cloneIdeaFilters(GROUP_VIEW_DEFAULT_FILTERS),
  }
}

/** Leave the group. Scan filter fields stay; the next group starts from its baseline. */
export function applyClearGroup(state: DashboardFilterState): DashboardFilterState {
  return {
    scan: { ...state.scan, groupId: null },
    group: cloneIdeaFilters(GROUP_VIEW_DEFAULT_FILTERS),
  }
}

/** Show every group member, including names below the 200-day SMA. */
export function applyShowAllGroup(state: DashboardFilterState): DashboardFilterState {
  return {
    scan: state.scan,
    group: showAllGroupFilters(),
  }
}

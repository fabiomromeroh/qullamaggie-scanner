import type { IdeaFilters, SetupStage, SetupType, EarningsStatus } from '../types'
import { DEFAULT_FILTERS } from '../types'

/**
 * Rows for a Finviz group drill-down.
 * Preference filters apply only when they differ from DEFAULT_FILTERS.
 * Search always applies. Order is the selected period's performance
 * (`finvizPerf`): descending, nulls last, ticker ascending on a tie.
 */
export interface GroupViewRow {
  ticker: string
  name: string
  groupName: string
  setupStage: SetupStage
  aboveSma50: boolean
  aboveSma10: boolean
  aboveSma20: boolean
  rvol: number
  pctFrom52wHigh: number
  setupType: SetupType
  isAPlus: boolean
  earningsStatus: EarningsStatus
  catalyst: string | null
  characteristics: readonly string[]
}

export interface GroupViewSelection<T> {
  rows: T[]
  hiddenCount: number
  total: number
}

export function groupViewFilterNote(
  shown: number,
  total: number,
  hiddenCount: number,
): string | null {
  if (hiddenCount <= 0) return null
  return `Showing ${shown} of ${total} group stocks (filters hiding ${hiddenCount})`
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

function matchesSearch(idea: GroupViewRow, search: string): boolean {
  if (!search) return true
  const q = search.toLowerCase()
  const hay =
    `${idea.ticker} ${idea.name} ${idea.groupName} ${idea.setupStage} ${idea.characteristics.join(' ')}`.toLowerCase()
  return hay.includes(q)
}

function passesGroupViewFilters(idea: GroupViewRow, filters: IdeaFilters): boolean {
  if (filters.requireSma50 !== DEFAULT_FILTERS.requireSma50 && filters.requireSma50 && !idea.aboveSma50) {
    return false
  }
  if (filters.requireSma10 !== DEFAULT_FILTERS.requireSma10 && filters.requireSma10 && !idea.aboveSma10) {
    return false
  }
  if (filters.requireSma20 !== DEFAULT_FILTERS.requireSma20 && filters.requireSma20 && !idea.aboveSma20) {
    return false
  }
  if (!sameMembers(filters.stages, DEFAULT_FILTERS.stages)) {
    if (filters.stages.length && !filters.stages.includes(idea.setupStage)) return false
  }
  if (filters.minRvol !== DEFAULT_FILTERS.minRvol && idea.rvol < filters.minRvol) return false
  if (filters.maxPctFromHigh !== DEFAULT_FILTERS.maxPctFromHigh) {
    const distance = Math.abs(Math.min(0, idea.pctFrom52wHigh))
    if (distance > filters.maxPctFromHigh) return false
  }
  if (!sameMembers(filters.setupTypes, DEFAULT_FILTERS.setupTypes) && !filters.setupTypes.includes(idea.setupType)) {
    return false
  }
  if (filters.aPlusOnly !== DEFAULT_FILTERS.aPlusOnly && filters.aPlusOnly && !idea.isAPlus) return false
  if (
    !sameMembers(filters.earningsStatuses ?? [], DEFAULT_FILTERS.earningsStatuses) &&
    filters.earningsStatuses?.length &&
    !filters.earningsStatuses.includes(idea.earningsStatus)
  ) {
    return false
  }
  if (filters.hasCatalyst !== DEFAULT_FILTERS.hasCatalyst && filters.hasCatalyst && !idea.catalyst) {
    return false
  }
  if (!matchesSearch(idea, filters.search)) return false
  return true
}

function periodPerf(
  ticker: string,
  perfByTicker: Readonly<Record<string, number | null>> | null | undefined,
): number | null {
  if (!perfByTicker) return null
  const value =
    ticker in perfByTicker
      ? perfByTicker[ticker]
      : ticker.toUpperCase() in perfByTicker
        ? perfByTicker[ticker.toUpperCase()]
        : null
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function compareTicker(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function compareByPeriodPerf(
  a: GroupViewRow,
  b: GroupViewRow,
  perfByTicker: Readonly<Record<string, number | null>> | null | undefined,
): number {
  const pa = periodPerf(a.ticker, perfByTicker)
  const pb = periodPerf(b.ticker, perfByTicker)
  if (pa == null && pb == null) return compareTicker(a.ticker, b.ticker)
  if (pa == null) return 1
  if (pb == null) return -1
  if (pa !== pb) return pb - pa
  return compareTicker(a.ticker, b.ticker)
}

export function selectGroupViewRows<T extends GroupViewRow>(
  ideas: readonly T[],
  filters: IdeaFilters,
  perfByTicker: Readonly<Record<string, number | null>> | null | undefined,
): GroupViewSelection<T> {
  const rows = ideas.filter((idea) => passesGroupViewFilters(idea, filters))
  rows.sort((a, b) => compareByPeriodPerf(a, b, perfByTicker))
  return {
    rows,
    hiddenCount: ideas.length - rows.length,
    total: ideas.length,
  }
}

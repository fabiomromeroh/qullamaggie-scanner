import type { EarningsStatus, IdeaFilters, SetupStage, SetupType } from '../types'
import { passesFilters } from './ideaFilters'

/**
 * Rows for a Finviz group drill-down.
 * Every filter on the group-view state applies immediately (there is no
 * "only if it differs from the scanner defaults" skip). `groupId` is not a
 * row filter here. Order is the selected period's performance (`finvizPerf`):
 * descending, nulls last, ticker ascending on a tie.
 */
export interface GroupViewRow {
  ticker: string
  name: string
  groupName: string
  setupStage: SetupStage
  aboveSma200: boolean
  aboveSma50: boolean
  aboveSma10: boolean
  aboveSma20: boolean
  surfer10?: boolean
  surfer20?: boolean
  surfer50?: boolean
  tightConsolidation?: boolean
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

function passesGroupViewFilters(idea: GroupViewRow, filters: IdeaFilters): boolean {
  return passesFilters(idea, filters, { groupView: true })
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

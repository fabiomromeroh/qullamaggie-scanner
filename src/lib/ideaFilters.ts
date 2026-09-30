import { ideaMatchesFinvizGroup } from './groupMatch'
import type { IdeaFilters, IndustryGroup, TradingIdea } from '../types'

/**
 * Scanner-table predicate. `groupView` is the historical drill-down flag:
 * below-200 names stay, and those rows skip the stage and SMA preference gates.
 * The group screen no longer calls this with `groupView=true` (see `selectGroupViewRows`).
 * The `groupView=false` path is the normal scan and must stay as it is.
 */
export function matchesFilters(
  idea: TradingIdea,
  f: IdeaFilters,
  groupSource: 'finviz' | 'fallback' | null,
  groups: IndustryGroup[],
  groupView = false,
): boolean {
  const below200 = !idea.aboveSma200
  // Hard gate on the normal scan. Group drill-down keeps below-200 names and flags them.
  if (!groupView && below200) return false
  // Below-200 drill-down rows skip the setup-stage and SMA preference gates so the flag stays visible.
  const exemptTrendGates = groupView && below200
  if (!exemptTrendGates) {
    if (f.requireSma50 && !idea.aboveSma50) return false
    if (f.requireSma10 && !idea.aboveSma10) return false
    if (f.requireSma20 && !idea.aboveSma20) return false
    if (f.stages.length && !f.stages.includes(idea.setupStage)) return false
  }
  if (idea.rvol < f.minRvol) return false
  const distance = Math.abs(Math.min(0, idea.pctFrom52wHigh))
  if (distance > f.maxPctFromHigh) return false
  if (!f.setupTypes.includes(idea.setupType)) return false
  if (f.aPlusOnly && !idea.isAPlus) return false
  // A+ only never includes earnings avoid (isAPlus already false); still honor status filter
  if (f.earningsStatuses?.length && !f.earningsStatuses.includes(idea.earningsStatus)) {
    return false
  }
  if (f.hasCatalyst && !idea.catalyst) return false
  if (!groupView && f.groupId) {
    if (groupSource === 'finviz') {
      const group = groups.find((g) => g.id === f.groupId)
      if (!group || !ideaMatchesFinvizGroup(idea, group)) return false
    } else if (idea.groupId !== f.groupId) {
      return false
    }
  }
  if (f.search) {
    const q = f.search.toLowerCase()
    const hay =
      `${idea.ticker} ${idea.name} ${idea.groupName} ${idea.setupStage} ${idea.characteristics.join(' ')}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

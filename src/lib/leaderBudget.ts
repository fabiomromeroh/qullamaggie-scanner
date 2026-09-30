/**
 * How many uncached symbols a leaders request may still start.
 * A call stops when either the time budget or the symbol cap is spent.
 * Symbols already in the quote cache are not part of `uncached`.
 */
export interface SymbolBudget {
  budgetMs: number
  maxSymbols: number
}

export function remainingSymbolBudget(
  uncached: readonly string[],
  state: { elapsedMs: number; startedCount: number },
  budget: SymbolBudget,
): { take: number; deferred: string[] } {
  const overTime = !(state.elapsedMs < budget.budgetMs)
  const overCount = !(state.startedCount < budget.maxSymbols)
  if (overTime || overCount) return { take: 0, deferred: [...uncached] }
  const room = budget.maxSymbols - state.startedCount
  const take = Math.max(0, Math.min(room, uncached.length))
  return { take, deferred: uncached.slice(take) }
}

/** True when any member has not been resolved (cache hit or fetch) yet. */
export function groupPending(tickers: readonly string[], resolved: ReadonlySet<string>): boolean {
  return tickers.some((ticker) => !resolved.has(ticker))
}

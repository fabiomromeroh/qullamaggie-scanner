/**
 * Keyboard / button navigation of an ordered ticker list (chart dock + modal).
 * Stops at the ends. Empty list → -1. Unknown current: Next starts at 0, Prev
 * starts at the last row.
 */

export function normalizeTickerList(list?: readonly string[] | null): string[] {
  if (!list?.length) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const ticker = raw.trim().toUpperCase()
    if (!ticker || seen.has(ticker)) continue
    seen.add(ticker)
    out.push(ticker)
  }
  return out
}

export function tickerNamesMap(
  rows: readonly { ticker: string; name?: string | null }[],
): Record<string, string> {
  const names: Record<string, string> = {}
  for (const row of rows) {
    const ticker = row.ticker.trim().toUpperCase()
    const name = row.name?.trim()
    if (!ticker || !name) continue
    names[ticker] = name
  }
  return names
}

export function tickerIndexInList(list: readonly string[], current: string | null | undefined): number {
  if (!list.length || current == null) return -1
  const key = current.trim().toUpperCase()
  if (!key) return -1
  return list.findIndex((ticker) => ticker.toUpperCase() === key)
}

/**
 * Next/prev index. Stops at the ends (returns -1 when the step would leave the
 * list). Empty list → -1. A single row stays put on both directions (returns
 * that row's index so a caller can no-op). Unknown `current`: Next → 0, Prev → last.
 */
export function stepTickerIndex(
  list: readonly string[],
  current: string | null | undefined,
  direction: 1 | -1,
): number {
  const n = list.length
  if (n === 0) return -1
  const step: 1 | -1 = direction < 0 ? -1 : 1
  const idx = tickerIndexInList(list, current)
  if (idx === -1) return step > 0 ? 0 : n - 1
  const next = idx + step
  if (next < 0 || next >= n) return -1
  return next
}

export function tickerListPosition(
  list: readonly string[],
  current: string | null | undefined,
): { index: number; total: number } {
  return { index: tickerIndexInList(list, current), total: list.length }
}

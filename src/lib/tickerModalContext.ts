import { createContext, useContext } from 'react'

export interface TickerModalTarget {
  ticker: string
  name?: string
  /** Visible ordered list the ticker was opened from (already filtered + sorted). */
  list?: string[]
  /** Optional display names keyed by ticker (uppercase). */
  names?: Record<string, string>
}

export interface TickerModalApi {
  open: (target: TickerModalTarget) => void
  close: () => void
}

export const TickerModalContext = createContext<TickerModalApi>({ open: () => {}, close: () => {} })

export function useTickerModal(): TickerModalApi {
  return useContext(TickerModalContext)
}

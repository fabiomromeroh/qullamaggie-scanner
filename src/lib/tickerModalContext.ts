import { createContext, useContext } from 'react'

export interface TickerModalTarget {
  ticker: string
  name?: string
}

export interface TickerModalApi {
  open: (target: TickerModalTarget) => void
}

export const TickerModalContext = createContext<TickerModalApi>({ open: () => {} })

export function useTickerModal(): TickerModalApi {
  return useContext(TickerModalContext)
}

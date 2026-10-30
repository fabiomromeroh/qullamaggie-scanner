import { useMemo } from 'react'
import { useJson } from '../../hooks/useJson'
import { passesLiquidityFilters, useLiquidityFilters } from '../../lib/liquidityFilters'
import { fmtPct, fmtPrice, pctClass } from '../../lib/pulseFormat'
import { useTickerModal } from '../../lib/tickerModalContext'
import { normalizeTickerList } from '../../lib/tickerListNav'

interface TapeItem {
  ticker: string
  label?: string
  price: number
  changePct: number
}
interface Tape {
  asOf: string
  indexes: TapeItem[]
  gainers: TapeItem[]
  losers: TapeItem[]
  moversUniverse: number
  moversMinDollarVolume: number
  moversSource?: 'quote' | 'chart'
  moversAsOf?: string
  moversError?: string
}

function Item({ item, list }: { item: TapeItem; list: string[] }) {
  const { open } = useTickerModal()
  return (
    <button
      type="button"
      onClick={() => open({ ticker: item.ticker, name: item.label, list })}
      className="inline-flex items-baseline gap-1 whitespace-nowrap px-2 hover:bg-terminal-elevated"
      title={item.label ? `${item.label} (${item.ticker} ETF proxy)` : item.ticker}
    >
      <span className="font-semibold text-terminal-fg">{item.label ?? item.ticker}</span>
      <span className="font-mono text-terminal-muted">{fmtPrice(item.price)}</span>
      <span className={`font-mono ${pctClass(item.changePct)}`}>{fmtPct(item.changePct)}</span>
    </button>
  )
}

function Segment({ tape }: { tape: Tape }) {
  const indexList = useMemo(() => normalizeTickerList(tape.indexes.map((i) => i.ticker)), [tape.indexes])
  const gainerList = useMemo(() => normalizeTickerList(tape.gainers.map((i) => i.ticker)), [tape.gainers])
  const loserList = useMemo(() => normalizeTickerList(tape.losers.map((i) => i.ticker)), [tape.losers])
  return (
    <>
      {tape.indexes.map((i) => (
        <Item key={`i-${i.ticker}`} item={i} list={indexList} />
      ))}
      {tape.gainers.length ? (
        <span className="px-2 font-semibold text-terminal-green">TOP GAINERS</span>
      ) : null}
      {tape.gainers.map((i) => (
        <Item key={`g-${i.ticker}`} item={i} list={gainerList} />
      ))}
      {tape.losers.length ? <span className="px-2 font-semibold text-terminal-red">TOP LOSERS</span> : null}
      {tape.losers.map((i) => (
        <Item key={`l-${i.ticker}`} item={i} list={loserList} />
      ))}
    </>
  )
}

/** Scrolling tape: index ETF proxies, then top gainers / losers from the membership universe. */
export function TickerTape() {
  const { filters } = useLiquidityFilters()
  const { data, error } = useJson<Tape>('/api/pulse/tape', 60_000)
  const tape = useMemo(() => {
    if (!data) return null
    const keep = (item: TapeItem) => passesLiquidityFilters({ price: item.price }, filters)
    return {
      ...data,
      // Index proxies always stay; movers hide when the price toggle drops them.
      gainers: data.gainers.filter(keep),
      losers: data.losers.filter(keep),
    }
  }, [data, filters])
  if (!tape) {
    return (
      <div className="shrink-0 border-b border-terminal-border bg-terminal-bg px-3 py-1 text-[11px] text-terminal-dim">
        {error ? `Ticker tape unavailable: ${error}` : 'Loading ticker tape…'}
      </div>
    )
  }
  return (
    <div
      className="qm-tape group shrink-0 overflow-hidden border-b border-terminal-border bg-terminal-bg py-1 text-[11px]"
      title={
        data?.moversError
          ? `Movers unavailable: ${data.moversError}`
          : `Movers from ${tape.moversUniverse} membership-snapshot stocks with ≥ $${(tape.moversMinDollarVolume / 1e6).toFixed(0)}M average daily $ volume (tape universe floor)${
              tape.moversSource === 'chart' && tape.moversAsOf
                ? ` · from chart data as of ${new Date(tape.moversAsOf).toLocaleTimeString()}`
                : ''
            }`
      }
    >
      <div className="qm-tape-track inline-flex">
        <Segment tape={tape} />
        <span aria-hidden className="inline-flex">
          <Segment tape={tape} />
        </span>
      </div>
    </div>
  )
}

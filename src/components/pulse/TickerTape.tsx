import { useJson } from '../../hooks/useJson'
import { fmtPct, fmtPrice, pctClass } from '../../lib/pulseFormat'
import { useTickerModal } from '../../lib/tickerModalContext'

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

function Item({ item }: { item: TapeItem }) {
  const { open } = useTickerModal()
  return (
    <button
      type="button"
      onClick={() => open({ ticker: item.ticker })}
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
  return (
    <>
      {tape.indexes.map((i) => (
        <Item key={`i-${i.ticker}`} item={i} />
      ))}
      {tape.gainers.length ? (
        <span className="px-2 font-semibold text-terminal-green">TOP GAINERS</span>
      ) : null}
      {tape.gainers.map((i) => (
        <Item key={`g-${i.ticker}`} item={i} />
      ))}
      {tape.losers.length ? <span className="px-2 font-semibold text-terminal-red">TOP LOSERS</span> : null}
      {tape.losers.map((i) => (
        <Item key={`l-${i.ticker}`} item={i} />
      ))}
    </>
  )
}

/** Scrolling tape: index ETF proxies, then top gainers / losers from the membership universe. */
export function TickerTape() {
  const { data, error } = useJson<Tape>('/api/pulse/tape', 60_000)
  if (!data) {
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
        data.moversError
          ? `Movers unavailable: ${data.moversError}`
          : `Movers from ${data.moversUniverse} membership-snapshot stocks with ≥ $${(data.moversMinDollarVolume / 1e6).toFixed(0)}M average daily $ volume${
              data.moversSource === 'chart' && data.moversAsOf
                ? ` · from chart data as of ${new Date(data.moversAsOf).toLocaleTimeString()}`
                : ''
            }`
      }
    >
      <div className="qm-tape-track inline-flex">
        <Segment tape={data} />
        <span aria-hidden className="inline-flex">
          <Segment tape={data} />
        </span>
      </div>
    </div>
  )
}

import { useJson } from '../../hooks/useJson'
import type { EtfListId } from '../../lib/etfLists'
import { fmtPrice } from '../../lib/pulseFormat'
import { TickerLink } from '../TickerModal'
import { SortableTable, type Column } from './SortableTable'

export interface EtfRow {
  ticker: string
  name: string
  price?: number
  changeFromOpen?: number | null
  perfDay?: number | null
  perfWeek?: number | null
  perfMonth?: number | null
  perf3m?: number | null
  perf6m?: number | null
  perfYtd?: number | null
  perfYear?: number | null
  error?: string
}

interface EtfListResponse {
  list: EtfListId
  asOf: string
  rows: EtfRow[]
}

interface Holdings {
  symbol: string
  holdings: { symbol?: string; name?: string; weightPct: number }[]
}

function HoldingsPanel({ ticker }: { ticker: string }) {
  const { data, error, loading } = useJson<Holdings>(`/api/pulse/holdings/${encodeURIComponent(ticker)}`)
  if (loading && !data) return <span className="text-[11px] text-terminal-muted">Loading top holdings…</span>
  if (error) return <span className="text-[11px] text-terminal-dim">Top holdings are not available right now.</span>
  if (!data?.holdings.length) return <span className="text-[11px] text-terminal-muted">Yahoo lists no holdings for {ticker}.</span>
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-terminal-dim">Top holdings (Yahoo)</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {data.holdings.map((h, i) => (
          <span key={`${h.symbol ?? h.name}-${i}`} className="inline-flex items-baseline gap-1">
            {h.symbol ? <TickerLink ticker={h.symbol} name={h.name} /> : null}
            <span className="max-w-48 truncate text-terminal-muted">{h.name}</span>
            <span className="font-mono text-terminal-fg">{h.weightPct.toFixed(2)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

const ETF_COLUMNS: Column<EtfRow>[] = [
  { key: 'ticker', label: 'Ticker', text: (r) => r.ticker, render: (r) => <TickerLink ticker={r.ticker} name={r.name} /> },
  {
    key: 'name',
    label: 'Company',
    text: (r) => r.name,
    render: (r) => (
      <span className="block max-w-[16rem] truncate text-terminal-muted" title={r.error ? `${r.name} — ${r.error}` : r.name}>
        {r.name}
        {r.error ? <span className="ml-1 text-terminal-red">(no data)</span> : null}
      </span>
    ),
  },
  { key: 'price', label: 'Price', value: (r) => r.price, render: (r) => fmtPrice(r.price) },
  { key: 'changeFromOpen', label: 'Change from Open', value: (r) => r.changeFromOpen, pct: true },
  { key: 'perfDay', label: 'Perf Day', value: (r) => r.perfDay, pct: true },
  { key: 'perfWeek', label: 'Perf Week', value: (r) => r.perfWeek, pct: true },
  { key: 'perfMonth', label: 'Perf Month', value: (r) => r.perfMonth, pct: true },
  { key: 'perf3m', label: 'Perf 3M', value: (r) => r.perf3m, pct: true },
  { key: 'perf6m', label: 'Perf 6M', value: (r) => r.perf6m, pct: true },
  { key: 'perfYtd', label: 'Perf YTD', value: (r) => r.perfYtd, pct: true },
  { key: 'perfYear', label: 'Perf Year', value: (r) => r.perfYear, pct: true },
]

export function EtfTable({ list }: { list: EtfListId }) {
  const { data, error, loading, reload } = useJson<EtfListResponse>(`/api/pulse/etfs?list=${list}`, 5 * 60_000)
  // Holdings come from Yahoo quoteSummary (crumb). Hide row expansion when the server reports it blocked.
  const caps = useJson<{ holdings: boolean }>('/api/pulse/capabilities')
  const holdingsOn = caps.data?.holdings !== false
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-2 py-1 text-[10px] text-terminal-dim">
        <span>
          Yahoo daily bars · windows in sessions (W 5, M 21, 3M 63, 6M 126, Y 252) · YTD from last close of prior year
        </span>
        {data ? <span>as of {new Date(data.asOf).toLocaleTimeString()}</span> : null}
        {error ? <span className="text-terminal-red">{error}</span> : null}
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          className="ml-auto rounded border border-terminal-border px-2 py-0.5 text-terminal-muted hover:text-terminal-fg disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {!data && loading ? (
        <div className="p-6 text-center text-xs text-terminal-muted">Loading ETF performance…</div>
      ) : (
        <SortableTable
          rows={data?.rows ?? []}
          columns={ETF_COLUMNS}
          rowKey={(r) => r.ticker}
          defaultSort={{ key: 'perfDay', dir: 'desc' }}
          renderExpanded={holdingsOn ? (r) => <HoldingsPanel ticker={r.ticker} /> : undefined}
        />
      )}
    </div>
  )
}

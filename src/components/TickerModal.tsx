import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useJson } from '../hooks/useJson'
import { fmtCompact, fmtPct, fmtPrice, pctClass } from '../lib/pulseFormat'
import { TickerModalContext, useTickerModal, type TickerModalTarget } from '../lib/tickerModalContext'
import { IntradayChart, type IntradayInterval } from './IntradayChart'
import { TickerNews } from './TickerNews'

const DailyChartPanel = lazy(() => import('./DailyChartPanel'))

/** Clickable ticker that opens the shared ticker modal. */
export function TickerLink({ ticker, name, className = '' }: { ticker: string; name?: string; className?: string }) {
  const { open } = useTickerModal()
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        open({ ticker, name })
      }}
      className={`font-mono font-semibold text-terminal-blue hover:underline ${className}`}
    >
      {ticker}
    </button>
  )
}

interface Summary {
  symbol: string
  name?: string
  quote: {
    price: number
    prevClose: number | null
    change: number | null
    changePct: number | null
    open: number | null
    high: number | null
    low: number | null
    volume: number | null
    avgVolume: number | null
    marketCap: number | null
  }
  adrPct: number | null
  dollarVolume20: number | null
  asOf: string
}

interface Fundamentals {
  name: string | null
  sector: string | null
  industry: string | null
  country: string | null
  website: string | null
  employees: number | null
  summary: string | null
  marketCap: number | null
  sharesOutstanding: number | null
  floatShares: number | null
  shortPctFloat: number | null
  shortRatio: number | null
  heldByInstitutionsPct: number | null
  heldByInsidersPct: number | null
  trailingPe: number | null
  forwardPe: number | null
  revenueGrowthYoyPct: number | null
  earningsGrowthYoyPct: number | null
  grossMarginPct: number | null
  operatingMarginPct: number | null
  totalRevenue: number | null
  nextEarningsDate: string | null
  quarterlyEps: { period: string; actual: number | null; estimate: number | null }[]
  quarterlyRevenue: { period: string; revenue: number | null; earnings: number | null }[]
}

interface Filings {
  configured: boolean
  browseUrl: string
  note?: string
  filings: { form: string; filingDate: string; reportDate?: string; description?: string; url: string; accessionNumber: string }[]
}

type Tab = 'chart' | 'fundamentals' | 'news' | 'filings'
type Timeframe = IntradayInterval | 'D'

function Stat({ label, value, className = '' }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-terminal-dim">{label}</span>
      <span className={`font-mono text-[12px] text-terminal-fg ${className}`}>{value}</span>
    </div>
  )
}

function QuoteCard({ s }: { s: Summary }) {
  const q = s.quote
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-1 border-b border-terminal-border px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xl font-bold text-terminal-fg">{fmtPrice(q.price)}</span>
        <span className={`font-mono text-sm ${pctClass(q.changePct)}`}>
          {q.change != null ? `${q.change > 0 ? '+' : ''}${q.change.toFixed(2)}` : '—'} ({fmtPct(q.changePct)})
        </span>
      </div>
      <Stat label="Open" value={fmtPrice(q.open)} />
      <Stat label="High" value={fmtPrice(q.high)} />
      <Stat label="Low" value={fmtPrice(q.low)} />
      <Stat label="Prev Close" value={fmtPrice(q.prevClose)} />
      <Stat label="Volume" value={fmtCompact(q.volume)} />
      <span className="ml-auto text-[10px] text-terminal-dim">Yahoo · delayed · {new Date(s.asOf).toLocaleTimeString()}</span>
    </div>
  )
}

function FundamentalsTab({ symbol }: { symbol: string }) {
  const { data, error, loading } = useJson<Fundamentals>(`/api/ticker/${encodeURIComponent(symbol)}/fundamentals`)
  if (loading && !data) return <p className="p-4 text-xs text-terminal-muted">Loading fundamentals…</p>
  if (error) return <p className="p-4 text-xs text-terminal-red">Fundamentals unavailable: {error}</p>
  if (!data) return null
  const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)
  const num = (v: number | null, d = 1) => (v == null ? '—' : v.toFixed(d))
  return (
    <div className="h-full overflow-auto p-3 text-xs">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sector" value={data.sector ?? '—'} />
        <Stat label="Industry" value={data.industry ?? '—'} />
        <Stat label="Country" value={data.country ?? '—'} />
        <Stat label="Next earnings" value={data.nextEarningsDate ?? '—'} className="text-terminal-amber" />
        <Stat label="Market cap" value={fmtCompact(data.marketCap)} />
        <Stat label="Shares out" value={fmtCompact(data.sharesOutstanding)} />
        <Stat label="Float" value={fmtCompact(data.floatShares)} />
        <Stat label="Short % float" value={pct(data.shortPctFloat)} />
        <Stat label="Short ratio (days)" value={num(data.shortRatio)} />
        <Stat label="Institutions" value={pct(data.heldByInstitutionsPct)} />
        <Stat label="Insiders" value={pct(data.heldByInsidersPct)} />
        <Stat label="P/E ttm / fwd" value={`${num(data.trailingPe)} / ${num(data.forwardPe)}`} />
        <Stat label="Revenue growth (YoY q)" value={pct(data.revenueGrowthYoyPct)} className={pctClass(data.revenueGrowthYoyPct)} />
        <Stat label="Earnings growth (YoY q)" value={pct(data.earningsGrowthYoyPct)} className={pctClass(data.earningsGrowthYoyPct)} />
        <Stat label="Gross margin" value={pct(data.grossMarginPct)} />
        <Stat label="Operating margin" value={pct(data.operatingMarginPct)} />
      </div>
      {data.quarterlyEps.length || data.quarterlyRevenue.length ? (
        <table className="mt-4 text-[11px]">
          <thead className="text-terminal-dim">
            <tr>
              <th className="pr-4 text-left font-medium">Quarter</th>
              <th className="pr-4 text-right font-medium">EPS actual</th>
              <th className="pr-4 text-right font-medium">EPS est.</th>
              <th className="pr-4 text-right font-medium">Revenue</th>
              <th className="text-right font-medium">Net income</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {Array.from(new Set([...data.quarterlyEps.map((q) => q.period), ...data.quarterlyRevenue.map((q) => q.period)])).map((p) => {
              const e = data.quarterlyEps.find((q) => q.period === p)
              const r = data.quarterlyRevenue.find((q) => q.period === p)
              return (
                <tr key={p}>
                  <td className="pr-4">{p}</td>
                  <td className={`pr-4 text-right ${e?.actual != null && e.estimate != null ? (e.actual >= e.estimate ? 'text-terminal-green' : 'text-terminal-red') : ''}`}>
                    {num(e?.actual ?? null, 2)}
                  </td>
                  <td className="pr-4 text-right text-terminal-muted">{num(e?.estimate ?? null, 2)}</td>
                  <td className="pr-4 text-right">{fmtCompact(r?.revenue)}</td>
                  <td className="text-right">{fmtCompact(r?.earnings)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : null}
      {data.summary ? <p className="mt-4 max-w-3xl leading-relaxed text-terminal-muted">{data.summary}</p> : null}
      <p className="mt-3 text-[10px] text-terminal-dim">Source: Yahoo quoteSummary (unofficial). Growth is the latest quarter vs the same quarter a year ago.</p>
    </div>
  )
}

function FilingsTab({ symbol }: { symbol: string }) {
  const { data, error, loading } = useJson<Filings>(`/api/ticker/${encodeURIComponent(symbol)}/filings`)
  if (loading && !data) return <p className="p-4 text-xs text-terminal-muted">Loading SEC filings…</p>
  if (error) return <p className="p-4 text-xs text-terminal-red">Filings unavailable: {error}</p>
  if (!data) return null
  return (
    <div className="h-full overflow-auto p-3 text-xs">
      {data.note ? <p className="mb-2 text-terminal-muted">{data.note}</p> : null}
      <a href={data.browseUrl} target="_blank" rel="noreferrer" className="text-terminal-blue hover:underline">
        Open {symbol} on SEC EDGAR ↗
      </a>
      {data.filings.length ? (
        <table className="mt-3 w-full text-[11px]">
          <thead className="text-terminal-dim">
            <tr>
              <th className="pr-3 text-left font-medium">Form</th>
              <th className="pr-3 text-left font-medium">Filed</th>
              <th className="pr-3 text-left font-medium">Period</th>
              <th className="text-left font-medium">Document</th>
            </tr>
          </thead>
          <tbody>
            {data.filings.map((f) => (
              <tr key={f.accessionNumber} className="border-t border-terminal-border/60">
                <td className="py-0.5 pr-3 font-mono text-terminal-amber">{f.form}</td>
                <td className="pr-3 font-mono">{f.filingDate}</td>
                <td className="pr-3 font-mono text-terminal-muted">{f.reportDate ?? ''}</td>
                <td>
                  <a href={f.url} target="_blank" rel="noreferrer" className="text-terminal-blue hover:underline">
                    {f.description || f.form} ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

function ChartTab({ target, summary }: { target: TickerModalTarget; summary: Summary | null }) {
  const [tf, setTf] = useState<Timeframe>('D')
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 px-2 py-1">
        {(['1m', '30m', '1h', 'D'] as Timeframe[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTf(t)}
            className={`rounded px-2 py-0.5 font-mono text-[11px] ${
              tf === t ? 'bg-terminal-blue/20 text-terminal-blue' : 'text-terminal-muted hover:text-terminal-fg'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tf === 'D' ? (
          <Suspense fallback={<div className="p-4 text-xs text-terminal-muted">Loading chart…</div>}>
            <DailyChartPanel
              symbol={target.ticker}
              name={summary?.name ?? target.name}
              price={summary?.quote.price ?? null}
              dayPct={summary?.quote.changePct ?? null}
            />
          </Suspense>
        ) : (
          <IntradayChart key={`${target.ticker}-${tf}`} symbol={target.ticker} interval={tf} />
        )}
      </div>
    </div>
  )
}

function TickerModalBody({ target, onClose }: { target: TickerModalTarget; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('chart')
  const { data: summary, error } = useJson<Summary>(`/api/ticker/${encodeURIComponent(target.ticker)}/summary`, 60_000)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const name = summary?.name ?? target.name
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-2 sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${target.ticker} details`}
        className="flex h-[90dvh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-terminal-border-bright bg-terminal-panel shadow-2xl"
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-terminal-border px-3 py-2">
          <span className="font-mono text-lg font-bold text-terminal-fg">{target.ticker}</span>
          {name ? <span className="max-w-96 truncate text-xs text-terminal-muted">{name}</span> : null}
          <span className="text-[11px] text-terminal-dim">
            $Vol <span className="font-mono text-terminal-fg">{summary?.dollarVolume20 != null ? `$${fmtCompact(summary.dollarVolume20)}` : '—'}</span>
          </span>
          <span className="text-[11px] text-terminal-dim">
            ADR% <span className="font-mono text-terminal-fg">{summary?.adrPct != null ? `${summary.adrPct.toFixed(2)}%` : '—'}</span>
          </span>
          <a
            href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(target.ticker)}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-terminal-blue hover:underline"
          >
            TradingView ↗
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded px-2 py-0.5 text-sm text-terminal-muted hover:bg-terminal-elevated hover:text-terminal-fg"
          >
            ✕
          </button>
        </div>
        {summary ? <QuoteCard s={summary} /> : (
          <div className="border-b border-terminal-border px-3 py-2 text-xs text-terminal-muted">
            {error ? `Quote unavailable: ${error}` : 'Loading quote…'}
          </div>
        )}
        <div role="tablist" className="flex shrink-0 gap-1 border-b border-terminal-border px-2 pt-1">
          {(['chart', 'fundamentals', 'news', 'filings'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-t px-3 py-1 text-xs capitalize ${
                tab === t ? 'border border-b-0 border-terminal-border-bright bg-terminal-elevated text-terminal-fg' : 'text-terminal-muted hover:text-terminal-fg'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          {tab === 'chart' ? <ChartTab target={target} summary={summary} /> : null}
          {tab === 'fundamentals' ? <FundamentalsTab symbol={target.ticker} /> : null}
          {tab === 'news' ? (
            <div className="h-full overflow-auto p-3">
              <TickerNews symbol={target.ticker} />
            </div>
          ) : null}
          {tab === 'filings' ? <FilingsTab symbol={target.ticker} /> : null}
        </div>
      </div>
    </div>
  )
}

export function TickerModalProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<TickerModalTarget | null>(null)
  const open = useCallback((t: TickerModalTarget) => setTarget({ ...t, ticker: t.ticker.toUpperCase() }), [])
  const close = useCallback(() => setTarget(null), [])
  const value = useMemo(() => ({ open }), [open])
  return (
    <TickerModalContext.Provider value={value}>
      {children}
      {target ? <TickerModalBody key={target.ticker} target={target} onClose={close} /> : null}
    </TickerModalContext.Provider>
  )
}

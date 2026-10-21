import { useEffect, useState } from 'react'
import { MetricTip } from '../components/MetricTip'
import type { MetricId } from '../lib/metricDefinitions'
import { cellTone, scaledThreshold, splitShares, type BreadthColumn, type BreadthRow, type Tone } from '../lib/breadth'

interface BreadthResponse {
  result: {
    generatedAt: string
    runtimeMs: number
    requests: number
    tickers: number
    failed: number
    rows: BreadthRow[]
  } | null
  job: { status: 'idle' | 'running' | 'error'; done: number; total: number; failed: number; startedAt?: string; error?: string }
}

const TONE_CLASS: Record<Exclude<Tone, null>, string> = {
  'strong-green': 'bg-[#1f6f43] text-white',
  green: 'bg-terminal-green-dim text-terminal-green',
  red: 'bg-terminal-red-dim text-terminal-red',
  'strong-red': 'bg-[#8a2a31] text-white',
  amber: 'bg-terminal-amber-dim text-terminal-amber',
}

/** Stockbee's full column names, shown in the header tooltip (visible labels are abbreviated). */
const FULL_LABEL: Record<BreadthColumn | 'universe', string> = {
  up4: 'Stocks Up 4%+ Today',
  down4: 'Stocks Down 4%+ Today',
  ratio5: '5 Day Ratio',
  ratio10: '10 Day Ratio',
  up25q: 'Up 25%+ Quarter',
  down25q: 'Down 25%+ Quarter',
  up25m: 'Up 25%+ Month',
  down25m: 'Down 25%+ Month',
  up50m: 'Up 50%+ Month',
  down50m: 'Down 50%+ Month',
  up13x34: 'Up 13%+ in 34 Days',
  down13x34: 'Down 13%+ in 34 Days',
  atrExt10: '10x ATR Extension',
  pctAbove50: '% above 50-day SMA',
  pctAbove200: '% above 200-day SMA',
  universe: 'Universe',
}

const METRIC_OF: Record<BreadthColumn | 'universe', MetricId> = {
  up4: 'breadthUp4',
  down4: 'breadthDown4',
  ratio5: 'breadthRatio5',
  ratio10: 'breadthRatio10',
  up25q: 'breadthUp25q',
  down25q: 'breadthDown25q',
  up25m: 'breadthUp25m',
  down25m: 'breadthDown25m',
  up50m: 'breadthUp50m',
  down50m: 'breadthDown50m',
  up13x34: 'breadthUp13x34',
  down13x34: 'breadthDown13x34',
  atrExt10: 'breadthAtrExt',
  pctAbove50: 'breadthAbove50',
  pctAbove200: 'breadthAbove200',
  universe: 'breadthUniverse',
}

const COLUMNS: { key: BreadthColumn | 'universe'; label: string; title: string; fmt?: 'ratio' | 'pct' }[] = [
  { key: 'up4', label: 'Up 4% Today', title: 'Close ≥ +4% vs prior close on higher volume than the prior day' },
  { key: 'down4', label: 'Dn 4% Today', title: 'Close ≤ −4% vs prior close on higher volume than the prior day' },
  { key: 'ratio5', label: '5D Ratio', title: 'Σ up-4% ÷ Σ down-4% over the last 5 sessions', fmt: 'ratio' },
  { key: 'ratio10', label: '10D Ratio', title: 'Σ up-4% ÷ Σ down-4% over the last 10 sessions', fmt: 'ratio' },
  { key: 'up25q', label: 'Up 25% Qtr', title: 'Close ≥ +25% vs 65 sessions ago' },
  { key: 'down25q', label: 'Dn 25% Qtr', title: 'Close ≤ −25% vs 65 sessions ago' },
  { key: 'up25m', label: 'Up 25% Mo', title: 'Close ≥ +25% vs 21 sessions ago' },
  { key: 'down25m', label: 'Dn 25% Mo', title: 'Close ≤ −25% vs 21 sessions ago' },
  { key: 'up50m', label: 'Up 50% Mo', title: 'Close ≥ +50% vs 21 sessions ago' },
  { key: 'down50m', label: 'Dn 50% Mo', title: 'Close ≤ −50% vs 21 sessions ago' },
  { key: 'up13x34', label: 'Up 13% 34D', title: 'Close ≥ +13% vs 34 sessions ago' },
  { key: 'down13x34', label: 'Dn 13% 34D', title: 'Close ≤ −13% vs 34 sessions ago' },
  { key: 'atrExt10', label: '10x ATR', title: '(Close − SMA50) ÷ ATR14 ≥ 10' },
  { key: 'pctAbove50', label: '>50dma', title: '% of stocks closing above their 50-day SMA', fmt: 'pct' },
  { key: 'pctAbove200', label: '>200dma', title: '% of stocks closing above their 200-day SMA', fmt: 'pct' },
  { key: 'universe', label: 'Univ.', title: 'Eligible stocks that day (price ≥ $5, 20d avg $vol ≥ $5M)' },
]

function fmt(v: number | null | undefined, kind?: 'ratio' | 'pct'): string {
  if (v == null) return '—'
  if (!Number.isFinite(v)) return '∞'
  if (kind === 'ratio') return v.toFixed(2)
  if (kind === 'pct') return `${v.toFixed(1)}%`
  return String(v)
}

/**
 * One continuous two-colour bar. Segment widths are left / (left + right), so
 * green and red always meet with no gap; labels sit on their own row above.
 */
function SplitBar({
  leftLabel,
  rightLabel,
  left,
  right,
  note,
}: {
  leftLabel: string
  rightLabel: string
  left: number
  right: number
  note?: string
}) {
  const { leftPct, rightPct } = splitShares(left, right)
  const empty = left + right === 0
  return (
    <div className="min-w-0 basis-72 flex-1" title={note}>
      <div className="mb-0.5 flex items-baseline justify-between gap-2 whitespace-nowrap text-[11px]">
        <span className="min-w-0 truncate text-terminal-green">
          {leftLabel} {leftPct.toFixed(1)}% <span className="text-terminal-dim">({left})</span>
        </span>
        <span className="min-w-0 truncate text-right text-terminal-red">
          {rightLabel} {rightPct.toFixed(1)}% <span className="text-terminal-dim">({right})</span>
        </span>
      </div>
      <div
        role="img"
        aria-label={`${leftLabel} ${left}, ${rightLabel} ${right}`}
        className="flex h-2 w-full overflow-hidden rounded bg-terminal-elevated"
      >
        {empty ? null : (
          <>
            <div className="h-full bg-terminal-green" style={{ width: `${leftPct}%` }} />
            <div className="h-full bg-terminal-red" style={{ width: `${rightPct}%` }} />
          </>
        )}
      </div>
    </div>
  )
}

export function BreadthModule() {
  const [data, setData] = useState<BreadthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    fetch('/api/breadth')
      .then(async (r) => {
        const body = (await r.json()) as BreadthResponse & { error?: string }
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
        if (alive) {
          setData(body)
          setError(null)
        }
      })
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : 'Request failed'))
    return () => {
      alive = false
    }
  }, [tick])

  const running = data?.job.status === 'running'
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setTick((n) => n + 1), 3000)
    return () => clearInterval(t)
  }, [running])

  const recompute = async () => {
    try {
      const r = await fetch('/api/breadth/recompute', { method: 'POST' })
      setData((await r.json()) as BreadthResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    }
  }

  const rows = data?.result?.rows ?? []
  const latest = rows[0]
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-terminal-panel">
      <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-terminal-border px-3 py-2">
        <h2 className="text-sm font-semibold text-terminal-fg">Market Monitor</h2>
        {latest ? (
          <>
            <SplitBar
              leftLabel="Advancing"
              rightLabel="Declining"
              left={latest.advancing}
              right={latest.declining}
              note={`${latest.date}: ${latest.universe - latest.advancing - latest.declining} unchanged of ${latest.universe}`}
            />
            <SplitBar
              leftLabel="New High"
              rightLabel="New Low"
              left={latest.newHighs}
              right={latest.newLows}
              note={`${latest.date}: 52-week highs vs lows`}
            />
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-2 text-[11px] text-terminal-dim">
          {running ? (
            <span className="text-terminal-amber">
              Computing… {data!.job.done}/{data!.job.total}
              {data!.job.failed ? ` (${data!.job.failed} failed)` : ''}
            </span>
          ) : null}
          {data?.job.status === 'error' ? <span className="text-terminal-red">Job failed: {data.job.error}</span> : null}
          {data?.result ? (
            <span title={`${data.result.requests} Yahoo requests · ${data.result.failed} failed · ${(data.result.runtimeMs / 1000).toFixed(0)}s`}>
              Computed {new Date(data.result.generatedAt).toLocaleString()} · {data.result.tickers} tickers
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void recompute()}
            disabled={running}
            className="rounded border border-terminal-border-bright px-2 py-0.5 text-terminal-fg hover:border-terminal-blue disabled:opacity-50"
          >
            Force Recompute
          </button>
        </div>
      </div>
      {error ? <div className="px-3 py-1 text-xs text-terminal-red">{error}</div> : null}
      {!rows.length ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-terminal-muted">
          {running
            ? `Building breadth from Yahoo daily bars for ${data!.job.total} stocks (one request each). This takes a few minutes.`
            : data
              ? 'No breadth data yet. Use Force Recompute.'
              : 'Loading…'}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {/* Auto-width: columns size to content; narrow screens scroll horizontally. */}
          <table className="w-max border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-terminal-panel">
              <tr className="border-b border-terminal-border text-[10px] uppercase text-terminal-dim">
                <th className="whitespace-nowrap px-1.5 py-1 text-left font-medium">
                  <MetricTip id="breadthDate">Date</MetricTip>
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="whitespace-nowrap px-1.5 py-1 text-right font-medium">
                    {/* One-line header: the column is as wide as its label. Tooltip explains the calculation. */}
                    <MetricTip id={METRIC_OF[c.key]} extra={FULL_LABEL[c.key]}>
                      {c.label}
                    </MetricTip>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {rows.map((r) => (
                <tr key={r.date} className="border-b border-terminal-border/50">
                  <td className="whitespace-nowrap px-1.5 py-0.5 text-terminal-muted">{r.date}</td>
                  {COLUMNS.map((c) => {
                    const tone = c.key === 'universe' ? null : cellTone(c.key, r)
                    return (
                      <td key={c.key} className={`whitespace-nowrap px-1.5 py-0.5 text-right ${tone ? TONE_CLASS[tone] : 'text-terminal-fg'}`}>
                        {fmt(r[c.key] as number | null, c.fmt)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="shrink-0 border-t border-terminal-border px-3 py-1 text-[10px] leading-snug text-terminal-dim">
        Universe: Finviz membership snapshot, price ≥ $5 and 20-day avg $ volume ≥ $5M per day. Yahoo daily bars (2y).
        Colours: Up/Down 4% strong at ≥ {latest ? scaledThreshold(300, latest.universe) : '—'} (Stockbee's 300 scaled to this universe
        from ~6,000); 5/10-day ratio ≥ 2 green, ≤ 0.5 red; up/down pairs tint the larger side; Up 25% quarter ≤{' '}
        {latest ? scaledThreshold(200, latest.universe) : '—'} red; &gt;50/200dma ≥ 60% green, ≤ 40% red; 10x ATR ≥ 0.5% of universe amber.
        The latest row is intraday until the close. NYSE H/L and T2108 are not replicated.
      </footer>
    </div>
  )
}

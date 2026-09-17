interface Props {
  mode: 'live' | 'demo'
  source?: 'live' | 'demo'
  error: string | null
}

export function StatusBanner({ mode, source, error }: Props) {
  if (mode === 'demo' || source === 'demo') {
    return (
      <div className="flex items-center gap-3 border-b border-terminal-amber/30 bg-terminal-amber-dim px-4 py-1.5 text-xs">
        <span className="rounded bg-terminal-amber px-1.5 py-0.5 font-mono font-bold tracking-wide text-terminal-bg">
          DEMO
        </span>
        <span className="text-terminal-amber">
          Explicit demo mode (VITE_MARKET_DATA_MODE=demo) — seed data only, not live quotes.
        </span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-terminal-red/40 bg-terminal-red-dim px-4 py-1.5 text-xs">
        <span className="rounded bg-terminal-red px-1.5 py-0.5 font-mono font-bold tracking-wide text-terminal-bg">
          LIVE ERROR
        </span>
        <span className="text-terminal-red">Could not load live data — no demo fallback.</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 border-b border-terminal-green/25 bg-terminal-green-dim/40 px-4 py-1.5 text-xs">
      <span className="rounded bg-terminal-green px-1.5 py-0.5 font-mono font-bold tracking-wide text-terminal-bg">
        LIVE
      </span>
      <span className="text-terminal-muted">
        Real market data via Finnhub → Yahoo (unofficial) → Stooq cascade. Catalysts blank until briefed.
      </span>
    </div>
  )
}

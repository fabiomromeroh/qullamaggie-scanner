interface Props {
  mode: 'live' | 'demo'
  source?: 'live' | 'demo'
  error: string | null
  scanning?: boolean
  scanMessage?: string | null
}

export function StatusBanner({ mode, source, error, scanning, scanMessage }: Props) {
  if (mode === 'demo' || source === 'demo') {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-terminal-amber/30 bg-terminal-amber-dim px-3 py-1.5 text-xs sm:gap-3 sm:px-4">
        <span className="rounded bg-terminal-amber px-1.5 py-0.5 font-mono font-bold tracking-wide text-terminal-bg">
          DEMO
        </span>
        <span className="min-w-0 text-terminal-amber">
          Explicit demo mode — seed data only, not live quotes.
        </span>
      </div>
    )
  }

  if (scanning) {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-terminal-blue/40 bg-terminal-blue/10 px-3 py-1.5 text-xs sm:gap-3 sm:px-4">
        <span className="rounded bg-terminal-blue px-1.5 py-0.5 font-mono font-bold tracking-wide text-terminal-bg">
          SCANNING
        </span>
        <span className="min-w-0 text-terminal-muted">
          {scanMessage || 'Scanning US market…'} Cold start on free tier can take 30–60s.
        </span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-terminal-red/40 bg-terminal-red-dim px-3 py-1.5 text-xs sm:gap-3 sm:px-4">
        <span className="rounded bg-terminal-red px-1.5 py-0.5 font-mono font-bold tracking-wide text-terminal-bg">
          LIVE ERROR
        </span>
        <span className="min-w-0 text-terminal-red">Could not load live data — no demo fallback.</span>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-terminal-green/25 bg-terminal-green-dim/40 px-3 py-1.5 text-xs sm:gap-3 sm:px-4">
      <span className="rounded bg-terminal-green px-1.5 py-0.5 font-mono font-bold tracking-wide text-terminal-bg">
        LIVE
      </span>
      <span className="min-w-0 text-terminal-muted">
        <span className="sm:hidden">Live market data</span>
        <span className="hidden sm:inline">
          Real market data via Finnhub → Yahoo (unofficial) → Stooq cascade. Catalysts blank until briefed.
        </span>
      </span>
    </div>
  )
}

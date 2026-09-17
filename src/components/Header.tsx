import { Activity, RefreshCw } from 'lucide-react'
import type { MarketRegime } from '../types'

interface HeaderProps {
  asOf: string
  ideaCount: number
  aPlusCount: number
  onRefresh: () => void
  loading: boolean
  source?: 'live' | 'demo'
  marketRegime?: MarketRegime | null
  scanUniverseSize?: number
  coiledCount?: number
  triggeringCount?: number
}

export function Header({
  asOf,
  ideaCount,
  aPlusCount,
  onRefresh,
  loading,
  source,
  marketRegime,
  scanUniverseSize,
  coiledCount,
  triggeringCount,
}: HeaderProps) {
  const downtrend = marketRegime?.stDirection === 'Downtrend'
  const asOfLabel = (() => {
    try {
      return new Date(asOf).toLocaleString('en-IE', {
        timeZone: 'Europe/Dublin',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    } catch {
      return asOf
    }
  })()

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-terminal-border bg-terminal-panel px-4 py-2">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-terminal-elevated border border-terminal-border-bright">
          <Activity className="h-4 w-4 text-terminal-green" />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-terminal-fg">
            Qullamaggie Ideas
          </h1>
          <p className="text-[11px] text-terminal-muted">
            Group RS → range setups → A+ with catalyst · US equities · Kyle-style proxies (bars)
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs">
        <div className="hidden sm:flex items-center gap-3 font-mono text-terminal-muted">
          {marketRegime ? (
            <>
              <span
                className={
                  marketRegime.qqq10gt20 ? 'text-terminal-green' : 'text-terminal-amber'
                }
                title={marketRegime.detail ?? 'QQQ SMA10 vs SMA20'}
              >
                QQQ 10&gt;20{' '}
                <span className="text-terminal-fg">{marketRegime.qqq10gt20 ? 'ON' : 'OFF'}</span>
              </span>
              <span className="text-terminal-border-bright">|</span>
              <span
                className={
                  marketRegime.stDirection === 'Uptrend'
                    ? 'text-terminal-green'
                    : marketRegime.stDirection === 'Downtrend'
                      ? 'text-terminal-red'
                      : 'text-terminal-amber'
                }
                title="Heuristic ST direction from QQQ vs SMA50 / slope"
              >
                ST <span className="text-terminal-fg">{marketRegime.stDirection}</span>
              </span>
              {downtrend ? (
                <span
                  className="rounded border border-terminal-amber/40 bg-terminal-amber-dim px-1.5 py-0.5 text-[10px] text-terminal-amber"
                  title="Soft warn: deprioritize new breakouts in Downtrend regime"
                >
                  Soft warn · breakouts deprioritized
                </span>
              ) : null}
              <span className="text-terminal-border-bright">|</span>
            </>
          ) : null}
          {typeof scanUniverseSize === 'number' ? (
            <>
              <span title="Scan universe size">
                Scan <span className="text-terminal-fg">{scanUniverseSize}</span>
              </span>
              <span className="text-terminal-border-bright">|</span>
            </>
          ) : null}
          <span>
            Shown <span className="text-terminal-fg">{ideaCount}</span>
          </span>
          {typeof coiledCount === 'number' ? (
            <>
              <span className="text-terminal-border-bright">|</span>
              <span className="text-terminal-purple" title="Coiled in filtered set">
                Coil {coiledCount}
              </span>
            </>
          ) : null}
          {typeof triggeringCount === 'number' ? (
            <>
              <span className="text-terminal-border-bright">|</span>
              <span className="text-terminal-amber" title="Triggering in filtered set">
                Trig {triggeringCount}
              </span>
            </>
          ) : null}
          <span className="text-terminal-border-bright">|</span>
          <span>
            A+ <span className="text-terminal-a-plus">{aPlusCount}</span>
          </span>
          <span className="text-terminal-border-bright">|</span>
          <span title={source === 'live' ? 'Live as-of (Europe/Dublin)' : 'As-of (Europe/Dublin)'}>
            As of {asOfLabel} IST
          </span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-terminal-border-bright bg-terminal-elevated px-2.5 py-1.5 text-terminal-muted hover:border-terminal-blue hover:text-terminal-fg disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
    </header>
  )
}

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
  stage1Count?: number
  shortlistCount?: number
  emergencyFallback?: boolean
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
  stage1Count,
  shortlistCount,
  emergencyFallback,
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
    <header className="shrink-0 border-b border-terminal-border bg-terminal-panel px-3 py-2 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-terminal-border-bright bg-terminal-elevated">
            <Activity className="h-4 w-4 text-terminal-green" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight text-terminal-fg">
              Qullamaggie Ideas
            </h1>
            <p className="hidden text-[11px] text-terminal-muted sm:block">
              Group RS → range setups → A+ with catalyst · US equities · Kyle-style proxies (bars)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 text-xs">
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
            {typeof stage1Count === 'number' ? (
              <>
                <span className="text-terminal-border-bright">|</span>
                <span title="Stage-1 Yahoo liquid universe size">
                  Univ <span className="text-terminal-fg">{stage1Count}</span>
                </span>
              </>
            ) : null}
            {typeof shortlistCount === 'number' ? (
              <>
                <span className="text-terminal-border-bright">|</span>
                <span title="Stage-2 deep-scan shortlist size">
                  Deep <span className="text-terminal-fg">{shortlistCount}</span>
                </span>
              </>
            ) : null}
            {emergencyFallback ? (
              <>
                <span className="text-terminal-border-bright">|</span>
                <span className="text-terminal-amber" title="Yahoo Stage-1 failed; using emergency fixed SCAN_UNIVERSE">
                  Emergency universe
                </span>
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
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-terminal-border-bright bg-terminal-elevated px-2.5 py-1.5 text-terminal-muted hover:border-terminal-blue hover:text-terminal-fg disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden xs:inline sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Compact mobile stats strip */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-terminal-muted sm:hidden">
        <span>
          Shown <span className="text-terminal-fg">{ideaCount}</span>
        </span>
        <span className="text-terminal-border-bright">·</span>
        <span>
          A+ <span className="text-terminal-a-plus">{aPlusCount}</span>
        </span>
        {typeof coiledCount === 'number' ? (
          <>
            <span className="text-terminal-border-bright">·</span>
            <span className="text-terminal-purple">Coil {coiledCount}</span>
          </>
        ) : null}
        {typeof triggeringCount === 'number' ? (
          <>
            <span className="text-terminal-border-bright">·</span>
            <span className="text-terminal-amber">Trig {triggeringCount}</span>
          </>
        ) : null}
        {marketRegime ? (
          <>
            <span className="text-terminal-border-bright">·</span>
            <span
              className={
                marketRegime.stDirection === 'Uptrend'
                  ? 'text-terminal-green'
                  : marketRegime.stDirection === 'Downtrend'
                    ? 'text-terminal-red'
                    : 'text-terminal-amber'
              }
            >
              ST {marketRegime.stDirection}
            </span>
          </>
        ) : null}
      </div>
    </header>
  )
}

import { Activity, RefreshCw } from 'lucide-react'
import type { MarketRegime } from '../types'
import { MetricTip } from './MetricTip'

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
  stage15Count?: number
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
  stage15Count,
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
                <MetricTip
                  id="marketRegime10gt20"
                  extra={marketRegime.detail}
                  className={marketRegime.qqq10gt20 ? 'text-terminal-green' : 'text-terminal-amber'}
                >
                  QQQ 10&gt;20{' '}
                  <span className="text-terminal-fg">{marketRegime.qqq10gt20 ? 'ON' : 'OFF'}</span>
                </MetricTip>
                <span className="text-terminal-border-bright">|</span>
                <MetricTip
                  id="marketRegimeSt"
                  extra={marketRegime.detail}
                  className={
                    marketRegime.stDirection === 'Uptrend'
                      ? 'text-terminal-green'
                      : marketRegime.stDirection === 'Downtrend'
                        ? 'text-terminal-red'
                        : 'text-terminal-amber'
                  }
                >
                  ST <span className="text-terminal-fg">{marketRegime.stDirection}</span>
                </MetricTip>
                {downtrend ? (
                  <MetricTip
                    id="marketRegimeWarn"
                    className="rounded border border-terminal-amber/40 bg-terminal-amber-dim px-1.5 py-0.5 text-[10px] text-terminal-amber"
                  >
                    Soft warn · breakouts deprioritized
                  </MetricTip>
                ) : null}
                <span className="text-terminal-border-bright">|</span>
              </>
            ) : null}
            {typeof scanUniverseSize === 'number' ? (
              <>
                <MetricTip id="scanUniverse">
                  Scan <span className="text-terminal-fg">{scanUniverseSize}</span>
                </MetricTip>
                <span className="text-terminal-border-bright">|</span>
              </>
            ) : null}
            {typeof stage1Count === 'number' ? (
              <>
                <span className="text-terminal-border-bright">|</span>
                <MetricTip id="stage1Universe">
                  Univ <span className="text-terminal-fg">{stage1Count}</span>
                </MetricTip>
              </>
            ) : null}
            {typeof stage15Count === 'number' ? (
              <>
                <span className="text-terminal-border-bright">|</span>
                <MetricTip id="stage15Sma">
                  SMA <span className="text-terminal-fg">{stage15Count}</span>
                </MetricTip>
              </>
            ) : null}
            {typeof shortlistCount === 'number' ? (
              <>
                <span className="text-terminal-border-bright">|</span>
                <MetricTip id="stage2Deep">
                  Deep <span className="text-terminal-fg">{shortlistCount}</span>
                </MetricTip>
              </>
            ) : null}
            {emergencyFallback ? (
              <>
                <span className="text-terminal-border-bright">|</span>
                <MetricTip id="emergencyUniverse" className="text-terminal-amber">
                  Emergency universe
                </MetricTip>
              </>
            ) : null}
            <MetricTip id="shownCount">
              Shown <span className="text-terminal-fg">{ideaCount}</span>
            </MetricTip>
            {typeof coiledCount === 'number' ? (
              <>
                <span className="text-terminal-border-bright">|</span>
                <MetricTip id="stageCoiled" className="text-terminal-purple">
                  Coil {coiledCount}
                </MetricTip>
              </>
            ) : null}
            {typeof triggeringCount === 'number' ? (
              <>
                <span className="text-terminal-border-bright">|</span>
                <MetricTip id="stageTriggering" className="text-terminal-amber">
                  Trig {triggeringCount}
                </MetricTip>
              </>
            ) : null}
            <span className="text-terminal-border-bright">|</span>
            <MetricTip id="aPlus">
              A+ <span className="text-terminal-a-plus">{aPlusCount}</span>
            </MetricTip>
            <span className="text-terminal-border-bright">|</span>
            <MetricTip id="asOf" extra={source === 'live' ? 'Live' : source}>
              As of {asOfLabel} IST
            </MetricTip>
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
        <MetricTip id="shownCount">
          Shown <span className="text-terminal-fg">{ideaCount}</span>
        </MetricTip>
        <span className="text-terminal-border-bright">·</span>
        <MetricTip id="aPlus">
          A+ <span className="text-terminal-a-plus">{aPlusCount}</span>
        </MetricTip>
        {typeof coiledCount === 'number' ? (
          <>
            <span className="text-terminal-border-bright">·</span>
            <MetricTip id="stageCoiled" className="text-terminal-purple">
              Coil {coiledCount}
            </MetricTip>
          </>
        ) : null}
        {typeof triggeringCount === 'number' ? (
          <>
            <span className="text-terminal-border-bright">·</span>
            <MetricTip id="stageTriggering" className="text-terminal-amber">
              Trig {triggeringCount}
            </MetricTip>
          </>
        ) : null}
        {marketRegime ? (
          <>
            <span className="text-terminal-border-bright">·</span>
            <MetricTip
              id="marketRegimeSt"
              extra={marketRegime.detail}
              className={
                marketRegime.stDirection === 'Uptrend'
                  ? 'text-terminal-green'
                  : marketRegime.stDirection === 'Downtrend'
                    ? 'text-terminal-red'
                    : 'text-terminal-amber'
              }
            >
              ST {marketRegime.stDirection}
            </MetricTip>
          </>
        ) : null}
      </div>
    </header>
  )
}

import { Pin, PinOff, X } from 'lucide-react'
import type { TradingIdea } from '../types'
import { stageLabel } from '../lib/setupStage'
import type { UserWatchlistEntry } from '../lib/userWatchlistStore'
import { fmtPct, pctClass } from '../utils/format'

interface Props {
  entries: UserWatchlistEntry[]
  ideasByTicker: Map<string, TradingIdea>
  selectedTicker: string | null
  onSelect: (ticker: string) => void
  onTogglePin: (ticker: string) => void
  onRemove: (ticker: string) => void
  autoAddMinScore: number
  lastAutoAdded: string[]
  regimeDowntrend?: boolean
}

export function WatchlistPanel({
  entries,
  ideasByTicker,
  selectedTicker,
  onSelect,
  onTogglePin,
  onRemove,
  autoAddMinScore,
  lastAutoAdded,
  regimeDowntrend,
}: Props) {
  const sorted = [...entries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const ia = ideasByTicker.get(a.ticker)
    const ib = ideasByTicker.get(b.ticker)
    const sa = ia?.kyleScore ?? 0
    const sb = ib?.kyleScore ?? 0
    return sb - sa
  })

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-terminal-border bg-terminal-panel">
      <div className="border-b border-terminal-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">
            Dynamic watchlist
          </h2>
          <span className="font-mono text-[10px] text-terminal-dim">{entries.length}</span>
        </div>
        <p className="mt-1 text-[10px] leading-snug text-terminal-dim">
          Persists in localStorage. Auto-adds when{' '}
          <span className="font-mono text-terminal-amber">kyleScore ≥ {autoAddMinScore}</span> and
          stage is coiled/triggering. Pin to keep; unpin/remove to drop.
        </p>
        {regimeDowntrend ? (
          <p className="mt-1 text-[10px] text-terminal-amber">
            QQQ ST Downtrend — new breakouts deprioritized (soft warn).
          </p>
        ) : null}
        {lastAutoAdded.length ? (
          <p className="mt-1 text-[10px] text-terminal-green">
            Auto-added: {lastAutoAdded.slice(0, 8).join(', ')}
            {lastAutoAdded.length > 8 ? '…' : ''}
          </p>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        {!sorted.length ? (
          <p className="px-3 py-6 text-center text-[11px] text-terminal-dim">
            Empty — pin a scan row or wait for auto-add (coiled/triggering ★≥{autoAddMinScore}).
          </p>
        ) : (
          <ul className="divide-y divide-terminal-border/60">
            {sorted.map((entry) => {
              const idea = ideasByTicker.get(entry.ticker)
              const selected = selectedTicker === entry.ticker
              const stage = idea?.setupStage
              return (
                <li
                  key={entry.ticker}
                  className={`flex items-start gap-1 px-2 py-1.5 hover:bg-terminal-elevated/70 ${
                    selected ? 'bg-terminal-elevated ring-1 ring-inset ring-terminal-blue/40' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSelect(entry.ticker)}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-terminal-fg">
                        {entry.ticker}
                      </span>
                      {entry.pinned ? (
                        <span className="text-[9px] text-terminal-amber">PIN</span>
                      ) : null}
                      {entry.source === 'auto' ? (
                        <span className="text-[9px] text-terminal-dim">auto</span>
                      ) : null}
                      {stage ? (
                        <span
                          className={`rounded border px-1 py-0.5 text-[9px] ${
                            stage === 'triggering'
                              ? 'border-terminal-amber/40 bg-terminal-amber-dim text-terminal-amber'
                              : stage === 'coiled'
                                ? 'border-terminal-purple/40 bg-terminal-purple/10 text-terminal-purple'
                                : 'border-terminal-border text-terminal-dim'
                          }`}
                        >
                          {stageLabel(stage)}
                        </span>
                      ) : (
                        <span className="text-[9px] text-terminal-dim">no scan hit</span>
                      )}
                    </div>
                    {idea ? (
                      <div className="mt-0.5 flex flex-wrap gap-2 font-mono text-[10px] text-terminal-muted">
                        <span className={pctClass(idea.dayPct)}>{fmtPct(idea.dayPct)}</span>
                        <span>★{idea.kyleScore}</span>
                        <span>RVOL {idea.rvol.toFixed(1)}</span>
                        <span>{fmtPct(idea.pctFrom52wHigh)} Hi</span>
                      </div>
                    ) : (
                      <p className="mt-0.5 text-[10px] text-terminal-dim">
                        Not in current scan results (below 200 / failed fetch).
                      </p>
                    )}
                  </button>
                  <button
                    type="button"
                    title={entry.pinned ? 'Unpin' : 'Pin'}
                    onClick={() => onTogglePin(entry.ticker)}
                    className="rounded p-1 text-terminal-dim hover:bg-terminal-bg hover:text-terminal-amber"
                  >
                    {entry.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => onRemove(entry.ticker)}
                    className="rounded p-1 text-terminal-dim hover:bg-terminal-bg hover:text-terminal-red"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

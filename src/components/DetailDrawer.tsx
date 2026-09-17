import { X } from 'lucide-react'
import type { TradingIdea } from '../types'
import { stageLabel } from '../lib/setupStage'
import { fmtDollarVol, fmtPct, fmtPrice, fmtRvol, pctClass } from '../utils/format'
import { MiniSparkline } from './MiniSparkline'

interface Props {
  idea: TradingIdea | null
  onClose: () => void
  source?: 'live' | 'demo'
}

export function DetailDrawer({ idea, onClose, source = 'live' }: Props) {
  if (!idea) return null

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-terminal-border bg-terminal-panel shadow-2xl shadow-black/50">
      <div className="flex items-start justify-between border-b border-terminal-border px-4 py-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-lg font-bold text-terminal-fg">{idea.ticker}</h2>
            {idea.isAPlus && (
              <span className="rounded bg-terminal-a-plus px-1.5 py-0.5 text-[10px] font-bold text-terminal-bg">
                A+
              </span>
            )}
            <span
              className="rounded border border-terminal-amber/40 bg-terminal-amber-dim px-1.5 py-0.5 text-[10px] font-mono text-terminal-amber"
              title="Heuristic kyleScore (not Kyle official Rating)"
            >
              ★ {idea.kyleScore}
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] ${
                idea.setupStage === 'triggering'
                  ? 'border-terminal-amber/40 bg-terminal-amber-dim text-terminal-amber'
                  : idea.setupStage === 'coiled'
                    ? 'border-terminal-purple/40 bg-terminal-purple/10 text-terminal-purple'
                    : 'border-terminal-border text-terminal-muted'
              }`}
              title="Setup readiness stage"
            >
              {stageLabel(idea.setupStage)}
            </span>
            {idea.aboveSma200 && (
              <span className="rounded border border-terminal-green/30 bg-terminal-green/15 px-1.5 py-0.5 text-[10px] text-terminal-green">
                &gt;200 SMA
              </span>
            )}
            {idea.aboveSma50 && (
              <span className="rounded border border-terminal-blue/30 bg-terminal-blue/15 px-1.5 py-0.5 text-[10px] text-terminal-blue">
                above 50 SMA
              </span>
            )}
            {source === 'demo' && (
              <span className="rounded bg-terminal-amber-dim px-1.5 py-0.5 text-[10px] font-mono text-terminal-amber">
                DEMO
              </span>
            )}
          </div>
          <p className="text-xs text-terminal-muted">{idea.name}</p>
          <p className="text-[11px] text-terminal-dim">{idea.groupName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-terminal-dim hover:bg-terminal-elevated hover:text-terminal-fg"
          aria-label="Close detail"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between rounded-lg border border-terminal-border bg-terminal-elevated px-3 py-2">
          <div>
            <div className="font-mono text-xl text-terminal-fg">{fmtPrice(idea.price)}</div>
            <div className={`font-mono text-sm ${pctClass(idea.dayPct)}`}>
              {fmtPct(idea.dayPct)} today
            </div>
          </div>
          <MiniSparkline data={idea.sparkline} positive={idea.perf3M >= 0} />
        </div>

        {idea.characteristics.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {idea.characteristics.map((t) => (
              <span
                key={t}
                className="rounded border border-terminal-purple/30 bg-terminal-purple/10 px-1.5 py-0.5 text-[10px] text-terminal-purple"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'RVOL', value: fmtRvol(idea.rvol) },
            { label: 'ADR%', value: `${idea.adrPct.toFixed(1)}%` },
            { label: 'vs 52w', value: fmtPct(idea.pctFrom52wHigh) },
            { label: '1M', value: fmtPct(idea.perf1M, 0) },
            { label: '3M', value: fmtPct(idea.perf3M, 0) },
            { label: 'Setup', value: idea.setupType },
            { label: 'vs 200 SMA', value: fmtPct(idea.pctAboveSma200) },
            { label: 'vs 50 SMA', value: fmtPct(idea.pctAboveSma50) },
            { label: 'SMA200', value: fmtPrice(idea.sma200) },
            { label: 'Prior run%', value: fmtPct(idea.priorRunPct, 0) },
            { label: 'Tight / Base', value: `${idea.tightDays} / ${idea.baseLengthDays}d` },
            { label: 'DolVol', value: fmtDollarVol(idea.dollarVolume || idea.avgDollarVol) },
            { label: 'SMA10', value: fmtPrice(idea.sma10) },
            { label: 'SMA20', value: fmtPrice(idea.sma20) },
            { label: 'kyleScore', value: String(idea.kyleScore) },
          ].map((m) => (
            <div
              key={m.label}
              className="rounded border border-terminal-border bg-terminal-bg px-2 py-2"
            >
              <div className="text-[9px] uppercase tracking-wide text-terminal-dim">{m.label}</div>
              <div className="mt-0.5 truncate font-mono text-xs text-terminal-fg">{m.value}</div>
            </div>
          ))}
        </div>

        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
            Trend gate
          </h3>
          <p className="rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm text-terminal-muted">
            aboveSma200={String(idea.aboveSma200)} · aboveSma50={String(idea.aboveSma50)} ·
            aboveSma20={String(idea.aboveSma20)} · aboveSma10={String(idea.aboveSma10)} · SMA50{' '}
            {fmtPrice(idea.sma50)}
          </p>
        </section>

        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
            Catalyst
          </h3>
          <p className="rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm text-terminal-fg">
            {idea.catalyst ?? (
              <span className="text-terminal-dim">No discrete catalyst — not preferred for A+.</span>
            )}
          </p>
        </section>

        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
            Why it qualifies
          </h3>
          <p className="text-sm leading-relaxed text-terminal-muted">{idea.whyQualifies}</p>
        </section>

        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
            Notes
          </h3>
          <p className="text-sm leading-relaxed text-terminal-muted">{idea.notes}</p>
        </section>

        <section className="rounded-lg border border-dashed border-terminal-border-bright bg-terminal-bg/50 px-3 py-3">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
            Suggested levels (placeholders)
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-[10px] text-terminal-dim">Entry zone</div>
              <div className="font-mono text-terminal-green">
                {idea.suggestedEntry != null ? fmtPrice(idea.suggestedEntry) : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-terminal-dim">Stop</div>
              <div className="font-mono text-terminal-red">
                {idea.suggestedStop != null ? fmtPrice(idea.suggestedStop) : '—'}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-terminal-dim">
            Placeholders only — not trade advice. Size by ADR and risk rules. kyleScore is a
            heuristic, not Kyle&apos;s official Rating.
          </p>
        </section>
      </div>
    </aside>
  )
}

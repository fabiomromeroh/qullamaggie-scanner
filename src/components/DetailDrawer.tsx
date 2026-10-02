import type { TradingIdea } from '../types'
import { stageLabel } from '../lib/setupStage'
import { SURFER_CONFIG } from '../lib/surfer'
import { TIGHT_CONFIG } from '../lib/tightConsolidation'
import { fmtDollarVol, fmtPct, fmtPrice, fmtRvol, pctClass } from '../utils/format'
import { MiniSparkline } from './MiniSparkline'
import { TickerNews } from './TickerNews'
import { TickerProfile } from './TickerProfile'

interface Props {
  idea: TradingIdea
  source?: 'live' | 'demo'
}

function passFail(ok: boolean): string {
  return ok ? 'pass' : 'fail'
}

function SurferDetailSection({ idea }: { idea: TradingIdea }) {
  const rows: { label: string; ok: boolean; key: 'sma10' | 'sma20' | 'sma50' }[] = [
    { label: '10MA', ok: Boolean(idea.surfer10), key: 'sma10' },
    { label: '20MA', ok: Boolean(idea.surfer20), key: 'sma20' },
    { label: '50MA', ok: Boolean(idea.surfer50), key: 'sma50' },
  ]
  return (
    <section>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
        Strict MA surfer
      </h3>
      <p className="mb-2 text-[11px] text-terminal-dim">
        Ride the SMA and bounce off it (window {SURFER_CONFIG.windowSessions.sma10}/
        {SURFER_CONFIG.windowSessions.sma50} sessions, min touches {SURFER_CONFIG.minTouches.sma10}/
        {SURFER_CONFIG.minTouches.sma50}, bounce {SURFER_CONFIG.bounceSessions}d, close-break ≤{' '}
        {SURFER_CONFIG.closeBreakTolerancePct}%). Loose above-SMA flags stay on Trend gate.
      </p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {rows.map((row) => {
          const d = idea.surferDetail?.[row.key]
          return (
            <div
              key={row.key}
              className="rounded border border-terminal-border bg-terminal-bg px-2 py-2"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-terminal-muted">
                  {row.label}
                </span>
                <span
                  className={`text-[10px] font-mono ${
                    row.ok ? 'text-terminal-green' : 'text-terminal-dim'
                  }`}
                >
                  {row.ok ? 'YES' : 'no'}
                </span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-terminal-fg">
                {d
                  ? `${d.touches} touches · ${d.bounces} bounces · slope ${d.slopePct}%`
                  : '—'}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function TightDetailSection({ idea }: { idea: TradingIdea }) {
  const d = idea.tightDetail
  const reasons = d?.failedReasons ?? []
  const has = (needle: string) => reasons.some((r) => r.includes(needle))
  const rangeOk = d != null && d.rangeRatio <= TIGHT_CONFIG.rangeRatioMax
  const volumeOk = d != null && d.volumeRatio <= TIGHT_CONFIG.volumeRatioMax
  const spreadOk = reasons.length
    ? !has('close-spread')
    : d != null && d.closeSpreadPct <= TIGHT_CONFIG.closeSpreadAbsMaxPct
  const nearHigh = idea.pctFrom52wHigh >= -TIGHT_CONFIG.nearHighMaxPct
  const aboveMas = idea.aboveSma10 && idea.aboveSma20
  const rows = [
    {
      label: 'Range contraction',
      value: d ? `${d.rangeRatio}×` : '—',
      ok: rangeOk,
      hint: `≤ ${TIGHT_CONFIG.rangeRatioMax} vs prior ${TIGHT_CONFIG.baselineSessions}d`,
    },
    {
      label: 'Volume ratio',
      value: d ? `${d.volumeRatio}×` : '—',
      ok: volumeOk,
      hint: `≤ ${TIGHT_CONFIG.volumeRatioMax} vs ${TIGHT_CONFIG.volumeAvgSessions}d avg`,
    },
    {
      label: 'Close spread',
      value: d ? `${d.closeSpreadPct}%` : '—',
      ok: spreadOk,
      hint: `cap ${TIGHT_CONFIG.closeSpreadAbsMaxPct}% and ${TIGHT_CONFIG.closeSpreadMaxMultipleOfAdr}× baseline ADR`,
    },
    {
      label: 'Days',
      value: d ? String(d.days) : String(TIGHT_CONFIG.recentWindow),
      ok: Boolean(d),
      hint: 'recent window',
    },
    {
      label: 'Near 52w high',
      value: fmtPct(idea.pctFrom52wHigh),
      ok: nearHigh,
      hint: `within ${TIGHT_CONFIG.nearHighMaxPct}%`,
    },
    {
      label: 'Above SMA10+20',
      value: `${idea.aboveSma10 ? '10' : '·'} / ${idea.aboveSma20 ? '20' : '·'}`,
      ok: aboveMas,
      hint: 'loose price-above-SMA',
    },
  ]
  return (
    <section>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
        Tight consolidation
      </h3>
      <p className="mb-2 text-[11px] text-terminal-dim">
        {idea.tightConsolidation ? 'Passes' : 'Does not pass'} the strict contraction rule
        {d ? ` (${d.days}d window)` : ''}.
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className="rounded border border-terminal-border bg-terminal-bg px-2 py-2"
            title={row.hint}
          >
            <div className="text-[9px] uppercase tracking-wide text-terminal-dim">{row.label}</div>
            <div className="mt-0.5 font-mono text-xs text-terminal-fg">{row.value}</div>
            <div
              className={`text-[10px] ${row.ok ? 'text-terminal-green' : 'text-terminal-dim'}`}
            >
              {passFail(row.ok)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function DetailDrawer({ idea, source = 'live' }: Props) {
  return (
    <div className="flex flex-col bg-terminal-panel">
      <div className="border-b border-terminal-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-lg font-bold text-terminal-fg">{idea.ticker}</h2>
            {idea.earningsStatus === 'avoid' ? (
              <span className="rounded border border-terminal-red/50 bg-terminal-red-dim px-1.5 py-0.5 text-[10px] font-bold text-terminal-red">
                AVOID EARNINGS
              </span>
            ) : idea.isAPlus ? (
              <span className="rounded bg-terminal-a-plus px-1.5 py-0.5 text-[10px] font-bold text-terminal-bg">
                A+
              </span>
            ) : null}
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
          <p className="truncate text-xs text-terminal-muted">{idea.name}</p>
          <p className="text-[11px] text-terminal-dim">{idea.groupName}</p>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-terminal-border bg-terminal-elevated px-3 py-2">
          <div>
            <div className="font-mono text-xl text-terminal-fg">{fmtPrice(idea.price)}</div>
            <div className={`font-mono text-sm ${pctClass(idea.dayPct)}`}>
              {fmtPct(idea.dayPct)} today
            </div>
          </div>
          <div className="shrink-0" title="Recent closes">
            <MiniSparkline data={idea.sparkline} positive={idea.perf3M >= 0} />
          </div>
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

        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
          {[
            { label: 'RVOL', value: fmtRvol(idea.rvol) },
            { label: 'ADR%', value: `${idea.adrPct.toFixed(1)}%` },
            { label: 'vs 52w', value: fmtPct(idea.pctFrom52wHigh) },
            { label: '1M', value: fmtPct(idea.perf1M, 0) },
            { label: '3M', value: fmtPct(idea.perf3M, 0) },
            { label: '6M', value: fmtPct(idea.perf6M, 0) },
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

        <SurferDetailSection idea={idea} />
        <TightDetailSection idea={idea} />

        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
            Earnings proximity
          </h3>
          <p
            className={`rounded border px-3 py-2 text-sm ${
              idea.earningsStatus === 'avoid'
                ? 'border-terminal-red/40 bg-terminal-red-dim text-terminal-red'
                : idea.earningsStatus === 'alert'
                  ? 'border-terminal-amber/40 bg-terminal-amber-dim text-terminal-amber'
                  : 'border-terminal-border bg-terminal-bg text-terminal-muted'
            }`}
          >
            {idea.earningsDate != null ? (
              <>
                Next earnings <span className="font-mono">{idea.earningsDate}</span>
                {idea.daysToEarnings != null ? (
                  <>
                    {' '}
                    · <span className="font-mono">{idea.daysToEarnings}</span> trading day
                    {idea.daysToEarnings === 1 ? '' : 's'}
                  </>
                ) : null}
                {' '}
                · status <span className="font-mono uppercase">{idea.earningsStatus}</span>
                {idea.earningsStatus === 'avoid'
                  ? ' — hard fail for entry (same day / next trading day)'
                  : idea.earningsStatus === 'alert'
                    ? ' — flagged (~2 trading days out)'
                    : ''}
              </>
            ) : (
              <>No upcoming earnings in calendar window · status clear</>
            )}
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

        <TickerProfile key={`profile-${idea.ticker}`} symbol={idea.ticker} />
        <TickerNews key={`news-${idea.ticker}`} symbol={idea.ticker} />
      </div>
    </div>
  )
}

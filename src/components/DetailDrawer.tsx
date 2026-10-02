import type { MetricId } from '../lib/metricDefinitions'
import type { TradingIdea } from '../types'
import { stageLabel } from '../lib/setupStage'
import { SURFER_CONFIG } from '../lib/surfer'
import { TIGHT_CONFIG } from '../lib/tightConsolidation'
import { fmtDollarVol, fmtPct, fmtPrice, fmtRvol, pctClass } from '../utils/format'
import { MetricTip } from './MetricTip'
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

function MetricCell({ id, label, value }: { id: MetricId; label: string; value: string }) {
  return (
    <MetricTip id={id} className="block rounded border border-terminal-border bg-terminal-bg px-2 py-2">
      <div className="text-[9px] uppercase tracking-wide text-terminal-dim">{label}</div>
      <div className="mt-0.5 truncate font-mono text-xs text-terminal-fg">{value}</div>
    </MetricTip>
  )
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
            <MetricTip
              key={row.key}
              id={row.key === 'sma10' ? 'surfer10' : row.key === 'sma20' ? 'surfer20' : 'surfer50'}
              extra={
                d ? `${d.touches} touches · ${d.bounces} bounces · slope ${d.slopePct}%` : undefined
              }
              className="block rounded border border-terminal-border bg-terminal-bg px-2 py-2"
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
            </MetricTip>
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
        <MetricTip id="tightConsolidation">Tight consolidation</MetricTip>
      </h3>
      <p className="mb-2 text-[11px] text-terminal-dim">
        {idea.tightConsolidation ? 'Passes' : 'Does not pass'} the strict contraction rule
        {d ? ` (${d.days}d window)` : ''}.
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {rows.map((row) => (
          <MetricTip
            key={row.label}
            id={
              row.label === 'Range contraction'
                ? 'tightRangeRatio'
                : row.label === 'Volume ratio'
                  ? 'tightVolumeRatio'
                  : row.label === 'Close spread'
                    ? 'tightCloseSpread'
                    : row.label === 'Days'
                      ? 'tightWindowDays'
                      : row.label === 'Near 52w high'
                        ? 'tightNearHigh'
                        : 'tightAboveMas'
            }
            extra={row.hint}
            className="block rounded border border-terminal-border bg-terminal-bg px-2 py-2"
          >
            <div className="text-[9px] uppercase tracking-wide text-terminal-dim">{row.label}</div>
            <div className="mt-0.5 font-mono text-xs text-terminal-fg">{row.value}</div>
            <div
              className={`text-[10px] ${row.ok ? 'text-terminal-green' : 'text-terminal-dim'}`}
            >
              {passFail(row.ok)}
            </div>
          </MetricTip>
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
            <MetricTip id="ticker" className="font-mono text-lg font-bold text-terminal-fg">
              {idea.ticker}
            </MetricTip>
            {idea.earningsStatus === 'avoid' ? (
              <MetricTip
                id="earningsAvoid"
                className="rounded border border-terminal-red/50 bg-terminal-red-dim px-1.5 py-0.5 text-[10px] font-bold text-terminal-red"
              >
                AVOID EARNINGS
              </MetricTip>
            ) : idea.isAPlus ? (
              <MetricTip
                id="aPlus"
                className="rounded bg-terminal-a-plus px-1.5 py-0.5 text-[10px] font-bold text-terminal-bg"
              >
                A+
              </MetricTip>
            ) : null}
            <MetricTip
              id="kyleScore"
              extra={`kyleScore ${idea.kyleScore}`}
              className="rounded border border-terminal-amber/40 bg-terminal-amber-dim px-1.5 py-0.5 text-[10px] font-mono text-terminal-amber"
            >
              ★ {idea.kyleScore}
            </MetricTip>
            <MetricTip
              id={
                idea.setupStage === 'triggering'
                  ? 'stageTriggering'
                  : idea.setupStage === 'coiled'
                    ? 'stageCoiled'
                    : 'stageWatching'
              }
              className={`rounded border px-1.5 py-0.5 text-[10px] ${
                idea.setupStage === 'triggering'
                  ? 'border-terminal-amber/40 bg-terminal-amber-dim text-terminal-amber'
                  : idea.setupStage === 'coiled'
                    ? 'border-terminal-purple/40 bg-terminal-purple/10 text-terminal-purple'
                    : 'border-terminal-border text-terminal-muted'
              }`}
            >
              {stageLabel(idea.setupStage)}
            </MetricTip>
            {idea.aboveSma200 ? (
              <MetricTip
                id="aboveSma200"
                extra={`Price ${fmtPct(idea.pctAboveSma200)} vs 200 SMA (${fmtPrice(idea.sma200)})`}
                className="rounded border border-terminal-green/30 bg-terminal-green/15 px-1.5 py-0.5 text-[10px] text-terminal-green"
              >
                &gt;200 SMA
              </MetricTip>
            ) : (
              <MetricTip
                id="belowSma200"
                extra={`Price ${fmtPct(idea.pctAboveSma200)} vs 200 SMA (${fmtPrice(idea.sma200)})`}
                className="rounded border border-terminal-red/40 bg-terminal-red-dim px-1.5 py-0.5 text-[10px] text-terminal-red"
              >
                Below 200
              </MetricTip>
            )}
            {idea.aboveSma50 && (
              <MetricTip
                id="aboveSma50"
                extra={`${fmtPct(idea.pctAboveSma50)} vs 50 (${fmtPrice(idea.sma50)})`}
                className="rounded border border-terminal-blue/30 bg-terminal-blue/15 px-1.5 py-0.5 text-[10px] text-terminal-blue"
              >
                above 50 SMA
              </MetricTip>
            )}
            {source === 'demo' && (
              <span className="rounded bg-terminal-amber-dim px-1.5 py-0.5 text-[10px] font-mono text-terminal-amber">
                DEMO
              </span>
            )}
          </div>
          <p className="truncate text-xs text-terminal-muted">
            <MetricTip id="name">{idea.name}</MetricTip>
          </p>
          <p className="text-[11px] text-terminal-dim">
            <MetricTip id="ideaGroup">{idea.groupName}</MetricTip>
          </p>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-terminal-border bg-terminal-elevated px-3 py-2">
          <div>
            <div className="font-mono text-xl text-terminal-fg">
              <MetricTip id="price">{fmtPrice(idea.price)}</MetricTip>
            </div>
            <div className={`font-mono text-sm ${pctClass(idea.dayPct)}`}>
              <MetricTip id="dayPct">{fmtPct(idea.dayPct)} today</MetricTip>
            </div>
          </div>
          <MetricTip id="sparkline" extra={`3M ${fmtPct(idea.perf3M, 0)}`} className="shrink-0">
            <MiniSparkline data={idea.sparkline} positive={idea.perf3M >= 0} />
          </MetricTip>
        </div>

        {idea.characteristics.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {idea.characteristics.map((t) => (
              <MetricTip
                key={t}
                id={
                  t === '10MA Surfer'
                    ? 'surfer10'
                    : t === '20MA Surfer'
                      ? 'surfer20'
                      : t === '50MA Surfer'
                        ? 'surfer50'
                        : t === 'near ATH'
                          ? 'nearAth'
                          : t === 'Earnings'
                            ? 'charEarnings'
                            : t === 'GAP'
                              ? 'charGap'
                              : 'belowSma200'
                }
                className="rounded border border-terminal-purple/30 bg-terminal-purple/10 px-1.5 py-0.5 text-[10px] text-terminal-purple"
              >
                {t}
              </MetricTip>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
          <MetricCell id="rvol" label="RVOL" value={fmtRvol(idea.rvol)} />
          <MetricCell id="adrPct" label="ADR%" value={`${idea.adrPct.toFixed(1)}%`} />
          <MetricCell id="pctFrom52wHigh" label="vs 52w" value={fmtPct(idea.pctFrom52wHigh)} />
          <MetricCell id="perf1m" label="1M" value={fmtPct(idea.perf1M, 0)} />
          <MetricCell id="perf3m" label="3M" value={fmtPct(idea.perf3M, 0)} />
          <MetricCell id="perf6m" label="6M" value={fmtPct(idea.perf6M, 0)} />
          <MetricTip
            id={
              idea.setupType === 'Range Breakout'
                ? 'setupRangeBreakout'
                : idea.setupType === 'Episodic Pivot'
                  ? 'setupEpisodicPivot'
                  : 'setupContinuation'
            }
            className="block rounded border border-terminal-border bg-terminal-bg px-2 py-2"
          >
            <div className="text-[9px] uppercase tracking-wide text-terminal-dim">Setup</div>
            <div className="mt-0.5 truncate font-mono text-xs text-terminal-fg">{idea.setupType}</div>
          </MetricTip>
          <MetricCell id="pctAboveSma200" label="vs 200 SMA" value={fmtPct(idea.pctAboveSma200)} />
          <MetricCell id="pctAboveSma50" label="vs 50 SMA" value={fmtPct(idea.pctAboveSma50)} />
          <MetricCell id="sma200" label="SMA200" value={fmtPrice(idea.sma200)} />
          <MetricCell id="priorRunPct" label="Prior run%" value={fmtPct(idea.priorRunPct, 0)} />
          <MetricCell id="tightDays" label="Tight days" value={String(idea.tightDays)} />
          <MetricCell id="baseLengthDays" label="Base length" value={`${idea.baseLengthDays}d`} />
          <MetricCell id="dolVol" label="DolVol" value={fmtDollarVol(idea.dollarVolume || idea.avgDollarVol)} />
          <MetricCell id="sma10" label="SMA10" value={fmtPrice(idea.sma10)} />
          <MetricCell id="sma20" label="SMA20" value={fmtPrice(idea.sma20)} />
          <MetricCell id="sma50" label="SMA50" value={fmtPrice(idea.sma50)} />
          <MetricCell id="kyleScore" label="kyleScore" value={String(idea.kyleScore)} />
        </div>

        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
            <MetricTip id="trendGate">Trend gate</MetricTip>
          </h3>
          <p className="rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm text-terminal-muted">
            <MetricTip id="aboveSma200">aboveSma200={String(idea.aboveSma200)}</MetricTip>
            {' · '}
            <MetricTip id="aboveSma50">aboveSma50={String(idea.aboveSma50)}</MetricTip>
            {' · '}
            <MetricTip id="aboveSma20">aboveSma20={String(idea.aboveSma20)}</MetricTip>
            {' · '}
            <MetricTip id="aboveSma10">aboveSma10={String(idea.aboveSma10)}</MetricTip>
            {' · '}
            <MetricTip id="sma50">SMA50 {fmtPrice(idea.sma50)}</MetricTip>
          </p>
        </section>

        <SurferDetailSection idea={idea} />
        <TightDetailSection idea={idea} />

        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
            <MetricTip
              id="earningsStatus"
              extra={
                idea.earningsDate != null
                  ? `Next earnings ${idea.earningsDate} · ${idea.daysToEarnings ?? '?'} trading days · ${idea.earningsStatus}`
                  : 'No upcoming earnings in calendar window · status clear'
              }
            >
              Earnings proximity
            </MetricTip>
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
            <MetricTip id="catalyst">Catalyst</MetricTip>
          </h3>
          <p className="rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm text-terminal-fg">
            {idea.catalyst ? (
              <MetricTip id="catalyst" extra={idea.catalyst}>
                {idea.catalyst}
              </MetricTip>
            ) : (
              <MetricTip id="catalyst" className="text-terminal-dim">
                No discrete catalyst — not preferred for A+.
              </MetricTip>
            )}
          </p>
        </section>

        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
            <MetricTip id="whyQualifies">Why it qualifies</MetricTip>
          </h3>
          <p className="text-sm leading-relaxed text-terminal-muted">
            <MetricTip id="whyQualifies">{idea.whyQualifies}</MetricTip>
          </p>
        </section>

        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
            <MetricTip id="ideaNotes">Notes</MetricTip>
          </h3>
          <p className="text-sm leading-relaxed text-terminal-muted">
            <MetricTip id="ideaNotes">{idea.notes}</MetricTip>
          </p>
        </section>

        <TickerProfile key={`profile-${idea.ticker}`} symbol={idea.ticker} />
        <TickerNews key={`news-${idea.ticker}`} symbol={idea.ticker} />
      </div>
    </div>
  )
}

import type { ReactNode } from 'react'
import { Pin, PinOff } from 'lucide-react'
import {
  extensionAdr50Tone,
  formatExtensionAdr50,
} from '../lib/extensionAdr'
import { metricTipAttrs, type MetricId } from '../lib/metricDefinitions'
import type { TradingIdea } from '../types'
import { RANGE_BREAKOUT_CONFIG } from '../lib/metrics'
import { RANGE_BASE_CONFIG } from '../lib/rangeBase'
import { stageLabel } from '../lib/setupStage'
import { TIGHT_CONFIG } from '../lib/tightConsolidation'
import { fmtDollarVol, fmtPct, fmtPrice, fmtRvol, pctClass } from '../utils/format'
import { MetricTip } from './MetricTip'
import { MiniSparkline } from './MiniSparkline'
import { TickerNews } from './TickerNews'
import { TickerProfile } from './TickerProfile'

interface Props {
  idea: TradingIdea
  source?: 'live' | 'demo'
  isPinned?: boolean
  onTogglePin?: () => void
}

function passFail(ok: boolean): string {
  return ok ? 'pass' : 'fail'
}

function ext50ChipClass(value: number | null): string {
  const tone = extensionAdr50Tone(value)
  const base = 'rounded border px-1.5 py-0.5 text-[10px] font-mono'
  if (tone === 'green') return `${base} border-terminal-green/30 bg-terminal-green/15 text-terminal-green`
  if (tone === 'amber') return `${base} border-terminal-amber/40 bg-terminal-amber-dim text-terminal-amber`
  if (tone === 'red') return `${base} border-terminal-red/40 bg-terminal-red-dim text-terminal-red`
  return `${base} border-terminal-border text-terminal-dim`
}

function MetricCell({ id, label, value }: { id: MetricId; label: string; value: string }) {
  return (
    <MetricTip id={id} className="block rounded border border-terminal-border bg-terminal-bg px-2 py-2">
      <div className="text-[9px] uppercase tracking-wide text-terminal-dim">{label}</div>
      <div className="mt-0.5 truncate font-mono text-xs text-terminal-fg">{value}</div>
    </MetricTip>
  )
}

const tightCardClass = 'block rounded border border-terminal-border bg-terminal-bg px-2 py-2'

function tightRowBody(row: { label: string; value: string; ok: boolean }): ReactNode {
  return (
    <>
      <div className="text-[9px] uppercase tracking-wide text-terminal-dim">{row.label}</div>
      <div className="mt-0.5 font-mono text-xs text-terminal-fg">{row.value}</div>
      <div className={`text-[10px] ${row.ok ? 'text-terminal-green' : 'text-terminal-dim'}`}>
        {passFail(row.ok)}
      </div>
    </>
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
  const nearHigh = d?.nearHigh ?? idea.pctFrom52wHigh >= -TIGHT_CONFIG.nearHighMaxPct
  const above50 = d?.aboveSma50 ?? idea.aboveSma50
  const above200 = d?.aboveSma200 ?? idea.aboveSma200
  const rows: { label: string; value: string; ok: boolean; hint: string; id: MetricId }[] = [
    {
      label: 'Range contraction',
      value: d ? `${d.rangeRatio}×` : '—',
      ok: rangeOk,
      hint: `≤ ${TIGHT_CONFIG.rangeRatioMax} vs prior ${TIGHT_CONFIG.baselineSessions}d`,
      id: 'tightRangeRatio',
    },
    {
      label: 'Volume ratio',
      value: d ? `${d.volumeRatio}×` : '—',
      ok: volumeOk,
      hint: `≤ ${TIGHT_CONFIG.volumeRatioMax} vs ${TIGHT_CONFIG.volumeAvgSessions}d avg`,
      id: 'tightVolumeRatio',
    },
    {
      label: 'Close spread',
      value: d ? `${d.closeSpreadPct}%` : '—',
      ok: spreadOk,
      hint: `cap ${TIGHT_CONFIG.closeSpreadAbsMaxPct}% and ${TIGHT_CONFIG.closeSpreadMaxMultipleOfAdr}× baseline ADR`,
      id: 'tightCloseSpread',
    },
    {
      label: 'Days',
      value: d ? String(d.days) : String(TIGHT_CONFIG.recentWindow),
      ok: Boolean(d),
      hint: 'recent window',
      id: 'tightWindowDays',
    },
    {
      label: 'Near 52w high',
      value: fmtPct(idea.pctFrom52wHigh),
      ok: nearHigh,
      hint: `within ${TIGHT_CONFIG.nearHighMaxPct}%`,
      id: 'tightNearHigh',
    },
    {
      label: 'Above SMA50',
      value: above50 ? 'yes' : 'no',
      ok: above50,
      hint: 'price above the 50-day SMA',
      id: 'tightAboveSma50',
    },
    {
      label: 'Above 200 DMA',
      value: above200 ? 'yes' : 'no',
      ok: above200,
      hint: 'price above the 200-day SMA',
      id: 'tightAboveSma200',
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
        <MetricTip id="tightRangeRatio" extra={rows[0]!.hint} className={tightCardClass}>
          {tightRowBody(rows[0]!)}
        </MetricTip>
        <MetricTip id="tightVolumeRatio" extra={rows[1]!.hint} className={tightCardClass}>
          {tightRowBody(rows[1]!)}
        </MetricTip>
        <MetricTip id="tightCloseSpread" extra={rows[2]!.hint} className={tightCardClass}>
          {tightRowBody(rows[2]!)}
        </MetricTip>
        <MetricTip id="tightWindowDays" extra={rows[3]!.hint} className={tightCardClass}>
          {tightRowBody(rows[3]!)}
        </MetricTip>
        <MetricTip id="tightNearHigh" extra={rows[4]!.hint} className={tightCardClass}>
          {tightRowBody(rows[4]!)}
        </MetricTip>
        <MetricTip id="tightAboveSma50" extra={rows[5]!.hint} className={tightCardClass}>
          {tightRowBody(rows[5]!)}
        </MetricTip>
        <MetricTip id="tightAboveSma200" extra={rows[6]!.hint} className={tightCardClass}>
          {tightRowBody(rows[6]!)}
        </MetricTip>
      </div>
    </section>
  )
}

function gateCardClass(ok: boolean): string {
  const tone = ok ? 'border-terminal-green/40' : 'border-terminal-red/40'
  return `block rounded border ${tone} bg-terminal-bg px-2 py-2`
}

function gateStatusClass(ok: boolean): string {
  return ok ? 'text-terminal-green' : 'text-terminal-red'
}

function gateBody(label: string, value: string, ok: boolean): ReactNode {
  return (
    <>
      <div className="text-[9px] uppercase tracking-wide text-terminal-dim">{label}</div>
      <div className={`mt-0.5 font-mono text-xs ${gateStatusClass(ok)}`}>{value}</div>
      <div className={`text-[10px] ${gateStatusClass(ok)}`}>{ok ? 'pass' : 'fail'}</div>
    </>
  )
}

function RangeBreakoutGatesSection({ idea }: { idea: TradingIdea }) {
  const d = idea.rangeBreakoutDetail
  if (!d) return null
  const c = RANGE_BREAKOUT_CONFIG
  const adrOk = d.adrPct >= c.adrMinPct
  const aboveOk = d.aboveSma50 === true
  const priorOk = d.priorRunPct >= c.priorLegMinPct
  const rangeOk = d.rangeOverAdr != null && d.rangeOverAdr <= c.rangeOverAdrMax
  const lowsOk = d.hasHigherLows === true
  const ruleLabel =
    d.higherLowsRule === 'half' ? 'half-window' : d.higherLowsRule === 'swing' ? 'swing lows' : 'neither'
  const headline = d.passed
    ? idea.setupType === 'Episodic Pivot'
      ? 'All five gates pass. Episodic Pivot is checked first, so the label stays Episodic Pivot.'
      : 'All five gates pass.'
    : 'Not every gate passes.'
  return (
    <section>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
        <MetricTip id="setupRangeBreakout">Range Breakout gates</MetricTip>
      </h3>
      <p className="mb-2 text-[11px] text-terminal-dim">{headline}</p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <MetricTip id="rangeBreakoutAdr" extra={`≥ ${c.adrMinPct}`} className={gateCardClass(adrOk)}>
          {gateBody('ADR%', `${d.adrPct.toFixed(1)}%`, adrOk)}
        </MetricTip>
        <MetricTip
          id="rangeBreakoutAbove50"
          extra="price above the 50-day SMA"
          className={gateCardClass(aboveOk)}
        >
          {gateBody('Above 50 SMA', d.aboveSma50 ? 'yes' : 'no', aboveOk)}
        </MetricTip>
        <MetricTip
          id="rangeBreakoutPriorLeg"
          extra={`≥ ${c.priorLegMinPct}% via priorRunPct`}
          className={gateCardClass(priorOk)}
        >
          {gateBody('Prior leg%', fmtPct(d.priorRunPct, 0), priorOk)}
        </MetricTip>
        <MetricTip
          id="rangeBreakoutRangeAdr"
          extra={`≤ ${c.rangeOverAdrMax} over ${c.recentRangeSessions} sessions`}
          className={gateCardClass(rangeOk)}
        >
          {gateBody('Range/ADR', d.rangeOverAdr == null ? '—' : d.rangeOverAdr.toFixed(2), rangeOk)}
        </MetricTip>
        <MetricTip id="rangeBreakoutHigherLows" extra={ruleLabel} className={gateCardClass(lowsOk)}>
          {gateBody('Higher lows', lowsOk ? `yes · ${ruleLabel}` : 'no', lowsOk)}
        </MetricTip>
      </div>
    </section>
  )
}

function RangeBaseSection({ idea }: { idea: TradingIdea }) {
  const d = idea.rangeBaseDetail
  if (!d) return null
  const c = RANGE_BASE_CONFIG
  const compressionOk = d.compression != null && d.compression <= c.compressionMax
  const containmentOk = d.containment >= c.containmentMin
  const lengthOk = d.lengthSessions >= c.minSessions
  const aboveOk = d.above50Frac >= c.above50Min
  return (
    <section className="border-b border-terminal-border px-4 py-3">
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
        <MetricTip id="rangeBase" extra={d.failedReasons.length ? d.failedReasons.join(', ') : 'core gates passed'}>
          Range base
        </MetricTip>
      </h3>
      <p className="mb-2 text-[11px] text-terminal-dim">
        {d.ok ? 'Passes' : 'Does not pass'} · score {d.score.toFixed(2)} · {d.lengthSessions} sessions
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <MetricTip id="rangeBase" extra={`≤ ${c.compressionMax} over ${c.recentSessions} sessions`} className={gateCardClass(compressionOk)}>
          {gateBody('Compression', d.compression == null ? '—' : d.compression.toFixed(2), compressionOk)}
        </MetricTip>
        <MetricTip id="rangeBase" extra={`≥ ${c.containmentMin} of the newer half`} className={gateCardClass(containmentOk)}>
          {gateBody('Containment', d.containment.toFixed(2), containmentOk)}
        </MetricTip>
        <MetricTip id="rangeBase" extra={`≥ ${c.minSessions} sessions · length score ${d.lengthScore.toFixed(2)}`} className={gateCardClass(lengthOk)}>
          {gateBody('Length', String(d.lengthSessions), lengthOk)}
        </MetricTip>
        <MetricTip id="rangeBase" extra={`≥ ${c.above50Min} of closes above SMA${c.smaPeriod}`} className={gateCardClass(aboveOk)}>
          {gateBody('Above 50', d.above50Frac.toFixed(2), aboveOk)}
        </MetricTip>
        <MetricTip id="rangeBase" extra={c.higherLowsHardFail ? 'required' : `bonus ${c.higherLowsBonus}`} className={gateCardClass(d.higherLows || !c.higherLowsHardFail)}>
          {gateBody('Higher lows', d.higherLows ? 'yes' : 'no', d.higherLows || !c.higherLowsHardFail)}
        </MetricTip>
      </div>
    </section>
  )
}

export function DetailDrawer({ idea, source = 'live', isPinned, onTogglePin }: Props) {
  return (
    <div className="flex flex-col bg-terminal-panel">
      <div className="border-b border-terminal-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
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
            ) : idea.isAPlusPlus ? (
              <MetricTip
                id="aPlusPlus"
                className="rounded bg-terminal-a-plus-plus px-1.5 py-0.5 text-[10px] font-bold text-terminal-bg ring-1 ring-white/80"
              >
                A++
              </MetricTip>
            ) : idea.isAPlus ? (
              <MetricTip
                id="aPlus"
                className="rounded bg-terminal-a-plus px-1.5 py-0.5 text-[10px] font-bold text-terminal-bg"
              >
                A+
              </MetricTip>
            ) : idea.isA ? (
              <MetricTip
                id="qualityA"
                className="rounded border border-terminal-a-plus/40 bg-terminal-a-plus/15 px-1.5 py-0.5 text-[10px] font-bold text-terminal-a-plus"
              >
                A
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
            <MetricTip
              id="extensionAdr50"
              extra={`${formatExtensionAdr50(idea.extensionAdr50)} ADR · price ${fmtPrice(idea.price)} · SMA50 ${fmtPrice(idea.sma50)} · ADR% ${idea.adrPct.toFixed(1)}`}
              className={ext50ChipClass(idea.extensionAdr50)}
            >
              Ext. 50SMA: {formatExtensionAdr50(idea.extensionAdr50)} ADR
            </MetricTip>
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
            <MetricTip id="ideaGroup">Finviz · {idea.groupName}</MetricTip>
          </p>
        </div>
        {onTogglePin ? (
          <button
            type="button"
            title={isPinned ? 'Remove from watchlist' : 'Pin to watchlist'}
            aria-label={isPinned ? 'Remove from watchlist' : 'Pin to watchlist'}
            {...metricTipAttrs('watchlistPin')}
            onClick={onTogglePin}
            className={`min-h-9 min-w-9 shrink-0 rounded p-2 ${
              isPinned
                ? 'text-terminal-amber hover:bg-terminal-bg'
                : 'text-terminal-dim hover:bg-terminal-bg hover:text-terminal-amber'
            }`}
          >
            {isPinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
          </button>
        ) : null}
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
          <MetricCell
            id="rvol"
            label="RVOL"
            value={`${fmtRvol(idea.rvol)} ${idea.rvolSource === 'tod' ? 'TOD' : 'D'}`}
          />
          <MetricCell id="rvolTod" label="RVOL TOD" value={idea.rvolTod == null ? '—' : fmtRvol(idea.rvolTod)} />
          <MetricCell id="rvolDaily10" label="RVOL 10D" value={fmtRvol(idea.rvolDaily10)} />
          <MetricCell id="rvol20" label="RVOL 20D" value={fmtRvol(idea.rvol20)} />
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
          <MetricCell
            id="extensionAdr50"
            label="Ext. 50SMA"
            value={`${formatExtensionAdr50(idea.extensionAdr50)} ADR`}
          />
          <MetricCell id="sma200" label="SMA200" value={fmtPrice(idea.sma200)} />
          <MetricCell id="priorRunPct" label="Prior run%" value={fmtPct(idea.priorRunPct, 0)} />
          <MetricCell id="tightDays" label="Tight days" value={String(idea.tightDays)} />
          <MetricCell id="baseLengthDays" label="Base length" value={`${idea.baseLengthDays}d`} />
          <MetricCell id="dolVol" label="DolVol" value={fmtDollarVol(idea.dollarVolume || idea.avgDollarVol)} />
          <MetricCell id="kyleScore" label="kyleScore" value={String(idea.kyleScore)} />
        </div>

        <TightDetailSection idea={idea} />
        <RangeBreakoutGatesSection idea={idea} />
        <RangeBaseSection idea={idea} />

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
          <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm text-terminal-fg">
            <p className="text-[11px] text-terminal-dim">
              <MetricTip id="catalystStatus">{idea.catalystStatus ?? 'unchecked'}</MetricTip>
              {idea.catalystDirection ? ` · ${idea.catalystDirection}` : ''}
              {idea.catalystCount != null ? ` · ${idea.catalystCount} important` : ''}
              {idea.catalystAgeHours != null ? ` · ${idea.catalystAgeHours}h ago` : ''}
              {idea.catalystSource ? ` · ${idea.catalystSource}` : ''}
            </p>
            {idea.catalystCategories?.length ? (
              <p className="mt-1 text-[11px] text-terminal-muted">{idea.catalystCategories.join(' · ')}</p>
            ) : null}
            {idea.catalystHeadline || idea.catalyst ? (
              idea.catalystUrl ? (
                <a
                  href={idea.catalystUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-terminal-blue underline"
                >
                  {idea.catalystHeadline ?? idea.catalyst}
                </a>
              ) : (
                <p className="mt-1">{idea.catalystHeadline ?? idea.catalyst}</p>
              )
            ) : (
              <p className="mt-1 text-terminal-dim">No important headline inside the 48h window.</p>
            )}
          </div>
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

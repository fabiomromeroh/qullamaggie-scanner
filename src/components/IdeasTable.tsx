import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { Pin, PinOff } from 'lucide-react'
import type { CharacteristicTag, EarningsStatus, SetupStage, TradingIdea } from '../types'
import { SHOW_ALL_GROUP_LABEL } from '../lib/ideaFilters'
import { groupViewFilterNote } from '../lib/groupView'
import { extensionAdr50Class, formatExtensionAdr50 } from '../lib/extensionAdr'
import { KYLE_SCORE_CONFIG, NEAR_ATH_MAX_PCT } from '../lib/metrics'
import { metricTipAttrs } from '../lib/metricDefinitions'
import { stageLabel } from '../lib/setupStage'
import { surferBadgeTitle } from '../lib/surfer'
import { tightBadgeTitle } from '../lib/tightConsolidation'
import { fmtDollarVol, fmtPct, fmtPrice, fmtRvol, pctClass } from '../utils/format'
import { useResizableColumns } from '../hooks/useResizableColumns'
import { ResizeHandle } from './ResizeHandle'
import { CopyForTradingView } from './CopyForTradingView'
import { MetricTip } from './MetricTip'

function RvolReadout({ idea, className }: { idea: TradingIdea; className: string }) {
  return (
    <MetricTip id="rvol" className={className}>
      <span className="inline-flex items-center justify-end gap-1">
        {fmtRvol(idea.rvol)}
        {idea.rvolSource === 'tod' ? (
          <span className="rounded bg-terminal-amber/15 px-1 text-[9px] font-semibold leading-none tracking-wide text-terminal-amber">
            TOD
          </span>
        ) : (
          <span className="text-[9px] font-semibold leading-none text-terminal-dim">D</span>
        )}
      </span>
    </MetricTip>
  )
}

const IDEAS_COL_KEY = 'qm-ideas-col-widths'

const DEFAULT_IDEAS_COLS: Record<string, number> = {
  pin: 36,
  ticker: 72,
  name: 120,
  group: 100,
  price: 64,
  dayPct: 56,
  rvol: 80,
  adr: 52,
  ext50: 52,
  hi52: 64,
  trend: 88,
  surfer: 72,
  priorRun: 72,
  tight: 56,
  m1: 48,
  m3: 48,
  dolVol: 64,
  stage: 72,
  setup: 110,
  score: 64,
  earn: 64,
  catalyst: 120,
  aPlus: 40,
}

export interface GroupViewBanner {
  label: string
  periodLabel: string
  loading: boolean
  error: string | null
  stale: boolean
  failed: { ticker: string; reason: string }[]
  parsedCount: number | null
  onReset: () => void
  onRetry: () => void
  source?: 'finviz' | 'snapshot' | null
  membershipGeneratedAt?: string | null
  membershipStale?: boolean
  /** Scored group members currently on screen. */
  shownCount?: number
  /** Scored group members before client filters. */
  total?: number
  /** Rows removed by the active group filters, including Above 200 DMA. */
  hiddenCount?: number
  /** Most permissive group filters, including names below the 200-day SMA. */
  onShowAll?: () => void
}

interface Props {
  ideas: TradingIdea[]
  selectedTicker: string | null
  onSelect: (ticker: string) => void
  source?: 'live' | 'demo'
  isPinned?: (ticker: string) => boolean
  isOnWatchlist?: (ticker: string) => boolean
  onTogglePin?: (ticker: string) => void
  emptyMessage?: string
  /** Set while a Finviz group drill-down owns the results table. */
  groupBanner?: GroupViewBanner | null
  /** Selected-period Finviz performance, keyed by ticker. Tooltip only. */
  finvizPerf?: Record<string, number | null> | null
}

function SetupBadge({ type }: { type: TradingIdea['setupType'] }) {
  const styles: Record<TradingIdea['setupType'], string> = {
    'Range Breakout': 'bg-terminal-blue/15 text-terminal-blue border-terminal-blue/30',
    'Episodic Pivot': 'bg-terminal-purple/15 text-terminal-purple border-terminal-purple/30',
    Continuation: 'bg-terminal-green/15 text-terminal-green border-terminal-green/30',
  }
  return (
    <MetricTip
      id={
        type === 'Range Breakout'
          ? 'setupRangeBreakout'
          : type === 'Episodic Pivot'
            ? 'setupEpisodicPivot'
            : 'setupContinuation'
      }
      className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] ${styles[type]}`}
    >
      {type}
    </MetricTip>
  )
}

function TrendBadges({ idea }: { idea: TradingIdea }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {idea.aboveSma200 ? (
        <MetricTip
          id="aboveSma200"
          extra={`Price ${fmtPct(idea.pctAboveSma200)} vs 200 SMA (${fmtPrice(idea.sma200)})`}
          className="inline-block whitespace-nowrap rounded border border-terminal-green/30 bg-terminal-green/15 px-1.5 py-0.5 text-[10px] text-terminal-green"
        >
          &gt;200
        </MetricTip>
      ) : (
        <MetricTip
          id="belowSma200"
          extra={`Price ${fmtPct(idea.pctAboveSma200)} vs 200 SMA (${fmtPrice(idea.sma200)})`}
          className="inline-block whitespace-nowrap rounded border border-terminal-red/40 bg-terminal-red-dim px-1.5 py-0.5 text-[10px] text-terminal-red"
        >
          &lt;200
        </MetricTip>
      )}
      {idea.aboveSma50 ? (
        <MetricTip
          id="aboveSma50"
          extra={`above 50 SMA · ${fmtPct(idea.pctAboveSma50)} vs 50 (${fmtPrice(idea.sma50)})`}
          className="inline-block whitespace-nowrap rounded border border-terminal-blue/30 bg-terminal-blue/15 px-1.5 py-0.5 text-[10px] text-terminal-blue"
        >
          &gt;50
        </MetricTip>
      ) : null}
    </div>
  )
}

const SURFER_TAGS: CharacteristicTag[] = ['10MA Surfer', '20MA Surfer', '50MA Surfer', 'near ATH']

function CatalystBadge({ idea }: { idea: TradingIdea }) {
  if (idea.catalystStatus === 'pending') {
    return <MetricTip id="catalystStatus" className="text-[10px] text-terminal-dim">pending</MetricTip>
  }
  if (idea.catalystStatus === 'error') {
    return <MetricTip id="catalystStatus" className="text-[10px] text-terminal-red">error</MetricTip>
  }
  if (!idea.hasCatalyst && !idea.catalyst) {
    return <MetricTip id="catalyst" className="text-terminal-dim">—</MetricTip>
  }
  const labels = (idea.catalystCategories ?? []).slice(0, 2).join(', ')
  const age = idea.catalystAgeHours != null ? `${idea.catalystAgeHours}h ago` : ''
  const extra = [idea.catalystDirection, labels, idea.catalystHeadline ?? idea.catalyst, idea.catalystSource, age]
    .filter(Boolean)
    .join(' · ')
  const tone =
    idea.catalystDirection === 'negative'
      ? 'border-terminal-red/40 text-terminal-red'
      : idea.catalystDirection === 'mixed'
        ? 'border-terminal-amber/40 text-terminal-amber'
        : 'border-terminal-green/40 text-terminal-green'
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <MetricTip
        id="catalyst"
        extra={extra}
        className={`inline-block whitespace-nowrap rounded border px-1 py-0.5 text-[9px] ${tone}`}
      >
        Cat{labels ? ` ${labels}` : ''}
      </MetricTip>
      {idea.catalystUrl ? (
        <a
          href={idea.catalystUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-[10px] text-terminal-blue underline"
        >
          link
        </a>
      ) : null}
    </span>
  )
}

function SurferBadges({ idea }: { idea: TradingIdea }) {
  const tags = idea.characteristics.filter((t) => SURFER_TAGS.includes(t))
  const tightOn = Boolean(idea.tightConsolidation)
  if (!tags.length && !tightOn) return <span className="text-terminal-dim">·</span>
  return (
    <div className="flex flex-wrap gap-0.5">
      {tags.map((t) => (
        <MetricTip
          key={t}
          id={
            t === '10MA Surfer'
              ? 'surfer10'
              : t === '20MA Surfer'
                ? 'surfer20'
                : t === '50MA Surfer'
                  ? 'surfer50'
                  : 'nearAth'
          }
          extra={
            t === '10MA Surfer' || t === '20MA Surfer' || t === '50MA Surfer'
              ? surferBadgeTitle(t, idea.surferDetail)
              : t
          }
          className="inline-block whitespace-nowrap rounded border border-terminal-purple/30 bg-terminal-purple/10 px-1 py-0.5 text-[9px] text-terminal-purple"
        >
          {t === '10MA Surfer' ? '10S' : t === '20MA Surfer' ? '20S' : t === '50MA Surfer' ? '50S' : 'ATH'}
        </MetricTip>
      ))}
      {tightOn ? (
        <MetricTip
          id="tightConsolidation"
          extra={tightBadgeTitle(idea.tightDetail)}
          className="inline-block whitespace-nowrap rounded border border-terminal-green/30 bg-terminal-green/15 px-1 py-0.5 text-[9px] text-terminal-green"
        >
          Tight
        </MetricTip>
      ) : null}
    </div>
  )
}

function KyleStars({ score }: { score: number }) {
  const filled = Math.round(score)
  return (
    <MetricTip
      id="kyleScore"
      extra={`kyleScore ${score}`}
      className="font-mono text-[10px] text-terminal-amber"
    >
      {'★'.repeat(Math.min(5, filled))}
      <span className="text-terminal-dim">{'·'.repeat(Math.max(0, 5 - filled))}</span>
    </MetricTip>
  )
}

function StageBadge({ stage, aboveSma200 = true }: { stage: SetupStage; aboveSma200?: boolean }) {
  if (!aboveSma200) {
    return (
      <MetricTip
        id="belowSma200"
        className="inline-block whitespace-nowrap rounded border border-terminal-red/40 bg-terminal-red-dim px-1.5 py-0.5 text-[10px] text-terminal-red"
      >
        Below 200
      </MetricTip>
    )
  }
  const styles: Record<SetupStage, string> = {
    triggering: 'bg-terminal-amber/15 text-terminal-amber border-terminal-amber/40',
    coiled: 'bg-terminal-purple/15 text-terminal-purple border-terminal-purple/40',
    watching: 'bg-terminal-elevated text-terminal-muted border-terminal-border-bright',
  }
  return (
    <MetricTip
      id={stage === 'triggering' ? 'stageTriggering' : stage === 'coiled' ? 'stageCoiled' : 'stageWatching'}
      className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] ${styles[stage]}`}
    >
      {stageLabel(stage)}
    </MetricTip>
  )
}

function EarningsBadge({ idea }: { idea: TradingIdea }) {
  const status: EarningsStatus = idea.earningsStatus ?? 'clear'
  const styles: Record<EarningsStatus, string> = {
    avoid: 'bg-terminal-red-dim text-terminal-red border-terminal-red/50 font-bold',
    alert: 'bg-terminal-amber/15 text-terminal-amber border-terminal-amber/40',
    clear: 'bg-terminal-elevated text-terminal-dim border-terminal-border',
  }
  const label =
    status === 'avoid'
      ? 'AVOID'
      : status === 'alert'
        ? idea.daysToEarnings != null
          ? `Earn ${idea.daysToEarnings}d`
          : 'Earn soon'
        : idea.daysToEarnings != null
          ? `${idea.daysToEarnings}d`
          : '—'
  const title =
    idea.earningsDate != null
      ? `Next earnings ${idea.earningsDate} · ${idea.daysToEarnings ?? '?'} trading days · ${status}`
      : 'No upcoming earnings in calendar window'
  return (
    <MetricTip
      id={status === 'avoid' ? 'earningsAvoid' : status === 'alert' ? 'earningsAlert' : 'earningsClear'}
      extra={title}
      className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] ${styles[status]}`}
    >
      {label}
    </MetricTip>
  )
}

function QualityCell({ idea }: { idea: TradingIdea }) {
  const avoid = idea.earningsStatus === 'avoid'
  if (avoid) {
    return (
      <MetricTip
        id="earningsAvoid"
        className="inline-flex rounded border border-terminal-red/50 bg-terminal-red-dim px-1.5 py-0.5 text-[10px] font-bold text-terminal-red"
      >
        AVOID
      </MetricTip>
    )
  }
  if (idea.isAPlusPlus) {
    return (
      <MetricTip
        id="aPlusPlus"
        className="inline-flex rounded bg-terminal-a-plus-plus px-1.5 py-0.5 text-[10px] font-bold text-terminal-bg ring-1 ring-white/80"
      >
        A++
      </MetricTip>
    )
  }
  if (idea.isAPlus) {
    return (
      <MetricTip
        id="aPlus"
        className="inline-flex rounded bg-terminal-a-plus px-1.5 py-0.5 text-[10px] font-bold text-terminal-bg"
      >
        A+
      </MetricTip>
    )
  }
  if (idea.isA) {
    return (
      <MetricTip
        id="qualityA"
        className="inline-flex rounded border border-terminal-a-plus/40 bg-terminal-a-plus/15 px-1.5 py-0.5 text-[10px] font-bold text-terminal-a-plus"
      >
        A
      </MetricTip>
    )
  }
  return (
    <MetricTip id="qualityA" className="text-terminal-dim">
      ·
    </MetricTip>
  )
}

function rowHighlight(idea: TradingIdea) {
  const avoid = idea.earningsStatus === 'avoid'
  if (avoid) return 'bg-terminal-red-dim/70'
  if (!idea.aboveSma200) return 'bg-terminal-red-dim/60'
  if (idea.isAPlusPlus) return 'bg-terminal-a-plus-plus/15'
  if (idea.isAPlus && idea.catalyst) return 'bg-terminal-a-plus-bg/80'
  if (idea.isAPlus) return 'bg-terminal-a-plus-bg/40'
  if (idea.isA) return 'bg-terminal-a-plus-bg/20'
  return ''
}

function finvizPerfTitle(
  idea: TradingIdea,
  finvizPerf: Record<string, number | null> | null | undefined,
  periodLabel?: string,
  source?: 'finviz' | 'snapshot' | null,
): string | undefined {
  if (!finvizPerf) return undefined
  const key = idea.ticker.toUpperCase()
  if (!(key in finvizPerf) && !(idea.ticker in finvizPerf)) return undefined
  const value = key in finvizPerf ? finvizPerf[key] : finvizPerf[idea.ticker]
  const shown = value == null || !Number.isFinite(value) ? '—' : fmtPct(value)
  if (source === 'finviz') return `Finviz ${periodLabel ?? 'period'} performance: ${shown}`
  return `${periodLabel ?? 'Period'} performance from snapshot members via Yahoo/Finnhub, not Finviz's live screener: ${shown}`
}

function PinButton({
  ticker,
  isPinned,
  isOnWatchlist,
  onTogglePin,
}: {
  ticker: string
  isPinned?: (ticker: string) => boolean
  isOnWatchlist?: (ticker: string) => boolean
  onTogglePin?: (ticker: string) => void
}) {
  if (!onTogglePin) return <span className="text-terminal-dim">·</span>
  return (
    <button
      type="button"
      title={isPinned?.(ticker) ? 'Unpin' : 'Pin to watchlist'}
      aria-label={isPinned?.(ticker) ? 'Remove from watchlist' : 'Pin to watchlist'}
      {...metricTipAttrs('watchlistPin')}
      onClick={(e) => {
        e.stopPropagation()
        onTogglePin(ticker)
      }}
      className={`rounded p-1.5 min-h-9 min-w-9 inline-flex items-center justify-center ${
        isOnWatchlist?.(ticker)
          ? 'text-terminal-amber'
          : 'text-terminal-dim hover:text-terminal-amber'
      }`}
    >
      {isPinned?.(ticker) ? (
        <Pin className="h-4 w-4" />
      ) : (
        <PinOff className="h-4 w-4" />
      )}
    </button>
  )
}

function IdeaCard({
  idea,
  selected,
  onSelect,
  isPinned,
  isOnWatchlist,
  onTogglePin,
  rowTitle,
}: {
  idea: TradingIdea
  selected: boolean
  onSelect: (ticker: string) => void
  isPinned?: (ticker: string) => boolean
  isOnWatchlist?: (ticker: string) => boolean
  onTogglePin?: (ticker: string) => void
  rowTitle?: string
}) {
  const avoid = idea.earningsStatus === 'avoid'
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect(idea.ticker)
  }
  return (
    <div
      role="button"
      tabIndex={0}
      data-idea-ticker={idea.ticker}
      aria-selected={selected}
      onClick={() => onSelect(idea.ticker)}
      onKeyDown={onKey}
      className={`w-full scroll-mt-8 rounded-lg border border-terminal-border/80 px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-terminal-blue active:bg-terminal-elevated ${rowHighlight(idea)} ${
        selected ? 'ring-1 ring-terminal-blue/60' : ''
      } ${avoid ? 'opacity-90' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <MetricTip id="ticker" extra={rowTitle} className="font-mono text-sm font-bold text-terminal-fg">
              {idea.ticker}
            </MetricTip>
            <QualityCell idea={idea} />
            <StageBadge stage={idea.setupStage} aboveSma200={idea.aboveSma200} />
            <EarningsBadge idea={idea} />
          </div>
          <p className="mt-0.5 truncate text-[11px] text-terminal-muted">
            <MetricTip id="name">{idea.name}</MetricTip>
            <span className="text-terminal-dim">
              {' '}
              · <MetricTip id="ideaGroup">{idea.groupName}</MetricTip>
            </span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm text-terminal-fg">
            <MetricTip id="price">{fmtPrice(idea.price)}</MetricTip>
          </div>
          <div className={`font-mono text-xs ${pctClass(idea.dayPct)}`}>
            <MetricTip id="dayPct">{fmtPct(idea.dayPct)}</MetricTip>
          </div>
        </div>
        <PinButton
          ticker={idea.ticker}
          isPinned={isPinned}
          isOnWatchlist={isOnWatchlist}
          onTogglePin={onTogglePin}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
        <SetupBadge type={idea.setupType} />
        <TrendBadges idea={idea} />
        <SurferBadges idea={idea} />
        <RvolReadout
          idea={idea}
          className={`font-mono ${idea.rvol >= KYLE_SCORE_CONFIG.rvolHigh ? 'text-terminal-amber' : 'text-terminal-muted'}`}
        />
        <MetricTip id="adrPct" className="font-mono text-terminal-muted">
          ADR {idea.adrPct.toFixed(1)}%
        </MetricTip>
        <MetricTip
          id="extensionAdr50"
          extra={`${formatExtensionAdr50(idea.extensionAdr50)} ADR from 50 SMA`}
          className={`font-mono ${extensionAdr50Class(idea.extensionAdr50)}`}
        >
          Ext {formatExtensionAdr50(idea.extensionAdr50)}
        </MetricTip>
        <MetricTip
          id="pctFrom52wHigh"
          className={`font-mono ${
            Math.abs(idea.pctFrom52wHigh) <= NEAR_ATH_MAX_PCT ? 'text-terminal-green' : 'text-terminal-muted'
          }`}
        >
          {fmtPct(idea.pctFrom52wHigh)} Hi
        </MetricTip>
        <KyleStars score={idea.kyleScore} />
      </div>
    </div>
  )
}


function ResizableTh({
  colKey,
  width,
  onResize,
  className = '',
  children,
  style,
}: {
  colKey: string
  width: number
  onResize: (key: string, dx: number) => void
  className?: string
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <th
      className={`qm-th-resizable px-2 py-2 font-medium ${className}`}
      style={{ width, minWidth: width, ...style }}
    >
      {children}
      <ResizeHandle
        variant="col"
        label={`Resize ${colKey} column`}
        onDelta={(dx) => onResize(colKey, dx)}
        className="hidden lg:block"
      />
    </th>
  )
}

function snapshotDay(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso)
  return match?.[1] ?? iso
}

function GroupBannerBar({ banner }: { banner: GroupViewBanner }) {
  const denom = banner.parsedCount ?? 20
  const reasons = banner.failed.map((row) => `${row.ticker}: ${row.reason}`).join('\n')
  const membershipDay = banner.membershipGeneratedAt ? snapshotDay(banner.membershipGeneratedAt) : null
  const filterNote =
    !banner.loading && !banner.error
      ? groupViewFilterNote(banner.shownCount ?? 0, banner.total ?? 0, banner.hiddenCount ?? 0)
      : null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-terminal-border bg-terminal-blue/10 px-2 py-1.5 text-[11px] sm:px-3">
      <span className="min-w-0 font-medium text-terminal-fg">
        Group: {banner.label}
        <span className="font-normal text-terminal-muted">
          {' · '}
          <MetricTip id="memberPeriodPerf">
            top {denom} by {banner.periodLabel} perf
            {membershipDay ? '' : ' (Finviz)'}
          </MetricTip>
          {membershipDay ? (
            <>
              {' · '}
              <MetricTip id="groupMembershipSnapshot">membership snapshot {membershipDay}</MetricTip>
            </>
          ) : null}
        </span>
        {banner.membershipStale ? (
          <MetricTip
            id="groupMembershipStale"
            className="ml-1.5 rounded bg-terminal-amber-dim px-1 py-px text-[10px] font-medium uppercase tracking-wide text-terminal-amber"
          >
            stale
          </MetricTip>
        ) : banner.stale ? (
          <MetricTip id="groupScoreStale" className="ml-1.5 text-terminal-amber">
            stale
          </MetricTip>
        ) : null}
      </span>
      <button
        type="button"
        onClick={banner.onReset}
        {...metricTipAttrs('groupReset')}
        className="min-h-8 shrink-0 cursor-help rounded border border-terminal-border-bright bg-terminal-panel px-2 text-[10px] font-medium text-terminal-fg hover:text-terminal-blue"
      >
        Reset
      </button>
      {banner.failed.length > 0 && !banner.loading && !banner.error ? (
        <MetricTip id="groupFailedTickers" extra={reasons} className="text-terminal-amber">
          {banner.failed.length} of {denom} tickers had no data
        </MetricTip>
      ) : null}
      {filterNote ? (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-terminal-amber">
          <span>{filterNote}</span>
          {banner.onShowAll ? (
            <button
              type="button"
              onClick={banner.onShowAll}
              {...metricTipAttrs('filterShowAll')}
              className="min-h-8 shrink-0 cursor-help rounded border border-terminal-border-bright bg-terminal-panel px-2 text-[10px] font-medium text-terminal-fg hover:text-terminal-blue"
            >
              {SHOW_ALL_GROUP_LABEL}
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}

export function IdeasTable({
  ideas,
  selectedTicker,
  onSelect,
  source = 'live',
  isPinned,
  isOnWatchlist,
  onTogglePin,
  emptyMessage,
  groupBanner = null,
  finvizPerf = null,
}: Props) {
  const { widthOf, resizeColumn } = useResizableColumns(IDEAS_COL_KEY, DEFAULT_IDEAS_COLS, {
    min: 36,
    max: 360,
  })
  const pinW = widthOf('pin')
  const tickerW = widthOf('ticker')
  const earnW = widthOf('earn')
  const aPlusW = widthOf('aPlus')

  const tickers = ideas.map((i) => i.ticker)

  return (
    <section className="flex flex-col rounded-lg border border-terminal-border bg-terminal-panel lg:h-full lg:min-h-0 lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-terminal-border px-2 py-2 sm:px-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">
            Scan results
          </h2>
          <span className="font-mono text-[10px] text-terminal-dim">
            <MetricTip id="shownCount">
              {groupBanner?.loading
                ? 'loading'
                : groupBanner && (groupBanner.hiddenCount ?? 0) > 0
                  ? `${ideas.length} of ${groupBanner.total ?? ideas.length} shown`
                  : `${ideas.length} shown`}
            </MetricTip>
            {' · '}
            {source === 'demo' ? 'DEMO' : 'LIVE'}
          </span>
        </div>
        <CopyForTradingView tickers={tickers} />
      </div>

      {groupBanner ? <GroupBannerBar banner={groupBanner} /> : null}

      {groupBanner?.loading ? (
        <div className="flex min-h-[12rem] flex-1 items-center justify-center p-4 text-sm text-terminal-muted">
          Loading group stocks…
        </div>
      ) : groupBanner?.error ? (
        <div className="flex min-h-[12rem] flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
          <p className="max-w-lg text-sm text-terminal-red">{groupBanner.error}</p>
          <button
            type="button"
            onClick={groupBanner.onRetry}
            className="min-h-8 rounded border border-terminal-border-bright bg-terminal-elevated px-3 text-xs text-terminal-fg hover:border-terminal-blue"
          >
            Retry
          </button>
        </div>
      ) : !ideas.length ? (
        <div className="flex min-h-[12rem] flex-1 items-center justify-center p-4 text-sm text-terminal-muted">
          {emptyMessage ?? 'No ideas match current filters.'}
        </div>
      ) : (
        <>
      {/* Mobile: card list in document flow (no nested scroll trapping results) */}
      <div className="space-y-2 p-2 md:hidden">
        {ideas.map((idea) => (
          <IdeaCard
            key={idea.ticker}
            idea={idea}
            selected={selectedTicker === idea.ticker}
            onSelect={onSelect}
            isPinned={isPinned}
            isOnWatchlist={isOnWatchlist}
            onTogglePin={onTogglePin}
            rowTitle={finvizPerfTitle(idea, finvizPerf, groupBanner?.periodLabel, groupBanner?.source)}
          />
        ))}
      </div>

      {/* Desktop / tablet: full table with sticky ticker + earn/A+ */}
      <div className="hidden min-h-0 flex-1 overflow-auto md:block">
        <table className="w-full table-fixed text-left text-xs" style={{ minWidth: '100%' }}>
          <thead className="sticky top-0 z-10 bg-terminal-elevated text-[10px] uppercase tracking-wide text-terminal-dim shadow-[0_1px_0_0_var(--color-terminal-border)]">
            <tr>
              <ResizableTh
                colKey="pin"
                width={pinW}
                onResize={resizeColumn}
                className="sticky left-0 z-20 bg-terminal-elevated"
                style={{ left: 0 }}
              >
                <MetricTip id="watchlistPin">★</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="ticker"
                width={tickerW}
                onResize={resizeColumn}
                className="sticky z-20 bg-terminal-elevated"
                style={{ left: pinW }}
              >
                <MetricTip id="ticker">Ticker</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="name"
                width={widthOf('name')}
                onResize={resizeColumn}
                className="hidden xl:table-cell"
              >
                <MetricTip id="name">Name</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="group"
                width={widthOf('group')}
                onResize={resizeColumn}
                className="hidden lg:table-cell"
              >
                <MetricTip id="ideaGroup">Group</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="price"
                width={widthOf('price')}
                onResize={resizeColumn}
                className="text-right"
              >
                <MetricTip id="price">Price</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="dayPct"
                width={widthOf('dayPct')}
                onResize={resizeColumn}
                className="text-right"
              >
                <MetricTip id="dayPct">Day%</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="rvol"
                width={widthOf('rvol')}
                onResize={resizeColumn}
                className="text-right"
              >
                <MetricTip id="rvol">RVOL</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="adr"
                width={widthOf('adr')}
                onResize={resizeColumn}
                className="hidden text-right lg:table-cell"
              >
                <MetricTip id="adrPct">ADR%</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="ext50"
                width={widthOf('ext50')}
                onResize={resizeColumn}
                className="text-right"
              >
                <MetricTip id="extensionAdr50">Ext50</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="hi52"
                width={widthOf('hi52')}
                onResize={resizeColumn}
                className="hidden text-right lg:table-cell"
              >
                <MetricTip id="pctFrom52wHigh">% 52w Hi</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="trend"
                width={widthOf('trend')}
                onResize={resizeColumn}
                className="hidden xl:table-cell"
              >
                <MetricTip id="trendGate">Trend</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="surfer"
                width={widthOf('surfer')}
                onResize={resizeColumn}
                className="hidden xl:table-cell"
              >
                <MetricTip id="surferColumn">Surfer</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="priorRun"
                width={widthOf('priorRun')}
                onResize={resizeColumn}
                className="hidden text-right xl:table-cell"
              >
                <MetricTip id="priorRunPct">Prior run%</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="tight"
                width={widthOf('tight')}
                onResize={resizeColumn}
                className="hidden text-right xl:table-cell"
              >
                <MetricTip id="tightDays">Tight</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="m1"
                width={widthOf('m1')}
                onResize={resizeColumn}
                className="hidden text-right xl:table-cell"
              >
                <MetricTip id="perf1m">1M</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="m3"
                width={widthOf('m3')}
                onResize={resizeColumn}
                className="hidden text-right xl:table-cell"
              >
                <MetricTip id="perf3m">3M</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="dolVol"
                width={widthOf('dolVol')}
                onResize={resizeColumn}
                className="hidden text-right xl:table-cell"
              >
                <MetricTip id="dolVol">DolVol</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="stage"
                width={widthOf('stage')}
                onResize={resizeColumn}
              >
                <MetricTip id="setupStage">Stage</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="setup"
                width={widthOf('setup')}
                onResize={resizeColumn}
                className="hidden lg:table-cell"
              >
                <MetricTip id="setupType">Setup</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="score"
                width={widthOf('score')}
                onResize={resizeColumn}
                className="text-center"
              >
                <MetricTip id="kyleScore">Score</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="earn"
                width={earnW}
                onResize={resizeColumn}
                className="sticky z-20 bg-terminal-elevated"
                style={{ right: aPlusW }}
              >
                <MetricTip id="earningsStatus">Earn</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="catalyst"
                width={widthOf('catalyst')}
                onResize={resizeColumn}
                className="hidden xl:table-cell"
              >
                <MetricTip id="catalyst">Catalyst</MetricTip>
              </ResizableTh>
              <ResizableTh
                colKey="aPlus"
                width={aPlusW}
                onResize={resizeColumn}
                className="sticky right-0 z-20 bg-terminal-elevated text-center"
                style={{ right: 0 }}
              >
                <MetricTip id="qualityA">A</MetricTip>
              </ResizableTh>
            </tr>
          </thead>
          <tbody>
            {ideas.map((idea) => {
              const selected = selectedTicker === idea.ticker
              const avoid = idea.earningsStatus === 'avoid'
              const highlight = rowHighlight(idea)
              const rowTitle = finvizPerfTitle(idea, finvizPerf, groupBanner?.periodLabel, groupBanner?.source)
              return (
                <tr
                  key={idea.ticker}
                  data-idea-ticker={idea.ticker}
                  aria-selected={selected}
                  tabIndex={-1}
                  onClick={() => onSelect(idea.ticker)}
                  className={`scroll-mt-8 cursor-pointer border-t border-terminal-border/50 transition-colors hover:bg-terminal-elevated/80 ${highlight} ${
                    selected ? 'ring-1 ring-inset ring-terminal-blue/50' : ''
                  } ${avoid ? 'opacity-90' : ''}`}
                >
                  <td
                    className={`sticky z-[5] overflow-hidden px-2 py-1.5 ${highlight || 'bg-terminal-panel'}`}
                    style={{ left: 0, width: pinW, minWidth: pinW }}
                  >
                    <PinButton
                      ticker={idea.ticker}
                      isPinned={isPinned}
                      isOnWatchlist={isOnWatchlist}
                      onTogglePin={onTogglePin}
                    />
                  </td>
                  <td
                    className={`sticky z-[5] overflow-hidden px-2 py-1.5 font-mono font-semibold text-terminal-fg ${highlight || 'bg-terminal-panel'}`}
                    style={{ left: pinW, width: tickerW, minWidth: tickerW }}
                  >
                    <MetricTip id="ticker" extra={rowTitle}>
                      {idea.ticker}
                    </MetricTip>
                  </td>
                  <td className="hidden truncate px-2 py-1.5 text-terminal-muted xl:table-cell">
                    <MetricTip id="name">{idea.name}</MetricTip>
                  </td>
                  <td className="hidden truncate px-2 py-1.5 text-terminal-muted lg:table-cell">
                    <MetricTip id="ideaGroup">{idea.groupName}</MetricTip>
                  </td>
                  <td className="overflow-hidden px-2 py-1.5 text-right font-mono text-terminal-fg">
                    <MetricTip id="price">{fmtPrice(idea.price)}</MetricTip>
                  </td>
                  <td className={`overflow-hidden px-2 py-1.5 text-right font-mono ${pctClass(idea.dayPct)}`}>
                    <MetricTip id="dayPct">{fmtPct(idea.dayPct)}</MetricTip>
                  </td>
                  <td
                    className={`overflow-hidden px-2 py-1.5 text-right font-mono ${
                      idea.rvol >= KYLE_SCORE_CONFIG.rvolHigh ? 'text-terminal-amber' : 'text-terminal-fg'
                    }`}
                  >
                    <RvolReadout
                      idea={idea}
                      className={
                        idea.rvol >= KYLE_SCORE_CONFIG.rvolHigh ? 'text-terminal-amber' : 'text-terminal-fg'
                      }
                    />
                  </td>
                  <td className="hidden overflow-hidden px-2 py-1.5 text-right font-mono text-terminal-fg lg:table-cell">
                    <MetricTip id="adrPct">{idea.adrPct.toFixed(1)}%</MetricTip>
                  </td>
                  <td
                    className={`overflow-hidden px-2 py-1.5 text-right font-mono ${extensionAdr50Class(idea.extensionAdr50)}`}
                  >
                    <MetricTip
                      id="extensionAdr50"
                      extra={`${formatExtensionAdr50(idea.extensionAdr50)} ADR from 50 SMA`}
                    >
                      {formatExtensionAdr50(idea.extensionAdr50)}
                    </MetricTip>
                  </td>
                  <td
                    className={`hidden overflow-hidden px-2 py-1.5 text-right font-mono lg:table-cell ${
                      Math.abs(idea.pctFrom52wHigh) <= NEAR_ATH_MAX_PCT
                        ? 'text-terminal-green'
                        : 'text-terminal-muted'
                    }`}
                  >
                    <MetricTip id="pctFrom52wHigh">{fmtPct(idea.pctFrom52wHigh)}</MetricTip>
                  </td>
                  <td className="hidden overflow-hidden px-2 py-1.5 xl:table-cell">
                    <TrendBadges idea={idea} />
                  </td>
                  <td className="hidden overflow-hidden px-2 py-1.5 xl:table-cell">
                    <SurferBadges idea={idea} />
                  </td>
                  <td className={`hidden overflow-hidden px-2 py-1.5 text-right font-mono xl:table-cell ${pctClass(idea.priorRunPct)}`}>
                    <MetricTip id="priorRunPct">{fmtPct(idea.priorRunPct, 0)}</MetricTip>
                  </td>
                  <td className="hidden overflow-hidden px-2 py-1.5 text-right font-mono text-terminal-muted xl:table-cell">
                    <MetricTip
                      id="tightDays"
                      extra={`tightDays=${idea.tightDays} · baseLengthDays=${idea.baseLengthDays}`}
                    >
                      {idea.tightDays}
                    </MetricTip>
                    <span className="text-terminal-dim">/</span>
                    <MetricTip id="baseLengthDays">{idea.baseLengthDays}</MetricTip>
                  </td>
                  <td className={`hidden overflow-hidden px-2 py-1.5 text-right font-mono xl:table-cell ${pctClass(idea.perf1M)}`}>
                    <MetricTip id="perf1m">{fmtPct(idea.perf1M, 0)}</MetricTip>
                  </td>
                  <td className={`hidden overflow-hidden px-2 py-1.5 text-right font-mono xl:table-cell ${pctClass(idea.perf3M)}`}>
                    <MetricTip id="perf3m">{fmtPct(idea.perf3M, 0)}</MetricTip>
                  </td>
                  <td className="hidden overflow-hidden px-2 py-1.5 text-right font-mono text-terminal-muted xl:table-cell">
                    <MetricTip id="dolVol">{fmtDollarVol(idea.dollarVolume || idea.avgDollarVol)}</MetricTip>
                  </td>
                  <td className="overflow-hidden px-2 py-1.5">
                    <StageBadge stage={idea.setupStage} aboveSma200={idea.aboveSma200} />
                  </td>
                  <td className="hidden overflow-hidden px-2 py-1.5 lg:table-cell">
                    <SetupBadge type={idea.setupType} />
                  </td>
                  <td className="overflow-hidden px-2 py-1.5 text-center">
                    <KyleStars score={idea.kyleScore} />
                  </td>
                  <td
                    className={`sticky z-[5] overflow-hidden px-2 py-1.5 ${highlight || 'bg-terminal-panel'}`}
                    style={{ right: aPlusW, width: earnW, minWidth: earnW }}
                  >
                    <EarningsBadge idea={idea} />
                  </td>
                  <td className="hidden truncate px-2 py-1.5 xl:table-cell">
                    <CatalystBadge idea={idea} />
                  </td>
                  <td
                    className={`sticky right-0 z-[5] overflow-hidden px-2 py-1.5 text-center ${highlight || 'bg-terminal-panel'}`}
                    style={{ right: 0, width: aPlusW, minWidth: aPlusW }}
                  >
                    <QualityCell idea={idea} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
        </>
      )}
    </section>
  )
}

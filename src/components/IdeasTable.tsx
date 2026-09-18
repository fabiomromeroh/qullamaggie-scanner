import type { CSSProperties, ReactNode } from 'react'
import { Pin, PinOff } from 'lucide-react'
import type { CharacteristicTag, EarningsStatus, SetupStage, TradingIdea } from '../types'
import { stageLabel } from '../lib/setupStage'
import { fmtDollarVol, fmtPct, fmtPrice, fmtRvol, pctClass } from '../utils/format'
import { useResizableColumns } from '../hooks/useResizableColumns'
import { ResizeHandle } from './ResizeHandle'
import { CopyForTradingView } from './CopyForTradingView'

const IDEAS_COL_KEY = 'qm-ideas-col-widths'

const DEFAULT_IDEAS_COLS: Record<string, number> = {
  pin: 36,
  ticker: 72,
  name: 120,
  group: 100,
  price: 64,
  dayPct: 56,
  rvol: 52,
  adr: 52,
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

interface Props {
  ideas: TradingIdea[]
  selectedTicker: string | null
  onSelect: (ticker: string) => void
  source?: 'live' | 'demo'
  isPinned?: (ticker: string) => boolean
  isOnWatchlist?: (ticker: string) => boolean
  onTogglePin?: (ticker: string) => void
}

function SetupBadge({ type }: { type: TradingIdea['setupType'] }) {
  const styles: Record<TradingIdea['setupType'], string> = {
    'Range Breakout': 'bg-terminal-blue/15 text-terminal-blue border-terminal-blue/30',
    'Episodic Pivot': 'bg-terminal-purple/15 text-terminal-purple border-terminal-purple/30',
    Continuation: 'bg-terminal-green/15 text-terminal-green border-terminal-green/30',
  }
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] ${styles[type]}`}>
      {type}
    </span>
  )
}

function TrendBadges({ idea }: { idea: TradingIdea }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {idea.aboveSma200 ? (
        <span
          className="inline-block whitespace-nowrap rounded border border-terminal-green/30 bg-terminal-green/15 px-1.5 py-0.5 text-[10px] text-terminal-green"
          title={`Price ${fmtPct(idea.pctAboveSma200)} vs 200 SMA (${fmtPrice(idea.sma200)})`}
        >
          &gt;200
        </span>
      ) : (
        <span className="inline-block whitespace-nowrap rounded border border-terminal-red/40 bg-terminal-red-dim px-1.5 py-0.5 text-[10px] text-terminal-red">
          &lt;200
        </span>
      )}
      {idea.aboveSma50 ? (
        <span
          className="inline-block whitespace-nowrap rounded border border-terminal-blue/30 bg-terminal-blue/15 px-1.5 py-0.5 text-[10px] text-terminal-blue"
          title={`above 50 SMA · ${fmtPct(idea.pctAboveSma50)} vs 50 (${fmtPrice(idea.sma50)})`}
        >
          &gt;50
        </span>
      ) : null}
    </div>
  )
}

const SURFER_TAGS: CharacteristicTag[] = ['10MA Surfer', '20MA Surfer', '50MA Surfer', 'near ATH']

function SurferBadges({ idea }: { idea: TradingIdea }) {
  const tags = idea.characteristics.filter((t) => SURFER_TAGS.includes(t))
  if (!tags.length) return <span className="text-terminal-dim">·</span>
  return (
    <div className="flex flex-wrap gap-0.5">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-block whitespace-nowrap rounded border border-terminal-purple/30 bg-terminal-purple/10 px-1 py-0.5 text-[9px] text-terminal-purple"
          title={t}
        >
          {t === '10MA Surfer' ? '10S' : t === '20MA Surfer' ? '20S' : t === '50MA Surfer' ? '50S' : 'ATH'}
        </span>
      ))}
    </div>
  )
}

function KyleStars({ score }: { score: number }) {
  const filled = Math.round(score)
  return (
    <span
      className="font-mono text-[10px] text-terminal-amber"
      title={`kyleScore ${score} (heuristic 3–5, not Kyle official Rating)`}
    >
      {'★'.repeat(Math.min(5, filled))}
      <span className="text-terminal-dim">{'·'.repeat(Math.max(0, 5 - filled))}</span>
    </span>
  )
}

function StageBadge({ stage }: { stage: SetupStage }) {
  const styles: Record<SetupStage, string> = {
    triggering: 'bg-terminal-amber/15 text-terminal-amber border-terminal-amber/40',
    coiled: 'bg-terminal-purple/15 text-terminal-purple border-terminal-purple/40',
    watching: 'bg-terminal-elevated text-terminal-muted border-terminal-border-bright',
  }
  return (
    <span
      className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] ${styles[stage]}`}
      title={
        stage === 'triggering'
          ? 'Elevated RVOL / breakout-day heuristic'
          : stage === 'coiled'
            ? 'Tight days + near highs + MA surfer'
            : 'Above 200 SMA, building base'
      }
    >
      {stageLabel(stage)}
    </span>
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
    <span
      className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] ${styles[status]}`}
      title={title}
    >
      {label}
    </span>
  )
}

function APlusCell({ idea }: { idea: TradingIdea }) {
  const avoid = idea.earningsStatus === 'avoid'
  if (avoid) {
    return (
      <span className="inline-flex rounded border border-terminal-red/50 bg-terminal-red-dim px-1.5 py-0.5 text-[10px] font-bold text-terminal-red">
        AVOID
      </span>
    )
  }
  if (idea.isAPlus) {
    return (
      <span className="inline-flex rounded bg-terminal-a-plus px-1.5 py-0.5 text-[10px] font-bold text-terminal-bg">
        A+
      </span>
    )
  }
  return <span className="text-terminal-dim">·</span>
}

function rowHighlight(idea: TradingIdea) {
  const avoid = idea.earningsStatus === 'avoid'
  if (avoid) return 'bg-terminal-red-dim/70'
  if (idea.isAPlus && idea.catalyst) return 'bg-terminal-a-plus-bg/80'
  if (idea.isAPlus) return 'bg-terminal-a-plus-bg/40'
  return ''
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
}: {
  idea: TradingIdea
  selected: boolean
  onSelect: (ticker: string) => void
  isPinned?: (ticker: string) => boolean
  isOnWatchlist?: (ticker: string) => boolean
  onTogglePin?: (ticker: string) => void
}) {
  const avoid = idea.earningsStatus === 'avoid'
  return (
    <button
      type="button"
      onClick={() => onSelect(idea.ticker)}
      className={`w-full rounded-lg border border-terminal-border/80 px-3 py-2.5 text-left transition-colors active:bg-terminal-elevated ${rowHighlight(idea)} ${
        selected ? 'ring-1 ring-terminal-blue/60' : ''
      } ${avoid ? 'opacity-90' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-bold text-terminal-fg">{idea.ticker}</span>
            <APlusCell idea={idea} />
            <StageBadge stage={idea.setupStage} />
            <EarningsBadge idea={idea} />
          </div>
          <p className="mt-0.5 truncate text-[11px] text-terminal-muted">
            {idea.name}
            <span className="text-terminal-dim"> · {idea.groupName}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm text-terminal-fg">{fmtPrice(idea.price)}</div>
          <div className={`font-mono text-xs ${pctClass(idea.dayPct)}`}>{fmtPct(idea.dayPct)}</div>
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
        <span className={`font-mono ${idea.rvol >= 1.5 ? 'text-terminal-amber' : 'text-terminal-muted'}`}>
          RVOL {fmtRvol(idea.rvol)}
        </span>
        <span className="font-mono text-terminal-muted">ADR {idea.adrPct.toFixed(1)}%</span>
        <span
          className={`font-mono ${
            Math.abs(idea.pctFrom52wHigh) <= 5 ? 'text-terminal-green' : 'text-terminal-muted'
          }`}
        >
          {fmtPct(idea.pctFrom52wHigh)} Hi
        </span>
        <KyleStars score={idea.kyleScore} />
      </div>
    </button>
  )
}


function ResizableTh({
  colKey,
  width,
  onResize,
  className = '',
  title,
  children,
  style,
}: {
  colKey: string
  width: number
  onResize: (key: string, dx: number) => void
  className?: string
  title?: string
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <th
      className={`qm-th-resizable px-2 py-2 font-medium ${className}`}
      style={{ width, minWidth: width, ...style }}
      title={title}
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

export function IdeasTable({
  ideas,
  selectedTicker,
  onSelect,
  source = 'live',
  isPinned,
  isOnWatchlist,
  onTogglePin,
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
            {ideas.length} shown · {source === 'demo' ? 'DEMO' : 'LIVE'}
          </span>
        </div>
        <CopyForTradingView tickers={tickers} />
      </div>

      {!ideas.length ? (
        <div className="flex min-h-[12rem] flex-1 items-center justify-center p-4 text-sm text-terminal-muted">
          No ideas match current filters.
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
                title="Pin to dynamic watchlist"
              >
                ★
              </ResizableTh>
              <ResizableTh
                colKey="ticker"
                width={tickerW}
                onResize={resizeColumn}
                className="sticky z-20 bg-terminal-elevated"
                style={{ left: pinW }}
              >
                Ticker
              </ResizableTh>
              <ResizableTh
                colKey="name"
                width={widthOf('name')}
                onResize={resizeColumn}
                className="hidden xl:table-cell"
              >
                Name
              </ResizableTh>
              <ResizableTh
                colKey="group"
                width={widthOf('group')}
                onResize={resizeColumn}
                className="hidden lg:table-cell"
              >
                Group
              </ResizableTh>
              <ResizableTh
                colKey="price"
                width={widthOf('price')}
                onResize={resizeColumn}
                className="text-right"
              >
                Price
              </ResizableTh>
              <ResizableTh
                colKey="dayPct"
                width={widthOf('dayPct')}
                onResize={resizeColumn}
                className="text-right"
              >
                Day%
              </ResizableTh>
              <ResizableTh
                colKey="rvol"
                width={widthOf('rvol')}
                onResize={resizeColumn}
                className="text-right"
              >
                RVOL
              </ResizableTh>
              <ResizableTh
                colKey="adr"
                width={widthOf('adr')}
                onResize={resizeColumn}
                className="hidden text-right lg:table-cell"
              >
                ADR%
              </ResizableTh>
              <ResizableTh
                colKey="hi52"
                width={widthOf('hi52')}
                onResize={resizeColumn}
                className="hidden text-right lg:table-cell"
              >
                % 52w Hi
              </ResizableTh>
              <ResizableTh
                colKey="trend"
                width={widthOf('trend')}
                onResize={resizeColumn}
                className="hidden xl:table-cell"
              >
                Trend
              </ResizableTh>
              <ResizableTh
                colKey="surfer"
                width={widthOf('surfer')}
                onResize={resizeColumn}
                className="hidden xl:table-cell"
              >
                Surfer
              </ResizableTh>
              <ResizableTh
                colKey="priorRun"
                width={widthOf('priorRun')}
                onResize={resizeColumn}
                className="hidden text-right xl:table-cell"
                title="Inc% BBO proxy: % from ~63d prior low into recent base high"
              >
                Prior run%
              </ResizableTh>
              <ResizableTh
                colKey="tight"
                width={widthOf('tight')}
                onResize={resizeColumn}
                className="hidden text-right xl:table-cell"
                title="Tight-days proxy (last 15)"
              >
                Tight
              </ResizableTh>
              <ResizableTh
                colKey="m1"
                width={widthOf('m1')}
                onResize={resizeColumn}
                className="hidden text-right xl:table-cell"
              >
                1M
              </ResizableTh>
              <ResizableTh
                colKey="m3"
                width={widthOf('m3')}
                onResize={resizeColumn}
                className="hidden text-right xl:table-cell"
              >
                3M
              </ResizableTh>
              <ResizableTh
                colKey="dolVol"
                width={widthOf('dolVol')}
                onResize={resizeColumn}
                className="hidden text-right xl:table-cell"
                title="Avg $ volume (DolVol)"
              >
                DolVol
              </ResizableTh>
              <ResizableTh
                colKey="stage"
                width={widthOf('stage')}
                onResize={resizeColumn}
              >
                Stage
              </ResizableTh>
              <ResizableTh
                colKey="setup"
                width={widthOf('setup')}
                onResize={resizeColumn}
                className="hidden lg:table-cell"
              >
                Setup
              </ResizableTh>
              <ResizableTh
                colKey="score"
                width={widthOf('score')}
                onResize={resizeColumn}
                className="text-center"
                title="Heuristic kyleScore 3–5"
              >
                Score
              </ResizableTh>
              <ResizableTh
                colKey="earn"
                width={earnW}
                onResize={resizeColumn}
                className="sticky z-20 bg-terminal-elevated"
                style={{ right: aPlusW }}
                title="Earnings proximity: AVOID = same/next trading day"
              >
                Earn
              </ResizableTh>
              <ResizableTh
                colKey="catalyst"
                width={widthOf('catalyst')}
                onResize={resizeColumn}
                className="hidden xl:table-cell"
              >
                Catalyst
              </ResizableTh>
              <ResizableTh
                colKey="aPlus"
                width={aPlusW}
                onResize={resizeColumn}
                className="sticky right-0 z-20 bg-terminal-elevated text-center"
                style={{ right: 0 }}
              >
                A+
              </ResizableTh>
            </tr>
          </thead>
          <tbody>
            {ideas.map((idea) => {
              const selected = selectedTicker === idea.ticker
              const avoid = idea.earningsStatus === 'avoid'
              const highlight = rowHighlight(idea)
              return (
                <tr
                  key={idea.ticker}
                  onClick={() => onSelect(idea.ticker)}
                  className={`cursor-pointer border-t border-terminal-border/50 transition-colors hover:bg-terminal-elevated/80 ${highlight} ${
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
                    {idea.ticker}
                  </td>
                  <td className="hidden truncate px-2 py-1.5 text-terminal-muted xl:table-cell">
                    {idea.name}
                  </td>
                  <td className="hidden truncate px-2 py-1.5 text-terminal-muted lg:table-cell">
                    {idea.groupName}
                  </td>
                  <td className="overflow-hidden px-2 py-1.5 text-right font-mono text-terminal-fg">
                    {fmtPrice(idea.price)}
                  </td>
                  <td className={`overflow-hidden px-2 py-1.5 text-right font-mono ${pctClass(idea.dayPct)}`}>
                    {fmtPct(idea.dayPct)}
                  </td>
                  <td
                    className={`overflow-hidden px-2 py-1.5 text-right font-mono ${
                      idea.rvol >= 1.5 ? 'text-terminal-amber' : 'text-terminal-fg'
                    }`}
                  >
                    {fmtRvol(idea.rvol)}
                  </td>
                  <td className="hidden overflow-hidden px-2 py-1.5 text-right font-mono text-terminal-fg lg:table-cell">
                    {idea.adrPct.toFixed(1)}%
                  </td>
                  <td
                    className={`hidden overflow-hidden px-2 py-1.5 text-right font-mono lg:table-cell ${
                      Math.abs(idea.pctFrom52wHigh) <= 5
                        ? 'text-terminal-green'
                        : 'text-terminal-muted'
                    }`}
                  >
                    {fmtPct(idea.pctFrom52wHigh)}
                  </td>
                  <td className="hidden overflow-hidden px-2 py-1.5 xl:table-cell">
                    <TrendBadges idea={idea} />
                  </td>
                  <td className="hidden overflow-hidden px-2 py-1.5 xl:table-cell">
                    <SurferBadges idea={idea} />
                  </td>
                  <td className={`hidden overflow-hidden px-2 py-1.5 text-right font-mono xl:table-cell ${pctClass(idea.priorRunPct)}`}>
                    {fmtPct(idea.priorRunPct, 0)}
                  </td>
                  <td
                    className="hidden overflow-hidden px-2 py-1.5 text-right font-mono text-terminal-muted xl:table-cell"
                    title={`tightDays=${idea.tightDays} · baseLengthDays=${idea.baseLengthDays}`}
                  >
                    {idea.tightDays}
                    <span className="text-terminal-dim">/{idea.baseLengthDays}</span>
                  </td>
                  <td className={`hidden overflow-hidden px-2 py-1.5 text-right font-mono xl:table-cell ${pctClass(idea.perf1M)}`}>
                    {fmtPct(idea.perf1M, 0)}
                  </td>
                  <td className={`hidden overflow-hidden px-2 py-1.5 text-right font-mono xl:table-cell ${pctClass(idea.perf3M)}`}>
                    {fmtPct(idea.perf3M, 0)}
                  </td>
                  <td className="hidden overflow-hidden px-2 py-1.5 text-right font-mono text-terminal-muted xl:table-cell">
                    {fmtDollarVol(idea.dollarVolume || idea.avgDollarVol)}
                  </td>
                  <td className="overflow-hidden px-2 py-1.5">
                    <StageBadge stage={idea.setupStage} />
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
                    {idea.catalyst ? (
                      <span className="text-terminal-green" title={idea.catalyst}>
                        {idea.catalyst}
                      </span>
                    ) : (
                      <span className="text-terminal-dim">—</span>
                    )}
                  </td>
                  <td
                    className={`sticky right-0 z-[5] overflow-hidden px-2 py-1.5 text-center ${highlight || 'bg-terminal-panel'}`}
                    style={{ right: 0, width: aPlusW, minWidth: aPlusW }}
                  >
                    <APlusCell idea={idea} />
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

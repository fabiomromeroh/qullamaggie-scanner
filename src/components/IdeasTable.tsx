import { Pin, PinOff } from 'lucide-react'
import type { CharacteristicTag, EarningsStatus, SetupStage, TradingIdea } from '../types'
import { stageLabel } from '../lib/setupStage'
import { fmtDollarVol, fmtPct, fmtPrice, fmtRvol, pctClass } from '../utils/format'

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

export function IdeasTable({
  ideas,
  selectedTicker,
  onSelect,
  source = 'live',
  isPinned,
  isOnWatchlist,
  onTogglePin,
}: Props) {
  if (!ideas.length) {
    return (
      <div className="flex h-full min-h-[12rem] items-center justify-center rounded-lg border border-terminal-border bg-terminal-panel text-sm text-terminal-muted">
        No ideas match current filters.
      </div>
    )
  }

  return (
    <section className="flex flex-col rounded-lg border border-terminal-border bg-terminal-panel lg:h-full lg:min-h-0 lg:overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-terminal-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">
          Scan results
        </h2>
        <span className="font-mono text-[10px] text-terminal-dim">
          {ideas.length} shown · {source === 'demo' ? 'DEMO' : 'LIVE'}
        </span>
      </div>

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
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-terminal-elevated text-[10px] uppercase tracking-wide text-terminal-dim shadow-[0_1px_0_0_var(--color-terminal-border)]">
            <tr>
              <th className="sticky left-0 z-20 bg-terminal-elevated px-2 py-2 font-medium w-8" title="Pin to dynamic watchlist">
                ★
              </th>
              <th className="sticky left-8 z-20 bg-terminal-elevated px-2 py-2 font-medium">Ticker</th>
              <th className="hidden px-2 py-2 font-medium xl:table-cell">Name</th>
              <th className="hidden px-2 py-2 font-medium lg:table-cell">Group</th>
              <th className="px-2 py-2 font-medium text-right">Price</th>
              <th className="px-2 py-2 font-medium text-right">Day%</th>
              <th className="px-2 py-2 font-medium text-right">RVOL</th>
              <th className="hidden px-2 py-2 font-medium text-right lg:table-cell">ADR%</th>
              <th className="hidden px-2 py-2 font-medium text-right lg:table-cell">% 52w Hi</th>
              <th className="hidden px-2 py-2 font-medium xl:table-cell">Trend</th>
              <th className="hidden px-2 py-2 font-medium xl:table-cell">Surfer</th>
              <th
                className="hidden px-2 py-2 font-medium text-right xl:table-cell"
                title="Inc% BBO proxy: % from ~63d prior low into recent base high"
              >
                Prior run%
              </th>
              <th className="hidden px-2 py-2 font-medium text-right xl:table-cell" title="Tight-days proxy (last 15)">
                Tight
              </th>
              <th className="hidden px-2 py-2 font-medium text-right xl:table-cell">1M</th>
              <th className="hidden px-2 py-2 font-medium text-right xl:table-cell">3M</th>
              <th className="hidden px-2 py-2 font-medium text-right xl:table-cell" title="Avg $ volume (DolVol)">
                DolVol
              </th>
              <th className="px-2 py-2 font-medium">Stage</th>
              <th className="hidden px-2 py-2 font-medium lg:table-cell">Setup</th>
              <th className="px-2 py-2 font-medium text-center" title="Heuristic kyleScore 3–5">
                Score
              </th>
              <th
                className="sticky right-12 z-20 bg-terminal-elevated px-2 py-2 font-medium"
                title="Earnings proximity: AVOID = same/next trading day"
              >
                Earn
              </th>
              <th className="hidden px-2 py-2 font-medium xl:table-cell">Catalyst</th>
              <th className="sticky right-0 z-20 bg-terminal-elevated px-2 py-2 font-medium text-center">A+</th>
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
                  <td className={`sticky left-0 z-[5] px-2 py-1.5 ${highlight || 'bg-terminal-panel'}`}>
                    <PinButton
                      ticker={idea.ticker}
                      isPinned={isPinned}
                      isOnWatchlist={isOnWatchlist}
                      onTogglePin={onTogglePin}
                    />
                  </td>
                  <td className={`sticky left-8 z-[5] px-2 py-1.5 font-mono font-semibold text-terminal-fg ${highlight || 'bg-terminal-panel'}`}>
                    {idea.ticker}
                  </td>
                  <td className="hidden max-w-[120px] truncate px-2 py-1.5 text-terminal-muted xl:table-cell">
                    {idea.name}
                  </td>
                  <td className="hidden max-w-[110px] truncate px-2 py-1.5 text-terminal-muted lg:table-cell">
                    {idea.groupName}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-terminal-fg">
                    {fmtPrice(idea.price)}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${pctClass(idea.dayPct)}`}>
                    {fmtPct(idea.dayPct)}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-mono ${
                      idea.rvol >= 1.5 ? 'text-terminal-amber' : 'text-terminal-fg'
                    }`}
                  >
                    {fmtRvol(idea.rvol)}
                  </td>
                  <td className="hidden px-2 py-1.5 text-right font-mono text-terminal-fg lg:table-cell">
                    {idea.adrPct.toFixed(1)}%
                  </td>
                  <td
                    className={`hidden px-2 py-1.5 text-right font-mono lg:table-cell ${
                      Math.abs(idea.pctFrom52wHigh) <= 5
                        ? 'text-terminal-green'
                        : 'text-terminal-muted'
                    }`}
                  >
                    {fmtPct(idea.pctFrom52wHigh)}
                  </td>
                  <td className="hidden px-2 py-1.5 xl:table-cell">
                    <TrendBadges idea={idea} />
                  </td>
                  <td className="hidden px-2 py-1.5 xl:table-cell">
                    <SurferBadges idea={idea} />
                  </td>
                  <td className={`hidden px-2 py-1.5 text-right font-mono xl:table-cell ${pctClass(idea.priorRunPct)}`}>
                    {fmtPct(idea.priorRunPct, 0)}
                  </td>
                  <td
                    className="hidden px-2 py-1.5 text-right font-mono text-terminal-muted xl:table-cell"
                    title={`tightDays=${idea.tightDays} · baseLengthDays=${idea.baseLengthDays}`}
                  >
                    {idea.tightDays}
                    <span className="text-terminal-dim">/{idea.baseLengthDays}</span>
                  </td>
                  <td className={`hidden px-2 py-1.5 text-right font-mono xl:table-cell ${pctClass(idea.perf1M)}`}>
                    {fmtPct(idea.perf1M, 0)}
                  </td>
                  <td className={`hidden px-2 py-1.5 text-right font-mono xl:table-cell ${pctClass(idea.perf3M)}`}>
                    {fmtPct(idea.perf3M, 0)}
                  </td>
                  <td className="hidden px-2 py-1.5 text-right font-mono text-terminal-muted xl:table-cell">
                    {fmtDollarVol(idea.dollarVolume || idea.avgDollarVol)}
                  </td>
                  <td className="px-2 py-1.5">
                    <StageBadge stage={idea.setupStage} />
                  </td>
                  <td className="hidden px-2 py-1.5 lg:table-cell">
                    <SetupBadge type={idea.setupType} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <KyleStars score={idea.kyleScore} />
                  </td>
                  <td className={`sticky right-12 z-[5] px-2 py-1.5 ${highlight || 'bg-terminal-panel'}`}>
                    <EarningsBadge idea={idea} />
                  </td>
                  <td className="hidden max-w-[140px] truncate px-2 py-1.5 xl:table-cell">
                    {idea.catalyst ? (
                      <span className="text-terminal-green" title={idea.catalyst}>
                        {idea.catalyst}
                      </span>
                    ) : (
                      <span className="text-terminal-dim">—</span>
                    )}
                  </td>
                  <td className={`sticky right-0 z-[5] px-2 py-1.5 text-center ${highlight || 'bg-terminal-panel'}`}>
                    <APlusCell idea={idea} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

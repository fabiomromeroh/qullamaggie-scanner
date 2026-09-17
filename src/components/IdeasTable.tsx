import { Pin, PinOff } from 'lucide-react'
import type { CharacteristicTag, SetupStage, TradingIdea } from '../types'
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
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-terminal-border bg-terminal-panel">
      <div className="flex shrink-0 items-center justify-between border-b border-terminal-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">
          Scan results
        </h2>
        <span className="font-mono text-[10px] text-terminal-dim">
          {ideas.length} shown · {source === 'demo' ? 'DEMO' : 'LIVE'} · stages + Kyle proxies
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1580px] text-left text-xs">
          <thead className="sticky top-0 z-10 bg-terminal-elevated text-[10px] uppercase tracking-wide text-terminal-dim shadow-[0_1px_0_0_var(--color-terminal-border)]">
            <tr>
              <th className="px-2 py-2 font-medium w-8" title="Pin to dynamic watchlist">★</th>
              <th className="px-2 py-2 font-medium">Ticker</th>
              <th className="px-2 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">Group</th>
              <th className="px-2 py-2 font-medium text-right">Price</th>
              <th className="px-2 py-2 font-medium text-right">Day%</th>
              <th className="px-2 py-2 font-medium text-right">RVOL</th>
              <th className="px-2 py-2 font-medium text-right">ADR%</th>
              <th className="px-2 py-2 font-medium text-right">% 52w Hi</th>
              <th className="px-2 py-2 font-medium">Trend</th>
              <th className="px-2 py-2 font-medium">Surfer</th>
              <th
                className="px-2 py-2 font-medium text-right"
                title="Inc% BBO proxy: % from ~63d prior low into recent base high"
              >
                Prior run%
              </th>
              <th className="px-2 py-2 font-medium text-right" title="Tight-days proxy (last 15)">
                Tight
              </th>
              <th className="px-2 py-2 font-medium text-right">1M</th>
              <th className="px-2 py-2 font-medium text-right">3M</th>
              <th className="px-2 py-2 font-medium text-right" title="Avg $ volume (DolVol)">
                DolVol
              </th>
              <th className="px-2 py-2 font-medium">Stage</th>
              <th className="px-2 py-2 font-medium">Setup</th>
              <th className="px-2 py-2 font-medium text-center" title="Heuristic kyleScore 3–5">
                Score
              </th>
              <th className="px-2 py-2 font-medium">Catalyst</th>
              <th className="px-2 py-2 font-medium text-center">A+</th>
            </tr>
          </thead>
          <tbody>
            {ideas.map((idea) => {
              const selected = selectedTicker === idea.ticker
              const highlight =
                idea.isAPlus && idea.catalyst
                  ? 'bg-terminal-a-plus-bg/80'
                  : idea.isAPlus
                    ? 'bg-terminal-a-plus-bg/40'
                    : ''
              return (
                <tr
                  key={idea.ticker}
                  onClick={() => onSelect(idea.ticker)}
                  className={`cursor-pointer border-t border-terminal-border/50 transition-colors hover:bg-terminal-elevated/80 ${highlight} ${
                    selected ? 'ring-1 ring-inset ring-terminal-blue/50' : ''
                  }`}
                >
                  <td className="px-2 py-1.5">
                    {onTogglePin ? (
                      <button
                        type="button"
                        title={isPinned?.(idea.ticker) ? 'Unpin' : 'Pin to watchlist'}
                        onClick={(e) => {
                          e.stopPropagation()
                          onTogglePin(idea.ticker)
                        }}
                        className={`rounded p-0.5 ${
                          isOnWatchlist?.(idea.ticker)
                            ? 'text-terminal-amber'
                            : 'text-terminal-dim hover:text-terminal-amber'
                        }`}
                      >
                        {isPinned?.(idea.ticker) ? (
                          <Pin className="h-3.5 w-3.5" />
                        ) : (
                          <PinOff className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="text-terminal-dim">·</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono font-semibold text-terminal-fg">
                    {idea.ticker}
                  </td>
                  <td className="max-w-[120px] truncate px-2 py-1.5 text-terminal-muted">
                    {idea.name}
                  </td>
                  <td className="max-w-[110px] truncate px-2 py-1.5 text-terminal-muted">
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
                  <td className="px-2 py-1.5 text-right font-mono text-terminal-fg">
                    {idea.adrPct.toFixed(1)}%
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-mono ${
                      Math.abs(idea.pctFrom52wHigh) <= 5
                        ? 'text-terminal-green'
                        : 'text-terminal-muted'
                    }`}
                  >
                    {fmtPct(idea.pctFrom52wHigh)}
                  </td>
                  <td className="px-2 py-1.5">
                    <TrendBadges idea={idea} />
                  </td>
                  <td className="px-2 py-1.5">
                    <SurferBadges idea={idea} />
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${pctClass(idea.priorRunPct)}`}>
                    {fmtPct(idea.priorRunPct, 0)}
                  </td>
                  <td
                    className="px-2 py-1.5 text-right font-mono text-terminal-muted"
                    title={`tightDays=${idea.tightDays} · baseLengthDays=${idea.baseLengthDays}`}
                  >
                    {idea.tightDays}
                    <span className="text-terminal-dim">/{idea.baseLengthDays}</span>
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${pctClass(idea.perf1M)}`}>
                    {fmtPct(idea.perf1M, 0)}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${pctClass(idea.perf3M)}`}>
                    {fmtPct(idea.perf3M, 0)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-terminal-muted">
                    {fmtDollarVol(idea.dollarVolume || idea.avgDollarVol)}
                  </td>
                  <td className="px-2 py-1.5">
                    <StageBadge stage={idea.setupStage} />
                  </td>
                  <td className="px-2 py-1.5">
                    <SetupBadge type={idea.setupType} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <KyleStars score={idea.kyleScore} />
                  </td>
                  <td className="max-w-[140px] truncate px-2 py-1.5">
                    {idea.catalyst ? (
                      <span className="text-terminal-green" title={idea.catalyst}>
                        {idea.catalyst}
                      </span>
                    ) : (
                      <span className="text-terminal-dim">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {idea.isAPlus ? (
                      <span className="inline-flex rounded bg-terminal-a-plus px-1.5 py-0.5 text-[10px] font-bold text-terminal-bg">
                        A+
                      </span>
                    ) : (
                      <span className="text-terminal-dim">·</span>
                    )}
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

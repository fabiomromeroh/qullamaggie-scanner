import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { IndustryGroup } from '../types'
import { fmtPct, pctClass } from '../utils/format'

const GROUPS_EXPAND_KEY = 'qm-groups-expanded'

interface Props {
  groups: IndustryGroup[]
  selectedGroupId: string | null
  onSelectGroup: (id: string | null) => void
}

function readGroupsExpanded(): boolean {
  try {
    const v = sessionStorage.getItem(GROUPS_EXPAND_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* ignore */
  }
  // Default collapsed on mobile — results dominate the first screenful
  return false
}

export function GroupStrength({ groups, selectedGroupId, onSelectGroup }: Props) {
  const ranked = [...groups].sort((a, b) => a.rsRank - b.rsRank)
  const [stripOpen, setStripOpen] = useState(readGroupsExpanded)

  useEffect(() => {
    try {
      sessionStorage.setItem(GROUPS_EXPAND_KEY, stripOpen ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [stripOpen])

  const top3 = ranked.slice(0, 3)
  const topSummary = top3.map((g) => g.name.split(' ')[0] || g.name).join(' · ')

  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border border-terminal-border bg-terminal-panel">
      {/* Mobile header + optional strip */}
      <div className="md:hidden">
        <div className="flex items-center justify-between gap-2 border-b border-terminal-border px-2.5 py-1">
          <button
            type="button"
            onClick={() => setStripOpen((v) => !v)}
            className="flex min-h-8 flex-1 items-center justify-between gap-2 text-left"
            aria-expanded={stripOpen}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-terminal-muted">
              Groups
              {!stripOpen ? (
                <span className="ml-1.5 font-mono normal-case tracking-normal text-terminal-dim">
                  · top 3 · {topSummary || '—'}
                </span>
              ) : null}
            </span>
            {stripOpen ? (
              <ChevronUp className="h-3.5 w-3.5 shrink-0 text-terminal-dim" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-terminal-dim" />
            )}
          </button>
          {stripOpen ? (
            <button
              type="button"
              onClick={() => onSelectGroup(null)}
              className="min-h-8 px-1.5 text-[10px] text-terminal-dim hover:text-terminal-blue"
            >
              Clear
            </button>
          ) : null}
        </div>

        {stripOpen ? (
          <div className="overflow-x-auto p-1.5">
            <div className="flex gap-1.5 snap-x snap-mandatory">
              {ranked.map((g) => {
                const active = selectedGroupId === g.id
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => onSelectGroup(active ? null : g.id)}
                    title={`${g.description} · 1M ${fmtPct(g.perf1m)} · 3M ${fmtPct(g.perf3m)} · 6M ${fmtPct(g.perf6m)}`}
                    className={`snap-start shrink-0 min-w-[9.75rem] max-w-[11rem] rounded-md border px-2 py-1 text-left transition-colors ${
                      active
                        ? 'border-terminal-blue/50 bg-terminal-blue/10'
                        : 'border-terminal-border bg-terminal-bg hover:bg-terminal-elevated'
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-[9px] text-terminal-dim">#{g.rsRank}</span>
                      <span className="truncate text-[10px] font-medium leading-tight text-terminal-fg">
                        {g.name}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-nowrap items-center gap-1.5 overflow-visible font-mono text-[9px] leading-tight whitespace-nowrap">
                      <span className={pctClass(g.perf1m)}>1M {fmtPct(g.perf1m, 0)}</span>
                      <span className={pctClass(g.perf3m)}>3M {fmtPct(g.perf3m, 0)}</span>
                      <span className={pctClass(g.perf6m)}>6M {fmtPct(g.perf6m, 0)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>

      {/* Desktop header + table */}
      <div className="hidden shrink-0 items-center justify-between border-b border-terminal-border px-3 py-2 md:flex">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">
          Group strength
        </h2>
        <button
          type="button"
          onClick={() => onSelectGroup(null)}
          className="min-h-8 px-2 text-[10px] text-terminal-dim hover:text-terminal-blue"
        >
          Clear
        </button>
      </div>

      <div className="hidden min-h-0 flex-1 overflow-auto md:block">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-terminal-elevated text-[10px] uppercase tracking-wide text-terminal-dim">
            <tr>
              <th className="px-2 py-1.5 font-medium">#</th>
              <th className="px-2 py-1.5 font-medium">Group</th>
              <th className="px-2 py-1.5 font-medium text-right">Leaders</th>
              <th className="px-2 py-1.5 font-medium text-right">1D</th>
              <th
                className="px-2 py-1.5 font-medium text-right"
                title="Avg member ~21 trading-day return"
              >
                1M
              </th>
              <th
                className="px-2 py-1.5 font-medium text-right"
                title="Avg member ~63 trading-day return"
              >
                3M
              </th>
              <th
                className="px-2 py-1.5 font-medium text-right"
                title="Avg member ~126 trading-day return"
              >
                6M
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((g) => {
              const active = selectedGroupId === g.id
              return (
                <tr
                  key={g.id}
                  onClick={() => onSelectGroup(active ? null : g.id)}
                  title={`${g.description} · 1M ${fmtPct(g.perf1m)} · 3M ${fmtPct(g.perf3m)} · 6M ${fmtPct(g.perf6m)}`}
                  className={`cursor-pointer border-t border-terminal-border/60 transition-colors hover:bg-terminal-elevated ${
                    active ? 'bg-terminal-blue/10' : ''
                  }`}
                >
                  <td className="px-2 py-1.5 font-mono text-terminal-dim">{g.rsRank}</td>
                  <td className="px-2 py-1.5">
                    <div className="font-medium text-terminal-fg">{g.name}</div>
                    <div className="mt-0.5 h-1 w-full max-w-[120px] overflow-hidden rounded-full bg-terminal-border">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-terminal-green/80 to-terminal-blue/80"
                        style={{ width: `${Math.max(8, 100 - (g.rsRank - 1) * 10)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-terminal-fg">
                    {g.leaderCount}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${pctClass(g.dayPct)}`}>
                    {fmtPct(g.dayPct)}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${pctClass(g.perf1m)}`}>
                    {fmtPct(g.perf1m, 0)}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${pctClass(g.perf3m)}`}>
                    {fmtPct(g.perf3m, 0)}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${pctClass(g.perf6m)}`}>
                    {fmtPct(g.perf6m, 0)}
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

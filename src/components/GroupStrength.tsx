import type { IndustryGroup } from '../types'
import { fmtPct, pctClass } from '../utils/format'

interface Props {
  groups: IndustryGroup[]
  selectedGroupId: string | null
  onSelectGroup: (id: string | null) => void
}

export function GroupStrength({ groups, selectedGroupId, onSelectGroup }: Props) {
  const ranked = [...groups].sort((a, b) => a.rsRank - b.rsRank)

  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border border-terminal-border bg-terminal-panel">
      <div className="flex items-center justify-between border-b border-terminal-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">
          Group strength
        </h2>
        <button
          type="button"
          onClick={() => onSelectGroup(null)}
          className="text-[10px] text-terminal-dim hover:text-terminal-blue"
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-terminal-elevated text-[10px] uppercase tracking-wide text-terminal-dim">
            <tr>
              <th className="px-2 py-1.5 font-medium">#</th>
              <th className="px-2 py-1.5 font-medium">Group</th>
              <th className="px-2 py-1.5 font-medium text-right">Leaders</th>
              <th className="px-2 py-1.5 font-medium text-right">1D</th>
              <th className="px-2 py-1.5 font-medium text-right">1M</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((g) => {
              const active = selectedGroupId === g.id
              return (
                <tr
                  key={g.id}
                  onClick={() => onSelectGroup(active ? null : g.id)}
                  title={g.description}
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
                  <td className={`px-2 py-1.5 text-right font-mono ${pctClass(g.monthPct)}`}>
                    {fmtPct(g.monthPct)}
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

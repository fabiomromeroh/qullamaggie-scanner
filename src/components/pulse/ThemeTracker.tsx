import { useJson } from '../../hooks/useJson'
import { fmtCompact, fmtPct, fmtPrice, pctClass } from '../../lib/pulseFormat'
import type { GroupsResponse, IndustryGroup } from '../../types'
import { TickerLink } from '../TickerModal'
import { SortableTable, type Column } from './SortableTable'

interface MembersResponse {
  slug: string
  name: string
  generatedAt: string
  members: {
    ticker: string
    company?: string
    price?: number
    changePct?: number
    volume?: number
    avgVolume?: number
    marketCap?: number
  }[]
  quotesSource?: string
  quotesError?: string
}

function GroupMembers({ group }: { group: IndustryGroup }) {
  const slug = group.slug ?? group.id
  const { data, error, loading } = useJson<MembersResponse>(`/api/pulse/group-members/${encodeURIComponent(slug)}`)
  if (loading && !data) return <span className="text-[11px] text-terminal-muted">Loading members…</span>
  if (error) return <span className="text-[11px] text-terminal-red">Members unavailable: {error}</span>
  if (!data) return null
  const members = [...data.members].sort((a, b) => (b.changePct ?? -1e9) - (a.changePct ?? -1e9))
  return (
    <div>
      <div className="mb-1 text-[10px] text-terminal-dim">
        {members.length} members from the Finviz membership snapshot ({data.generatedAt.slice(0, 10)}; price &gt; $5, avg vol
        &gt; 750K) · {data.quotesSource ?? 'Yahoo quotes'}
        {data.quotesError ? <span className="text-terminal-red"> · quotes unavailable: {data.quotesError}</span> : null}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-4 gap-y-0.5 text-[11px]">
        {members.map((m) => (
          <div key={m.ticker} className="flex items-baseline gap-2">
            <TickerLink ticker={m.ticker} name={m.company} className="w-14 text-left" />
            <span className={`w-16 text-right font-mono ${pctClass(m.changePct)}`}>{fmtPct(m.changePct)}</span>
            <span className="w-14 text-right font-mono text-terminal-muted">{fmtPrice(m.price)}</span>
            <span className="min-w-0 flex-1 truncate text-terminal-dim" title={m.company}>
              {m.company}
              {m.marketCap ? ` · ${fmtCompact(m.marketCap)}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const COLUMNS: Column<IndustryGroup>[] = [
  { key: 'name', label: 'Group', text: (g) => g.name, render: (g) => (
      <span className="block max-w-[14rem] truncate text-terminal-fg" title={g.name}>
        {g.name}
      </span>
    ),
  },
  { key: 'day', label: 'Today', value: (g) => g.dayPct, pct: true },
  { key: 'week', label: '1W', value: (g) => g.weekPct, pct: true },
  { key: 'month', label: '1M', value: (g) => g.perf1m ?? g.monthPct, pct: true },
  { key: 'q', label: '3M', value: (g) => g.perf3m, pct: true },
  { key: 'h', label: '6M', value: (g) => g.perf6m, pct: true },
  { key: 'ytd', label: 'YTD', value: (g) => g.perfYtd, pct: true },
]

/** Finviz industry groups: same /api/groups feed and cache as the scanner's Leading groups panel. */
export function ThemeTracker() {
  const { data, error, loading, reload } = useJson<GroupsResponse>('/api/groups', 5 * 60_000)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-2 py-1 text-[10px] text-terminal-dim">
        <span>
          {data?.source === 'finviz'
            ? `Finviz industry groups${data.stale ? ' (stale cache)' : ''} · fetched ${new Date(data.fetchedAt).toLocaleTimeString()}`
            : data
              ? 'Finviz unavailable: internal fallback ranking (performance columns may be empty)'
              : ''}
        </span>
        {error ? <span className="text-terminal-red">{error}</span> : null}
        <span>Click a group for its members</span>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          className="ml-auto rounded border border-terminal-border px-2 py-0.5 text-terminal-muted hover:text-terminal-fg disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {!data && loading ? (
        <div className="p-6 text-center text-xs text-terminal-muted">Loading groups…</div>
      ) : (
        <SortableTable
          rows={data?.groups ?? []}
          columns={COLUMNS}
          rowKey={(g) => g.id}
          defaultSort={{ key: 'day', dir: 'desc' }}
          renderExpanded={(g) => <GroupMembers group={g} />}
        />
      )}
    </div>
  )
}


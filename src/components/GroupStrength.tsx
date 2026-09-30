import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import type { GroupLeadersEntry, GroupPeriod, GroupsResponse, IndustryGroup } from '../types'
import { fmtPct, pctClass } from '../utils/format'
import { useResizableColumns } from '../hooks/useResizableColumns'
import { useGroupLeaders } from '../hooks/useGroupLeaders'
import {
  compareGroupsByPeriod,
  GROUP_PERIOD_IDS,
  GROUP_PERIODS,
  isGroupSlug,
  rankGroups,
} from '../lib/groupPeriod'
import { ResizeHandle } from './ResizeHandle'

const GROUPS_EXPAND_KEY = 'qm-groups-expanded'
const GROUPS_COL_KEY = 'qm-groups-col-widths'
const LEADER_WINDOW = 25

const DEFAULT_COLS: Record<string, number> = {
  rank: 36,
  name: 148,
  leaders: 58,
  d1: 52,
  m1: 52,
  m3: 52,
  m6: 52,
}

type GroupsMeta = Pick<GroupsResponse, 'source' | 'stale' | 'fetchedAt'>
type GroupSortKey = 'rank' | 'name' | 'leaders' | '1d' | '1w' | '1m' | '3m' | '6m'
type SortDir = 'asc' | 'desc'
type SortState = { key: GroupSortKey; dir: SortDir }

const SORT_PERIOD: Partial<Record<GroupSortKey, GroupPeriod>> = {
  '1d': '1d',
  '1w': '1w',
  '1m': '1m',
  '3m': '3m',
  '6m': '6m',
}

const COLUMN_PERIOD: Record<'d1' | 'm1' | 'm3' | 'm6', GroupPeriod> = {
  d1: '1d',
  m1: '1m',
  m3: '3m',
  m6: '6m',
}

interface Props {
  groups: IndustryGroup[]
  selectedGroupId: string | null
  onSelectGroup: (id: string | null) => void
  onReset: () => void
  period: GroupPeriod
  onPeriodChange: (period: GroupPeriod) => void
  meta?: GroupsMeta | null
  loading?: boolean
}

function readGroupsExpanded(): boolean {
  try {
    const v = sessionStorage.getItem(GROUPS_EXPAND_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* ignore */
  }
  return false
}

function finite(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function fmtCell(n: number | undefined, digits = 1): string {
  if (!finite(n)) return '—'
  return fmtPct(n, digits)
}

function cellClass(n: number | undefined): string {
  if (!finite(n)) return 'text-terminal-muted'
  return pctClass(n)
}

function formatUpdatedHm(iso: string | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function groupTitle(g: IndustryGroup): string {
  const parts = [g.description]
  if (g.source === 'finviz' && finite(g.weekPct)) parts.push(`1W ${fmtPct(g.weekPct)}`)
  parts.push(`1M ${fmtCell(g.perf1m)}`, `3M ${fmtCell(g.perf3m)}`, `6M ${fmtCell(g.perf6m)}`)
  if (finite(g.perf1y)) parts.push(`1Y ${fmtPct(g.perf1y)}`)
  if (finite(g.perfYtd)) parts.push(`YTD ${fmtPct(g.perfYtd)}`)
  return parts.join(' · ')
}

function finvizScreenerHref(slug: string, order: string): string {
  return `https://finviz.com/screener.ashx?v=111&f=ind_${encodeURIComponent(slug)}&o=${encodeURIComponent(order)}`
}

function slugOf(group: IndustryGroup): string | null {
  const slug = (group.slug || group.id).toLowerCase()
  return isGroupSlug(slug) ? slug : null
}

function visibleSlugList(groups: IndustryGroup[], selected: string | null): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (slug: string | null | undefined) => {
    if (!slug || !isGroupSlug(slug) || seen.has(slug)) return
    seen.add(slug)
    out.push(slug)
  }
  for (const group of groups.slice(0, LEADER_WINDOW)) push(slugOf(group))
  if (selected) push(selected.toLowerCase())
  return out
}

function sortGroups(
  groups: IndustryGroup[],
  sort: SortState,
  entries: Record<string, GroupLeadersEntry>,
): IndustryGroup[] {
  const period = SORT_PERIOD[sort.key]
  const list = [...groups]
  list.sort((a, b) => {
    if (period) return compareGroupsByPeriod(a, b, period, sort.dir)
    if (sort.key === 'name') {
      const diff = a.name.localeCompare(b.name)
      return sort.dir === 'asc' ? diff : -diff
    }
    if (sort.key === 'rank') {
      const diff = a.rsRank - b.rsRank
      return sort.dir === 'asc' ? diff : -diff
    }
    const ae = entries[slugOf(a) ?? '']
    const be = entries[slugOf(b) ?? '']
    const av = ae && ae.inScanCount != null ? ae.inScanCount : null
    const bv = be && be.inScanCount != null ? be.inScanCount : null
    if (av == null && bv == null) return a.rsRank - b.rsRank
    if (av == null) return 1
    if (bv == null) return -1
    if (av !== bv) return sort.dir === 'asc' ? av - bv : bv - av
    return a.rsRank - b.rsRank
  })
  return list
}

const LEADER_HELP =
  'A leader is a stock in this group’s Finviz top list (price > $5, average volume > 750K, ordered by the selected period) whose selected-period performance is above 0 and that also appears in the current scan (above the 200-day SMA). Shown as in-scan / parsed, for example 3/20.'

function leaderTooltip(entry: GroupLeadersEntry, periodLabel: string): string {
  const lines = [
    LEADER_HELP,
    `Ordered by ${periodLabel}.`,
  ]
  if (entry.error && entry.leaders.length === 0) {
    lines.push(entry.error)
    return lines.join('\n')
  }
  if (entry.inScanCount == null) {
    lines.push('Scan cache is not ready, so the in-scan leader count is unknown.')
  } else {
    lines.push(`${entry.inScanCount}/${entry.parsedCount} in the current scan.`)
  }
  if (entry.stale) lines.push('Finviz list is stale.')
  for (const row of entry.top5) {
    const perf = row.perf == null ? '—' : fmtPct(row.perf)
    const mark = row.inScan == null ? '' : row.inScan ? ' · in scan' : ' · not in scan'
    lines.push(`${row.ticker} ${perf}${mark}${row.company ? ` · ${row.company}` : ''}`)
  }
  if (entry.error) lines.push(entry.error)
  return lines.join('\n')
}

function leaderCell(
  entry: GroupLeadersEntry | undefined,
  inWindow: boolean,
  periodLabel: string,
  fallbackCount: number | undefined,
  finviz: boolean,
): { text: string; title: string } {
  if (!finviz) {
    return {
      text: fallbackCount == null ? '—' : String(fallbackCount),
      title: 'Members within 10% of 52-week high',
    }
  }
  if (!entry) {
    return inWindow
      ? { text: '…', title: 'Loading leaders…' }
      : { text: '·', title: 'Leaders load for the first 25 groups in the current sort.' }
  }
  if (entry.error && entry.leaders.length === 0) {
    return { text: '—', title: entry.error }
  }
  if (entry.parsedCount === 0) {
    return { text: '—', title: entry.error || 'Finviz returned no names for this group.' }
  }
  if (entry.inScanCount == null) {
    const peek = entry.top5[0]?.ticker
    return {
      text: peek || '—',
      title: leaderTooltip(entry, periodLabel),
    }
  }
  return {
    text: `${entry.inScanCount}/${entry.parsedCount}`,
    title: leaderTooltip(entry, periodLabel),
  }
}

function GroupsMetaLine({ meta }: { meta: GroupsMeta }) {
  const updated = formatUpdatedHm(meta.fetchedAt)
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] font-normal normal-case tracking-normal text-terminal-dim">
      {meta.source === 'fallback' ? (
        <span className="font-medium text-terminal-amber">Fallback: internal ranking</span>
      ) : (
        <span>Finviz</span>
      )}
      {meta.stale ? (
        <span className="rounded bg-terminal-amber-dim px-1 py-px font-medium uppercase tracking-wide text-terminal-amber">
          stale
        </span>
      ) : null}
      {updated ? <span>updated {updated}</span> : null}
    </p>
  )
}

function PeriodControl({
  period,
  onChange,
}: {
  period: GroupPeriod
  onChange: (period: GroupPeriod) => void
}) {
  return (
    <div
      className="flex shrink-0 rounded border border-terminal-border p-px"
      role="group"
      aria-label="Group performance period"
    >
      {GROUP_PERIOD_IDS.map((id) => {
        const active = id === period
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={`min-h-8 px-1.5 text-[10px] ${
              active
                ? 'rounded-sm bg-terminal-blue/20 font-semibold text-terminal-fg'
                : 'text-terminal-dim hover:text-terminal-fg'
            }`}
          >
            {GROUP_PERIODS[id].label}
          </button>
        )
      })}
    </div>
  )
}

function ResetButton({ onReset, className = '' }: { onReset: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onReset}
      className={`min-h-8 shrink-0 px-2 text-[10px] font-medium text-terminal-fg hover:text-terminal-blue ${className}`}
    >
      Reset
    </button>
  )
}

function Th({
  colKey,
  width,
  onResize,
  className = '',
  title,
  children,
  align = 'left',
  sortKey,
  sort,
  onSort,
  emphasize = false,
}: {
  colKey: string
  width: number
  onResize: (key: string, dx: number) => void
  className?: string
  title?: string
  children: ReactNode
  align?: 'left' | 'right'
  sortKey: GroupSortKey
  sort: SortState
  onSort: (key: GroupSortKey) => void
  emphasize?: boolean
}) {
  const moved = useRef(false)
  const startX = useRef(0)
  const active = sort.key === sortKey
  return (
    <th
      className={`qm-th-resizable px-2 py-1.5 font-medium ${align === 'right' ? 'text-right' : ''} ${
        emphasize ? 'bg-terminal-blue/10 font-semibold text-terminal-fg' : ''
      } ${className}`}
      style={{ width, minWidth: width, maxWidth: width }}
      title={title}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={`inline-flex w-full items-center gap-0.5 ${align === 'right' ? 'justify-end' : 'justify-start'}`}
        onPointerDown={(event) => {
          moved.current = false
          startX.current = event.clientX
        }}
        onPointerMove={(event) => {
          if (Math.abs(event.clientX - startX.current) > 4) moved.current = true
        }}
        onClick={() => {
          if (moved.current) return
          onSort(sortKey)
        }}
      >
        {children}
        {active ? (
          sort.dir === 'asc' ? (
            <ChevronUp className="h-3 w-3 shrink-0" aria-hidden />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
          )
        ) : null}
      </button>
      <ResizeHandle
        variant="col"
        label={`Resize ${colKey} column`}
        onDelta={(dx) => onResize(colKey, dx)}
        className="hidden lg:block"
      />
    </th>
  )
}

export function GroupStrength({
  groups,
  selectedGroupId,
  onSelectGroup,
  onReset,
  period,
  onPeriodChange,
  meta = null,
  loading = false,
}: Props) {
  const ranked = useMemo(() => rankGroups(groups, period), [groups, period])
  const [stripOpen, setStripOpen] = useState(readGroupsExpanded)
  const [sortPeriod, setSortPeriod] = useState(period)
  const [sort, setSort] = useState<SortState>({ key: period, dir: 'desc' })
  const [requestedSlugs, setRequestedSlugs] = useState<string[]>([])
  const { widthOf, resizeColumn } = useResizableColumns(GROUPS_COL_KEY, DEFAULT_COLS, {
    min: 36,
    max: 320,
  })
  const finviz = meta?.source === 'finviz'
  const entries = useGroupLeaders(requestedSlugs, period, finviz)
  const sorted = useMemo(() => sortGroups(ranked, sort, entries), [ranked, sort, entries])

  if (sortPeriod !== period) {
    setSortPeriod(period)
    setSort({ key: period, dir: 'desc' })
  }
  const wanted = finviz ? visibleSlugList(sorted, selectedGroupId) : []
  if (wanted.join(',') !== requestedSlugs.join(',')) {
    setRequestedSlugs(wanted)
  }

  useEffect(() => {
    try {
      sessionStorage.setItem(GROUPS_EXPAND_KEY, stripOpen ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [stripOpen])

  const onSort = (key: GroupSortKey) => {
    setSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
      if (key === 'name' || key === 'rank') return { key, dir: 'asc' }
      return { key, dir: 'desc' }
    })
  }

  const order = GROUP_PERIODS[period].order
  const periodLabel = GROUP_PERIODS[period].label
  const top3 = sorted.slice(0, 3)
  const topSummary = top3.map((g) => g.name.split(' ')[0] || g.name).join(' · ')
  const wantedSet = new Set(wanted)
  const stripPeriods = [period, ...(['1m', '3m', '6m'] as GroupPeriod[]).filter((id) => id !== period)].slice(0, 3)

  const emph = (key: keyof typeof COLUMN_PERIOD) => COLUMN_PERIOD[key] === period

  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border border-terminal-border bg-terminal-panel">
      <div className="md:hidden">
        <div className="flex items-center gap-1 border-b border-terminal-border px-2 py-1">
          <button
            type="button"
            onClick={() => setStripOpen((v) => !v)}
            className="flex min-h-8 min-w-0 flex-1 items-center justify-between gap-2 text-left"
            aria-expanded={stripOpen}
          >
            <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-terminal-muted">
              Leading groups
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
          <PeriodControl period={period} onChange={onPeriodChange} />
          <ResetButton onReset={onReset} className="px-1.5" />
        </div>

        {loading || meta ? (
          <div className="px-2.5 pb-1">
            {loading && !meta ? (
              <p className="text-[10px] text-terminal-dim">Loading…</p>
            ) : meta ? (
              <GroupsMetaLine meta={meta} />
            ) : null}
          </div>
        ) : null}

        {stripOpen ? (
          <div className="overflow-x-auto p-1.5">
            {sorted.length === 0 ? (
              <p className="px-1 py-2 text-[10px] text-terminal-dim">
                {loading ? 'Loading leading groups…' : 'No groups'}
              </p>
            ) : (
              <div className="flex gap-1.5 snap-x snap-mandatory">
                {sorted.map((g) => {
                  const active = selectedGroupId === g.id
                  const slug = slugOf(g)
                  const entry = slug ? entries[slug] : undefined
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => onSelectGroup(active ? null : g.id)}
                      title={`${groupTitle(g)}${entry ? `\n${leaderTooltip(entry, periodLabel)}` : ''}`}
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
                        {stripPeriods.map((id) => {
                          const value = g[GROUP_PERIODS[id].field]
                          return (
                            <span key={id} className={cellClass(value)}>
                              {GROUP_PERIODS[id].label} {fmtCell(value, id === '1d' ? 1 : 0)}
                            </span>
                          )
                        })}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="hidden shrink-0 items-center justify-between gap-2 border-b border-terminal-border px-3 py-2 md:flex">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">
            Leading groups · Finviz live
          </h2>
          {loading && !meta ? (
            <p className="mt-0.5 text-[10px] font-normal normal-case tracking-normal text-terminal-dim">
              Loading…
            </p>
          ) : meta ? (
            <GroupsMetaLine meta={meta} />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <PeriodControl period={period} onChange={onPeriodChange} />
          <ResetButton onReset={onReset} />
        </div>
      </div>

      <div className="hidden min-h-0 flex-1 overflow-auto md:block">
        <table className="w-full table-fixed text-left text-xs" style={{ minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: widthOf('rank') }} />
            <col style={{ width: widthOf('name') }} />
            <col style={{ width: widthOf('leaders') }} />
            <col style={{ width: widthOf('d1') }} />
            <col style={{ width: widthOf('m1') }} />
            <col style={{ width: widthOf('m3') }} />
            <col style={{ width: widthOf('m6') }} />
          </colgroup>
          <thead className="sticky top-0 bg-terminal-elevated text-[10px] uppercase tracking-wide text-terminal-dim">
            <tr>
              <Th colKey="rank" width={widthOf('rank')} onResize={resizeColumn} sortKey="rank" sort={sort} onSort={onSort}>
                #
              </Th>
              <Th colKey="name" width={widthOf('name')} onResize={resizeColumn} sortKey="name" sort={sort} onSort={onSort}>
                Group
              </Th>
              <Th
                colKey="leaders"
                width={widthOf('leaders')}
                onResize={resizeColumn}
                align="right"
                sortKey="leaders"
                sort={sort}
                onSort={onSort}
                title={finviz ? LEADER_HELP : 'Members within 10% of 52-week high'}
              >
                Leaders
              </Th>
              <Th
                colKey="d1"
                width={widthOf('d1')}
                onResize={resizeColumn}
                align="right"
                sortKey="1d"
                sort={sort}
                onSort={onSort}
                emphasize={emph('d1')}
                title={finviz ? 'Finviz today change %' : undefined}
              >
                1D
              </Th>
              <Th
                colKey="m1"
                width={widthOf('m1')}
                onResize={resizeColumn}
                align="right"
                sortKey="1m"
                sort={sort}
                onSort={onSort}
                emphasize={emph('m1')}
                title={finviz ? 'Finviz 1-month performance' : 'Avg member ~21 trading-day return'}
              >
                1M
              </Th>
              <Th
                colKey="m3"
                width={widthOf('m3')}
                onResize={resizeColumn}
                align="right"
                sortKey="3m"
                sort={sort}
                onSort={onSort}
                emphasize={emph('m3')}
                title={finviz ? 'Finviz 13-week performance' : 'Avg member ~63 trading-day return'}
              >
                3M
              </Th>
              <Th
                colKey="m6"
                width={widthOf('m6')}
                onResize={resizeColumn}
                align="right"
                sortKey="6m"
                sort={sort}
                onSort={onSort}
                emphasize={emph('m6')}
                title={finviz ? 'Finviz 6-month performance' : 'Avg member ~126 trading-day return'}
              >
                6M
              </Th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2 py-4 text-center text-terminal-dim">
                  {loading ? 'Loading leading groups…' : 'No groups'}
                </td>
              </tr>
            ) : (
              sorted.map((g) => {
                const active = selectedGroupId === g.id
                const slug = slugOf(g)
                const entry = slug ? entries[slug] : undefined
                const leaders = leaderCell(
                  entry,
                  slug ? wantedSet.has(slug) : false,
                  periodLabel,
                  g.leaderCount,
                  finviz,
                )
                const peek = entry?.top5.slice(0, 2).map((row) => row.ticker) ?? []
                return (
                  <tr
                    key={g.id}
                    onClick={() => onSelectGroup(active ? null : g.id)}
                    title={groupTitle(g)}
                    className={`cursor-pointer border-t border-terminal-border/60 transition-colors hover:bg-terminal-elevated ${
                      active ? 'bg-terminal-blue/10' : ''
                    }`}
                  >
                    <td className="overflow-hidden px-2 py-1.5 font-mono text-terminal-dim">{g.rsRank}</td>
                    <td className="overflow-hidden px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <div className="min-w-0 flex-1 truncate font-medium text-terminal-fg">{g.name}</div>
                        {peek.length ? (
                          <span className="shrink-0 font-mono text-[9px] font-normal normal-case tracking-normal text-terminal-dim">
                            {peek.join(' ')}
                          </span>
                        ) : null}
                        {g.source === 'finviz' && slug ? (
                          <a
                            href={finvizScreenerHref(slug, order)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open Finviz screener"
                            aria-label={`Open Finviz screener for ${g.name}`}
                            className="inline-flex shrink-0 text-terminal-dim hover:text-terminal-blue"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <ExternalLink className="h-3 w-3" aria-hidden />
                          </a>
                        ) : null}
                      </div>
                      <div className="mt-0.5 h-1 w-full max-w-[120px] overflow-hidden rounded-full bg-terminal-border">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-terminal-green/80 to-terminal-blue/80"
                          style={{ width: `${Math.max(8, 100 - (g.rsRank - 1) * 10)}%` }}
                        />
                      </div>
                    </td>
                    <td
                      className="overflow-hidden px-2 py-1.5 text-right font-mono text-terminal-fg"
                      title={leaders.title}
                    >
                      {leaders.text}
                    </td>
                    <td className={`overflow-hidden px-2 py-1.5 text-right font-mono ${cellClass(g.dayPct)} ${emph('d1') ? 'bg-terminal-blue/10 font-semibold' : ''}`}>
                      {fmtCell(g.dayPct)}
                    </td>
                    <td className={`overflow-hidden px-2 py-1.5 text-right font-mono ${cellClass(g.perf1m)} ${emph('m1') ? 'bg-terminal-blue/10 font-semibold' : ''}`}>
                      {fmtCell(g.perf1m, 0)}
                    </td>
                    <td className={`overflow-hidden px-2 py-1.5 text-right font-mono ${cellClass(g.perf3m)} ${emph('m3') ? 'bg-terminal-blue/10 font-semibold' : ''}`}>
                      {fmtCell(g.perf3m, 0)}
                    </td>
                    <td className={`overflow-hidden px-2 py-1.5 text-right font-mono ${cellClass(g.perf6m)} ${emph('m6') ? 'bg-terminal-blue/10 font-semibold' : ''}`}>
                      {fmtCell(g.perf6m, 0)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

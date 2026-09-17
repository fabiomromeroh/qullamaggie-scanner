import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { EarningsStatus, IdeaFilters, IndustryGroup, SetupStage, SetupType } from '../types'
import { ALL_EARNINGS_STATUSES, ALL_SETUP_TYPES, DEFAULT_FILTERS } from '../types'
import { ALL_SETUP_STAGES, stageLabel } from '../lib/setupStage'

const FILTERS_EXPAND_KEY = 'qm-filters-expanded'

interface Props {
  filters: IdeaFilters
  onChange: (next: IdeaFilters) => void
  groups: IndustryGroup[]
  /** Compact top-band layout (no tall help blurb). */
  dense?: boolean
}

function countActiveFilters(filters: IdeaFilters): number {
  let n = 0
  if (filters.search.trim()) n++
  if (filters.minRvol !== DEFAULT_FILTERS.minRvol) n++
  if (filters.maxPctFromHigh !== DEFAULT_FILTERS.maxPctFromHigh) n++
  if (filters.groupId) n++
  if (filters.setupTypes.length !== ALL_SETUP_TYPES.length) n++
  const defaultStages = [...DEFAULT_FILTERS.stages].sort().join(',')
  const stages = [...filters.stages].sort().join(',')
  if (stages !== defaultStages) n++
  if (filters.requireSma50 !== DEFAULT_FILTERS.requireSma50) n++
  if (filters.requireSma10) n++
  if (filters.requireSma20) n++
  if (filters.earningsStatuses.length !== ALL_EARNINGS_STATUSES.length) n++
  if (filters.aPlusOnly) n++
  if (filters.hasCatalyst) n++
  return n
}

function readExpandedPreference(): boolean {
  try {
    const v = sessionStorage.getItem(FILTERS_EXPAND_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* ignore */
  }
  return false // collapsed by default on mobile
}

export function FiltersBar({ filters, onChange, groups, dense = false }: Props) {
  const [expanded, setExpanded] = useState(readExpandedPreference)
  const activeCount = useMemo(() => countActiveFilters(filters), [filters])

  useEffect(() => {
    try {
      sessionStorage.setItem(FILTERS_EXPAND_KEY, expanded ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [expanded])

  const toggleSetup = (s: SetupType) => {
    const has = filters.setupTypes.includes(s)
    const setupTypes = has
      ? filters.setupTypes.filter((x) => x !== s)
      : [...filters.setupTypes, s]
    onChange({ ...filters, setupTypes: setupTypes.length ? setupTypes : [...ALL_SETUP_TYPES] })
  }

  const toggleStage = (s: SetupStage) => {
    const has = filters.stages.includes(s)
    const stages = has ? filters.stages.filter((x) => x !== s) : [...filters.stages, s]
    onChange({
      ...filters,
      stages: stages.length ? stages : [...ALL_SETUP_STAGES],
    })
  }

  const toggleEarnings = (s: EarningsStatus) => {
    const has = filters.earningsStatuses.includes(s)
    const earningsStatuses = has
      ? filters.earningsStatuses.filter((x) => x !== s)
      : [...filters.earningsStatuses, s]
    onChange({
      ...filters,
      earningsStatuses: earningsStatuses.length
        ? earningsStatuses
        : [...ALL_EARNINGS_STATUSES],
    })
  }

  const reset = () =>
    onChange({
      ...DEFAULT_FILTERS,
      groupId: filters.groupId,
      setupTypes: [...ALL_SETUP_TYPES],
      stages: [...DEFAULT_FILTERS.stages],
      earningsStatuses: [...ALL_EARNINGS_STATUSES],
    })

  const filterBody = (
    <div className="flex max-h-[50vh] flex-wrap items-end gap-2 overflow-y-auto overscroll-contain sm:max-h-none sm:gap-3">
      <label className="flex min-w-[40%] flex-1 flex-col gap-0.5 text-[10px] text-terminal-dim sm:min-w-0 sm:flex-none">
        Search
        <input
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Ticker / name / tag"
          className="w-full min-w-[8rem] rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1.5 text-xs text-terminal-fg outline-none focus:border-terminal-blue sm:w-32 sm:py-1"
        />
      </label>

      <label className="flex flex-col gap-0.5 text-[10px] text-terminal-dim">
        Min RVOL
        <input
          type="number"
          min={0}
          step={0.1}
          value={filters.minRvol}
          onChange={(e) => onChange({ ...filters, minRvol: Number(e.target.value) || 0 })}
          className="w-16 rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1 font-mono text-xs text-terminal-fg outline-none focus:border-terminal-blue sm:w-20"
        />
      </label>

      <label className="flex flex-col gap-0.5 text-[10px] text-terminal-dim">
        Max % from highs
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={filters.maxPctFromHigh}
          onChange={(e) =>
            onChange({ ...filters, maxPctFromHigh: Number(e.target.value) || 0 })
          }
          className="w-20 rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1 font-mono text-xs text-terminal-fg outline-none focus:border-terminal-blue sm:w-24"
        />
      </label>

      <label className="flex flex-col gap-0.5 text-[10px] text-terminal-dim">
        Group
        <select
          value={filters.groupId ?? ''}
          onChange={(e) =>
            onChange({ ...filters, groupId: e.target.value || null })
          }
          className="min-w-[120px] rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1 text-xs text-terminal-fg outline-none focus:border-terminal-blue sm:min-w-[140px]"
        >
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-0.5 text-[10px] text-terminal-dim">
        Setup type
        <div className="flex flex-wrap gap-1">
          {ALL_SETUP_TYPES.map((s) => {
            const on = filters.setupTypes.includes(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleSetup(s)}
                className={`rounded px-2.5 py-1.5 text-[10px] min-h-8 ${
                  on
                    ? 'bg-terminal-blue/20 text-terminal-blue border border-terminal-blue/40'
                    : 'bg-terminal-bg text-terminal-dim border border-terminal-border'
                }`}
              >
                {s}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-0.5 text-[10px] text-terminal-dim">
        Setup stage
        <div className="flex flex-wrap gap-1">
          {ALL_SETUP_STAGES.map((s) => {
            const on = filters.stages.includes(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStage(s)}
                title={
                  s === 'watching'
                    ? 'Above 200 SMA, building base'
                    : s === 'coiled'
                      ? 'Tight days + near highs + MA surfer'
                      : 'Elevated RVOL / breakout-day heuristic'
                }
                className={`rounded px-2.5 py-1.5 text-[10px] min-h-8 ${
                  on
                    ? s === 'triggering'
                      ? 'bg-terminal-amber/20 text-terminal-amber border border-terminal-amber/40'
                      : s === 'coiled'
                        ? 'bg-terminal-purple/20 text-terminal-purple border border-terminal-purple/40'
                        : 'bg-terminal-blue/20 text-terminal-blue border border-terminal-blue/40'
                    : 'bg-terminal-bg text-terminal-dim border border-terminal-border'
                }`}
              >
                {stageLabel(s)}
              </button>
            )
          })}
        </div>
      </div>

      <label className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1.5 text-xs text-terminal-fg">
        <input
          type="checkbox"
          checked={filters.requireSma50}
          onChange={(e) => onChange({ ...filters, requireSma50: e.target.checked })}
          className="accent-terminal-green"
        />
        <span>Require 50 SMA</span>
      </label>

      <label className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1.5 text-xs text-terminal-fg">
        <input
          type="checkbox"
          checked={filters.requireSma10}
          onChange={(e) => onChange({ ...filters, requireSma10: e.target.checked })}
          className="accent-terminal-green"
        />
        <span>10MA Surfer</span>
      </label>

      <label className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1.5 text-xs text-terminal-fg">
        <input
          type="checkbox"
          checked={filters.requireSma20}
          onChange={(e) => onChange({ ...filters, requireSma20: e.target.checked })}
          className="accent-terminal-green"
        />
        <span>20MA Surfer</span>
      </label>

      <div className="flex flex-col gap-0.5 text-[10px] text-terminal-dim">
        Earnings
        <div className="flex flex-wrap gap-1">
          {ALL_EARNINGS_STATUSES.map((s) => {
            const on = filters.earningsStatuses.includes(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleEarnings(s)}
                title={
                  s === 'avoid'
                    ? 'Same day or next trading day — hard fail for entry'
                    : s === 'alert'
                      ? '~2 trading days out'
                      : 'Further out / none soon'
                }
                className={`rounded px-2.5 py-1.5 text-[10px] uppercase min-h-8 ${
                  on
                    ? s === 'avoid'
                      ? 'bg-terminal-red-dim text-terminal-red border border-terminal-red/40'
                      : s === 'alert'
                        ? 'bg-terminal-amber/20 text-terminal-amber border border-terminal-amber/40'
                        : 'bg-terminal-green/15 text-terminal-green border border-terminal-green/40'
                    : 'bg-terminal-bg text-terminal-dim border border-terminal-border'
                }`}
              >
                {s}
              </button>
            )
          })}
        </div>
      </div>

      <label className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1.5 text-xs text-terminal-fg">
        <input
          type="checkbox"
          checked={filters.aPlusOnly}
          onChange={(e) => onChange({ ...filters, aPlusOnly: e.target.checked })}
          className="accent-terminal-a-plus"
        />
        <span className="text-terminal-a-plus">A+ only</span>
      </label>

      <label className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1.5 text-xs text-terminal-fg">
        <input
          type="checkbox"
          checked={filters.hasCatalyst}
          onChange={(e) => onChange({ ...filters, hasCatalyst: e.target.checked })}
          className="accent-terminal-green"
        />
        Has catalyst
      </label>
    </div>
  )

  return (
    <section
      className={`rounded-lg border border-terminal-border bg-terminal-panel ${
        dense ? 'px-2.5 py-1' : 'px-3 py-2.5'
      }`}
    >
      {/* Mobile: one-row collapse toggle */}
      <div className="flex items-center justify-between gap-2 md:hidden">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-9 flex-1 items-center justify-between gap-2 rounded-md px-1 text-left"
          aria-expanded={expanded}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">
            Filters
            <span className="ml-1.5 font-mono normal-case tracking-normal text-terminal-dim">
              · {activeCount} active
            </span>
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-terminal-dim" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-terminal-dim" />
          )}
        </button>
        {expanded ? (
          <button
            type="button"
            className="shrink-0 px-2 text-[10px] text-terminal-dim hover:text-terminal-blue"
            onClick={reset}
          >
            Reset
          </button>
        ) : null}
      </div>

      {/* Desktop header */}
      <div className={`hidden items-center justify-between md:flex ${dense ? 'mb-1' : 'mb-2'}`}>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">
          Filters
        </h2>
        <button
          type="button"
          className="text-[10px] text-terminal-dim hover:text-terminal-blue"
          onClick={reset}
        >
          Reset
        </button>
      </div>

      {!dense ? (
        <p className="mb-2 hidden text-[10px] text-terminal-dim md:block">
          Hard gate: price must be above the daily{' '}
          <span className="font-mono text-terminal-green">200 SMA</span> (names below are never
          shown as setups · tag Below 200MA). Default stages:{' '}
          <span className="text-terminal-purple">coiled</span> +{' '}
          <span className="text-terminal-amber">triggering</span> (enable Watching to see
          base-builders).
        </p>
      ) : null}

      {/* Body: always on md+, toggle on mobile */}
      <div className={`${expanded ? 'mt-1.5 block' : 'hidden'} md:mt-0 md:block`}>
        {filterBody}
      </div>
    </section>
  )
}

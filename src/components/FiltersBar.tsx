import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { CatalystMeta, EarningsStatus, IdeaFilters, IndustryGroup, SetupStage, SetupType } from '../types'
import { ALL_EARNINGS_STATUSES, ALL_SETUP_TYPES, DEFAULT_FILTERS, MAX_EXTENSION_ADR50_PRESETS, NEAR_HIGHS_PRESETS } from '../types'
import {
  ABOVE_200_DMA_LABEL,
  ABOVE_200_DMA_TOOLTIP,
  countActiveFilters,
  resetFilters,
  SEARCH_POOL_NOTE,
  SHOW_ALL_SETUPS_LABEL,
  searchQuery,
} from '../lib/ideaFilters'
import { metricTipAttrs, type MetricId } from '../lib/metricDefinitions'
import { stageLabel } from '../lib/setupStage'
import { MetricTip } from './MetricTip'

const FILTERS_EXPAND_KEY = 'qm-filters-expanded'

const STAGE_CHIP_ORDER: SetupStage[] = ['watching', 'coiled', 'triggering']

const CHIP =
  'flex min-h-8 cursor-help items-center gap-1.5 rounded border px-2.5 py-1.5 text-[10px]'

function chipClass(on: boolean, tone: 'green' | 'blue' | 'amber' | 'purple' | 'red' | 'gold' | 'goldBright' | 'goldLite' = 'green'): string {
  if (!on) return `${CHIP} border-terminal-border bg-terminal-bg text-terminal-dim`
  if (tone === 'blue') return `${CHIP} border-terminal-blue/40 bg-terminal-blue/20 text-terminal-blue`
  if (tone === 'amber') return `${CHIP} border-terminal-amber/40 bg-terminal-amber/20 text-terminal-amber`
  if (tone === 'purple') return `${CHIP} border-terminal-purple/40 bg-terminal-purple/20 text-terminal-purple`
  if (tone === 'red') return `${CHIP} border-terminal-red/40 bg-terminal-red-dim text-terminal-red`
  if (tone === 'gold') return `${CHIP} border-terminal-a-plus/40 bg-terminal-a-plus/15 text-terminal-a-plus`
  if (tone === 'goldBright') return `${CHIP} border-terminal-a-plus-plus/70 bg-terminal-a-plus-plus/25 text-terminal-a-plus-plus`
  if (tone === 'goldLite') return `${CHIP} border-terminal-a-plus/30 bg-terminal-a-plus/10 text-terminal-a-plus/80`
  return `${CHIP} border-terminal-green/40 bg-terminal-green/15 text-terminal-green`
}

function earningsLabel(status: EarningsStatus): string {
  if (status === 'clear') return 'Clear'
  if (status === 'alert') return 'Alert'
  return 'Avoid'
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5" data-filter-group={label}>
      <span className="text-[10px] uppercase tracking-wide text-terminal-dim">{label}</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  )
}

function CheckChip({
  id,
  label,
  checked,
  onChange,
  tone = 'green',
}: {
  id: MetricId
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  tone?: 'green' | 'gold' | 'goldBright' | 'goldLite'
}) {
  return (
    <label {...metricTipAttrs(id)} className={chipClass(checked, tone)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-terminal-green"
      />
      <span>{label}</span>
    </label>
  )
}

interface Props {
  filters: IdeaFilters
  onChange: (next: IdeaFilters) => void
  /** Restores the scan defaults and the group-view baseline. */
  onReset?: () => void
  /** Clears the selected group and its stock payload. */
  onClearGroup?: () => void
  /**
   * Values treated as "not active" in the counter.
   * Normal scan uses DEFAULT_FILTERS. Group view uses GROUP_VIEW_DEFAULT_FILTERS.
   */
  baseline?: IdeaFilters
  groups: IndustryGroup[]
  /** Compact top-band layout (no tall help blurb). */
  dense?: boolean
  /** Lookup coverage for the active view. */
  catalystMeta?: CatalystMeta | null
  /** Ideas that pass every other filter but are still pending or unchecked. */
  uncheckedCount?: number
  /** Server ticker lookup while the search box looks like a symbol. */
  lookupStatus?: { symbol: string; state: 'loading' | 'not-found' } | null
}

function readExpandedPreference(): boolean {
  try {
    const v = sessionStorage.getItem(FILTERS_EXPAND_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* ignore */
  }
  return false
}

export function FiltersBar({
  filters,
  onChange,
  onReset,
  onClearGroup,
  baseline = DEFAULT_FILTERS,
  groups,
  dense = false,
  catalystMeta = null,
  uncheckedCount = 0,
  lookupStatus = null,
}: Props) {
  const [expanded, setExpanded] = useState(readExpandedPreference)
  const activeCount = useMemo(
    () => countActiveFilters(filters, baseline),
    [filters, baseline],
  )

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
      stages: stages.length ? stages : [...STAGE_CHIP_ORDER],
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

  const reset = () => {
    if (onReset) {
      onReset()
      return
    }
    onChange(resetFilters(filters, baseline))
  }

  const clearGroup = () => {
    if (onClearGroup) {
      onClearGroup()
      return
    }
    onChange({ ...filters, groupId: null })
  }

  const filterBody = (
    <div className="flex max-h-[50vh] flex-wrap items-end gap-2 overflow-y-auto overscroll-contain sm:max-h-none sm:gap-3">
      <FilterGroup label="Search">
        <label
          {...metricTipAttrs('filterSearch')}
          className="flex min-w-[8rem] cursor-help flex-col gap-0.5 text-[10px] text-terminal-dim"
        >
          <input
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Ticker / name / tag"
            aria-label="Search"
            className="w-full min-w-[8rem] rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1.5 text-xs text-terminal-fg outline-none focus:border-terminal-blue sm:w-32"
          />
        </label>
      </FilterGroup>

      <FilterGroup label="Group">
        <label {...metricTipAttrs('filterGroup')} className="flex cursor-help flex-col gap-0.5 text-[10px] text-terminal-dim">
          <select
            value={filters.groupId ?? ''}
            aria-label="Group"
            onChange={(e) => onChange({ ...filters, groupId: e.target.value || null })}
            className="min-h-8 min-w-[120px] rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1 text-[10px] text-terminal-fg outline-none focus:border-terminal-blue sm:min-w-[140px]"
          >
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        {filters.groupId ? (
          <button
            type="button"
            {...metricTipAttrs('filterGroup')}
            className={chipClass(false)}
            onClick={clearGroup}
          >
            Clear group
          </button>
        ) : null}
      </FilterGroup>

      <FilterGroup label="Numeric">
        <label {...metricTipAttrs('filterMinRvol')} className="flex cursor-help flex-col gap-0.5 text-[10px] text-terminal-dim">
          Min RVOL
          <input
            type="number"
            min={0}
            step={0.1}
            value={filters.minRvol}
            aria-label="Min RVOL"
            onChange={(e) => onChange({ ...filters, minRvol: Number(e.target.value) || 0 })}
            className="w-16 rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1 font-mono text-xs text-terminal-fg outline-none focus:border-terminal-blue sm:w-20"
          />
        </label>
        <label
          {...metricTipAttrs('filterMinDollarVol')}
          className="flex cursor-help flex-col gap-0.5 text-[10px] text-terminal-dim"
        >
          Min DolVol
          <span className="flex items-center gap-1">
            <span>$</span>
            <input
              type="number"
              min={0}
              step={1}
              value={Number.isFinite(filters.minAvgDollarVol) ? Math.round(filters.minAvgDollarVol / 1_000_000) : 0}
              aria-label="Min DolVol"
              onChange={(e) => {
                const raw = e.target.value.trim()
                const millions = raw === '' ? 0 : Number(raw)
                const next =
                  Number.isFinite(millions) && millions > 0 ? Math.round(millions * 1_000_000) : 0
                onChange({ ...filters, minAvgDollarVol: next })
              }}
              className="w-16 rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1 font-mono text-xs text-terminal-fg outline-none focus:border-terminal-blue sm:w-20"
            />
            <span>M</span>
          </span>
        </label>
        <label
          {...metricTipAttrs('filterMaxPctFromHigh')}
          className="flex cursor-help flex-col gap-0.5 text-[10px] text-terminal-dim"
        >
          Near highs ≤
          <select
            value={filters.maxPctFromHigh ?? ''}
            aria-label="Near highs ≤"
            onChange={(e) =>
              onChange({
                ...filters,
                maxPctFromHigh: e.target.value === '' ? null : Number(e.target.value),
              })
            }
            className="min-h-8 min-w-[88px] rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1 text-[10px] text-terminal-fg outline-none focus:border-terminal-blue"
          >
            <option value="">Any</option>
            {NEAR_HIGHS_PRESETS.map((t) => (
              <option key={t} value={t}>
                {t}%
              </option>
            ))}
          </select>
        </label>
        <label
          {...metricTipAttrs('filterMaxExtensionAdr50')}
          className="flex cursor-help flex-col gap-0.5 text-[10px] text-terminal-dim"
        >
          Max ADR extension from 50 SMA
          <select
            value={filters.maxExtensionAdr50 ?? ''}
            aria-label="Max ADR extension from 50 SMA"
            onChange={(e) =>
              onChange({
                ...filters,
                maxExtensionAdr50: e.target.value === '' ? null : Number(e.target.value),
              })
            }
            className="min-h-8 min-w-[120px] rounded border border-terminal-border-bright bg-terminal-bg px-2 py-1 text-[10px] text-terminal-fg outline-none focus:border-terminal-blue"
          >
            <option value="">Any</option>
            {MAX_EXTENSION_ADR50_PRESETS.map((t) => (
              <option key={t} value={t}>
                {t === 5 ? `< ${t} ADR` : `< ${t}`}
              </option>
            ))}
          </select>
        </label>
      </FilterGroup>

      <FilterGroup label="SMA">
        <CheckChip id="aboveSma10" label="> 10 SMA" checked={Boolean(filters.requireSma10)} onChange={(checked) => onChange({ ...filters, requireSma10: checked })} />
        <CheckChip id="aboveSma20" label="> 20 SMA" checked={Boolean(filters.requireSma20)} onChange={(checked) => onChange({ ...filters, requireSma20: checked })} />
        <CheckChip id="aboveSma50" label="> 50 SMA" checked={Boolean(filters.requireSma50)} onChange={(checked) => onChange({ ...filters, requireSma50: checked })} />
        <CheckChip
          id="aboveSma200"
          label={ABOVE_200_DMA_LABEL}
          checked={filters.requireAbove200 !== false}
          onChange={(checked) => onChange({ ...filters, requireAbove200: checked })}
        />
      </FilterGroup>

      <FilterGroup label="Surfer (ADR-based)">
        <CheckChip id="surfer10" label="10MA Surfer" checked={Boolean(filters.requireSurfer10)} onChange={(checked) => onChange({ ...filters, requireSurfer10: checked })} />
        <CheckChip id="surfer20" label="20MA Surfer" checked={Boolean(filters.requireSurfer20)} onChange={(checked) => onChange({ ...filters, requireSurfer20: checked })} />
        <CheckChip id="surfer50" label="50MA Surfer" checked={Boolean(filters.requireSurfer50)} onChange={(checked) => onChange({ ...filters, requireSurfer50: checked })} />
      </FilterGroup>

      <FilterGroup label="Tight consolidation">
        <CheckChip id="tightConsolidation" label="Tight consolidation" checked={Boolean(filters.requireTight)} onChange={(checked) => onChange({ ...filters, requireTight: checked })} />
      </FilterGroup>

      <FilterGroup label="Stage">
        {STAGE_CHIP_ORDER.map((s) => {
          const on = filters.stages.includes(s)
          const tone = s === 'triggering' ? 'amber' : s === 'coiled' ? 'purple' : 'blue'
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStage(s)}
              {...metricTipAttrs(s === 'watching' ? 'stageWatching' : s === 'coiled' ? 'stageCoiled' : 'stageTriggering')}
              className={`${chipClass(on, tone)}${filters.showAllSetups ? ' opacity-40' : ''}`}
            >
              {stageLabel(s)}
            </button>
          )
        })}
      </FilterGroup>

      <FilterGroup label="Setup type">
        {ALL_SETUP_TYPES.map((s) => {
          const on = filters.setupTypes.includes(s)
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleSetup(s)}
              {...metricTipAttrs(
                s === 'Range Breakout' ? 'setupRangeBreakout' : s === 'Episodic Pivot' ? 'setupEpisodicPivot' : 'setupContinuation',
              )}
              className={`${chipClass(on, 'blue')}${filters.showAllSetups ? ' opacity-40' : ''}`}
            >
              {s}
            </button>
          )
        })}
        <label
          {...metricTipAttrs('filterShowAllSetups')}
          className={chipClass(Boolean(filters.showAllSetups), 'blue')}
        >
          <input
            type="checkbox"
            checked={Boolean(filters.showAllSetups)}
            onChange={(e) => onChange({ ...filters, showAllSetups: e.target.checked })}
            className="accent-terminal-green"
          />
          <span>{SHOW_ALL_SETUPS_LABEL}</span>
        </label>
      </FilterGroup>

      <FilterGroup label="Earnings">
        {ALL_EARNINGS_STATUSES.map((s) => {
          const on = filters.earningsStatuses.includes(s)
          const tone = s === 'avoid' ? 'red' : s === 'alert' ? 'amber' : 'green'
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleEarnings(s)}
              {...metricTipAttrs(s === 'avoid' ? 'earningsAvoid' : s === 'alert' ? 'earningsAlert' : 'earningsClear')}
              className={chipClass(on, tone)}
            >
              {earningsLabel(s)}
            </button>
          )
        })}
      </FilterGroup>

      <FilterGroup label="Other">
        <CheckChip
          id="qualityA"
          label="A"
          tone="goldLite"
          checked={filters.requireA}
          onChange={(checked) => onChange({ ...filters, requireA: checked })}
        />
        <CheckChip
          id="aPlus"
          label="A+"
          tone="gold"
          checked={filters.requireAPlus}
          onChange={(checked) => onChange({ ...filters, requireAPlus: checked })}
        />
        <CheckChip
          id="aPlusPlus"
          label="A++"
          tone="goldBright"
          checked={Boolean(filters.requireAPlusPlus)}
          onChange={(checked) => onChange({ ...filters, requireAPlusPlus: checked })}
        />
        <label {...metricTipAttrs('hasCatalyst')} className={chipClass(filters.hasCatalyst, 'green')}>
          <input
            type="checkbox"
            checked={filters.hasCatalyst}
            onChange={(e) => onChange({ ...filters, hasCatalyst: e.target.checked })}
            className="accent-terminal-green"
          />
          <span>Has catalyst</span>
        </label>
      </FilterGroup>

      {searchQuery(filters) ? (
        <p className="w-full text-[10px] text-terminal-dim" {...metricTipAttrs('searchOverride')}>
          {SEARCH_POOL_NOTE}
        </p>
      ) : null}
      {lookupStatus?.state === 'loading' ? (
        <p className="w-full text-[10px] text-terminal-dim">Looking up {lookupStatus.symbol}…</p>
      ) : lookupStatus?.state === 'not-found' ? (
        <p className="w-full text-[10px] text-terminal-dim">{lookupStatus.symbol} not found</p>
      ) : null}

      {catalystMeta ? (
        <p className="w-full text-[10px] text-terminal-dim" data-catalyst-coverage>
          Catalyst: checked {catalystMeta.checked} of {catalystMeta.candidates} candidates
          {filters.hasCatalyst && uncheckedCount > 0 ? ` · ${uncheckedCount} ideas not yet checked` : ''}
        </p>
      ) : filters.hasCatalyst && uncheckedCount > 0 ? (
        <p className="w-full text-[10px] text-terminal-dim" data-catalyst-coverage>
          {uncheckedCount} ideas not yet checked
        </p>
      ) : null}
    </div>
  )

  return (
    <section
      className={`rounded-lg border border-terminal-border bg-terminal-panel ${
        dense ? 'px-2.5 py-1' : 'px-3 py-2.5'
      }`}
    >
      <div className="flex items-center justify-between gap-2 md:hidden">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-9 flex-1 items-center justify-between gap-2 rounded-md px-1 text-left"
          aria-expanded={expanded}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">
            Filters
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-terminal-dim" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-terminal-dim" />
          )}
        </button>
        <MetricTip id="filterActiveCount" className="shrink-0 font-mono text-[10px] normal-case tracking-normal text-terminal-dim">
          {activeCount} active
        </MetricTip>
        {expanded ? (
          <button
            type="button"
            {...metricTipAttrs('filterReset')}
            className="shrink-0 cursor-help px-2 text-[10px] text-terminal-dim hover:text-terminal-blue"
            onClick={reset}
          >
            Reset
          </button>
        ) : null}
      </div>

      <div className={`hidden items-center justify-between md:flex ${dense ? 'mb-1' : 'mb-2'}`}>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">
          Filters
          <MetricTip id="filterActiveCount" className="ml-1.5 font-mono text-[10px] normal-case tracking-normal text-terminal-dim">
            {activeCount} active
          </MetricTip>
        </h2>
        <button
          type="button"
          {...metricTipAttrs('filterReset')}
          className="cursor-help text-[10px] text-terminal-dim hover:text-terminal-blue"
          onClick={reset}
        >
          Reset
        </button>
      </div>

      {!dense ? (
        <p className="mb-2 hidden text-[10px] text-terminal-dim md:block">
          <span className="font-mono text-terminal-green">{ABOVE_200_DMA_LABEL}</span> is on by
          default. {ABOVE_200_DMA_TOOLTIP} Default stages:{' '}
          <span className="text-terminal-purple">Coiled</span> +{' '}
          <span className="text-terminal-amber">Triggering</span> (enable Watching to see
          base-builders). Group view starts with every stage. &gt; 10/20/50 SMA, Surfer, and
          Tight consolidation start off in group view.
        </p>
      ) : null}

      <div className={`${expanded ? 'mt-1.5 block' : 'hidden'} md:mt-0 md:block`}>
        {filterBody}
      </div>
    </section>
  )
}

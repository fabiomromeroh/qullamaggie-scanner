import { useMemo } from 'react'
import { FiltersBar } from './components/FiltersBar'
import { GroupStrength } from './components/GroupStrength'
import { Header } from './components/Header'
import { IdeasTable } from './components/IdeasTable'
import { MetricTipRoot } from './components/MetricTip'
import { ResizeHandle } from './components/ResizeHandle'
import { ScanStatsLine } from './components/ScanStatsLine'
import { SplitDetailSheet } from './components/SplitDetailSheet'
import { StatusBanner } from './components/StatusBanner'
import { WatchlistPanel } from './components/WatchlistPanel'
import { useDashboard } from './hooks/useDashboard'
import { groupViewFilterNote } from './lib/groupView'
import { countCatalystUnchecked } from './lib/ideaFilters'
import { useResizablePanels } from './hooks/useResizablePanels'
import { splitReservedLeft } from './lib/splitLayout'

export default function App() {
  const {
    data,
    loading,
    error,
    scanning,
    scanMessage,
    mode,
    filters,
    filtersBaseline,
    setFilters,
    resetFilters,
    filteredIdeas,
    selectedIdea,
    selectedTicker,
    setSelectedTicker,
    reload,
    userWatchlist,
    groups,
    groupsMeta,
    groupsLoading,
    period,
    setPeriod,
    resetGroup,
    retryGroup,
    showAllGroupStocks,
    groupView,
  } = useDashboard()

  const { widths: panelWidths, resizeGroups, resizeWatchlist } = useResizablePanels()

  const aPlusCount = filteredIdeas.filter((i) => i.isAPlus).length
  const coiledCount = filteredIdeas.filter((i) => i.setupStage === 'coiled').length
  const triggeringCount = filteredIdeas.filter((i) => i.setupStage === 'triggering').length
  const isLive = mode === 'live' && data?.source === 'live'
  const catalystMeta = groupView?.catalystMeta ?? data?.catalystMeta ?? null
  const catalystIdeas = groupView?.ideas ?? data?.ideas ?? []
  const uncheckedCatalysts = countCatalystUnchecked(catalystIdeas, filters, {
    groupView: Boolean(groupView),
  })

  const selectedGroupUnmatched = useMemo(() => {
    if (!data || !filters.groupId) return false
    // Finviz selection loads that group's screener into the table, not a name filter.
    if (groupsMeta?.source === 'finviz') return false
    const group = groups.find((g) => g.id === filters.groupId)
    if (!group) return true
    return !data.ideas.some((idea) => idea.groupId === group.id)
  }, [data, filters.groupId, groups, groupsMeta])

  const ideasByTicker = useMemo(() => {
    const map = new Map<string, (typeof filteredIdeas)[number]>()
    for (const idea of data?.ideas ?? []) {
      map.set(idea.ticker, idea)
    }
    return map
  }, [data?.ideas])

  const panelStyle = {
    ['--panel-groups' as string]: `${panelWidths.groups}px`,
    ['--panel-watchlist' as string]: `${panelWidths.watchlist}px`,
  }

  return (
    /* Mobile: min-h-dvh + document scroll. Desktop (lg): locked h-dvh panel layout. */
    <MetricTipRoot>
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <StatusBanner mode={mode} source={data?.source} error={error} scanning={scanning} scanMessage={scanMessage} />
      <Header
        asOf={data?.asOf ?? new Date().toISOString()}
        ideaCount={filteredIdeas.length}
        aPlusCount={aPlusCount}
        onRefresh={() => void reload({ refreshScan: true })}
        loading={loading}
        source={data?.source ?? (error ? 'live' : undefined)}
        marketRegime={data?.marketRegime}
        scanUniverseSize={data?.scanUniverseSize}
        stage1Count={data?.stage1Count}
        stage15Count={data?.stage15Count}
        shortlistCount={data?.shortlistCount}
        emergencyFallback={data?.emergencyFallback}
        coiledCount={coiledCount}
        triggeringCount={triggeringCount}
      />

      {data ? (
        <div className="shrink-0 border-b border-terminal-border bg-terminal-bg px-2 py-1 sm:px-3 sm:py-2">
          <FiltersBar
            filters={filters}
            baseline={filtersBaseline}
            onChange={setFilters}
            onReset={resetFilters}
            onClearGroup={resetGroup}
            groups={groups}
            dense
            catalystMeta={catalystMeta}
            uncheckedCount={uncheckedCatalysts}
          />
          <div className="mt-1.5 hidden flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-terminal-dim sm:flex">
            <span>
              Workflow: Stage1 liquid → Stage1.5 above 200+50 SMA → deep → coiled/triggering → pin.
              {' '}
              {catalystMeta
                ? `Catalyst: checked ${catalystMeta.checked} of ${catalystMeta.candidates} candidates.`
                : 'Catalyst lookup runs after the scan (48h window).'}
            </span>
            <ScanStatsLine data={data} />
          </div>
        </div>
      ) : null}

      <main className="mx-auto flex w-full max-w-none flex-1 flex-col p-2 sm:p-3 lg:min-h-0">
        {(loading || scanning) && !data ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-sm text-terminal-muted lg:py-0">
            <span>{scanMessage || 'Scanning US market…'}</span>
            <span className="text-xs text-terminal-dim">
              Free-tier cold start can take 30–60s while the background scan fills the cache.
            </span>
          </div>
        ) : data ? (
          <div className="dashboard-body flex-1 lg:min-h-0" style={panelStyle}>
            {/* Results first in DOM on mobile via CSS grid areas; groups stay above visually */}
            <aside className="dashboard-groups lg:h-full lg:min-h-0">
              <GroupStrength
                groups={groups}
                meta={groupsMeta}
                loading={groupsLoading}
                selectedGroupId={filters.groupId}
                onSelectGroup={(id) => setFilters({ ...filters, groupId: id })}
                onReset={resetGroup}
                period={period}
                onPeriodChange={setPeriod}
              />
            </aside>

            <ResizeHandle
              variant="panel"
              label="Resize leading groups panel"
              onDelta={resizeGroups}
            />

            <section className="dashboard-results flex min-w-0 flex-col lg:h-full lg:min-h-0">
              <IdeasTable
                ideas={filteredIdeas}
                selectedTicker={selectedTicker}
                onSelect={setSelectedTicker}
                source={data.source}
                isPinned={userWatchlist.isPinned}
                isOnWatchlist={userWatchlist.isOnWatchlist}
                onTogglePin={userWatchlist.toggle}
                emptyMessage={
                  selectedGroupUnmatched
                    ? 'No scan ideas match this group.'
                    : groupView && !groupView.loading && !groupView.error
                      ? (groupViewFilterNote(
                          groupView.shownCount,
                          groupView.total,
                          groupView.hiddenCount,
                        ) ?? undefined)
                      : undefined
                }
                groupBanner={
                  groupView
                    ? {
                        label: groupView.label,
                        periodLabel: groupView.periodLabel,
                        loading: groupView.loading,
                        error: groupView.error,
                        stale: groupView.stale,
                        failed: groupView.failed,
                        parsedCount: groupView.parsedCount,
                        onReset: resetGroup,
                        onRetry: retryGroup,
                        onShowAll: showAllGroupStocks,
                        shownCount: groupView.shownCount,
                        hiddenCount: groupView.hiddenCount,
                        total: groupView.total,
                        source: groupView.source,
                        membershipGeneratedAt: groupView.membershipGeneratedAt,
                        membershipStale: groupView.membershipStale,
                      }
                    : null
                }
                finvizPerf={groupView?.finvizPerf ?? null}
              />
            </section>

            <ResizeHandle
              variant="panel"
              label="Resize Watchlist panel"
              invert
              onDelta={resizeWatchlist}
            />

            <aside className="dashboard-watchlist lg:h-full lg:min-h-0">
              <WatchlistPanel
                tickers={userWatchlist.tickers}
                ideasByTicker={ideasByTicker}
                selectedTicker={selectedTicker}
                onSelect={setSelectedTicker}
                onRemove={userWatchlist.remove}
                onAdd={userWatchlist.addFromInput}
                onClearAll={userWatchlist.clearAll}
                onUndoClear={userWatchlist.undoClear}
                feedback={userWatchlist.feedback}
                undoCount={userWatchlist.undoCount}
                regimeDowntrend={data.marketRegime?.stDirection === 'Downtrend'}
              />
            </aside>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-terminal-border bg-terminal-panel p-8 text-center">
            <p className="text-sm font-medium text-terminal-red">Could not load live data</p>
            <p className="max-w-lg text-xs text-terminal-muted">
              {error ?? 'All market providers failed. No demo rows were loaded.'}
            </p>
            <button
              type="button"
              onClick={() => void reload({ refreshScan: true })}
              disabled={loading}
              className="rounded-md border border-terminal-border-bright bg-terminal-elevated px-3 py-1.5 text-xs text-terminal-fg hover:border-terminal-blue disabled:opacity-50"
            >
              Retry
            </button>
          </div>
        )}
      </main>

      <footer className="shrink-0 border-t border-terminal-border px-2 py-1 text-center text-[9px] text-terminal-dim sm:px-4 sm:py-1.5 sm:text-[10px]">
        {isLive
          ? 'Live market scan · Not investment advice · Qullamaggie / Kyle-style process reference only'
          : mode === 'demo'
            ? 'DEMO mode · Not investment advice · Qullamaggie / Kyle-style process reference only'
            : 'Not investment advice · Qullamaggie / Kyle-style process reference only'}
      </footer>

      {selectedIdea ? (
        <SplitDetailSheet
          idea={selectedIdea}
          tickers={filteredIdeas.map((idea) => idea.ticker)}
          onSelectTicker={setSelectedTicker}
          onClose={() => setSelectedTicker(null)}
          source={data?.source}
          reservedLeft={splitReservedLeft(panelWidths.groups)}
          isPinned={userWatchlist.isPinned}
          onTogglePin={userWatchlist.toggle}
        />
      ) : null}
    </div>
    </MetricTipRoot>
  )
}

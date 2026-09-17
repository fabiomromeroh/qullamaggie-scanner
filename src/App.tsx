import { useMemo } from 'react'
import { DetailDrawer } from './components/DetailDrawer'
import { FiltersBar } from './components/FiltersBar'
import { GroupStrength } from './components/GroupStrength'
import { Header } from './components/Header'
import { IdeasTable } from './components/IdeasTable'
import { StatusBanner } from './components/StatusBanner'
import { WatchlistPanel } from './components/WatchlistPanel'
import { useDashboard } from './hooks/useDashboard'

export default function App() {
  const {
    data,
    loading,
    error,
    mode,
    filters,
    setFilters,
    filteredIdeas,
    selectedIdea,
    selectedTicker,
    setSelectedTicker,
    reload,
    userWatchlist,
  } = useDashboard()

  const aPlusCount = filteredIdeas.filter((i) => i.isAPlus).length
  const coiledCount = filteredIdeas.filter((i) => i.setupStage === 'coiled').length
  const triggeringCount = filteredIdeas.filter((i) => i.setupStage === 'triggering').length
  const isLive = mode === 'live' && data?.source === 'live'

  const ideasByTicker = useMemo(() => {
    const map = new Map<string, (typeof filteredIdeas)[number]>()
    for (const idea of data?.ideas ?? []) {
      map.set(idea.ticker, idea)
    }
    return map
  }, [data?.ideas])

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <StatusBanner mode={mode} source={data?.source} error={error} />
      <Header
        asOf={data?.asOf ?? new Date().toISOString()}
        ideaCount={filteredIdeas.length}
        aPlusCount={aPlusCount}
        onRefresh={() => void reload()}
        loading={loading}
        source={data?.source ?? (error ? 'live' : undefined)}
        marketRegime={data?.marketRegime}
        scanUniverseSize={data?.scanUniverseSize}
        coiledCount={coiledCount}
        triggeringCount={triggeringCount}
      />

      {data ? (
        <div className="shrink-0 border-b border-terminal-border bg-terminal-bg px-2 py-1.5 sm:px-3 sm:py-2">
          <FiltersBar
            filters={filters}
            onChange={setFilters}
            groups={data.groups}
            dense
          />
          <div className="mt-1.5 hidden flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-terminal-dim sm:flex">
            <span>
              Workflow: scan → above 200 SMA → prefer above 50 → coiled/triggering → pin.
              Auto-add kyleScore ≥ {userWatchlist.autoAddMinScore}. Catalysts blank from APIs.
            </span>
            {data.scanUniverseSize != null ? (
              <span className="font-mono">
                Scan {data.scanHitCount ?? 0}/{data.scanUniverseSize} above 200 · below200{' '}
                {data.scanBelow200Count ?? 0} · fails {data.scanFailCount ?? 0}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <main className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col p-2 sm:p-3">
        {loading && !data ? (
          <div className="flex flex-1 items-center justify-center text-sm text-terminal-muted">
            Scanning live universe for Kyle / Qullamaggie setups…
          </div>
        ) : data ? (
          <div className="dashboard-body grid min-h-0 flex-1 gap-2 sm:gap-3">
            <aside className="dashboard-groups h-full min-h-0">
              <GroupStrength
                groups={data.groups}
                selectedGroupId={filters.groupId}
                onSelectGroup={(id) => setFilters({ ...filters, groupId: id })}
              />
            </aside>

            <section className="dashboard-results flex h-full min-h-0 min-w-0 flex-col">
              <IdeasTable
                ideas={filteredIdeas}
                selectedTicker={selectedTicker}
                onSelect={setSelectedTicker}
                source={data.source}
                isPinned={userWatchlist.isPinned}
                isOnWatchlist={userWatchlist.isOnWatchlist}
                onTogglePin={userWatchlist.toggle}
              />
            </section>

            <aside className="dashboard-watchlist h-full min-h-0">
              <WatchlistPanel
                entries={userWatchlist.entries}
                ideasByTicker={ideasByTicker}
                selectedTicker={selectedTicker}
                onSelect={setSelectedTicker}
                onTogglePin={userWatchlist.toggle}
                onRemove={userWatchlist.remove}
                autoAddMinScore={userWatchlist.autoAddMinScore}
                lastAutoAdded={userWatchlist.lastAutoAdded}
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
              onClick={() => void reload()}
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

      {selectedIdea && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 bg-black/40"
            aria-label="Close overlay"
            onClick={() => setSelectedTicker(null)}
          />
          <DetailDrawer
            idea={selectedIdea}
            onClose={() => setSelectedTicker(null)}
            source={data?.source}
          />
        </>
      )}
    </div>
  )
}

import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { TradingIdea } from '../types'
import { useWatchlistQuotes } from '../hooks/useWatchlistQuotes'
import { metricTipAttrs } from '../lib/metricDefinitions'
import { stageLabel } from '../lib/setupStage'
import {
  displayTickersNewestFirst,
  USER_WATCHLIST_CAP,
} from '../lib/userWatchlistStore'
import { fmtPct, fmtPrice, pctClass } from '../utils/format'
import { MetricTip } from './MetricTip'

const WATCHLIST_EXPAND_KEY = 'qm-watchlist-expanded'

interface Props {
  tickers: string[]
  ideasByTicker: Map<string, TradingIdea>
  selectedTicker: string | null
  onSelect: (ticker: string) => void
  onRemove: (ticker: string) => void
  onAdd: (raw: string) => void
  onClearAll: () => void
  onUndoClear: () => void
  feedback: string | null
  undoCount: number | null
  regimeDowntrend?: boolean
}

function readWatchlistExpanded(): boolean {
  try {
    const v = sessionStorage.getItem(WATCHLIST_EXPAND_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* ignore */
  }
  return false
}

function ScanDash({ id }: { id: 'setupStage' | 'kyleScore' | 'rvol' | 'adrPct' }) {
  return (
    <MetricTip id={id} className="text-terminal-dim">
      -
    </MetricTip>
  )
}

export function WatchlistPanel({
  tickers,
  ideasByTicker,
  selectedTicker,
  onSelect,
  onRemove,
  onAdd,
  onClearAll,
  onUndoClear,
  feedback,
  undoCount,
  regimeDowntrend,
}: Props) {
  const [expanded, setExpanded] = useState(readWatchlistExpanded)
  const [draft, setDraft] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const { quotes, retry } = useWatchlistQuotes(tickers, ideasByTicker)
  const displayed = displayTickersNewestFirst(tickers)

  useEffect(() => {
    try {
      sessionStorage.setItem(WATCHLIST_EXPAND_KEY, expanded ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [expanded])

  const showConfirmClear = confirmClear && tickers.length > 0

  function submitAdd(event?: FormEvent) {
    event?.preventDefault()
    const raw = draft
    if (!raw.trim()) return
    onAdd(raw)
    setDraft('')
    setConfirmClear(false)
  }

  function onDraftKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitAdd()
    }
  }

  const addForm = (
    <form onSubmit={submitAdd} className="flex items-start gap-1">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onDraftKey}
        rows={1}
        placeholder="NVDA, AMD"
        aria-label="Add tickers"
        {...metricTipAttrs('watchlistAdd')}
        className="min-h-8 w-full resize-y rounded border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-[11px] text-terminal-fg placeholder:text-terminal-dim focus:border-terminal-blue focus:outline-none"
      />
      <button
        type="submit"
        {...metricTipAttrs('watchlistAdd')}
        className="min-h-8 shrink-0 rounded border border-terminal-border-bright bg-terminal-elevated px-2 text-[11px] text-terminal-fg hover:border-terminal-blue"
      >
        Add
      </button>
    </form>
  )

  const clearRow = (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {showConfirmClear ? (
        <span className="text-[10px] text-terminal-amber">
          Clear all {tickers.length}?{' '}
          <button
            type="button"
            {...metricTipAttrs('watchlistClear')}
            onClick={() => {
              onClearAll()
              setConfirmClear(false)
            }}
            className="rounded px-1.5 py-0.5 font-medium text-terminal-red hover:bg-terminal-red-dim"
          >
            Yes
          </button>
          {' / '}
          <button
            type="button"
            onClick={() => setConfirmClear(false)}
            className="rounded px-1.5 py-0.5 text-terminal-muted hover:bg-terminal-elevated"
          >
            No
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={tickers.length === 0}
          {...metricTipAttrs('watchlistClear')}
          onClick={() => setConfirmClear(true)}
          className="rounded px-1.5 py-0.5 text-[10px] text-terminal-dim hover:bg-terminal-elevated hover:text-terminal-red disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear all
        </button>
      )}
    </div>
  )

  const statusLines = (
    <>
      {feedback ? (
        <p className="mt-1 text-[10px] text-terminal-amber">{feedback}</p>
      ) : null}
      {undoCount != null ? (
        <p className="mt-1 text-[10px] text-terminal-muted">
          Cleared {undoCount} ticker{undoCount === 1 ? '' : 's'} —{' '}
          <button
            type="button"
            {...metricTipAttrs('watchlistUndo')}
            onClick={onUndoClear}
            className="text-terminal-blue underline-offset-2 hover:underline"
          >
            Undo
          </button>
        </p>
      ) : null}
    </>
  )

  const hint = (
    <p className="mt-1 text-[10px] leading-snug text-terminal-dim">
      <MetricTip id="watchlistOrder">
        Newest first. Cap {USER_WATCHLIST_CAP}. This browser only.
      </MetricTip>
    </p>
  )

  const listBody = (
    <div className="lg:flex-1 lg:overflow-y-auto">
      {!displayed.length ? (
        <p className="px-3 py-6 text-center text-[11px] text-terminal-dim">
          Your watchlist is empty. Type tickers above (e.g. NVDA, AMD) or pin a row from
          the results table.
        </p>
      ) : (
        <ul className="divide-y divide-terminal-border/60">
          {displayed.map((ticker) => {
            const idea = ideasByTicker.get(ticker)
            const selected = selectedTicker === ticker
            const inScan = Boolean(idea)
            const quote = quotes[ticker] ?? (inScan ? undefined : { status: 'loading' as const })
            const stage = idea?.setupStage
            const price = idea?.price ?? (quote?.status === 'ok' ? quote.quote.price : null)
            const dayPct = idea?.dayPct ?? (quote?.status === 'ok' ? quote.quote.dayPct : null)
            return (
              <li
                key={ticker}
                className={`flex items-start gap-1 px-2 py-1.5 hover:bg-terminal-elevated/70 ${
                  selected ? 'bg-terminal-elevated ring-1 ring-inset ring-terminal-blue/40' : ''
                }`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  data-idea-ticker={ticker}
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onSelect(ticker)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    onSelect(ticker)
                  }}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <MetricTip id="ticker" className="font-mono text-xs font-semibold text-terminal-fg">
                      {ticker}
                    </MetricTip>
                    {!inScan ? (
                      <MetricTip
                        id="watchlistMissing"
                        className="rounded border border-terminal-border px-1 py-0.5 text-[9px] text-terminal-dim"
                      >
                        Not in scan
                      </MetricTip>
                    ) : null}
                    {stage ? (
                      <MetricTip
                        id={
                          stage === 'triggering'
                            ? 'stageTriggering'
                            : stage === 'coiled'
                              ? 'stageCoiled'
                              : 'stageWatching'
                        }
                        className={`rounded border px-1 py-0.5 text-[9px] ${
                          stage === 'triggering'
                            ? 'border-terminal-amber/40 bg-terminal-amber-dim text-terminal-amber'
                            : stage === 'coiled'
                              ? 'border-terminal-purple/40 bg-terminal-purple/10 text-terminal-purple'
                              : 'border-terminal-border text-terminal-dim'
                        }`}
                      >
                        {stageLabel(stage)}
                      </MetricTip>
                    ) : (
                      <ScanDash id="setupStage" />
                    )}
                  </div>
                  {inScan && idea ? (
                    <div className="mt-0.5 flex flex-wrap gap-2 font-mono text-[10px] text-terminal-muted">
                      <MetricTip id="price">{fmtPrice(idea.price)}</MetricTip>
                      <MetricTip id="dayPct" className={pctClass(idea.dayPct)}>
                        {fmtPct(idea.dayPct)}
                      </MetricTip>
                      <MetricTip id="kyleScore">★{idea.kyleScore}</MetricTip>
                      <MetricTip id="rvol">RVOL {idea.rvol.toFixed(1)}</MetricTip>
                      <MetricTip id="adrPct">ADR {idea.adrPct.toFixed(1)}</MetricTip>
                    </div>
                  ) : quote?.status === 'loading' ? (
                    <p className="mt-0.5 font-mono text-[10px] text-terminal-dim">
                      <MetricTip id="watchlistQuoteLoading">Loading...</MetricTip>
                    </p>
                  ) : quote?.status === 'nodata' ? (
                    <p className="mt-0.5 font-mono text-[10px] text-terminal-dim">
                      <MetricTip id="watchlistNoData">No data</MetricTip>
                    </p>
                  ) : quote?.status === 'error' ? (
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-terminal-dim">
                      <MetricTip id="watchlistQuoteUnavailable">Unavailable</MetricTip>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          retry(ticker)
                        }}
                        className="rounded px-1 text-terminal-blue hover:underline"
                      >
                        Retry
                      </button>
                    </p>
                  ) : (
                    <div className="mt-0.5 flex flex-wrap gap-2 font-mono text-[10px] text-terminal-muted">
                      <MetricTip id="price">
                        {price != null ? fmtPrice(price) : '—'}
                      </MetricTip>
                      {dayPct != null ? (
                        <MetricTip id="dayPct" className={pctClass(dayPct)}>
                          {fmtPct(dayPct)}
                        </MetricTip>
                      ) : (
                        <MetricTip id="dayPct" className="text-terminal-dim">
                          -
                        </MetricTip>
                      )}
                      <ScanDash id="kyleScore" />
                      <ScanDash id="rvol" />
                      <ScanDash id="adrPct" />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${ticker} from watchlist`}
                  {...metricTipAttrs('watchlistRemove')}
                  onClick={() => {
                    setConfirmClear(false)
                    onRemove(ticker)
                  }}
                  className="min-h-9 min-w-9 rounded p-2 text-terminal-dim hover:bg-terminal-bg hover:text-terminal-red"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  const headerBits = (
    <>
      {addForm}
      {hint}
      {clearRow}
      {statusLines}
      {regimeDowntrend ? (
        <p className="mt-1 text-[10px] text-terminal-amber">
          <MetricTip id="marketRegimeWarn">
            QQQ ST Downtrend — new breakouts deprioritized (soft warn).
          </MetricTip>
        </p>
      ) : null}
    </>
  )

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-terminal-border bg-terminal-panel lg:h-full lg:min-h-0">
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-9 w-full items-center justify-between gap-2 border-b border-terminal-border px-3 py-2 text-left"
          aria-expanded={expanded}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">
            Watchlist
            <span className="ml-1.5 font-mono normal-case tracking-normal text-terminal-dim">
              · {tickers.length}
            </span>
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-terminal-dim" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-terminal-dim" />
          )}
        </button>
        {expanded ? (
          <>
            <div className="border-b border-terminal-border px-3 py-1.5">{headerBits}</div>
            {listBody}
          </>
        ) : null}
      </div>

      <div className="hidden h-full min-h-0 flex-col lg:flex">
        <div className="border-b border-terminal-border px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">
              Watchlist
            </h2>
            <span className="font-mono text-[10px] text-terminal-dim">{tickers.length}</span>
          </div>
          <div className="mt-2">{headerBits}</div>
        </div>
        {listBody}
      </div>
    </section>
  )
}

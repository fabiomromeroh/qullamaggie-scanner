import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, X } from 'lucide-react'
import { useSplitLayout } from '../hooks/useSplitLayout'
import { escClosesSheet, isTypingTarget } from '../lib/splitLayout'
import { stepTickerIndex, tickerListPosition } from '../lib/tickerListNav'
import type { TradingIdea } from '../types'
import type { IdeaGroupRank } from '../lib/groupPeriod'
import { DetailDrawer } from './DetailDrawer'
import { ResizeHandle } from './ResizeHandle'

const DailyChartPanel = lazy(() => import('./DailyChartPanel'))

interface Props {
  idea: TradingIdea
  /** Tickers in the order currently shown in the results table. */
  tickers: readonly string[]
  onSelectTicker: (ticker: string) => void
  onClose: () => void
  source?: 'live' | 'demo'
  /** Pixels that stay visible to the left of the sheet (groups + results strip). */
  reservedLeft: number
  isPinned?: (ticker: string) => boolean
  onTogglePin?: (ticker: string) => void
  /** Selected idea's group rank on the Leading groups period. */
  groupRank?: IdeaGroupRank | null
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function visibleIdeaRow(ticker: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const nodes = document.querySelectorAll<HTMLElement>(`[data-idea-ticker="${cssEscape(ticker)}"]`)
  for (const el of nodes) {
    if (el.getClientRects().length > 0) return el
  }
  return null
}

export function SplitDetailSheet({
  idea,
  tickers,
  onSelectTicker,
  onClose,
  source = 'live',
  reservedLeft,
  isPinned,
  onTogglePin,
  groupRank,
}: Props) {
  const [maximized, setMaximized] = useState(false)
  const { sheet, panel, resizeSheetEdge, resizeDivider } = useSplitLayout(reservedLeft, maximized)

  const tickersRef = useRef(tickers)
  const tickerRef = useRef(idea.ticker)
  const onCloseRef = useRef(onClose)
  const onSelectRef = useRef(onSelectTicker)

  useEffect(() => {
    tickersRef.current = tickers
    tickerRef.current = idea.ticker
    onCloseRef.current = onClose
    onSelectRef.current = onSelectTicker
  }, [tickers, idea.ticker, onClose, onSelectTicker])

  const close = () => {
    const ticker = idea.ticker
    onClose()
    requestAnimationFrame(() => {
      visibleIdeaRow(ticker)?.focus()
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return
        if (!escClosesSheet(e.target)) return
        e.preventDefault()
        const ticker = tickerRef.current
        onCloseRef.current()
        requestAnimationFrame(() => {
          visibleIdeaRow(ticker)?.focus()
        })
        return
      }
      if (
        e.key !== 'ArrowUp' &&
        e.key !== 'ArrowDown' &&
        e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowRight'
      ) {
        return
      }
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (isTypingTarget(e.target)) return
      const direction: 1 | -1 = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
      const idx = stepTickerIndex(tickersRef.current, tickerRef.current, direction)
      if (idx < 0) return
      e.preventDefault()
      const next = tickersRef.current[idx]
      if (!next || next === tickerRef.current) return
      tickerRef.current = next
      onSelectRef.current(next)
      visibleIdeaRow(next)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    const mq = window.matchMedia('(max-width: 1023px)')
    const apply = () => {
      const locked = mq.matches
      root.classList.toggle('qm-detail-open', locked)
      body.classList.toggle('qm-detail-open', locked)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => {
      mq.removeEventListener('change', apply)
      root.classList.remove('qm-detail-open')
      body.classList.remove('qm-detail-open')
    }
  }, [])

  return (
    <aside
      className={`qm-split-sheet${maximized ? ' qm-split-sheet--max' : ''}`}
      style={{
        ['--split-sheet' as string]: `${sheet}px`,
        ['--split-panel' as string]: `${panel}px`,
      }}
      role="dialog"
      aria-modal="false"
      aria-label={`${idea.ticker} chart and details`}
    >
      <div className="flex w-full min-w-0 flex-col lg:min-h-0 lg:flex-1 lg:flex-row">
        {maximized ? null : (
          <ResizeHandle
            variant="panel"
            label="Resize detail sheet"
            onDelta={resizeSheetEdge}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
          <header className="qm-split-header sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-terminal-border bg-terminal-panel px-3 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                {tickers.length > 1 ? (
                  <>
                    <button
                      type="button"
                      aria-label="Previous ticker"
                      disabled={tickerListPosition(tickers, idea.ticker).index <= 0}
                      className="rounded px-1 py-0.5 text-terminal-dim hover:bg-terminal-elevated hover:text-terminal-fg disabled:opacity-30"
                      onClick={() => {
                        const idx = stepTickerIndex(tickers, idea.ticker, -1)
                        if (idx < 0) return
                        const next = tickers[idx]
                        if (next) onSelectTicker(next)
                      }}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next ticker"
                      disabled={
                        tickerListPosition(tickers, idea.ticker).index >= tickers.length - 1
                      }
                      className="rounded px-1 py-0.5 text-terminal-dim hover:bg-terminal-elevated hover:text-terminal-fg disabled:opacity-30"
                      onClick={() => {
                        const idx = stepTickerIndex(tickers, idea.ticker, 1)
                        if (idx < 0) return
                        const next = tickers[idx]
                        if (next) onSelectTicker(next)
                      }}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                ) : null}
                <div className="truncate font-mono text-base font-bold text-terminal-fg">
                  {idea.ticker}
                </div>
                {tickers.length > 1 && tickerListPosition(tickers, idea.ticker).index >= 0 ? (
                  <span className="shrink-0 font-mono text-[11px] text-terminal-dim">
                    {tickerListPosition(tickers, idea.ticker).index + 1} / {tickers.length}
                  </span>
                ) : null}
              </div>
              <div className="truncate text-xs text-terminal-muted">{idea.name}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="hidden min-h-11 min-w-11 items-center justify-center rounded text-terminal-dim hover:bg-terminal-elevated hover:text-terminal-fg lg:inline-flex"
                aria-pressed={maximized}
                aria-label={maximized ? 'Restore chart size' : 'Maximize chart'}
                title={maximized ? 'Restore chart size' : 'Maximize chart'}
                onClick={() => setMaximized((open) => !open)}
              >
                {maximized ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-terminal-dim hover:bg-terminal-elevated hover:text-terminal-fg"
                aria-label="Close chart and details"
                onClick={close}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div className="qm-split-body">
            <div className="qm-split-chart">
              <Suspense
                fallback={
                  <div className="flex h-full min-h-[280px] flex-1 items-center justify-center bg-terminal-bg text-sm text-terminal-muted">
                    Loading chart…
                  </div>
                }
              >
                <DailyChartPanel
                  symbol={idea.ticker}
                  name={idea.name}
                  price={idea.price}
                  dayPct={idea.dayPct}
                />
              </Suspense>
            </div>
            <ResizeHandle
              variant="panel"
              label="Resize chart and details"
              onDelta={resizeDivider}
            />
            <div className="qm-split-panel">
              <DetailDrawer
                idea={idea}
                source={source}
                isPinned={isPinned?.(idea.ticker) ?? false}
                onTogglePin={onTogglePin ? () => onTogglePin(idea.ticker) : undefined}
                groupRank={groupRank}
              />
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

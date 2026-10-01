import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { useSplitLayout } from '../hooks/useSplitLayout'
import { escClosesSheet, isTypingTarget, nextTickerIndex } from '../lib/splitLayout'
import type { TradingIdea } from '../types'
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
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (isTypingTarget(e.target)) return
      const direction = e.key === 'ArrowDown' ? 1 : -1
      const idx = nextTickerIndex(tickersRef.current, tickerRef.current, direction)
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
              <div className="truncate font-mono text-base font-bold text-terminal-fg">
                {idea.ticker}
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
              <DetailDrawer idea={idea} source={source} />
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

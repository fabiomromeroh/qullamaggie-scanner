import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { TickerModalContext, useTickerModal, type TickerModalTarget } from '../lib/tickerModalContext'

const DailyChartPanel = lazy(() => import('./DailyChartPanel'))


/** Clickable ticker that opens the shared ticker modal. */
export function TickerLink({ ticker, name, className = '' }: { ticker: string; name?: string; className?: string }) {
  const { open } = useTickerModal()
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        open({ ticker, name })
      }}
      className={`font-mono font-semibold text-terminal-blue hover:underline ${className}`}
    >
      {ticker}
    </button>
  )
}

function TickerModalBody({ target, onClose }: { target: TickerModalTarget; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-2 sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${target.ticker} details`}
        className="flex h-[85dvh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-terminal-border-bright bg-terminal-panel shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-terminal-border px-3 py-2">
          <span className="font-mono text-base font-bold text-terminal-fg">{target.ticker}</span>
          {target.name ? <span className="truncate text-xs text-terminal-muted">{target.name}</span> : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded px-2 py-0.5 text-sm text-terminal-muted hover:bg-terminal-elevated hover:text-terminal-fg"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <Suspense fallback={<div className="p-4 text-xs text-terminal-muted">Loading chart…</div>}>
            <DailyChartPanel symbol={target.ticker} name={target.name} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

export function TickerModalProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<TickerModalTarget | null>(null)
  const open = useCallback((t: TickerModalTarget) => setTarget({ ...t, ticker: t.ticker.toUpperCase() }), [])
  const close = useCallback(() => setTarget(null), [])
  const value = useMemo(() => ({ open }), [open])
  return (
    <TickerModalContext.Provider value={value}>
      {children}
      {target ? <TickerModalBody target={target} onClose={close} /> : null}
    </TickerModalContext.Provider>
  )
}

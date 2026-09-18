import { useEffect, useRef, useState } from 'react'
import { Check, ClipboardCopy, X } from 'lucide-react'
import {
  copyTextToClipboard,
  formatTickersForTradingView,
} from '../lib/tradingViewExport'

interface Props {
  tickers: string[]
}

export function CopyForTradingView({ tickers }: Props) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const [fallbackText, setFallbackText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const empty = tickers.length === 0
  const pasteText = formatTickersForTradingView(tickers)

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    }
  }, [])

  useEffect(() => {
    if (fallbackOpen && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [fallbackOpen])

  function showFeedback(msg: string) {
    setFeedback(msg)
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setFeedback(null), 2200)
  }

  async function handleCopy() {
    if (empty) {
      showFeedback('Nothing to export')
      return
    }
    const ok = await copyTextToClipboard(pasteText)
    if (ok) {
      showFeedback(`Copied ${tickers.length} ticker${tickers.length === 1 ? '' : 's'}`)
      return
    }
    setFallbackText(pasteText)
    setFallbackOpen(true)
  }

  function selectAllFallback() {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.select()
  }

  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        {feedback ? (
          <span
            className="hidden max-w-[9rem] truncate font-mono text-[10px] text-terminal-green sm:inline"
            role="status"
          >
            {feedback.startsWith('Copied') ? (
              <span className="inline-flex items-center gap-1">
                <Check className="h-3 w-3 shrink-0" />
                {feedback}
              </span>
            ) : (
              feedback
            )}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void handleCopy()}
          disabled={empty}
          title={
            empty
              ? 'Nothing to export'
              : `Copy ${tickers.length} ticker${tickers.length === 1 ? '' : 's'} for TradingView (comma-separated)`
          }
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-terminal-border-bright bg-terminal-elevated px-2 py-1 text-[10px] text-terminal-muted hover:border-terminal-blue hover:text-terminal-fg disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9 sm:gap-1.5 sm:px-2.5 sm:text-[11px]"
        >
          <ClipboardCopy className="h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-nowrap">
            <span className="sm:hidden">Export</span>
            <span className="hidden sm:inline">Copy for TradingView</span>
          </span>
        </button>
        {feedback ? (
          <span className="font-mono text-[10px] text-terminal-green sm:hidden" role="status">
            {feedback.startsWith('Copied') ? `✓ ${tickers.length}` : '!'}
          </span>
        ) : null}
      </div>

      {fallbackOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tv-export-title"
        >
          <div className="w-full max-w-md rounded-lg border border-terminal-border bg-terminal-panel shadow-xl">
            <div className="flex items-center justify-between border-b border-terminal-border px-3 py-2">
              <h3 id="tv-export-title" className="text-xs font-semibold text-terminal-fg">
                Copy tickers for TradingView
              </h3>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setFallbackOpen(false)}
                className="rounded p-1.5 text-terminal-muted hover:text-terminal-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2 p-3">
              <p className="text-[11px] text-terminal-muted">
                Clipboard blocked — select all and copy manually. Paste into a TradingView
                watchlist ({tickers.length} ticker{tickers.length === 1 ? '' : 's'},
                comma-separated).
              </p>
              <textarea
                ref={textareaRef}
                readOnly
                value={fallbackText}
                rows={4}
                className="w-full resize-y rounded border border-terminal-border bg-terminal-elevated px-2 py-1.5 font-mono text-xs text-terminal-fg outline-none focus:border-terminal-blue"
              />
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={selectAllFallback}
                  className="min-h-9 rounded-md border border-terminal-border-bright bg-terminal-elevated px-3 py-1.5 text-xs text-terminal-fg hover:border-terminal-blue"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setFallbackOpen(false)}
                  className="min-h-9 rounded-md border border-terminal-border px-3 py-1.5 text-xs text-terminal-muted hover:text-terminal-fg"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

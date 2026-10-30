import type { TickerModalTarget } from '../lib/tickerModalContext'
import { ResizeHandle } from './ResizeHandle'
import { TickerDetail } from './TickerModal'

/** Right-hand Market Pulse chart. Fills leftover width. Closes only from the header X; it is not a modal. */
export function DockedTickerPanel({
  target,
  onResize,
  onClose,
}: {
  target: TickerModalTarget
  onResize: (deltaX: number) => void
  onClose: () => void
}) {
  return (
    <div className="hidden h-full min-h-0 min-w-[420px] flex-1 lg:flex">
      <ResizeHandle variant="panel" label="Resize chart panel" onDelta={onResize} />
      <aside
        aria-label={`${target.ticker} details`}
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-terminal-border bg-terminal-panel"
      >
        <TickerDetail key={target.ticker} target={target} onClose={onClose} />
      </aside>
    </div>
  )
}

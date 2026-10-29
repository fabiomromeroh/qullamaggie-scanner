import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DockedTickerPanel } from '../components/DockedTickerPanel'
import { EtfTable } from '../components/pulse/EtfTable'
import { ThemeTracker } from '../components/pulse/ThemeTracker'
import { TickerTape } from '../components/pulse/TickerTape'
import { subFromHash } from '../lib/modules'
import { TickerModalContext, useTickerModal, type TickerModalTarget } from '../lib/tickerModalContext'

const PULSE_TABS = [
  { id: 'themes', label: 'Theme Tracker' },
  { id: 'group', label: 'Group ETFs' },
  { id: 'sectors', label: 'S&P Sectors' },
  { id: 'equal', label: 'Equal Weight' },
  { id: 'country', label: 'Country ETFs' },
] as const

type PulseTab = (typeof PULSE_TABS)[number]['id']

/** Tailwind `lg`. Below this the dock falls back to the centred ticker modal. */
const LG_MEDIA = '(min-width: 1024px)'
/** Matches `min-w-[420px]` on the docked chart. The grid keeps the rest only up to its content. */
const CHART_MIN_PX = 420
const GRID_MIN_PX = 220

function isLgUp(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(LG_MEDIA).matches
}

function clampGridWidth(width: number, parentWidth: number): number {
  const room = Math.floor(parentWidth - CHART_MIN_PX)
  if (room <= 0) return Math.max(0, Math.round(width))
  const min = Math.min(GRID_MIN_PX, room)
  return Math.min(room, Math.max(min, Math.round(width)))
}

function tabFromHash(): PulseTab {
  const sub = typeof window === 'undefined' ? null : subFromHash(window.location.hash)
  return PULSE_TABS.find((t) => t.id === sub)?.id ?? 'themes'
}

export function MarketPulseModule() {
  const parent = useTickerModal()
  const [wide, setWide] = useState(isLgUp)
  const [tab, setTab] = useState<PulseTab>(tabFromHash)
  const [docked, setDocked] = useState<TickerModalTarget | null>(null)
  /** null = grid sizes to the table. A number is the width chosen by dragging the split. */
  const [gridWidth, setGridWidth] = useState<number | null>(null)
  const splitRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const gridWidthRef = useRef<number | null>(null)

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const open = useCallback(
    (t: TickerModalTarget) => {
      const target = { ...t, ticker: t.ticker.toUpperCase() }
      if (isLgUp()) {
        parent.close()
        setDocked(target)
      } else {
        setDocked(null)
        parent.open(target)
      }
    },
    [parent],
  )

  useEffect(() => {
    const mq = window.matchMedia(LG_MEDIA)
    const onChange = () => {
      const next = mq.matches
      setWide(next)
      if (!next && docked) {
        parent.open(docked)
        gridWidthRef.current = null
        setGridWidth(null)
        setDocked(null)
      }
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [parent, docked])

  const select = (id: PulseTab) => {
    window.history.replaceState(null, '', `#pulse/${id}`)
    setTab(id)
  }
  const close = useCallback(() => {
    gridWidthRef.current = null
    setGridWidth(null)
    setDocked(null)
  }, [])
  const api = useMemo(() => ({ open, close }), [open, close])
  const resizeDock = useCallback((deltaX: number) => {
    const measured = gridRef.current?.getBoundingClientRect().width ?? 0
    const parent = splitRef.current?.getBoundingClientRect().width ?? 0
    if (gridWidthRef.current == null) gridWidthRef.current = measured
    const next = clampGridWidth(gridWidthRef.current + deltaX, parent || measured + CHART_MIN_PX)
    gridWidthRef.current = next
    setGridWidth(next)
  }, [])

  const dockOpen = Boolean(docked && wide)
  const table = tab === 'themes' ? <ThemeTracker /> : <EtfTable key={tab} list={tab} />

  return (
    <TickerModalContext.Provider value={api}>
      <div ref={splitRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          ref={gridRef}
          style={
            dockOpen
              ? {
                  maxWidth: `calc(100% - ${CHART_MIN_PX}px)`,
                  ...(gridWidth != null ? { width: gridWidth } : {}),
                }
              : undefined
          }
          className={
            dockOpen
              ? 'flex min-h-0 w-max min-w-0 shrink-0 flex-col overflow-hidden'
              : 'flex min-h-0 min-w-0 flex-1 flex-col'
          }
        >
          <div className={dockOpen ? 'w-0 min-w-full shrink-0 [contain:inline-size]' : undefined}>
            <TickerTape />
          </div>
          <div
            role="tablist"
            className={`flex shrink-0 gap-1 overflow-x-auto border-b border-terminal-border px-2 pt-1 ${
              dockOpen ? 'w-0 min-w-full [contain:inline-size]' : ''
            }`}
          >
            {PULSE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => select(t.id)}
                className={`whitespace-nowrap rounded-t px-3 py-1 text-xs ${
                  tab === t.id
                    ? 'border border-b-0 border-terminal-border-bright bg-terminal-elevated text-terminal-fg'
                    : 'text-terminal-muted hover:text-terminal-fg'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div
            className={
              dockOpen
                ? 'min-h-0 min-w-0 flex-1 overflow-x-auto bg-terminal-panel'
                : 'flex min-h-0 flex-1 flex-col bg-terminal-panel'
            }
          >
            {/* `contents` when undocked keeps the table mounted in the original flex column. */}
            <div className={dockOpen ? 'flex h-full w-max shrink-0 flex-col' : 'contents'}>{table}</div>
          </div>
          <footer
            className={`shrink-0 border-t border-terminal-border px-2 py-1 text-center text-[10px] text-terminal-dim ${
              dockOpen ? 'w-0 min-w-full overflow-hidden [contain:inline-size]' : ''
            }`}
          >
            Market Pulse · Finviz groups + Yahoo (unofficial, delayed) · Not investment advice
          </footer>
        </div>
        {dockOpen && docked ? (
          <DockedTickerPanel target={docked} onResize={resizeDock} onClose={close} />
        ) : null}
      </div>
    </TickerModalContext.Provider>
  )
}

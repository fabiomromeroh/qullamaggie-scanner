import { useEffect, useState } from 'react'
import { EtfTable } from '../components/pulse/EtfTable'
import { ThemeTracker } from '../components/pulse/ThemeTracker'
import { TickerTape } from '../components/pulse/TickerTape'
import { subFromHash } from '../lib/modules'

const PULSE_TABS = [
  { id: 'themes', label: 'Theme Tracker' },
  { id: 'group', label: 'Group ETFs' },
  { id: 'sectors', label: 'S&P Sectors' },
  { id: 'equal', label: 'Equal Weight' },
  { id: 'country', label: 'Country ETFs' },
] as const

type PulseTab = (typeof PULSE_TABS)[number]['id']

function tabFromHash(): PulseTab {
  const sub = typeof window === 'undefined' ? null : subFromHash(window.location.hash)
  return PULSE_TABS.find((t) => t.id === sub)?.id ?? 'themes'
}

export function MarketPulseModule() {
  const [tab, setTab] = useState<PulseTab>(tabFromHash)
  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const select = (id: PulseTab) => {
    window.history.replaceState(null, '', `#pulse/${id}`)
    setTab(id)
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TickerTape />
      <div role="tablist" className="flex shrink-0 gap-1 overflow-x-auto border-b border-terminal-border px-2 pt-1">
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
      <div className="flex min-h-0 flex-1 flex-col bg-terminal-panel">
        {tab === 'themes' ? <ThemeTracker /> : <EtfTable key={tab} list={tab} />}
      </div>
      <footer className="shrink-0 border-t border-terminal-border px-2 py-1 text-center text-[10px] text-terminal-dim">
        Market Pulse · Finviz groups + Yahoo (unofficial, delayed) · Not investment advice
      </footer>
    </div>
  )
}

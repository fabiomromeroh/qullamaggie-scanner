import { useEffect, useRef, useState } from 'react'
import { MetricTipRoot } from './components/MetricTip'
import { TickerModalProvider } from './components/TickerModal'
import { MODULES, moduleFromHash, type ModuleId } from './lib/modules'
import { BreadthModule } from './modules/BreadthModule'
import { MarketPulseModule } from './modules/MarketPulseModule'
import { ScannerModule } from './modules/ScannerModule'

function ModuleSwitcher({ active, onChange }: { active: ModuleId; onChange: (id: ModuleId) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const current = MODULES.find((m) => m.id === active) ?? MODULES[0]!
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded px-2 py-0.5 text-[13px] font-semibold text-terminal-fg hover:bg-terminal-elevated"
      >
        {current.label} <span className="text-terminal-dim">▾</span>
      </button>
      {open ? (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 min-w-40 rounded-md border border-terminal-border-bright bg-terminal-elevated py-1 shadow-lg"
        >
          {MODULES.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={m.id === active}
                onClick={() => {
                  onChange(m.id)
                  setOpen(false)
                }}
                className={`block w-full px-3 py-1 text-left text-xs hover:bg-terminal-panel ${
                  m.id === active ? 'text-terminal-blue' : 'text-terminal-fg'
                }`}
              >
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default function App() {
  const [active, setActive] = useState<ModuleId>(() =>
    typeof window === 'undefined' ? 'scanner' : moduleFromHash(window.location.hash),
  )
  // Scanner stays mounted once visited so its scan state survives module switches.
  const [scannerMounted, setScannerMounted] = useState(active === 'scanner')

  useEffect(() => {
    const onHash = () => {
      const next = moduleFromHash(window.location.hash)
      if (next === 'scanner') setScannerMounted(true)
      setActive(next)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const change = (id: ModuleId) => {
    const hash = MODULES.find((m) => m.id === id)?.hash ?? ''
    if (window.location.hash.split('/')[0] !== hash) window.location.hash = hash
    if (id === 'scanner') setScannerMounted(true)
    setActive(id)
  }

  return (
    <MetricTipRoot>
      <TickerModalProvider>
        <div className="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden">
          <nav className="flex shrink-0 items-center gap-2 border-b border-terminal-border bg-terminal-panel px-2 py-0.5">
            <ModuleSwitcher active={active} onChange={change} />
          </nav>
          {scannerMounted ? (
            <div className={active === 'scanner' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <ScannerModule />
            </div>
          ) : null}
          {active === 'pulse' ? <MarketPulseModule /> : null}
          {active === 'breadth' ? <BreadthModule /> : null}
        </div>
      </TickerModalProvider>
    </MetricTipRoot>
  )
}

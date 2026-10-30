import { metricTipAttrs } from '../lib/metricDefinitions'
import { useLiquidityFilters } from '../lib/liquidityFilters'

const CHIP =
  'flex min-h-8 cursor-help items-center gap-1.5 rounded border px-2.5 py-1.5 text-[10px]'

function chipClass(on: boolean): string {
  if (!on) return `${CHIP} border-terminal-border bg-terminal-bg text-terminal-dim`
  return `${CHIP} border-terminal-green/40 bg-terminal-green/15 text-terminal-green`
}

/** Always-visible Price / avg-vol / $vol chips. Shared localStorage state. */
export function LiquidityFilterBar({ className = '' }: { className?: string }) {
  const { filters, setFilters } = useLiquidityFilters()
  return (
    <div
      className={`flex flex-wrap items-center gap-1 ${className}`}
      data-liquidity-filters
    >
      <span className="mr-1 text-[10px] uppercase tracking-wide text-terminal-dim">
        Liquidity
      </span>
      <label {...metricTipAttrs('filterPriceGt5')} className={chipClass(filters.priceGt5)}>
        <input
          type="checkbox"
          checked={filters.priceGt5}
          onChange={(e) => setFilters({ ...filters, priceGt5: e.target.checked })}
          className="accent-terminal-green"
        />
        <span>Price &gt; $5</span>
      </label>
      <label {...metricTipAttrs('filterAvgVol100k')} className={chipClass(filters.avgVol100k)}>
        <input
          type="checkbox"
          checked={filters.avgVol100k}
          onChange={(e) => setFilters({ ...filters, avgVol100k: e.target.checked })}
          className="accent-terminal-green"
        />
        <span>Avg vol &gt; 100K</span>
      </label>
      <label {...metricTipAttrs('filterDollarVol20m')} className={chipClass(filters.dollarVol20m)}>
        <input
          type="checkbox"
          checked={filters.dollarVol20m}
          onChange={(e) => setFilters({ ...filters, dollarVol20m: e.target.checked })}
          className="accent-terminal-green"
        />
        <span>$Vol &gt; $20M</span>
      </label>
    </div>
  )
}

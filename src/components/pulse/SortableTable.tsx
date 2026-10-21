import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { compareNullable } from '../../lib/perfWindows'
import { fmtPct, pctClass } from '../../lib/pulseFormat'

export interface Column<T> {
  key: string
  label: string
  /** Numeric value used for sorting; percent columns are also rendered from it. */
  value?: (row: T) => number | null | undefined
  /** Text sort key for non-numeric columns. */
  text?: (row: T) => string
  render?: (row: T) => ReactNode
  pct?: boolean
  align?: 'left' | 'right'
  className?: string
}

export function SortableTable<T>({
  rows,
  columns,
  rowKey,
  defaultSort,
  renderExpanded,
  emptyText = 'No rows.',
}: {
  rows: readonly T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  defaultSort: { key: string; dir: 'asc' | 'desc' }
  renderExpanded?: (row: T) => ReactNode
  emptyText?: string
}) {
  const [sort, setSort] = useState(defaultSort)
  const [expanded, setExpanded] = useState<string | null>(null)

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return [...rows]
    return [...rows].sort((a, b) => {
      if (col.value) return compareNullable(col.value(a), col.value(b), sort.dir)
      if (col.text) {
        const cmp = col.text(a).localeCompare(col.text(b))
        return sort.dir === 'asc' ? cmp : -cmp
      }
      return 0
    })
  }, [rows, columns, sort])

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead className="sticky top-0 z-10 bg-terminal-panel">
          <tr className="border-b border-terminal-border text-[11px] uppercase tracking-wide text-terminal-dim">
            {renderExpanded ? <th className="w-6" /> : null}
            {columns.map((c) => {
              const active = sort.key === c.key
              const sortable = Boolean(c.value || c.text)
              return (
                <th
                  key={c.key}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`whitespace-nowrap px-2 py-1.5 font-medium ${
                    (c.align ?? (c.pct || c.value ? 'right' : 'left')) === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSort((s) =>
                          s.key === c.key
                            ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                            : { key: c.key, dir: c.value ? 'desc' : 'asc' },
                        )
                      }
                      className={`uppercase hover:text-terminal-fg ${active ? 'text-terminal-blue' : ''}`}
                    >
                      {c.label}
                      {active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="px-2 py-6 text-center text-terminal-muted">
                {emptyText}
              </td>
            </tr>
          ) : null}
          {sorted.map((row) => {
            const k = rowKey(row)
            const isOpen = expanded === k
            return (
              <Fragment key={k}>
                <tr
                  className={`border-b border-terminal-border/60 hover:bg-terminal-elevated ${
                    renderExpanded ? 'cursor-pointer' : ''
                  } ${isOpen ? 'bg-terminal-elevated' : ''}`}
                  onClick={renderExpanded ? () => setExpanded(isOpen ? null : k) : undefined}
                >
                  {renderExpanded ? (
                    <td className="px-1 text-center text-terminal-dim" aria-hidden>
                      {isOpen ? '▾' : '▸'}
                    </td>
                  ) : null}
                  {columns.map((c) => {
                    const v = c.value?.(row)
                    const right = (c.align ?? (c.pct || c.value ? 'right' : 'left')) === 'right'
                    return (
                      <td
                        key={c.key}
                        className={`whitespace-nowrap px-2 py-1 ${right ? 'text-right font-mono tabular-nums' : ''} ${
                          c.pct ? pctClass(v) : ''
                        } ${c.className ?? ''}`}
                      >
                        {c.render ? c.render(row) : c.pct ? fmtPct(v) : (v ?? '—')}
                      </td>
                    )
                  })}
                </tr>
                {isOpen && renderExpanded ? (
                  <tr className="border-b border-terminal-border bg-terminal-bg">
                    <td colSpan={columns.length + 1} className="px-3 py-2">
                      {renderExpanded(row)}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

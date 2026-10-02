import { useEffect, useState } from 'react'
import { formatRelativeTime } from '../utils/format'
import { MetricTip } from './MetricTip'

interface NewsItem {
  headline: string
  source: string
  datetime: string
  url: string
  summary?: string
}

interface NewsPayload {
  symbol: string
  source?: 'finnhub' | 'yahoo'
  fetchedAt?: string
  items?: NewsItem[]
  error?: string
}

export function TickerNews({ symbol }: { symbol: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<'finnhub' | 'yahoo' | null>(null)
  const [items, setItems] = useState<NewsItem[]>([])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`/api/market/news/${encodeURIComponent(symbol)}`, {
          signal: ac.signal,
        })
        const body = (await res.json()) as NewsPayload
        if (ac.signal.aborted) return
        if (!res.ok) {
          setError(body.error || 'News unavailable')
          return
        }
        setSource(body.source ?? null)
        const next = Array.isArray(body.items) ? body.items.slice(0, 8) : []
        setItems(next)
        if (body.error && !next.length) setError('News unavailable')
      } catch (err) {
        if (ac.signal.aborted) return
        setError(err instanceof Error ? err.message : 'News unavailable')
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [symbol])

  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
          Latest news
        </h3>
        {source ? (
          <MetricTip id="newsSource" className="text-[9px] uppercase tracking-wide text-terminal-dim">
            {source === 'finnhub' ? 'Finnhub' : 'Yahoo'}
          </MetricTip>
        ) : null}
      </div>
      {loading ? (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse rounded border border-terminal-border bg-terminal-bg px-3 py-2">
              <div className="h-3 w-4/5 rounded bg-terminal-elevated" />
              <div className="mt-2 h-2 w-1/3 rounded bg-terminal-elevated" />
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm text-terminal-red">
          News unavailable
        </p>
      ) : items.length === 0 ? (
        <p className="rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm text-terminal-dim">
          No recent news found
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.url} className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm leading-snug text-terminal-fg hover:text-terminal-blue"
              >
                {item.headline}
              </a>
              <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-terminal-dim">
                <span>{item.source}</span>
                <span>{formatRelativeTime(item.datetime)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

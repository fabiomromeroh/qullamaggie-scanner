import { useEffect, useState } from 'react'
import { fmtMarketCap } from '../utils/format'
import { MetricTip } from './MetricTip'

interface ProfilePayload {
  symbol: string
  source?: string
  fetchedAt?: string
  name?: string
  industry?: string
  exchange?: string
  marketCap?: number
  weburl?: string
  description?: string
  descriptionSource?: string
  error?: string
}

export function TickerProfile({ symbol }: { symbol: string }) {
  const [loading, setLoading] = useState(true)
  const [payload, setPayload] = useState<ProfilePayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`/api/market/profile/${encodeURIComponent(symbol)}`, {
          signal: ac.signal,
        })
        const body = (await res.json()) as ProfilePayload
        if (ac.signal.aborted) return
        if (!res.ok) {
          setError(body.error || 'Profile unavailable')
          return
        }
        setPayload(body)
      } catch (err) {
        if (ac.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Profile unavailable')
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [symbol])

  if (loading) {
    return (
      <section>
        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
          Company
        </h3>
        <div className="animate-pulse space-y-2 rounded border border-terminal-border bg-terminal-bg px-3 py-2">
          <div className="h-3 w-1/2 rounded bg-terminal-elevated" />
          <div className="h-3 w-full rounded bg-terminal-elevated" />
          <div className="h-3 w-4/5 rounded bg-terminal-elevated" />
        </div>
      </section>
    )
  }

  const facts = payload
  const hasFacts = Boolean(
    facts &&
      (facts.industry ||
        facts.exchange ||
        facts.marketCap != null ||
        facts.weburl ||
        facts.description),
  )

  if (error && !hasFacts) {
    return (
      <section>
        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
          Company
        </h3>
        <p className="rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm text-terminal-dim">
          No profile available
        </p>
      </section>
    )
  }

  if (!hasFacts) {
    return (
      <section>
        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
          Company
        </h3>
        <p className="rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm text-terminal-dim">
          No profile available
        </p>
      </section>
    )
  }

  return (
    <section>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-dim">
        Company
      </h3>
      <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-terminal-muted">
          {facts!.industry ? (
            <MetricTip id="profileIndustry">Finnhub · {facts!.industry}</MetricTip>
          ) : null}
          {facts!.exchange ? (
            <MetricTip id="profileExchange">{facts!.exchange}</MetricTip>
          ) : null}
          {facts!.marketCap != null ? (
            <MetricTip id="marketCap" className="font-mono text-terminal-fg">
              {fmtMarketCap(facts!.marketCap)}
            </MetricTip>
          ) : null}
          {facts!.weburl ? (
            <a
              href={facts!.weburl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-terminal-blue hover:underline"
            >
              Website
            </a>
          ) : null}
        </div>
        {facts!.description ? (
          <p className="mt-2 text-sm leading-relaxed text-terminal-muted">
            {facts!.description}
            {facts!.descriptionSource ? (
              <span className="mt-1 block text-[9px] uppercase tracking-wide text-terminal-dim">
                {facts!.descriptionSource}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  )
}

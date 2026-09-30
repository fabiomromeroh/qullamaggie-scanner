import { useEffect, useRef, useState } from 'react'
import { isGroupSlug } from '../lib/groupPeriod'
import type { GroupLeadersEntry, GroupLeadersResponse, GroupPeriod } from '../types'

const BATCH = 12

function isLeadersPayload(value: unknown): value is GroupLeadersResponse {
  if (!value || typeof value !== 'object') return false
  const body = value as Partial<GroupLeadersResponse>
  return typeof body.period === 'string' && Array.isArray(body.groups)
}

function errorText(value: unknown, status: number): string {
  if (value && typeof value === 'object' && 'error' in value) {
    const message = (value as { error?: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  return `HTTP ${status}`
}

function stampError(
  prev: Record<string, GroupLeadersEntry>,
  slugs: string[],
  period: GroupPeriod,
  message: string,
): Record<string, GroupLeadersEntry> {
  const next = { ...prev }
  for (const slug of slugs) {
    next[slug] = {
      slug,
      period,
      fetchedAt: null,
      stale: false,
      error: message,
      leaders: [],
      top5: [],
      inScanCount: null,
      parsedCount: 0,
    }
  }
  return next
}

/**
 * Lazy Finviz leaders for the slugs currently on screen.
 * Refetches when `period` changes. Keeps the last payload per slug for this period.
 */
export function useGroupLeaders(slugs: string[], period: GroupPeriod, enabled: boolean) {
  const [storedPeriod, setStoredPeriod] = useState(period)
  const [entries, setEntries] = useState<Record<string, GroupLeadersEntry>>({})
  const entriesRef = useRef(entries)
  const slugsRef = useRef(slugs)

  if (storedPeriod !== period) {
    setStoredPeriod(period)
    setEntries({})
  }

  const slugKey = slugs.join(',')

  useEffect(() => {
    slugsRef.current = slugs
    entriesRef.current = storedPeriod === period ? entries : {}
  })

  useEffect(() => {
    if (!enabled) return
    const wanted = slugsRef.current.filter((slug) => isGroupSlug(slug))
    const missing = wanted.filter((slug) => entriesRef.current[slug] == null)
    if (missing.length === 0) return

    const ac = new AbortController()
    const batches: string[][] = []
    for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH))

    void (async () => {
      for (const batch of batches) {
        if (ac.signal.aborted) return
        const qs = new URLSearchParams({ period, slugs: batch.join(',') })
        try {
          const res = await fetch(`/api/groups/leaders?${qs.toString()}`, { signal: ac.signal })
          let body: unknown = null
          try {
            body = await res.json()
          } catch {
            body = null
          }
          if (ac.signal.aborted) return
          if (!res.ok || !isLeadersPayload(body)) {
            setEntries((prev) => stampError(prev, batch, period, errorText(body, res.status)))
            continue
          }
          setEntries((prev) => {
            const next = { ...prev }
            for (const entry of body.groups) {
              if (entry && entry.slug && entry.period === period) next[entry.slug] = entry
            }
            for (const slug of batch) {
              if (!next[slug]) {
                next[slug] = stampError({}, [slug], period, 'Leaders response omitted this group')[slug]!
              }
            }
            return next
          })
        } catch (err) {
          if (ac.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return
          const message = err instanceof Error ? err.message : 'leaders request failed'
          setEntries((prev) => stampError(prev, batch, period, message))
        }
      }
    })()

    return () => ac.abort()
  }, [enabled, period, slugKey])

  return storedPeriod === period ? entries : {}
}

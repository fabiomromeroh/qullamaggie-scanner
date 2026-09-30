import { useEffect, useRef, useState } from 'react'
import { isGroupSlug } from '../lib/groupPeriod'
import type { GroupLeadersEntry, GroupLeadersResponse, GroupPeriod } from '../types'

const BATCH = 12
const MAX_ATTEMPTS = 12

function backoffMs(attempt: number): number {
  return Math.min(12_000, 3_000 * 2 ** Math.min(Math.max(attempt, 1) - 1, 2))
}

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
    const ac = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    const attempts = new Map<string, number>()
    let known: Record<string, GroupLeadersEntry> = { ...entriesRef.current }

    const run = async () => {
      const wanted = slugsRef.current.filter((slug) => isGroupSlug(slug))
      const todo = wanted.filter((slug) => {
        const entry = known[slug]
        if (!entry) return true
        return entry.pending === true && (attempts.get(slug) ?? 0) < MAX_ATTEMPTS
      })
      if (todo.length === 0) return

      let stillPending = false
      let highest = 0
      for (let i = 0; i < todo.length; i += BATCH) {
        if (ac.signal.aborted) return
        const batch = todo.slice(i, i + BATCH)
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
            known = stampError(known, batch, period, errorText(body, res.status))
            entriesRef.current = known
            setEntries(known)
            continue
          }
          const next = { ...known }
          for (const entry of body.groups) {
            if (!entry || !entry.slug || entry.period !== period) continue
            let stored = entry
            if (entry.pending) {
              const n = (attempts.get(entry.slug) ?? 0) + 1
              attempts.set(entry.slug, n)
              highest = Math.max(highest, n)
              if (n >= MAX_ATTEMPTS) {
                stored = {
                  ...entry,
                  pending: false,
                  leaders: [],
                  top5: [],
                  inScanCount: null,
                  parsedCount: 0,
                  error: 'Leaders still computing after several attempts. Reload to continue.',
                }
              } else {
                stillPending = true
              }
            } else {
              attempts.delete(entry.slug)
            }
            next[entry.slug] = stored
          }
          for (const slug of batch) {
            if (!next[slug]) {
              next[slug] = stampError({}, [slug], period, 'Leaders response omitted this group')[slug]!
            }
          }
          known = next
          entriesRef.current = next
          setEntries(next)
        } catch (err) {
          if (ac.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return
          const message = err instanceof Error ? err.message : 'leaders request failed'
          known = stampError(known, batch, period, message)
          entriesRef.current = known
          setEntries(known)
        }
      }
      if (stillPending && !cancelled && !ac.signal.aborted) {
        timer = setTimeout(() => {
          if (!cancelled) void run()
        }, backoffMs(Math.max(1, highest)))
        if (cancelled) {
          clearTimeout(timer)
          timer = undefined
        }
      }
    }

    void run()
    return () => {
      cancelled = true
      ac.abort()
      if (timer) clearTimeout(timer)
    }
  }, [enabled, period, slugKey])

  return storedPeriod === period ? entries : {}
}

import { useEffect, useState } from 'react'
import type { GroupsResponse } from '../types'
import { GROUPS_POLL_MS } from '../lib/groupPeriod'

function isGroupsResponse(value: unknown): value is GroupsResponse {
  if (!value || typeof value !== 'object') return false
  const body = value as Partial<GroupsResponse>
  return (
    (body.source === 'finviz' || body.source === 'fallback') &&
    typeof body.stale === 'boolean' &&
    typeof body.fetchedAt === 'string' &&
    typeof body.sourceUrl === 'string' &&
    Array.isArray(body.groups)
  )
}

/**
 * Load leading groups from `/api/groups`.
 * A failed poll keeps the last good payload.
 */
export function useGroups() {
  const [payload, setPayload] = useState<GroupsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let seq = 0

    const run = async () => {
      const id = ++seq
      try {
        const res = await fetch('/api/groups')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body: unknown = await res.json()
        if (!isGroupsResponse(body)) throw new Error('invalid groups payload')
        if (cancelled || id !== seq) return
        setPayload(body)
        setError(null)
      } catch (err) {
        if (cancelled || id !== seq) return
        setError(err instanceof Error ? err.message : 'groups request failed')
      }
    }

    void run()
    const timer = setInterval(() => {
      void run()
    }, GROUPS_POLL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return {
    payload,
    error,
    loading: payload == null && error == null,
  }
}

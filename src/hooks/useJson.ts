import { useCallback, useEffect, useRef, useState } from 'react'

/** Fetch JSON with optional polling; keeps the last good payload on refresh errors. */
export function useJson<T>(url: string | null, pollMs = 0) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!url) return
    const id = ++seq.current
    setLoading(true)
    try {
      const res = await fetch(url)
      const body = (await res.json()) as T & { error?: string }
      if (id !== seq.current) return
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setData(body)
      setError(null)
    } catch (err) {
      if (id === seq.current) setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [url])

  useEffect(() => {
    const first = setTimeout(() => void load(), 0)
    const timer = pollMs ? setInterval(() => void load(), pollMs) : null
    return () => {
      clearTimeout(first)
      if (timer) clearInterval(timer)
    }
  }, [load, pollMs])

  return { data, error, loading, reload: load }
}

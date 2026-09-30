/**
 * Shared Finviz HTTP: desktop Chrome UA, 10s timeout, redirect follow,
 * and a small queue (2 in flight, ~400ms between starts). No proxies,
 * cookie jars, or challenge solving.
 */

export const FINVIZ_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export const FINVIZ_FETCH_TIMEOUT_MS = 10_000
export const FINVIZ_CACHE_TTL_MS = 12 * 60 * 1000
export const FINVIZ_CONCURRENCY = 2
export const FINVIZ_GAP_MS = 400

export function looksLikeFinvizChallenge(html: string): boolean {
  const head = html.slice(0, 20_000).toLowerCase()
  return (
    head.includes('just a moment') ||
    head.includes('cf-browser-verification') ||
    head.includes('challenge-platform') ||
    head.includes('attention required') ||
    head.includes('cf-challenge') ||
    /<title>[^<]{0,80}cloudflare[^<]*<\/title>/.test(head)
  )
}

let active = 0
let nextStartAt = 0
const waiters: Array<() => void> = []

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function acquireFinvizSlot(): Promise<void> {
  if (active >= FINVIZ_CONCURRENCY) {
    await new Promise<void>((resolve) => {
      waiters.push(resolve)
    })
    // The releasing call transferred its slot; `active` already counts us.
  } else {
    active += 1
  }
  const now = Date.now()
  const startAt = Math.max(now, nextStartAt)
  nextStartAt = startAt + FINVIZ_GAP_MS
  const wait = startAt - now
  if (wait > 0) await sleep(wait)
}

function releaseFinvizSlot(): void {
  const next = waiters.shift()
  if (next) {
    next()
    return
  }
  active -= 1
}

export async function withFinvizSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireFinvizSlot()
  try {
    return await fn()
  } finally {
    releaseFinvizSlot()
  }
}

export async function finvizFetchText(url: string): Promise<{ status: number; html: string }> {
  return withFinvizSlot(async () => {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(FINVIZ_FETCH_TIMEOUT_MS),
        headers: {
          'User-Agent': FINVIZ_USER_AGENT,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      })
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new Error('Finviz request timed out')
      }
      throw new Error('Finviz request failed')
    }
    const html = await res.text()
    return { status: res.status, html }
  })
}

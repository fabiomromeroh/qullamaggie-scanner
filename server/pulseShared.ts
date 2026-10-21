import { loadMembershipSnapshot } from './groupMembers.ts'

export type MiniRes = {
  statusCode: number
  setHeader: (name: string, value: string) => void
  end: (body?: string) => void
}

export function sendJson(res: MiniRes, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

export function membershipUniverse(): { tickers: string[]; companies: Map<string, string>; groupOf: Map<string, string> } {
  const loaded = loadMembershipSnapshot()
  const tickers = new Set<string>()
  const companies = new Map<string, string>()
  const groupOf = new Map<string, string>()
  if (loaded.ok) {
    for (const [slug, g] of Object.entries(loaded.snapshot.groups)) {
      for (const t of g.tickers) {
        tickers.add(t)
        if (!groupOf.has(t)) groupOf.set(t, slug)
        const name = g.companies?.[t]
        if (name) companies.set(t, name)
      }
    }
  }
  return { tickers: [...tickers].sort(), companies, groupOf }
}

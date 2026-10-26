/**
 * Breadth universe: every US-listed common stock from Nasdaq Trader's free
 * symbol directories (nasdaqlisted.txt + otherlisted.txt). ETFs, test issues,
 * warrants, units, rights, preferreds, notes and depositary-share lines are
 * excluded. The list is fetched at most once per New York trading date and
 * cached to a file; if both fetches fail, the Finviz membership snapshot is used.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { etDate } from '../src/lib/breadth.ts'

export const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt'
export const OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'

const EXCLUDE_NAME =
  /\b(warrants?|rights?|units?|preferred|depositary shares?|notes? due|debentures?|etns?|exchange traded|subordinated)\b|%/i

/** Parse one pipe-delimited Nasdaq Trader file into Yahoo-style common-stock symbols. */
export function parseNasdaqTraderList(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.includes('|'))
  if (lines.length < 2) return []
  const head = lines[0]!.split('|').map((h) => h.trim())
  const col = (name: string) => head.indexOf(name)
  const sym = col('Symbol') >= 0 ? col('Symbol') : col('ACT Symbol')
  const name = col('Security Name')
  const etf = col('ETF')
  const test = col('Test Issue')
  if (sym < 0 || name < 0 || etf < 0 || test < 0) return []
  const out: string[] = []
  for (const line of lines.slice(1)) {
    if (line.startsWith('File Creation Time')) continue
    const f = line.split('|')
    const s = (f[sym] ?? '').trim()
    if (f[etf]?.trim() === 'Y' || f[test]?.trim() === 'Y') continue
    if (EXCLUDE_NAME.test(f[name] ?? '')) continue
    // Plain symbols plus one-letter share classes (BRK.B → BRK-B for Yahoo).
    if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(s)) continue
    out.push(s.replace('.', '-'))
  }
  return out
}

export interface UniverseFile {
  date: string
  fetchedAt: string
  tickers: string[]
}

function writeTextAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

function cachePath(): string {
  return process.env.BREADTH_UNIVERSE_PATH
    ? resolve(process.env.BREADTH_UNIVERSE_PATH)
    : join(tmpdir(), 'qm-breadth-universe.json')
}

function readCache(): UniverseFile | null {
  try {
    const p = cachePath()
    if (!existsSync(p)) return null
    const v = JSON.parse(readFileSync(p, 'utf8')) as UniverseFile
    return Array.isArray(v?.tickers) && typeof v.date === 'string' ? v : null
  } catch {
    return null
  }
}

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': 'qullamaggie-scanner breadth (free symbol directory)' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

export type UniverseSource = 'nasdaqtrader' | 'nasdaqtrader-cache' | 'finviz-snapshot'

/** Listed common stocks; `fallback` supplies the Finviz membership tickers. */
export async function loadBreadthUniverse(
  fallback: () => string[],
  opts: { now?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ tickers: string[]; source: UniverseSource; error?: string }> {
  const today = etDate(Math.floor((opts.now ?? Date.now()) / 1000))
  const cached = readCache()
  if (cached && cached.date === today && cached.tickers.length > 1000) {
    return { tickers: cached.tickers, source: 'nasdaqtrader-cache' }
  }
  try {
    const f = opts.fetchImpl ?? fetch
    const [a, b] = await Promise.all([fetchText(NASDAQ_LISTED_URL, f), fetchText(OTHER_LISTED_URL, f)])
    const tickers = [...new Set([...parseNasdaqTraderList(a), ...parseNasdaqTraderList(b)])].sort()
    if (tickers.length < 1000) throw new Error(`only ${tickers.length} symbols parsed`)
    try {
      writeTextAtomic(cachePath(), JSON.stringify({ date: today, fetchedAt: new Date().toISOString(), tickers }))
    } catch {
      /* cache is best effort */
    }
    return { tickers, source: 'nasdaqtrader' }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'symbol list fetch failed'
    if (cached && cached.tickers.length > 1000) return { tickers: cached.tickers, source: 'nasdaqtrader-cache', error }
    return { tickers: fallback(), source: 'finviz-snapshot', error }
  }
}

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyCounts, type BreadthRow } from '../src/lib/breadth.ts'
import { summarizeBreadth } from '../src/lib/breadthSummary.ts'
import { buildPrompt, configuredProvider, getBreadthSummary, resetSummaryCache } from './breadthSummary.ts'

const row = (date: string, p: Partial<BreadthRow>): BreadthRow => ({
  ...emptyCounts(date),
  universe: 2600,
  ratio5: 1,
  ratio10: 1,
  pctAbove50: 50,
  pctAbove200: 50,
  ...p,
})
const series = (latest: Partial<BreadthRow>, older: Partial<BreadthRow> = {}) => [
  row('2026-10-23', latest),
  ...['22', '21', '20', '19', '16', '15'].map((d) => row(`2026-10-${d}`, older)),
]

test('strong tape: high ratios, thrust, participation → strong + aggressive', () => {
  const s = summarizeBreadth(
    series(
      { up4Price: 400, down4Price: 20, ratio5: 2.6, ratio10: 1.8, up25q: 400, down25q: 100, up13x34: 500, down13x34: 150, pctAbove50: 72, pctAbove200: 65, newHighs: 300, newLows: 40 },
      { ratio5: 1.1, pctAbove50: 55 },
    ),
  )!
  assert.equal(s.regime, 'strong')
  assert.ok(s.score >= 5)
  assert.match(s.conclusions[0]!, /aggressive/)
  assert.match(s.signals.find((x) => x.key === 'ratio5')!.text, /rising/)
  assert.equal(s.facts.up4, 400)
})

test('weak and washout tapes; neutral when mixed', () => {
  const weak = summarizeBreadth(series({ up4Price: 30, down4Price: 90, ratio5: 0.45, ratio10: 0.65, up25q: 100, down25q: 300, up13x34: 100, down13x34: 400, pctAbove50: 32, pctAbove200: 35, newHighs: 20, newLows: 200 }))!
  assert.equal(weak.regime, 'weak')
  assert.match(weak.conclusions[0]!, /cash/)
  const wash = summarizeBreadth(series({ up4Price: 10, down4Price: 500, ratio10: 0.4, pctAbove50: 15 }))!
  assert.equal(wash.regime, 'washout')
  const mixed = summarizeBreadth(series({ up4Price: 100, down4Price: 90, up25q: 200, down25q: 200, up13x34: 200, down13x34: 200 }))!
  assert.equal(mixed.regime, 'neutral')
  assert.match(mixed.conclusions[0]!, /A\+/)
})

test('partial intraday row is flagged in the read and the prompt', () => {
  const s = summarizeBreadth(series({ partial: true, asOf: '2026-10-26T17:00:00.000Z' }))!
  assert.equal(s.partial, true)
  assert.ok(s.conclusions.some((c) => c.includes('intraday · as of 13:00 ET')))
  assert.ok(!s.conclusions.some((c) => c.includes('T17:00')))
  assert.match(buildPrompt(s, series({ partial: true })).user, /intraday partial/)
  assert.equal(summarizeBreadth([]), null)
})

test('provider selection prefers Gemini, keys never leak, built-in fallback on failure', async () => {
  assert.equal(configuredProvider({}), null)
  assert.deepEqual(configuredProvider({ XAI_API_KEY: 'k', GEMINI_API_KEY: 'g' }), { provider: 'gemini', model: 'gemini-flash-latest' })
  assert.deepEqual(configuredProvider({ XAI_API_KEY: 'k' }), { provider: 'grok', model: 'grok-4.7' })
  assert.deepEqual(configuredProvider({ GEMINI_API_KEY: 'g' }), { provider: 'gemini', model: 'gemini-flash-latest' })
  resetSummaryCache()
  const input = { generatedAt: '2026-10-26T13:00:00.000Z', rows: series({}) }
  let calls = 0
  let sentAuth = ''
  const ok = (async (_url: string, init: RequestInit) => {
    calls++
    sentAuth = String((init.headers as Record<string, string>).Authorization)
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Regime: neutral\n- test' } }] }))
  }) as unknown as typeof fetch
  const env = { XAI_API_KEY: 'secret-key' } as NodeJS.ProcessEnv
  const none = await getBreadthSummary(input, { env, fetchImpl: ok })
  assert.equal(none.source, 'built-in')
  assert.equal(calls, 0, 'no LLM call unless requested')
  const r = await getBreadthSummary(input, { ai: true, env, fetchImpl: ok })
  assert.equal(r.source, 'grok')
  assert.equal(r.llm?.text, 'Regime: neutral\n- test')
  assert.equal(sentAuth, 'Bearer secret-key')
  assert.ok(!JSON.stringify(r).includes('secret-key'))
  await getBreadthSummary(input, { ai: true, env, fetchImpl: ok })
  assert.equal(calls, 1, 'cached per snapshot')
  const next = await getBreadthSummary({ ...input, generatedAt: '2026-10-26T14:00:00.000Z' }, { env, fetchImpl: ok })
  assert.equal(next.source, 'built-in', 'new snapshot invalidates the cache')
  const bad = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
  const f = await getBreadthSummary({ ...input, generatedAt: 'x2' }, { ai: true, env, fetchImpl: bad })
  assert.equal(f.source, 'built-in')
  assert.match(f.error ?? '', /Grok HTTP 401/)
  assert.ok(f.builtIn)
})

test('Gemini falls back to the lite alias when the first model is overloaded', async () => {
  resetSummaryCache()
  const urls: string[] = []
  const f = (async (url: string) => {
    urls.push(url)
    if (url.includes('/gemini-flash-latest:')) return new Response('busy', { status: 503 })
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Regime: neutral' }] } }] }))
  }) as unknown as typeof fetch
  const r = await getBreadthSummary({ generatedAt: 'g1', rows: series({}) }, { ai: true, env: { GEMINI_API_KEY: 'g' } as NodeJS.ProcessEnv, fetchImpl: f })
  assert.equal(r.source, 'gemini')
  assert.equal(r.llm?.model, 'gemini-flash-lite-latest')
  assert.equal(urls.length, 2)
  assert.ok(!urls.some((u) => u.includes('key=')), 'key goes in a header, not the URL')
})

test('prompt defines column names and the thrust rule', () => {
  const s = summarizeBreadth(series({ up4Price: 141, down4Price: 20 }))!
  const p = buildPrompt(s, series({})).user
  assert.match(p, /up25q\/down25q = up\/down >= 25% vs 65 sessions ago \(a QUARTER\)/)
  assert.match(p, new RegExp(`thrustThreshold \\(${s.facts.thrustThreshold}\\)`))
  assert.match(p, /CLEARS it/)
})


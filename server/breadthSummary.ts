/**
 * GET /api/breadth/summary         built-in summary (+ cached LLM text if any)
 * GET /api/breadth/summary?ai=1    also ask the configured LLM (on demand; cached per breadth snapshot ~1 h)
 *
 * Provider: GEMINI_API_KEY preferred (model GEMINI_MODEL, default gemini-flash-latest
 * then gemini-flash-lite-latest when the first is overloaded / unavailable); else
 * XAI_API_KEY (Grok, OpenAI-compatible https://api.x.ai/v1, model XAI_MODEL default grok-4.7).
 * Keys are read server-side only and never returned. The built-in summary is always
 * returned and is the fallback when no key is set or the call fails.
 */
import { summarizeBreadth, type BreadthSummary } from '../src/lib/breadthSummary.ts'
import type { BreadthRow } from '../src/lib/breadth.ts'

export type SummaryProvider = 'grok' | 'gemini'

export interface LlmText {
  source: SummaryProvider
  model: string
  text: string
  generatedAt: string
  snapshot: string
}

export interface SummaryResponse {
  source: 'built-in' | SummaryProvider
  builtIn: BreadthSummary | null
  llm: LlmText | null
  /** Provider that `?ai=1` would use, or null when no key is configured. */
  llmProvider: SummaryProvider | null
  snapshot: string | null
  error?: string
}

export const LLM_CACHE_MS = 60 * 60_000

/** Gemini aliases tried in order (2.5-flash is closed to new keys). */
export const GEMINI_DEFAULT_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest']

export function configuredProvider(env: NodeJS.ProcessEnv = process.env): { provider: SummaryProvider; model: string } | null {
  if (env.GEMINI_API_KEY) return { provider: 'gemini', model: env.GEMINI_MODEL || GEMINI_DEFAULT_MODELS[0]! }
  if (env.XAI_API_KEY) return { provider: 'grok', model: env.XAI_MODEL || 'grok-4.7' }
  return null
}

export function buildPrompt(summary: BreadthSummary, recent: readonly BreadthRow[]): { system: string; user: string } {
  const history = recent.slice(0, 10).map((r) => ({
    date: r.date,
    up4: r.up4Price ?? r.up4,
    down4: r.down4Price ?? r.down4,
    ratio5: r.ratio5 == null ? null : Math.round(r.ratio5 * 100) / 100,
    ratio10: r.ratio10 == null ? null : Math.round(r.ratio10 * 100) / 100,
    up25q: r.up25q,
    down25q: r.down25q,
    up13x34: r.up13x34,
    down13x34: r.down13x34,
    pctAbove50: r.pctAbove50 == null ? null : Math.round(r.pctAbove50 * 10) / 10,
    pctAbove200: r.pctAbove200 == null ? null : Math.round(r.pctAbove200 * 10) / 10,
    newHighs: r.newHighs,
    newLows: r.newLows,
    partial: Boolean(r.partial),
  }))
  return {
    system:
      'You are a market-breadth analyst for a Qullamaggie-style momentum swing trader. Use ONLY the numbers given; never invent data, prices or news. Be concise.',
    user: [
      'Stockbee-style Market Monitor breadth, newest first (US common stocks, price >= $5, 20-day avg volume > 100K shares, 20-day avg $vol >= $5M; advancing/declining and new highs/lows are unfiltered).',
      'Field meanings (use these names, do not rename them): up4/down4 = stocks up/down >= 4% today (price only); ratio5/ratio10 = sum of up4 / sum of down4 over 5/10 sessions; up25q/down25q = up/down >= 25% vs 65 sessions ago (a QUARTER); up13x34/down13x34 = up/down >= 13% vs 34 calendar days ago; pctAbove50/pctAbove200 = % above the 50/200-day SMA; newHighs/newLows = 52-week highs/lows; advancing/declining = stocks closing up/down (counts, not volume).',
      `Thrust rule: an up-thrust is up4 >= thrustThreshold (${summary.facts.thrustThreshold}); a down-thrust is down4 >= thrustThreshold. A count equal to or above the threshold CLEARS it. Today: up4 ${summary.facts.up4}, down4 ${summary.facts.down4}.`,
      `Rule-based read: regime=${summary.regime}, score=${summary.score}.`,
      `Latest facts: ${JSON.stringify(summary.facts)}`,
      `Last 10 sessions: ${JSON.stringify(history)}`,
      summary.partial ? `The newest row is an intraday partial bar (as of ${summary.asOf}); say so.` : '',
      'Reply in plain text: one line "Regime: <word>" then 4-6 short bullets ("- ") interpreting the trend of the ratios, thrusts, quarter and 34-day balance, moving-average participation and highs vs lows, ending with what to do (aggressive / selective A+ only / defensive).',
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

async function callLlm(
  cfg: { provider: SummaryProvider; model: string },
  prompt: { system: string; user: string },
  fetchImpl: typeof fetch,
  env: NodeJS.ProcessEnv,
): Promise<{ text: string; model: string }> {
  const signal = AbortSignal.timeout(45_000)
  if (cfg.provider === 'grok') {
    const res = await fetchImpl('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.XAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        max_completion_tokens: 600,
      }),
      signal,
    })
    if (!res.ok) throw new Error(`Grok HTTP ${res.status}`)
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = j.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('Grok returned no text')
    return { text, model: cfg.model }
  }
  const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL] : GEMINI_DEFAULT_MODELS
  let lastErr: Error = new Error('Gemini failed')
  for (const model of models) {
    try {
      return { text: await callGemini(model, prompt, fetchImpl, env, signal), model }
    } catch (err) {
      lastErr = err instanceof Error ? err : lastErr
      // Try the next alias only when this model is overloaded, rate-limited or unavailable.
      if (!/HTTP (404|429|500|503)/.test(lastErr.message)) throw lastErr
    }
  }
  throw lastErr
}

async function callGemini(
  model: string,
  prompt: { system: string; user: string },
  fetchImpl: typeof fetch,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': String(env.GEMINI_API_KEY), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: { maxOutputTokens: 1500 },
    }),
    signal,
  })
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`)
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
  if (!text) throw new Error('Gemini returned no text')
  return text
}

let cache: LlmText | null = null
let inflight: Promise<LlmText> | null = null

export function resetSummaryCache(): void {
  cache = null
  inflight = null
}

/** Built-in summary always; LLM text only when `ai` is requested (or already cached for this snapshot). */
export async function getBreadthSummary(
  input: { generatedAt: string; rows: BreadthRow[] } | null,
  opts: { ai?: boolean; now?: number; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<SummaryResponse> {
  const env = opts.env ?? process.env
  const now = opts.now ?? Date.now()
  const cfg = configuredProvider(env)
  const builtIn = input ? summarizeBreadth(input.rows) : null
  const snapshot = input?.generatedAt ?? null
  const base: SummaryResponse = { source: 'built-in', builtIn, llm: null, llmProvider: cfg?.provider ?? null, snapshot }
  if (!builtIn || !snapshot) return base
  const fresh = cache && cache.snapshot === snapshot && now - Date.parse(cache.generatedAt) < LLM_CACHE_MS ? cache : null
  if (fresh) return { ...base, source: fresh.source, llm: fresh }
  if (!opts.ai || !cfg) return base
  try {
    if (!inflight) {
      const prompt = buildPrompt(builtIn, input!.rows)
      inflight = callLlm(cfg, prompt, opts.fetchImpl ?? fetch, env).then(({ text, model }) => ({
        source: cfg.provider,
        model,
        text,
        generatedAt: new Date(now).toISOString(),
        snapshot,
      }))
    }
    const got = await inflight
    cache = got
    return { ...base, source: got.source, llm: got }
  } catch (err) {
    // Never echo provider bodies (could contain request details); status-level message only.
    return { ...base, error: err instanceof Error ? err.message.slice(0, 120) : 'LLM call failed' }
  } finally {
    inflight = null
  }
}

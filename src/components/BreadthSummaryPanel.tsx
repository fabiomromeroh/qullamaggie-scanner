import { useEffect, useState } from 'react'
import type { BreadthSummary, Regime } from '../lib/breadthSummary'

interface SummaryResponse {
  source: 'built-in' | 'grok' | 'gemini'
  builtIn: BreadthSummary | null
  llm: { source: 'grok' | 'gemini'; model: string; text: string; generatedAt: string } | null
  llmProvider: 'grok' | 'gemini' | null
  snapshot: string | null
  error?: string
}

const REGIME_CLASS: Record<Regime, string> = {
  strong: 'bg-[#1f6f43] text-white',
  healthy: 'bg-terminal-green-dim text-terminal-green',
  neutral: 'bg-terminal-elevated text-terminal-fg',
  weak: 'bg-terminal-red-dim text-terminal-red',
  washout: 'bg-[#8a2a31] text-white',
}

const SOURCE_LABEL = { 'built-in': 'Built-in rules', grok: 'Grok', gemini: 'Gemini' } as const

/** Market read beside the breadth table: deterministic rules, optional LLM text on demand. */
export function BreadthSummaryPanel({ snapshot }: { snapshot: string | null }) {
  const [data, setData] = useState<SummaryResponse | null>(null)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/breadth/summary')
      .then((r) => r.json() as Promise<SummaryResponse>)
      .then((j) => alive && setData(j))
      .catch(() => alive && setError('Summary unavailable'))
    return () => {
      alive = false
    }
  }, [snapshot])

  async function ask() {
    setAsking(true)
    setError(null)
    try {
      const j = (await (await fetch('/api/breadth/summary?ai=1')).json()) as SummaryResponse
      setData(j)
      if (j.error) setError(`${SOURCE_LABEL[j.llmProvider ?? 'built-in']} unavailable (${j.error}); showing built-in rules.`)
    } catch {
      setError('AI request failed; showing built-in rules.')
    } finally {
      setAsking(false)
    }
  }

  const s = data?.builtIn
  return (
    <aside className="flex min-w-0 flex-1 flex-col gap-2 overflow-auto max-lg:max-h-[45%] max-lg:flex-none border-t border-terminal-border p-3 text-[12px] lg:min-w-[300px] lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-terminal-dim">Market Read</h3>
        <span className="text-[10px] text-terminal-dim" title="Where the text below comes from">
          Source: {SOURCE_LABEL[data?.source ?? 'built-in']}
          {data?.llm ? ` (${data.llm.model})` : ''}
        </span>
      </div>
      {!s ? (
        <div className="text-terminal-muted">{error ?? (data ? 'No breadth data yet.' : 'Loading…')}</div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${REGIME_CLASS[s.regime]}`}>{s.regime}</span>
            <span className="text-terminal-dim">
              {s.date} · score {s.score > 0 ? `+${s.score}` : s.score}
            </span>
            {s.partial ? <span className="text-[10px] text-terminal-amber">intraday partial</span> : null}
          </div>
          {data?.llm ? (
            <div className="whitespace-pre-wrap rounded border border-terminal-border bg-terminal-elevated/40 p-2 leading-snug text-terminal-fg">
              {data.llm.text}
            </div>
          ) : null}
          <ul className="list-disc space-y-1 pl-4 leading-snug text-terminal-fg">
            {s.conclusions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <ul className="space-y-0.5 leading-snug text-terminal-muted">
            {s.signals.map((g) => (
              <li key={g.key} className="flex gap-2">
                <span
                  className={`w-6 shrink-0 text-right font-mono ${g.score > 0 ? 'text-terminal-green' : g.score < 0 ? 'text-terminal-red' : 'text-terminal-dim'}`}
                >
                  {g.score > 0 ? `+${g.score}` : g.score}
                </span>
                <span>{g.text}</span>
              </li>
            ))}
          </ul>
          {error ? <div className="text-[11px] text-terminal-amber">{error}</div> : null}
          {data?.llmProvider ? (
            <button
              type="button"
              onClick={ask}
              disabled={asking}
              className="self-start rounded border border-terminal-border-bright px-2 py-0.5 text-[11px] text-terminal-fg hover:border-terminal-blue disabled:opacity-50"
            >
              {asking ? 'Asking…' : 'Ask AI'}
            </button>
          ) : (
            <div className="text-[10px] text-terminal-dim">Set GEMINI_API_KEY (or XAI_API_KEY for Grok) on the server to add an AI read.</div>
          )}
          <div className="text-[10px] text-terminal-dim">Rules-based read of the breadth numbers only; not financial advice.</div>
        </>
      )}
    </aside>
  )
}

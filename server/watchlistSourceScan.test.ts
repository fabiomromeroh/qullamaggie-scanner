import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'

const ROOT = process.cwd()
const PATTERN = /auto-?add|autoAdd/gi

/** Migration note/test may mention dropping auto-added v1 rows. Keep those hits documented. */
const ALLOWED = new Set([
  'server/userWatchlistStore.test.ts',
  'server/watchlistSourceScan.test.ts',
  'server/metricDefinitions.test.ts',
  'README.md',
])

function walk(dir: string, files: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'packaging') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, files)
    else files.push(full)
  }
}

function hitsIn(file: string): { line: number; text: string }[] {
  const text = readFileSync(file, 'utf8')
  const out: { line: number; text: string }[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    PATTERN.lastIndex = 0
    if (PATTERN.test(line)) out.push({ line: i + 1, text: line.trim() })
  }
  return out
}

test('src, server, README, DEPLOY have no auto-add strings except the migration note/test', () => {
  const files: string[] = []
  walk(resolve(ROOT, 'src'), files)
  walk(resolve(ROOT, 'server'), files)
  files.push(resolve(ROOT, 'README.md'), resolve(ROOT, 'DEPLOY.md'))

  const unexpected: string[] = []
  for (const file of files) {
    const rel = relative(ROOT, file).replaceAll('\\', '/')
    const hits = hitsIn(file)
    if (!hits.length) continue
    if (ALLOWED.has(rel)) {
      if (rel === 'README.md') {
        for (const hit of hits) {
          const nearby = hit.text.toLowerCase()
          assert.ok(
            nearby.includes('migrat') || nearby.includes('drop'),
            `README.md:${hit.line} mentions auto-add outside the migration note: ${hit.text}`,
          )
        }
      }
      continue
    }
    for (const hit of hits) unexpected.push(`${rel}:${hit.line}: ${hit.text}`)
  }
  assert.deepEqual(unexpected, [])
})

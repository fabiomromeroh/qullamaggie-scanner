import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { formatIdeaGroupRank, ideaGroupRank, rankGroups } from '../src/lib/groupPeriod.ts'
import { METRIC_DEFS } from '../src/lib/metricDefinitions.ts'
import type { IndustryGroup } from '../src/types/index.ts'

function g(id: string, name: string, dayPct: number, weekPct: number, perf1m: number): IndustryGroup {
  return { id, slug: id, name, rsRank: 0, description: '', source: 'finviz', dayPct, weekPct, perf1m, perf3m: 0, perf6m: 0 }
}

const groups = [
  g('semiconductors', 'Semiconductors', 1, 2, 30),
  g('biotechnology', 'Biotechnology', 3, 1, 10),
  g('oilgasrefiningmarketing', 'Oil & Gas Refining & Marketing', 2, 5, 20),
]

test('ideaGroupRank follows the selected period like rankGroups', () => {
  const idea = { groupId: 'biotechnology', groupName: 'Biotechnology' }
  assert.deepEqual(ideaGroupRank(idea, groups, '1m'), { rank: 3, total: 3, period: '1m', groupName: 'Biotechnology' })
  assert.equal(ideaGroupRank(idea, groups, '1d')?.rank, 1)
  assert.equal(ideaGroupRank(idea, groups, '1w')?.rank, 3)
  const panel = rankGroups(groups, '1w').find((x) => x.id === 'oilgasrefiningmarketing')!
  assert.equal(ideaGroupRank({ groupId: '', groupName: 'Oil & Gas Refining & Marketing' }, groups, '1w')?.rank, panel.rsRank)
})

test('ideaGroupRank omits Other, unknown groups and empty lists', () => {
  assert.equal(ideaGroupRank({ groupId: 'other', groupName: 'Other' }, groups, '1m'), null)
  assert.equal(ideaGroupRank({ groupName: 'Other' }, groups, '1m'), null)
  assert.equal(ideaGroupRank({ groupId: '', groupName: '' }, groups, '1m'), null)
  assert.equal(ideaGroupRank({ groupId: 'nope', groupName: 'Not A Group' }, groups, '1m'), null)
  assert.equal(ideaGroupRank({ groupId: 'biotechnology', groupName: 'Biotechnology' }, [], '1m'), null)
})

test('formatIdeaGroupRank and the header wiring', () => {
  assert.equal(formatIdeaGroupRank({ rank: 52, total: 144, period: '1m', groupName: 'Biotechnology' }), '#52/144 · 1M')
  assert.ok(METRIC_DEFS.ideaGroupRank.how.includes('rankGroups'))
  const drawer = readFileSync(resolve(process.cwd(), 'src/components/DetailDrawer.tsx'), 'utf8')
  assert.match(drawer, /<MetricTip id="ideaGroupRank"[^>]*>\s*\{formatIdeaGroupRank\(groupRank\)\}/)
  const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
  assert.match(app, /ideaGroupRank\(selectedIdea, groups, period\)/)
  assert.match(app, /groupRank=\{selectedGroupRank\}/)
})

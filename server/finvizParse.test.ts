import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { ideaMatchesFinvizGroup, normalizeGroupKey } from '../src/lib/groupMatch.ts'
import { finvizRowsToGroups, parseFinvizGroupsPerformance } from './finvizParse.ts'

const fixturePath = resolve(process.cwd(), 'server/fixtures/finviz-groups-performance-sample.html')
const fixture = readFileSync(fixturePath, 'utf8')

test('parses three real Finviz performance rows from the format sample', () => {
  const rows = parseFinvizGroupsPerformance(fixture)
  assert.equal(rows.length, 3)
  assert.deepEqual(
    rows.map((row) => row.ticker),
    ['oilgasrefiningmarketing', 'softwareinfrastructure', 'diagnosticsresearch'],
  )
  assert.equal(rows[0]?.label, 'Oil & Gas Refining & Marketing')
  assert.equal(rows[0]?.perfT, 1.28)
  assert.equal(rows[0]?.perfW, 1.78)
  assert.equal(rows[0]?.perfM, 5.95)
  assert.equal(rows[0]?.perfQ, 44.32)
  assert.equal(rows[0]?.perfH, 50.34)
  assert.equal(rows[0]?.perfY, 95.54)
  assert.equal(rows[0]?.perfYtd, 116.54)
  assert.equal(rows[1]?.label, 'Software - Infrastructure')
  assert.equal(rows[1]?.perfQ, 26.69)
  assert.equal(rows[2]?.label, 'Diagnostics & Research')
  assert.equal(rows[2]?.perfT, -0.29)

  const groups = finvizRowsToGroups(rows)
  assert.equal(groups[0]?.id, 'oilgasrefiningmarketing')
  assert.equal(groups[0]?.slug, 'oilgasrefiningmarketing')
  assert.equal(groups[0]?.source, 'finviz')
  assert.equal(groups[0]?.description, 'Finviz industry group')
  assert.equal(groups[0]?.rsRank, 1)
  assert.equal(groups[0]?.dayPct, 1.28)
  assert.equal(groups[0]?.weekPct, 1.78)
  assert.equal(groups[0]?.perf1m, 5.95)
  assert.equal(groups[0]?.monthPct, 5.95)
  assert.equal(groups[0]?.perf3m, 44.32)
  assert.equal(groups[0]?.perf6m, 50.34)
  assert.equal(groups[0]?.perf1y, 95.54)
  assert.equal(groups[0]?.perfYtd, 116.54)
  assert.equal(groups[0]?.leaderCount, undefined)
  assert.equal(groups[1]?.rsRank, 2)
  assert.equal(groups[2]?.rsRank, 3)
})

test('ranks by 3M then 1M and leaves missing performance fields unset', () => {
  const rows = parseFinvizGroupsPerformance(`
    <script>
    window.FinvizInitGroupsPerformance([
      {"ticker":"slow","label":"Slow Group","perfT":1,"perfW":1,"perfM":1,"perfQ":5,"perfH":9},
      {"ticker":"fast","label":"Fast Group","perfT":2,"perfM":4,"perfQ":20,"perfH":8,"perfY":11,"perfYtd":3}
    ]);
    </script>
  `)
  assert.equal(rows.length, 2)
  assert.equal(rows[1]?.perfW, undefined)
  const groups = finvizRowsToGroups(rows)
  assert.equal(groups[0]?.id, 'fast')
  assert.equal(groups[0]?.rsRank, 1)
  assert.equal(groups[0]?.weekPct, undefined)
  assert.equal(groups[0]?.perf1y, 11)
  assert.equal(groups[0]?.perfYtd, 3)
  assert.equal(groups[1]?.id, 'slow')
  assert.equal(groups[1]?.perf1y, undefined)
})

test('drops invalid rows and returns nothing when the marker or valid rows are missing', () => {
  assert.deepEqual(parseFinvizGroupsPerformance('<html><title>Just a moment...</title></html>'), [])
  assert.deepEqual(
    parseFinvizGroupsPerformance('window.FinvizInitGroupsPerformance([{"ticker":1,"label":"Nope"}])'),
    [],
  )

  const mixed = parseFinvizGroupsPerformance(`
    window.FinvizInitGroupsPerformance([
      {"ticker":"good","label":"Weird ] Name","perfT":1.5,"perfW":2,"perfM":3,"perfQ":4,"perfH":5},
      {"ticker":"bad","label":"Bad Group","perfT":"nope","perfM":1,"perfQ":2}
    ])
  `)
  assert.equal(mixed.length, 1)
  assert.equal(mixed[0]?.ticker, 'good')
  assert.equal(mixed[0]?.label, 'Weird ] Name')
})

test('matches Finviz groups only on normalized label or slug equality', () => {
  assert.equal(normalizeGroupKey('Software — Application'), 'softwareapplication')
  assert.equal(
    ideaMatchesFinvizGroup(
      { groupId: 'software-application', groupName: 'Software — Application' },
      { id: 'softwareapplication', name: 'Software - Application', slug: 'softwareapplication' },
    ),
    true,
  )
  assert.equal(
    ideaMatchesFinvizGroup(
      { groupId: 'semis', groupName: 'Semiconductors' },
      { id: 'semiconductors', name: 'Semiconductors', slug: 'semiconductors' },
    ),
    true,
  )
  assert.equal(
    ideaMatchesFinvizGroup(
      { groupId: 'energy-eq', groupName: 'Oil & Gas Equipment' },
      {
        id: 'oilgasequipmentservices',
        name: 'Oil & Gas Equipment & Services',
        slug: 'oilgasequipmentservices',
      },
    ),
    false,
  )
})

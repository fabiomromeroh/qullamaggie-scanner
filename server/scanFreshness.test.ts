import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  barsAsOfFromEpochs,
  etDateOfEpoch,
  formatScanFreshnessLine,
} from '../src/lib/scanFreshness.ts'
import type { ScanFreshness } from '../src/types/index.ts'

/** Short zone name from the same Intl options the formatter uses. */
function shortZone(timeZone: string, iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(new Date(iso))
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
}

function freshness(overrides: Partial<ScanFreshness> = {}): ScanFreshness {
  return {
    asOf: '2026-10-16T13:25:00.000Z',
    barsAsOf: '2026-10-15',
    universeSize: 254,
    scannedCount: 40,
    passedCount: 18,
    groupsPeriod: '1m',
    groupsFetchedAt: '2026-10-16T12:00:00.000Z',
    membershipSnapshotDate: '2026-10-12T18:02:02.126Z',
    ...overrides,
  }
}

test('etDateOfEpoch is the America/New_York calendar date across DST boundaries', () => {
  // Spring forward 2026-03-08 02:00 EST → 03:00 EDT. The date does not skip.
  assert.equal(etDateOfEpoch(Date.parse('2026-03-08T04:30:00.000Z')), '2026-03-07')
  assert.equal(etDateOfEpoch(Date.parse('2026-03-08T05:00:00.000Z')), '2026-03-08')
  assert.equal(etDateOfEpoch(Date.parse('2026-03-08T06:29:00.000Z')), '2026-03-08')
  assert.equal(etDateOfEpoch(Date.parse('2026-03-08T07:30:00.000Z')), '2026-03-08')

  // Fall back 2026-11-01 02:00 EDT → 01:00 EST. Both 01:30 occurrences stay on Nov 1.
  assert.equal(etDateOfEpoch(Date.parse('2026-11-01T03:30:00.000Z')), '2026-10-31')
  assert.equal(etDateOfEpoch(Date.parse('2026-11-01T04:30:00.000Z')), '2026-11-01')
  assert.equal(etDateOfEpoch(Date.parse('2026-11-01T05:30:00.000Z')), '2026-11-01')
  assert.equal(etDateOfEpoch(Date.parse('2026-11-01T06:30:00.000Z')), '2026-11-01')

  // Winter EST (UTC−5) and summer EDT (UTC−4) session opens.
  assert.equal(etDateOfEpoch(Date.parse('2026-01-15T14:30:00.000Z')), '2026-01-15')
  assert.equal(etDateOfEpoch(Date.parse('2026-07-15T13:30:00.000Z')), '2026-07-15')

  assert.equal(etDateOfEpoch(Number.NaN), null)
  assert.equal(etDateOfEpoch(Number.POSITIVE_INFINITY), null)
})

test('pre-market bar date is the prior session', () => {
  // Monday 2026-10-19 08:00 ET is pre-market (12:00 UTC). The newest daily bar
  // is Friday's 09:30 ET print, not Monday morning.
  const thursdayOpen = Date.parse('2026-10-15T13:30:00.000Z')
  const fridayOpen = Date.parse('2026-10-16T13:30:00.000Z')
  const mondayPremarket = Date.parse('2026-10-19T12:00:00.000Z')
  assert.equal(etDateOfEpoch(fridayOpen), '2026-10-16')
  assert.equal(etDateOfEpoch(mondayPremarket), '2026-10-19')
  assert.equal(barsAsOfFromEpochs([thursdayOpen, fridayOpen]), '2026-10-16')
  assert.equal(barsAsOfFromEpochs([]), null)
  assert.equal(barsAsOfFromEpochs([Number.NaN]), null)
})

test('formatScanFreshnessLine uses local short zone, ET, and omits null pieces', () => {
  const iso = '2026-10-16T13:25:00.000Z'
  const zone = shortZone('Europe/Dublin', iso)
  assert.equal(zone.length > 0, true)
  const full = formatScanFreshnessLine(freshness({ asOf: iso }), { timeZone: 'Europe/Dublin' })
  assert.equal(
    full,
    `Scan 14:25 ${zone} (09:25 ET) · bars Oct 15 · universe 254 (top-12 groups, 1M) · membership Oct 12`,
  )
  assert.equal(full.includes(iso), false)
  assert.equal(full.includes('EDT'), false)
  assert.equal(full.includes('EST'), false)

  const winter = '2026-01-15T14:25:00.000Z'
  const winterZone = shortZone('Europe/Dublin', winter)
  assert.equal(
    formatScanFreshnessLine(freshness({ asOf: winter, barsAsOf: null, universeSize: null, membershipSnapshotDate: null }), {
      timeZone: 'Europe/Dublin',
    }),
    `Scan 14:25 ${winterZone} (09:25 ET)`,
  )

  const omitted = formatScanFreshnessLine(
    freshness({
      barsAsOf: null,
      universeSize: null,
      groupsPeriod: null,
      groupsFetchedAt: null,
      membershipSnapshotDate: null,
    }),
    { timeZone: 'Europe/Dublin' },
  )
  assert.equal(omitted.includes('bars'), false)
  assert.equal(omitted.includes('universe'), false)
  assert.equal(omitted.includes('membership'), false)
  assert.equal(omitted, `Scan 14:25 ${zone} (09:25 ET)`)

  assert.equal(
    formatScanFreshnessLine(
      freshness({ groupsPeriod: null, membershipSnapshotDate: null }),
      { timeZone: 'Europe/Dublin' },
    ),
    `Scan 14:25 ${zone} (09:25 ET) · bars Oct 15 · universe 254`,
  )
  assert.equal(
    formatScanFreshnessLine(freshness({ groupsPeriod: '3m' }), { timeZone: 'America/New_York' }),
    `Scan 09:25 ${shortZone('America/New_York', iso)} (09:25 ET) · bars Oct 15 · universe 254 (top-12 groups, 3M) · membership Oct 12`,
  )

  // generatedAt after 00:00 UTC can still be the previous ET date.
  assert.equal(
    formatScanFreshnessLine(
      freshness({
        barsAsOf: null,
        universeSize: null,
        membershipSnapshotDate: '2026-10-13T02:30:00.000Z',
      }),
      { timeZone: 'Europe/Dublin' },
    ),
    `Scan 14:25 ${zone} (09:25 ET) · membership Oct 12`,
  )

  assert.equal(formatScanFreshnessLine(null), '')
  assert.equal(formatScanFreshnessLine(undefined), '')
  assert.equal(
    formatScanFreshnessLine(freshness({ asOf: 'not-a-time', barsAsOf: null, universeSize: null, membershipSnapshotDate: null })),
    '',
  )
})

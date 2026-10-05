import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  CATALYST_CATEGORIES,
  CATALYST_MIN_SCORE,
  CATALYST_WINDOW_HOURS,
  SUBJECT_MAX_WORD_INDEX,
  SUBJECT_RELATED_OVERRIDE_WORDS,
  classifyHeadline,
  earningsDateIsRecentReport,
  evaluateCatalyst,
  headlineMentionsIssuer,
  itemConcernsIssuer,
} from '../src/lib/catalyst.ts'
import { classifyEarningsProximity } from '../src/lib/metrics.ts'
import {
  CATALYST_FETCH,
  clearCatalystStore,
  isCatalystCandidate,
  mergeCatalystIntoIdeas,
  noteCatalystRefreshFailure,
  seedCatalystCache,
  selectCatalystCandidates,
} from './catalystService.ts'
import { createJobQueue, maxInAnyWindow, TokenBucket } from './requestBudget.ts'
import type { TradingIdea } from '../src/types/index.ts'

const HOUR = 3600 * 1000

function idea(partial: Partial<TradingIdea>): TradingIdea {
  return {
    ticker: 'AAA',
    name: 'Aaa',
    groupId: 'g',
    groupName: 'G',
    price: 10,
    dayPct: 0,
    rvol: 1,
    adrPct: 3,
    pctFrom52wHigh: -2,
    perf1M: 1,
    perf3M: 1,
    avgDollarVol: 1,
    sma200: 8,
    sma50: 9,
    aboveSma200: true,
    aboveSma50: true,
    pctAboveSma200: 1,
    pctAboveSma50: 1,
    extensionAdr50: 0.3,
    setupType: 'Continuation',
    catalyst: null,
    isAPlus: false,
    notes: '',
    whyQualifies: '',
    suggestedEntry: null,
    suggestedStop: null,
    sparkline: [],
    sma10: 9,
    sma20: 9,
    aboveSma10: true,
    aboveSma20: true,
    priorRunPct: 10,
    tightDays: 3,
    baseLengthDays: 3,
    dollarVolume: 1,
    kyleScore: 3,
    characteristics: [],
    setupStage: 'watching',
    perf6M: 1,
    earningsDate: null,
    daysToEarnings: null,
    earningsStatus: 'clear',
    surfer10: false,
    surfer20: false,
    surfer50: false,
    tightConsolidation: false,
    ...partial,
  }
}

test('synthetic headlines: each category, noise vetoes, analyst bonus, direction', () => {
  const cases: { name: string; headline: string; source?: string; summary?: string; important: boolean; id?: string; direction?: string; noise?: boolean }[] = [
    { name: 'synthetic mna', headline: 'Acme agrees to be acquired in a $4 billion buyout', important: true, id: 'mna' },
    { name: 'synthetic fda clinical', headline: 'FDA approves Acme drug after positive Phase 3 results', important: true, id: 'fda_clinical' },
    { name: 'synthetic fda reject', headline: 'FDA rejects Acme filing with a complete response letter', important: true, id: 'fda_reject', direction: 'negative' },
    { name: 'synthetic earnings beat', headline: 'Acme reports Q3 earnings and the revenue beat estimates', important: true, id: 'earnings', direction: 'positive' },
    { name: 'synthetic earnings miss', headline: 'Acme Q2 earnings miss analyst estimates', important: true, id: 'earnings', direction: 'negative' },
    { name: 'synthetic guidance raise', headline: 'Acme raises guidance above consensus', important: true, id: 'guidance', direction: 'positive' },
    { name: 'synthetic guidance cut', headline: 'Acme cuts guidance and lowers its outlook', important: true, id: 'guidance', direction: 'negative' },
    { name: 'synthetic offering', headline: 'Acme prices a $200 million public offering', important: true, id: 'offering_dilution', direction: 'negative' },
    { name: 'synthetic contract', headline: 'Acme wins a multi-year agreement to supply the Navy', important: true, id: 'contract_deal' },
    { name: 'synthetic index', headline: 'Acme will be added to the S&P 500', important: true, id: 'index_inclusion' },
    { name: 'synthetic buyback', headline: 'Acme board approves a $1 billion share repurchase', important: true, id: 'buyback_dividend' },
    { name: 'synthetic activist', headline: 'Activist investor takes a 9% stake in Acme', important: true, id: 'activist_squeeze' },
    { name: 'synthetic regulatory', headline: 'Acme scores a court win and a tariff exemption', important: true, id: 'regulatory_win' },
    { name: 'synthetic spinoff', headline: 'Acme announces a spin-off of its software unit', important: true, id: 'spinoff' },
    { name: 'synthetic downgrade', headline: 'A desk downgrades Acme and cuts its price target', important: true, id: 'downgrade', direction: 'negative' },
    { name: 'synthetic cut to sell', headline: 'A desk cuts Acme to Sell', important: true, id: 'downgrade', direction: 'negative' },
    { name: 'synthetic lowers rating', headline: 'A desk lowers its rating on Acme to hold', important: true, id: 'downgrade', direction: 'negative' },
    { name: 'synthetic down is not a downgrade', headline: 'Acme is down 34% over five years', important: false },
    { name: 'synthetic cost cut is not a downgrade', headline: 'Acme cuts costs to fund a new plant', important: false },
    { name: 'synthetic lowered expenses are not a downgrade', headline: 'Acme lowered operating expenses in the quarter', important: false },
    { name: 'synthetic shareholder recap is not a buyback', headline: "Acme returned $2 billion to shareholders last quarter. Here's the buyback-to-dividend split.", important: false, noise: true },
    { name: 'synthetic soar recap without an event is noise', headline: 'Acme soars 8% as the sector rallies', important: false, noise: true },
    { name: 'synthetic soar with earnings stays', headline: 'Acme soars 15.8% as Q3 earnings crush estimates', important: true, id: 'earnings', noise: false },
    { name: 'synthetic probe', headline: 'SEC investigation opens into Acme accounting', important: true, id: 'lawsuit_probe', direction: 'negative' },
    { name: 'synthetic closed probe is a win', headline: 'SEC investigation closed against Acme', important: true, id: 'regulatory_win' },
    { name: 'synthetic launch', headline: 'Acme launches a new chip platform', important: true, id: 'product_launch' },
    { name: 'synthetic insider', headline: 'CEO buys $2 million of Acme stock', important: true, id: 'insider_inst_buy' },
    { name: 'synthetic analyst alone', headline: 'A small shop upgrades Acme to buy', important: false, id: 'analyst' },
    { name: 'synthetic analyst big firm', headline: 'Goldman Sachs upgrades Acme to overweight', important: true, id: 'analyst' },
    { name: 'synthetic price target raise', headline: 'Street upgrades Acme and the price target raised to 40', important: true, id: 'analyst' },
    { name: 'synthetic reiteration', headline: 'Goldman Sachs reiterates its buy rating on Acme', important: false, noise: true },
    { name: 'synthetic earnings preview', headline: 'Acme earnings preview: what to expect next week', important: false, noise: true },
    { name: 'synthetic noise listicle', headline: 'Top stocks to buy this month', important: false, noise: true },
    { name: 'synthetic noise veto unless strong', headline: 'Stocks to watch: Acme to be acquired', important: true, id: 'mna', noise: true },
    { name: 'synthetic breaking alone', headline: 'Breaking news: trading halted in Acme', important: false, id: 'breaking' },
    { name: 'synthetic motley source', headline: 'Acme launches a new chip platform', source: 'Motley Fool', important: false, noise: true },
    {
      name: 'synthetic summary-only acquisition is not a category',
      headline: 'Acme stock gets a fair value boost as analyst views shift',
      summary: 'The piece also mentions an acquisition and a share repurchase.',
      important: false,
    },
    {
      name: 'synthetic summary can flip an earnings headline to a miss',
      headline: 'Acme reports Q3 earnings',
      summary: 'The company misses estimates.',
      important: true,
      id: 'earnings',
      direction: 'negative',
    },
    {
      name: 'synthetic summary big-firm bonus confirms an upgrade',
      headline: 'A desk upgrades Acme to buy',
      summary: 'Goldman Sachs was the firm behind the call.',
      important: true,
      id: 'analyst',
    },
    {
      name: 'synthetic summary noise does not veto a headline earnings beat',
      headline: 'Acme reports Q3 earnings and the revenue beat estimates',
      summary: 'Stocks to watch this week include several other names and an acquisition rumor.',
      important: true,
      id: 'earnings',
    },
  ]
  const seen = new Set<string>()
  for (const row of cases) {
    const result = classifyHeadline(row.headline, row.summary, row.source)
    assert.equal(result.important, row.important, row.name)
    if (row.noise != null) assert.equal(result.noise, row.noise, row.name)
    if (row.id) {
      assert.ok(result.categories.some((c) => c.id === row.id), `${row.name} missing ${row.id}`)
      seen.add(row.id)
    }
    if (row.direction) assert.equal(result.direction, row.direction, row.name)
    if (row.important) assert.ok(result.score >= CATALYST_MIN_SCORE, row.name)
  }
  for (const category of CATALYST_CATEGORIES) {
    assert.ok(seen.has(category.id), `missing synthetic coverage for ${category.id}`)
  }
  const firm = classifyHeadline('Goldman Sachs upgrades Acme to buy')
  const plain = classifyHeadline('A small shop upgrades Acme to buy')
  assert.ok(firm.score >= plain.score + 1)
  const closed = classifyHeadline('SEC investigation closed against Acme')
  assert.equal(closed.categories.some((c) => c.id === 'lawsuit_probe'), false)
  assert.equal(headlineMentionsIssuer('NVIDIA (NVDA) stock rises', 'NVDA', 'NVIDIA Corporation'), true)
  assert.equal(headlineMentionsIssuer('Micron lifts its outlook', 'MU', 'Micron Technology Inc.'), true)
  assert.equal(headlineMentionsIssuer("What's going on with AMD stock Thursday?", 'META', 'Meta Platforms Inc.'), false)
  assert.equal(headlineMentionsIssuer('Ford (F) reports earnings', 'F', 'Ford Motor Company'), true)
  assert.equal(
    headlineMentionsIssuer('Devices win a multi-year contract', 'AMD', 'Advanced Micro Devices Inc.'),
    false,
  )
  const bonus = classifyHeadline('A desk upgrades Acme to buy', 'Goldman Sachs was the firm behind the call.')
  assert.equal(bonus.categories.map((c) => c.id).join(','), 'analyst')
  const recap = classifyHeadline(
    "Acme returned $2 billion to shareholders last quarter. Here's the buyback-to-dividend split.",
  )
  assert.equal(recap.categories.some((c) => c.id === 'buyback_dividend'), false)
  for (const headline of [
    'Acme is down 34% over five years',
    'Acme cuts costs to fund a new plant',
    'Acme lowered operating expenses in the quarter',
    'Pfizer (PFE) Advances Tilrekimig After Positive Phase 2 Atopic Dermatitis Results',
  ]) {
    assert.equal(classifyHeadline(headline).categories.some((c) => c.id === 'downgrade'), false, headline)
  }
})

test('unrelated Finnhub wire is dropped and a related item is kept', () => {
  const now = Date.parse('2026-10-02T15:00:00.000Z')
  const hpe = 'HPE Networking Outlook Gets Boost as Barclays, Citi and Wells Fargo Raise Price Targets'
  const hpeSummary = 'Citi, Barclays, and Wells Fargo all lifted their HPE price targets. Micron also raises guidance and agreed to an acquisition.'
  assert.equal(
    itemConcernsIssuer({ headline: hpe, related: ['AMD'], sourceFeed: 'finnhub' }, 'AMD', 'Advanced Micro Devices Inc.'),
    false,
  )
  const hpeClass = classifyHeadline(hpe, hpeSummary)
  assert.equal(hpeClass.categories.some((c) => c.id === 'mna' || c.id === 'guidance'), false)
  const micron = 'Micron raises guidance after record quarterly results'
  assert.equal(classifyHeadline(micron).important, true)
  assert.equal(
    itemConcernsIssuer({ headline: micron, related: ['AMD'], sourceFeed: 'finnhub' }, 'AMD', 'Advanced Micro Devices Inc.'),
    false,
  )
  const summaryOnly = classifyHeadline(
    'Acme shares are in focus today',
    'The company raises guidance and Goldman Sachs upgrades the stock with the price target raised.',
  )
  assert.deepEqual(summaryOnly.categories, [])
  assert.equal(summaryOnly.important, false)
  const dropped = evaluateCatalyst(
    [
      { headline: hpe, summary: hpeSummary, datetimeMs: now - HOUR, related: ['AMD'], sourceFeed: 'finnhub', source: 'Yahoo' },
      { headline: micron, datetimeMs: now - 2 * HOUR, related: ['AMD'], sourceFeed: 'finnhub', source: 'Wire' },
    ],
    now,
    null,
    { ticker: 'AMD', name: 'Advanced Micro Devices Inc.' },
  )
  assert.equal(dropped.hasCatalyst, false)

  const kept = evaluateCatalyst(
    [{
      headline: 'Advanced Micro Devices to be acquired in a $40 billion buyout',
      datetimeMs: now - HOUR,
      related: ['AMD'],
      sourceFeed: 'finnhub',
      source: 'Wire',
    }],
    now,
    null,
    { ticker: 'AMD', name: 'Advanced Micro Devices Inc.' },
  )
  assert.equal(kept.hasCatalyst, true)
  assert.ok(kept.categories.includes('M&A'))

  const multi = evaluateCatalyst(
    [{
      headline: 'Two chipmakers agree to a merger',
      datetimeMs: now - HOUR,
      related: ['AMD', 'NVDA'],
      sourceFeed: 'finnhub',
    }],
    now,
    null,
    { ticker: 'AMD', name: 'Advanced Micro Devices Inc.' },
  )
  assert.equal(multi.hasCatalyst, false)

  const multiNamed = evaluateCatalyst(
    [{
      headline: 'AMD agrees to a merger with another chipmaker',
      datetimeMs: now - HOUR,
      related: ['AMD', 'NVDA'],
      sourceFeed: 'finnhub',
    }],
    now,
    null,
    { ticker: 'AMD', name: 'Advanced Micro Devices Inc.' },
  )
  assert.equal(multiNamed.hasCatalyst, true)

  const otherStamp = evaluateCatalyst(
    [{
      headline: 'Tesla agrees to be acquired',
      datetimeMs: now - HOUR,
      related: ['TSLA'],
      sourceFeed: 'finnhub',
    }],
    now,
    null,
    { ticker: 'AAPL', name: 'Apple Inc.' },
  )
  assert.equal(otherStamp.hasCatalyst, false)

  const yahooRelatedOnly = evaluateCatalyst(
    [{
      headline: 'Company wins a multi-year Navy agreement',
      datetimeMs: now - HOUR,
      related: ['BA'],
      sourceFeed: 'yahoo',
    }],
    now,
    null,
    { ticker: 'BA', name: 'Boeing Co' },
  )
  assert.equal(yahooRelatedOnly.hasCatalyst, false)

  const yahooKept = evaluateCatalyst(
    [{
      headline: 'Boeing wins a multi-year Navy agreement',
      datetimeMs: now - HOUR,
      related: ['BA'],
      sourceFeed: 'yahoo',
    }],
    now,
    null,
    { ticker: 'BA', name: 'Boeing Co' },
  )
  assert.equal(yahooKept.hasCatalyst, true)

  const yahooOther = evaluateCatalyst(
    [{
      headline: 'NVIDIA wins a multi-year agreement',
      datetimeMs: now - HOUR,
      related: ['NVDA'],
      sourceFeed: 'yahoo',
    }],
    now,
    null,
    { ticker: 'AMD', name: 'Advanced Micro Devices Inc.' },
  )
  assert.equal(yahooOther.hasCatalyst, false)

  const yahooHeadline = evaluateCatalyst(
    [{
      headline: 'AMD wins a multi-year agreement',
      datetimeMs: now - HOUR,
      sourceFeed: 'yahoo',
    }],
    now,
    null,
    { ticker: 'AMD', name: 'Advanced Micro Devices Inc.' },
  )
  assert.equal(yahooHeadline.hasCatalyst, true)
})

test('48h boundary and past earnings date, without changing future-earnings avoid', () => {
  const now = Date.parse('2026-10-02T15:00:00.000Z')
  const inside = now - (CATALYST_WINDOW_HOURS * HOUR - 60 * 1000)
  const outside = now - (CATALYST_WINDOW_HOURS * HOUR + 60 * 1000)
  const headline = 'Acme reports Q3 earnings and revenue beat'
  const inn = evaluateCatalyst([{ headline, datetimeMs: inside, source: 'Wire', url: 'https://example.com/a' }], now)
  const out = evaluateCatalyst([{ headline, datetimeMs: outside, source: 'Wire', url: 'https://example.com/b' }], now)
  assert.equal(inn.hasCatalyst, true)
  assert.equal(out.hasCatalyst, false)
  assert.ok(Math.abs((inn.ageHours ?? 0) - (47 + 59 / 60)) < 0.05)

  const day = '2026-10-01'
  assert.equal(earningsDateIsRecentReport(day, now), true)
  assert.equal(earningsDateIsRecentReport('2026-10-08', now), false)
  const fromCalendar = evaluateCatalyst([], now, day)
  assert.equal(fromCalendar.hasCatalyst, true)
  assert.deepEqual(fromCalendar.categories, ['Earnings'])
  assert.equal(fromCalendar.topSource, 'earnings calendar')
  assert.equal(fromCalendar.topUrl, undefined)
  assert.match(fromCalendar.topHeadline ?? '', /Earnings reported 2026-10-01/)

  const past = classifyEarningsProximity('2026-10-01', '2026-10-02')
  const ahead = classifyEarningsProximity('2026-10-06', '2026-10-02')
  assert.equal(past.earningsStatus, 'clear')
  assert.equal(past.daysToEarnings, null)
  assert.equal(typeof ahead.earningsStatus, 'string')
})

test('real Yahoo headlines from 2026-10-02 classify without invented categories', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(process.cwd(), 'server/fixtures/yahoo-news-catalyst-sample.json'), 'utf8'),
  ) as {
    label: string
    fetchedAt: string
    symbols: Record<string, { headline: string; publisher: string; providerPublishTime: number }[]>
  }
  assert.match(fixture.label, /real-data sample/)
  assert.equal(fixture.fetchedAt, '2026-10-02')
  const find = (sym: string, needle: string) => {
    const row = fixture.symbols[sym]!.find((item) => item.headline.includes(needle))
    assert.ok(row, `${sym} ${needle}`)
    return row!
  }
  const phase = find('PFE', 'Positive Phase 2')
  const phaseHit = classifyHeadline(phase.headline, undefined, phase.publisher)
  assert.equal(phaseHit.important, true)
  assert.ok(phaseHit.categories.some((c) => c.id === 'fda_clinical'))

  const boeing = find('BA', 'Wins Navy')
  const boeingHit = classifyHeadline(boeing.headline, undefined, boeing.publisher)
  assert.equal(boeingHit.important, true)
  assert.ok(boeingHit.categories.some((c) => c.id === 'contract_deal'))

  const order = find('AMD', 'Helios order')
  const orderHit = classifyHeadline(order.headline, undefined, order.publisher)
  assert.ok(orderHit.categories.some((c) => c.id === 'contract_deal'))

  const dilution = find('AMD', 'Adds Dilution')
  const dilutionHit = classifyHeadline(dilution.headline, undefined, dilution.publisher)
  assert.ok(dilutionHit.categories.some((c) => c.id === 'offering_dilution'))
  assert.equal(dilutionHit.categories.some((c) => c.id === 'mna'), false)
  assert.equal(dilutionHit.direction, 'negative')

  const down = find('XOM', 'downgrades Exxon')
  const downHit = classifyHeadline(down.headline, undefined, down.publisher)
  assert.ok(downHit.categories.some((c) => c.id === 'downgrade'))
  assert.equal(downHit.important, true)

  const fool = find('AMD', 'Applied Materials vs. AMD')
  const foolHit = classifyHeadline(fool.headline, undefined, fool.publisher)
  assert.equal(foolHit.noise, true)
  assert.equal(foolHit.important, false)

  const zacks = find('PFE', 'What You Should Know')
  const zacksHit = classifyHeadline(zacks.headline, undefined, zacks.publisher)
  assert.equal(zacksHit.noise, true)
  assert.equal(zacksHit.important, false)

  const retiring = find('JPM', 'M&A chief')
  const retiringHit = classifyHeadline(retiring.headline, undefined, retiring.publisher)
  assert.equal(retiringHit.categories.some((c) => c.id === 'mna'), false)
  assert.equal(retiringHit.important, false)
})

test('token bucket stays inside 25 per minute and the queue stays at concurrency 2', async () => {
  const bucket = new TokenBucket(CATALYST_FETCH.finnhubPerMinute, CATALYST_FETCH.windowMs)
  const taken: number[] = []
  for (let i = 0; i < 25; i += 1) {
    assert.equal(bucket.tryTake(0), true)
    taken.push(0)
  }
  assert.equal(bucket.tryTake(0), false)
  assert.equal(bucket.delayMs(59_999), 1)
  assert.equal(bucket.tryTake(60_000), true)
  taken.push(60_000)
  assert.ok(maxInAnyWindow(taken, 60_000) <= 25)

  const queue = createJobQueue(CATALYST_FETCH.concurrency)
  let active = 0
  let max = 0
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      await queue.acquire()
      active += 1
      max = Math.max(max, active)
      await new Promise((resolve) => setTimeout(resolve, 15))
      active -= 1
      queue.release()
    }),
  )
  assert.ok(max <= 2)
  assert.equal(queue.active, 0)
})

test('candidate priority, cap, cache ttl, stale-on-error, and response merge', () => {
  const rows = [
    { ticker: 'WATCH', setupStage: 'watching', rvol: 9, dayPct: 0, isAPlus: false },
    { ticker: 'COIL', setupStage: 'coiled', rvol: 1, dayPct: 0, isAPlus: false },
    { ticker: 'TRIG', setupStage: 'triggering', rvol: 1.1, dayPct: 0, isAPlus: false },
    { ticker: 'LOUD', setupStage: 'watching', rvol: 0.4, dayPct: 6, isAPlus: false },
    { ticker: 'QUIET', setupStage: 'watching', rvol: 0.2, dayPct: 0.1, isAPlus: false },
  ]
  assert.equal(isCatalystCandidate(rows[4]!), false)
  assert.equal(isCatalystCandidate(rows[3]!), true)
  const picked = selectCatalystCandidates(rows, { cap: 3 })
  assert.deepEqual(picked.map((row) => row.ticker), ['TRIG', 'COIL', 'WATCH'])
  const all = selectCatalystCandidates(rows, { includeAll: true, cap: 120 })
  assert.equal(all.length, rows.length)
  assert.equal(all[0]!.ticker, 'TRIG')

  clearCatalystStore()
  const now = 1_000_000
  const evaluation = evaluateCatalyst(
    [{ headline: 'FDA approves Acme drug', datetimeMs: now - HOUR, source: 'Wire', url: 'https://example.com/fda' }],
    now,
  )
  seedCatalystCache('NVDA', evaluation, { now, status: 'checked' })
  const hit = mergeCatalystIntoIdeas([idea({ ticker: 'NVDA', setupStage: 'coiled' })], now)
  assert.equal(hit.ideas[0]!.catalystStatus, 'checked')
  assert.equal(hit.ideas[0]!.hasCatalyst, true)
  assert.equal(hit.ideas[0]!.catalyst, evaluation.topHeadline)
  assert.equal(hit.meta.checked, 1)
  assert.equal(hit.meta.pending, 0)

  const expired = mergeCatalystIntoIdeas([idea({ ticker: 'NVDA', setupStage: 'coiled' })], now + CATALYST_FETCH.ttlMs + 1)
  assert.equal(expired.ideas[0]!.catalystStatus, 'pending')
  assert.equal(expired.ideas[0]!.hasCatalyst, false)

  seedCatalystCache('NVDA', evaluation, { now, status: 'checked' })
  noteCatalystRefreshFailure('NVDA', now + 1000)
  const stale = mergeCatalystIntoIdeas([idea({ ticker: 'NVDA', setupStage: 'coiled' })], now + 1000)
  assert.equal(stale.ideas[0]!.catalystStatus, 'checked')
  assert.equal(stale.ideas[0]!.hasCatalyst, true)
  const afterNegative = mergeCatalystIntoIdeas(
    [idea({ ticker: 'NVDA', setupStage: 'coiled' })],
    now + 1000 + CATALYST_FETCH.negativeTtlMs + 1,
  )
  assert.equal(afterNegative.ideas[0]!.catalystStatus, 'pending')

  clearCatalystStore()
  seedCatalystCache('ERR', null, { now, status: 'error' })
  const failed = mergeCatalystIntoIdeas([idea({ ticker: 'ERR', setupStage: 'triggering' })], now)
  assert.equal(failed.ideas[0]!.catalystStatus, 'error')
  assert.equal(failed.meta.failed, 1)
  const quiet = mergeCatalystIntoIdeas([idea({ ticker: 'ZZZ', setupStage: 'watching', rvol: 0.2, dayPct: 0 })], now)
  assert.equal(quiet.ideas[0]!.catalystStatus, 'unchecked')
  assert.equal(quiet.ideas[0]!.hasCatalyst, false)
  assert.equal(quiet.ideas[0]!.catalyst, null)
  assert.equal(quiet.meta.pending, 0)
  assert.equal(quiet.meta.unchecked, 1)
})

test('subject window, object position, and related lists', () => {
  assert.ok(SUBJECT_RELATED_OVERRIDE_WORDS < SUBJECT_MAX_WORD_INDEX)
  const now = Date.parse('2026-10-02T18:00:00.000Z')
  const earnings = 'reports Q3 earnings and revenue beat'
  const at = (index: number, token: string) =>
    `${Array.from({ length: index }, (_, i) => `Pad${i}`).join(' ')} ${token} ${earnings}`.trim()

  assert.equal(headlineMentionsIssuer(at(SUBJECT_MAX_WORD_INDEX - 1, 'AMD'), 'AMD', 'Advanced Micro Devices Inc.'), true)
  assert.equal(headlineMentionsIssuer(at(SUBJECT_MAX_WORD_INDEX, 'AMD'), 'AMD', 'Advanced Micro Devices Inc.'), false)
  assert.equal(headlineMentionsIssuer('NASDAQ:NVDA reports Q3 earnings and revenue beat', 'NVDA', 'NVIDIA Corporation'), true)
  assert.equal(headlineMentionsIssuer('NYSE:F reports Q3 earnings and revenue beat', 'F', 'Ford Motor Company'), true)
  assert.equal(headlineMentionsIssuer('$MU raises guidance after the quarter', 'MU', 'Micron Technology'), true)
  assert.equal(headlineMentionsIssuer('mu raises guidance after the quarter', 'MU', 'Micron Technology'), false)

  assert.equal(
    headlineMentionsIssuer('SoftBank to acquire AMD in a $40 billion buyout', 'AMD', 'Advanced Micro Devices Inc.'),
    true,
  )
  assert.equal(
    headlineMentionsIssuer('Acme acquires AMD in a $40 billion buyout', 'AMD', 'Advanced Micro Devices Inc.'),
    false,
  )
  assert.equal(
    headlineMentionsIssuer('AMD agrees to be acquired by Acme in a buyout', 'AMD', 'Advanced Micro Devices Inc.'),
    true,
  )
  assert.equal(
    headlineMentionsIssuer('AMD to be acquired in a $40 billion buyout', 'AMD', 'Advanced Micro Devices Inc.'),
    true,
  )
  assert.equal(
    headlineMentionsIssuer('Customer orders AMD chips under a new supply agreement', 'AMD', 'Advanced Micro Devices Inc.'),
    false,
  )

  const nvidiaBacked =
    'Nvidia-Backed Nebius Acquires Inferize To Reduce Idle GPU Costs Across AI Inference Workloads'
  assert.equal(headlineMentionsIssuer(nvidiaBacked, 'NVDA', 'NVIDIA Corporation'), false)
  assert.equal(itemConcernsIssuer({ headline: nvidiaBacked }, 'NVDA', 'NVIDIA Corporation'), false)
  const amdBuyout = "AMD's World Labs Buyout"
  assert.equal(headlineMentionsIssuer(amdBuyout, 'AMD', 'Advanced Micro Devices Inc.'), true)
  assert.equal(itemConcernsIssuer({ headline: amdBuyout }, 'AMD', 'Advanced Micro Devices Inc.'), true)

  const evalAt = (headline: string, related?: string[]) =>
    evaluateCatalyst(
      [{ headline, datetimeMs: now - HOUR, related, sourceFeed: 'yahoo' }],
      now,
      null,
      { ticker: 'AMD', name: 'Advanced Micro Devices Inc.' },
    )

  assert.equal(evalAt(at(0, 'AMD'), ['INTC']).hasCatalyst, true)
  assert.equal(evalAt(at(SUBJECT_RELATED_OVERRIDE_WORDS, 'AMD'), ['INTC']).hasCatalyst, false)
  assert.equal(evalAt(at(SUBJECT_RELATED_OVERRIDE_WORDS, 'AMD'), ['AMD']).hasCatalyst, true)
  assert.equal(evalAt(at(SUBJECT_RELATED_OVERRIDE_WORDS, 'AMD')).hasCatalyst, true)
  assert.equal(
    evaluateCatalyst(
      [{
        headline: 'Tesla agrees to be acquired',
        datetimeMs: now - HOUR,
        related: ['NVDA'],
        sourceFeed: 'finnhub',
      }],
      now,
      null,
      { ticker: 'NVDA', name: 'NVIDIA Corporation' },
    ).hasCatalyst,
    false,
  )
})

test('real scan headlines: issuer must be the subject, categories stay precise', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(process.cwd(), 'server/fixtures/catalyst-subject-headlines.json'), 'utf8'),
  ) as {
    label: string
    observedAt: string
    cases: {
      id: string
      headline: string
      ticker: string
      name: string
      related?: string[]
      sourceFeed?: 'yahoo' | 'finnhub'
      publisher?: string
      hasCatalyst: boolean
      labels?: string[]
      classifyIds?: string[]
      forbidIds?: string[]
      noise?: boolean
      direction?: string
    }[]
  }
  assert.match(fixture.label, /real headlines/)
  assert.equal(fixture.observedAt, '2026-10-02')
  const now = Date.parse('2026-10-02T18:00:00.000Z')
  assert.ok(fixture.cases.length >= 15)
  for (const row of fixture.cases) {
    const classified = classifyHeadline(row.headline, undefined, row.publisher)
    if (row.noise != null) assert.equal(classified.noise, row.noise, row.id)
    for (const id of row.classifyIds ?? []) {
      assert.ok(classified.categories.some((c) => c.id === id), `${row.id} missing ${id}`)
    }
    for (const id of row.forbidIds ?? []) {
      assert.equal(classified.categories.some((c) => c.id === id), false, `${row.id} forbids ${id}`)
    }
    const evaluation = evaluateCatalyst(
      [{
        headline: row.headline,
        datetimeMs: now - HOUR,
        related: row.related,
        sourceFeed: row.sourceFeed,
        source: row.publisher,
      }],
      now,
      null,
      { ticker: row.ticker, name: row.name },
    )
    assert.equal(evaluation.hasCatalyst, row.hasCatalyst, row.id)
    assert.deepEqual(evaluation.categories, row.labels ?? [], row.id)
    if (row.direction) assert.equal(evaluation.direction, row.direction, row.id)
  }
})

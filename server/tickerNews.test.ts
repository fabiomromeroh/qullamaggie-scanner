import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  finalizeNewsItems,
  isHttpUrl,
  parseFinnhubNews,
  parseRelatedTickers,
  parseYahooNews,
  type NewsItem,
} from './tickerNews.ts'

const finnhubRaw = JSON.parse(
  readFileSync(resolve(process.cwd(), 'server/fixtures/finnhub-amd-news-sample.json'), 'utf8'),
) as unknown
const yahooRaw = JSON.parse(
  readFileSync(resolve(process.cwd(), 'server/fixtures/yahoo-amd-news-sample.json'), 'utf8'),
) as unknown

test('parseFinnhubNews reads a trimmed live AMD sample', () => {
  const items = parseFinnhubNews(finnhubRaw)
  assert.ok(items.length >= 3)
  assert.ok(items.every((i) => i.headline && isHttpUrl(i.url) && i.datetime.endsWith('Z')))
  assert.equal(
    items[0]?.headline,
    'HPE Networking Outlook Gets Boost as Barclays, Citi and Wells Fargo Raise Price Targets',
  )
  assert.equal(items[0]?.source, 'Yahoo')
  assert.equal(items[2]?.source, 'SeekingAlpha')
  assert.deepEqual(items[0]?.related, ['AMD'])
})

test('parseYahooNews reads a trimmed live AMD search sample', () => {
  const items = parseYahooNews(yahooRaw)
  assert.ok(items.length >= 4)
  assert.equal(
    items[0]?.headline,
    'Advanced Micro Devices (AMD) Benefit from Surging CPU Demand in Autonomous AI',
  )
  assert.equal(items[0]?.source, 'Insider Monkey')
  assert.ok(items[0]?.url.startsWith('https://'))
  assert.ok(items[0]?.datetime.startsWith('20'))
  assert.deepEqual(items[0]?.related, ['AMD'])
  assert.deepEqual(parseRelatedTickers('AAPL, MSFT, aapl'), ['AAPL', 'MSFT'])
  assert.equal(parseRelatedTickers(''), undefined)
})

test('parseFinnhubNews and parseYahooNews ignore empty/invalid payloads', () => {
  assert.deepEqual(parseFinnhubNews(null), [])
  assert.deepEqual(parseFinnhubNews({ error: 'no' }), [])
  assert.deepEqual(parseYahooNews({ news: [] }), [])
  assert.deepEqual(
    parseFinnhubNews([
      { headline: 'x', url: 'javascript:alert(1)', datetime: 1_700_000_000, source: 'x' },
      { headline: '', url: 'https://example.com/a', datetime: 1_700_000_000 },
    ]),
    [],
  )
})

test('finalizeNewsItems filters URLs, dedupes, sorts newest first, and caps at 10', () => {
  const items: NewsItem[] = [
    {
      headline: 'Old',
      source: 'A',
      datetime: '2026-09-01T00:00:00.000Z',
      url: 'https://example.com/old',
    },
    {
      headline: 'New',
      source: 'B',
      datetime: '2026-09-30T00:00:00.000Z',
      url: 'https://example.com/new',
    },
    {
      headline: 'New',
      source: 'C',
      datetime: '2026-09-29T00:00:00.000Z',
      url: 'https://example.com/dup-headline',
    },
    {
      headline: 'Same url',
      source: 'D',
      datetime: '2026-09-28T00:00:00.000Z',
      url: 'https://example.com/new/',
    },
    {
      headline: 'Bad',
      source: 'E',
      datetime: '2026-09-27T00:00:00.000Z',
      url: 'javascript:void(0)',
    },
    {
      headline: 'Ftp',
      source: 'F',
      datetime: '2026-09-26T00:00:00.000Z',
      url: 'ftp://example.com/x',
    },
  ]
  for (let i = 0; i < 12; i++) {
    items.push({
      headline: `Extra ${i}`,
      source: 'Z',
      datetime: `2026-08-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`,
      url: `https://example.com/extra-${i}`,
    })
  }
  const out = finalizeNewsItems(items, 10)
  assert.equal(out.length, 10)
  assert.equal(out[0]?.headline, 'New')
  assert.ok(out.every((i) => i.url.startsWith('http')))
  assert.equal(out.filter((i) => i.headline === 'New').length, 1)
  assert.equal(out.some((i) => i.headline === 'Same url'), false)
  assert.equal(out.some((i) => i.headline === 'Bad'), false)
})

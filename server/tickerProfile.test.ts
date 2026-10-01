import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  coreNameMatches,
  normalizeCompanyName,
  parseFinnhubProfile,
  parseOpenSearch,
  parseWikipediaSummary,
  trimToSentences,
} from './tickerProfile.ts'

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'server/fixtures', name), 'utf8'))
}

test('parseFinnhubProfile maps AMD facts and converts market cap from millions', () => {
  const facts = parseFinnhubProfile(readJson('finnhub-amd-profile-sample.json'))
  assert.ok(facts)
  assert.equal(facts!.name, 'Advanced Micro Devices Inc')
  assert.equal(facts!.industry, 'Semiconductors')
  assert.equal(facts!.exchange, 'NASDAQ NMS - GLOBAL MARKET')
  assert.equal(facts!.weburl, 'https://www.amd.com/')
  assert.ok(facts!.marketCap)
  assert.ok(Math.abs(facts!.marketCap! - 991434.7179996914 * 1_000_000) < 1)
})

test('parseFinnhubProfile returns null for empty objects', () => {
  assert.equal(parseFinnhubProfile({}), null)
  assert.equal(parseFinnhubProfile(null), null)
})

test('normalizeCompanyName strips Inc/Corp/Ltd and punctuation', () => {
  assert.equal(normalizeCompanyName('Advanced Micro Devices, Inc.'), 'advanced micro devices')
  assert.equal(normalizeCompanyName('Apple Inc.'), 'apple')
  assert.equal(normalizeCompanyName('Berkshire Hathaway Inc. Class B'), 'berkshire hathaway')
})

test('coreNameMatches accepts AMD and Apple Wikipedia titles', () => {
  assert.equal(
    coreNameMatches('Advanced Micro Devices, Inc.', 'Advanced Micro Devices'),
    true,
  )
  assert.equal(coreNameMatches('Apple Inc.', 'Apple'), true)
  assert.equal(coreNameMatches('Apple Inc.', 'Apple Inc.'), true)
})

test('coreNameMatches rejects unrelated and weak substring hits', () => {
  assert.equal(coreNameMatches('Advanced Micro Devices, Inc.', 'Apple'), false)
  assert.equal(coreNameMatches('Iovance Biotherapeutics, Inc.', 'Iowa'), false)
  assert.equal(coreNameMatches('Caterpillar Inc.', 'Cat'), false)
})

test('parseWikipediaSummary accepts the live AMD extract even when the title is AMD', () => {
  const parsed = parseWikipediaSummary(
    readJson('wikipedia-amd-summary-sample.json'),
    'Advanced Micro Devices Inc',
  )
  assert.ok(parsed)
  assert.ok(parsed!.description.startsWith('Advanced Micro Devices'))
  assert.ok(parsed!.description.length <= 420)
})

test('parseWikipediaSummary accepts Apple Inc. vs Apple Inc. page', () => {
  const parsed = parseWikipediaSummary(readJson('wikipedia-apple-inc-summary-sample.json'), 'Apple Inc.')
  assert.ok(parsed)
  assert.equal(parsed!.title, 'Apple Inc.')
})

test('parseWikipediaSummary rejects a disambiguation page', () => {
  const parsed = parseWikipediaSummary(
    readJson('wikipedia-mercury-disambiguation-sample.json'),
    'Mercury Systems, Inc.',
  )
  assert.equal(parsed, null)
})

test('parseWikipediaSummary rejects an unrelated fruit page for AMD', () => {
  const parsed = parseWikipediaSummary(
    readJson('wikipedia-apple-fruit-summary-sample.json'),
    'Advanced Micro Devices, Inc.',
  )
  assert.equal(parsed, null)
})

test('trimToSentences cuts at a sentence boundary under the char cap', () => {
  const text =
    'First sentence is short. Second sentence is also short. Third sentence would make this longer than we want if we kept adding words forever and ever without stopping at all.'
  const trimmed = trimToSentences(text, 3, 80)
  assert.equal(trimmed.endsWith('.'), true)
  assert.ok(trimmed.length <= 80)
  assert.ok(trimmed.startsWith('First sentence'))
  assert.equal(trimmed.includes('Third sentence'), false)
})

test('trimToSentences keeps Inc. abbreviations inside the first sentence', () => {
  const text =
    'Advanced Micro Devices, Inc. (AMD) is an American multinational semiconductor company. It develops CPUs.'
  const trimmed = trimToSentences(text, 2, 420)
  assert.ok(trimmed.includes('Inc.'))
  assert.ok(trimmed.includes(' It develops CPUs.'))
})

test('parseOpenSearch reads Wikipedia title lists', () => {
  const titles = parseOpenSearch(readJson('wikipedia-opensearch-amd-sample.json'))
  assert.equal(titles[0], 'Advanced Micro Devices')
})

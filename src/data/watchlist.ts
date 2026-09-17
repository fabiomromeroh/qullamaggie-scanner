/**
 * Scan universe + industry group tags for Kyle / Qullamaggie-style breakout spotting.
 * Metrics are filled at runtime from live market APIs; catalysts stay null.
 *
 * SCAN_UNIVERSE (~100 liquid US names) is what the live scanner scores.
 * Keep Finnhub free-tier friendly: client batches with low concurrency + gap;
 * proxy caches snapshots (see server/marketProxy.ts).
 */
import type { IndustryGroup } from '../types'

export interface WatchlistEntry {
  ticker: string
  name: string
  groupId: string
}

/** Static industry tags (RS rank / % filled from live member metrics). */
export const WATCHLIST_GROUPS: Omit<
  IndustryGroup,
  'rsRank' | 'leaderCount' | 'dayPct' | 'weekPct' | 'monthPct' | 'perf1m' | 'perf3m' | 'perf6m'
>[] = [
  {
    id: 'semis',
    name: 'Semiconductors',
    description: 'AI / HBM / foundry leaders',
  },
  {
    id: 'software',
    name: 'Software — Application',
    description: 'SaaS / platform momentum cohort',
  },
  {
    id: 'cyber',
    name: 'Cybersecurity',
    description: 'Security software cohort',
  },
  {
    id: 'aero',
    name: 'Aerospace & Defense',
    description: 'Defense + space theme names',
  },
  {
    id: 'biotech',
    name: 'Biotechnology',
    description: 'Selective biotech momentum',
  },
  {
    id: 'retail',
    name: 'Internet Retail',
    description: 'E-commerce / consumer discretionary leaders',
  },
  {
    id: 'fintech',
    name: 'Financial Technology',
    description: 'Payments / brokerage / crypto-adjacent',
  },
  {
    id: 'energy-eq',
    name: 'Oil & Gas Equipment',
    description: 'Energy equipment + services',
  },
]

/**
 * Broader liquid US scan universe (80–150 target).
 * Prefer high average dollar volume names so Yahoo/Stooq fallbacks stay useful.
 */
export const SCAN_UNIVERSE: WatchlistEntry[] = [
  // Semiconductors / hardware
  { ticker: 'NVDA', name: 'NVIDIA Corp', groupId: 'semis' },
  { ticker: 'AVGO', name: 'Broadcom Inc', groupId: 'semis' },
  { ticker: 'AMD', name: 'Advanced Micro Devices', groupId: 'semis' },
  { ticker: 'TSM', name: 'Taiwan Semiconductor', groupId: 'semis' },
  { ticker: 'ASML', name: 'ASML Holding', groupId: 'semis' },
  { ticker: 'AMAT', name: 'Applied Materials', groupId: 'semis' },
  { ticker: 'LRCX', name: 'Lam Research', groupId: 'semis' },
  { ticker: 'KLAC', name: 'KLA Corp', groupId: 'semis' },
  { ticker: 'MU', name: 'Micron Technology', groupId: 'semis' },
  { ticker: 'QCOM', name: 'Qualcomm Inc', groupId: 'semis' },
  { ticker: 'MRVL', name: 'Marvell Technology', groupId: 'semis' },
  { ticker: 'ARM', name: 'Arm Holdings', groupId: 'semis' },
  { ticker: 'SMCI', name: 'Super Micro Computer', groupId: 'semis' },
  { ticker: 'ON', name: 'ON Semiconductor', groupId: 'semis' },
  { ticker: 'NXPI', name: 'NXP Semiconductors', groupId: 'semis' },
  { ticker: 'ADI', name: 'Analog Devices', groupId: 'semis' },
  { ticker: 'SNPS', name: 'Synopsys Inc', groupId: 'semis' },
  { ticker: 'CDNS', name: 'Cadence Design', groupId: 'semis' },
  { ticker: 'INTC', name: 'Intel Corp', groupId: 'semis' },
  { ticker: 'TXN', name: 'Texas Instruments', groupId: 'semis' },

  // Software / platforms
  { ticker: 'MSFT', name: 'Microsoft Corp', groupId: 'software' },
  { ticker: 'ORCL', name: 'Oracle Corp', groupId: 'software' },
  { ticker: 'CRM', name: 'Salesforce Inc', groupId: 'software' },
  { ticker: 'NOW', name: 'ServiceNow Inc', groupId: 'software' },
  { ticker: 'ADBE', name: 'Adobe Inc', groupId: 'software' },
  { ticker: 'INTU', name: 'Intuit Inc', groupId: 'software' },
  { ticker: 'SNOW', name: 'Snowflake Inc', groupId: 'software' },
  { ticker: 'DDOG', name: 'Datadog Inc', groupId: 'software' },
  { ticker: 'NET', name: 'Cloudflare Inc', groupId: 'software' },
  { ticker: 'MDB', name: 'MongoDB Inc', groupId: 'software' },
  { ticker: 'TEAM', name: 'Atlassian Corp', groupId: 'software' },
  { ticker: 'WDAY', name: 'Workday Inc', groupId: 'software' },
  { ticker: 'HUBS', name: 'HubSpot Inc', groupId: 'software' },
  { ticker: 'PLTR', name: 'Palantir Technologies', groupId: 'software' },
  { ticker: 'APP', name: 'AppLovin Corp', groupId: 'software' },
  { ticker: 'META', name: 'Meta Platforms', groupId: 'software' },
  { ticker: 'GOOGL', name: 'Alphabet Inc', groupId: 'software' },
  { ticker: 'AMZN', name: 'Amazon.com Inc', groupId: 'retail' },
  { ticker: 'SHOP', name: 'Shopify Inc', groupId: 'software' },
  { ticker: 'TTD', name: 'The Trade Desk', groupId: 'software' },
  { ticker: 'ZS', name: 'Zscaler Inc', groupId: 'cyber' },

  // Cybersecurity
  { ticker: 'CRWD', name: 'CrowdStrike Holdings', groupId: 'cyber' },
  { ticker: 'PANW', name: 'Palo Alto Networks', groupId: 'cyber' },
  { ticker: 'FTNT', name: 'Fortinet Inc', groupId: 'cyber' },
  { ticker: 'S', name: 'SentinelOne Inc', groupId: 'cyber' },
  { ticker: 'OKTA', name: 'Okta Inc', groupId: 'cyber' },
  { ticker: 'CYBR', name: 'CyberArk Software', groupId: 'cyber' },
  { ticker: 'RBRK', name: 'Rubrik Inc', groupId: 'cyber' },
  { ticker: 'GEN', name: 'Gen Digital', groupId: 'cyber' },

  // Aerospace & defense
  { ticker: 'GE', name: 'GE Aerospace', groupId: 'aero' },
  { ticker: 'HWM', name: 'Howmet Aerospace', groupId: 'aero' },
  { ticker: 'AXON', name: 'Axon Enterprise', groupId: 'aero' },
  { ticker: 'RTX', name: 'RTX Corp', groupId: 'aero' },
  { ticker: 'LMT', name: 'Lockheed Martin', groupId: 'aero' },
  { ticker: 'NOC', name: 'Northrop Grumman', groupId: 'aero' },
  { ticker: 'GD', name: 'General Dynamics', groupId: 'aero' },
  { ticker: 'BA', name: 'Boeing Co', groupId: 'aero' },
  { ticker: 'TDG', name: 'TransDigm Group', groupId: 'aero' },
  { ticker: 'HEI', name: 'HEICO Corp', groupId: 'aero' },
  { ticker: 'CW', name: 'Curtiss-Wright', groupId: 'aero' },
  { ticker: 'RKLB', name: 'Rocket Lab USA', groupId: 'aero' },

  // Biotech / healthcare momentum
  { ticker: 'LLY', name: 'Eli Lilly', groupId: 'biotech' },
  { ticker: 'NVO', name: 'Novo Nordisk', groupId: 'biotech' },
  { ticker: 'VRTX', name: 'Vertex Pharmaceuticals', groupId: 'biotech' },
  { ticker: 'REGN', name: 'Regeneron Pharmaceuticals', groupId: 'biotech' },
  { ticker: 'AMGN', name: 'Amgen Inc', groupId: 'biotech' },
  { ticker: 'GILD', name: 'Gilead Sciences', groupId: 'biotech' },
  { ticker: 'NBIX', name: 'Neurocrine Biosciences', groupId: 'biotech' },
  { ticker: 'INSM', name: 'Insmed Inc', groupId: 'biotech' },
  { ticker: 'VKTX', name: 'Viking Therapeutics', groupId: 'biotech' },
  { ticker: 'ALNY', name: 'Alnylam Pharmaceuticals', groupId: 'biotech' },
  { ticker: 'SRPT', name: 'Sarepta Therapeutics', groupId: 'biotech' },
  { ticker: 'ARGX', name: 'argenx SE', groupId: 'biotech' },

  // Retail / consumer
  { ticker: 'MELI', name: 'MercadoLibre Inc', groupId: 'retail' },
  { ticker: 'COST', name: 'Costco Wholesale', groupId: 'retail' },
  { ticker: 'TJX', name: 'TJX Companies', groupId: 'retail' },
  { ticker: 'LULU', name: 'Lululemon Athletica', groupId: 'retail' },
  { ticker: 'NKE', name: 'Nike Inc', groupId: 'retail' },
  { ticker: 'SBUX', name: 'Starbucks Corp', groupId: 'retail' },
  { ticker: 'CMG', name: 'Chipotle Mexican Grill', groupId: 'retail' },
  { ticker: 'TSLA', name: 'Tesla Inc', groupId: 'retail' },
  { ticker: 'BKNG', name: 'Booking Holdings', groupId: 'retail' },
  { ticker: 'ABNB', name: 'Airbnb Inc', groupId: 'retail' },
  { ticker: 'UBER', name: 'Uber Technologies', groupId: 'retail' },
  { ticker: 'DASH', name: 'DoorDash Inc', groupId: 'retail' },

  // Fintech / financials
  { ticker: 'V', name: 'Visa Inc', groupId: 'fintech' },
  { ticker: 'MA', name: 'Mastercard Inc', groupId: 'fintech' },
  { ticker: 'PYPL', name: 'PayPal Holdings', groupId: 'fintech' },
  { ticker: 'XYZ', name: 'Block Inc', groupId: 'fintech' },
  { ticker: 'COIN', name: 'Coinbase Global', groupId: 'fintech' },
  { ticker: 'HOOD', name: 'Robinhood Markets', groupId: 'fintech' },
  { ticker: 'SOFI', name: 'SoFi Technologies', groupId: 'fintech' },
  { ticker: 'IBKR', name: 'Interactive Brokers', groupId: 'fintech' },
  { ticker: 'SCHW', name: 'Charles Schwab', groupId: 'fintech' },
  { ticker: 'GS', name: 'Goldman Sachs', groupId: 'fintech' },
  { ticker: 'MS', name: 'Morgan Stanley', groupId: 'fintech' },
  { ticker: 'JPM', name: 'JPMorgan Chase', groupId: 'fintech' },

  // Energy equipment / energy
  { ticker: 'FTI', name: 'TechnipFMC', groupId: 'energy-eq' },
  { ticker: 'SLB', name: 'Schlumberger', groupId: 'energy-eq' },
  { ticker: 'HAL', name: 'Halliburton', groupId: 'energy-eq' },
  { ticker: 'BKR', name: 'Baker Hughes', groupId: 'energy-eq' },
  { ticker: 'WFRD', name: 'Weatherford International', groupId: 'energy-eq' },
  { ticker: 'NOV', name: 'NOV Inc', groupId: 'energy-eq' },
  { ticker: 'XOM', name: 'Exxon Mobil', groupId: 'energy-eq' },
  { ticker: 'CVX', name: 'Chevron Corp', groupId: 'energy-eq' },
  { ticker: 'COP', name: 'ConocoPhillips', groupId: 'energy-eq' },
  { ticker: 'OXY', name: 'Occidental Petroleum', groupId: 'energy-eq' },
  { ticker: 'VLO', name: 'Valero Energy', groupId: 'energy-eq' },
  { ticker: 'MPC', name: 'Marathon Petroleum', groupId: 'energy-eq' },
]

/** @deprecated Prefer SCAN_UNIVERSE — kept as alias for older imports. */
export const WATCHLIST = SCAN_UNIVERSE

/** Client scan batching defaults (Finnhub free-tier friendly). */
export const SCAN_CONCURRENCY = 2
export const SCAN_GAP_MS = 200

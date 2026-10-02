/**
 * Volume-moving catalyst classifier.
 *
 * An idea has a catalyst when at least one IMPORTANT news item was published
 * within the last {@link CATALYST_WINDOW_HOURS} hours (2 × 24h rolling,
 * measured from fetch time, using the publication datetime — not the calendar
 * day). "Important" means the headline classifies into a category in
 * {@link CATALYST_CATEGORIES} and the score is at least {@link CATALYST_MIN_SCORE}.
 * A summary may confirm direction or add the big-firm / price-target analyst
 * bonus. It cannot create a category. The issuer has to be the subject of
 * the headline ({@link itemConcernsIssuer}): ticker or first significant
 * name word inside the first {@link SUBJECT_MAX_WORD_INDEX} words, or a
 * leading `Company (TICKER)` pattern. A name or ticker glued to a hyphen
 * modifier (`Nvidia-Backed`) is not the subject; a possessive (`AMD's`) is.
 * A related-ticker list cannot admit an item on its own.
 *
 * Earnings already reported inside that same 48h window (a past or same-day
 * earnings date, not a future date) counts as the `earnings` category. That
 * path does not change `classifyEarningsProximity` / the future-earnings
 * avoid gate.
 *
 * Score = max category weight + a small bonus per extra distinct category
 * (capped) + analyst bonuses. A lone analyst upgrade (weight 2) qualifies
 * only with a big-firm name or a price-target raise (+1 each). A noise match
 * vetoes the item unless a strong category (`mna` or `fda_clinical`) also
 * matches the same headline.
 *
 * Research encoded in the weights (see README "Catalyst classification"):
 * Qullamaggie episodic-pivot notes (earnings, FDA, contracts, regulatory),
 * NBER w13090 (earnings volume), PLOS ONE 2024 biopharma news (M&A and
 * product/regulatory/guidance), PMC9439234 (phase 2/3), RFS 2011 / NBER
 * w14971 (only a minority of analyst changes move price; leader firms more
 * so), EventStudyTools event ranking (M&A > buybacks > earnings > dividends
 * > analyst recommendations).
 */
export const CATALYST_WINDOW_HOURS = 48
export const CATALYST_MIN_SCORE = 3
/** Added once per extra distinct category beyond the heaviest match. */
export const CATALYST_EXTRA_CATEGORY_BONUS = 0.25
export const CATALYST_EXTRA_CATEGORY_CAP = 0.75
/** Big-firm name on an analyst item. Alone, 2 + 1 meets the floor. */
export const ANALYST_BIG_FIRM_BONUS = 1
/** Price-target raise on an analyst item. Alone, 2 + 1 meets the floor. */
export const ANALYST_PT_BONUS = 1
/** Future publication timestamps within this skew still count as "now". */
export const CATALYST_CLOCK_SKEW_MS = 5 * 60 * 1000
/**
 * Issuer ticker or name must sit at a word index strictly below this
 * (the first 5 whitespace-separated words) to be the subject.
 */
export const SUBJECT_MAX_WORD_INDEX = 5
/**
 * A related-ticker list that omits the symbol rejects the item unless the
 * subject match is in the first this-many words (index strictly below this).
 * The list never admits an item by itself.
 */
export const SUBJECT_RELATED_OVERRIDE_WORDS = 3
/**
 * A leading `Company (TICKER)` pattern: at most this many capitalized name
 * words before `(TICKER)` at the start of the headline.
 */
export const SUBJECT_LEADING_NAME_WORDS = 4

export type CatalystDirection = 'positive' | 'negative' | 'mixed'

export interface CatalystCategoryDef {
  id: string
  label: string
  weight: number
  direction: 'positive' | 'negative'
  /** Strong categories survive a noise veto when they match the headline. */
  strong?: boolean
  patterns: RegExp[]
}

export interface ClassifiedCategory {
  id: string
  label: string
  weight: number
  direction: 'positive' | 'negative'
}

export interface HeadlineClassification {
  categories: ClassifiedCategory[]
  score: number
  /** A noise pattern matched. A strong category can still make the item important. */
  noise: boolean
  important: boolean
  direction?: CatalystDirection
}

export type NewsFeed = 'finnhub' | 'yahoo'

export interface CatalystNewsInput {
  headline: string
  summary?: string
  source?: string
  url?: string
  /** Publication time in epoch milliseconds. */
  datetimeMs: number
  /**
   * Tickers the feed says the item is about.
   * Finnhub `related` is a comma-separated list. Yahoo search uses `relatedTickers`.
   */
  related?: readonly string[]
  /** Which feed produced `related`. Finnhub's lone query-symbol stamp is not evidence. */
  sourceFeed?: NewsFeed
}

export interface CatalystEvaluation {
  hasCatalyst: boolean
  /** Unique labels, heaviest category first. */
  categories: string[]
  direction?: CatalystDirection
  topHeadline?: string
  topUrl?: string
  topSource?: string
  /** ISO publication time of the top item. */
  topDatetime?: string
  ageHours?: number
  score: number
  /** Count of important items inside the window (calendar earnings counts as one when injected). */
  count: number
}

/**
 * Longer firm names are listed first so "Goldman Sachs" wins over a shorter
 * alias, and "Loop Capital" is required (bare "Loop" is too broad).
 */
export const BIG_ANALYST_FIRMS: readonly string[] = [
  'Goldman Sachs',
  'Morgan Stanley',
  'J.P. Morgan',
  'JPMorgan',
  'JP Morgan',
  'Bank of America',
  'BofA',
  'Citigroup',
  'Citi',
  'Barclays',
  'UBS',
  'Wells Fargo',
  'Jefferies',
  'Bernstein',
  'Wedbush',
  'Piper Sandler',
  'Needham',
  'Mizuho',
  'Evercore',
  'Raymond James',
  'RBC',
  'KeyBanc',
  'Cantor',
  'TD Cowen',
  'Cowen',
  'Truist',
  'Stifel',
  'Oppenheimer',
  'BTIG',
  'Loop Capital',
  'DA Davidson',
  'Baird',
  'William Blair',
  'H.C. Wainwright',
  'HC Wainwright',
]

const FIRM_RE = new RegExp(
  `\\b(?:${[...BIG_ANALYST_FIRMS]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s+'))
    .join('|')})\\b`,
  'i',
)

const PT_RAISE_RE =
  /\b(?:raises|lifts|boosts|hikes|increases)\b[\s\S]{0,40}\bprice targets?\b|\bprice targets?\b[\s\S]{0,24}\b(?:raised|lifted|boosted|hiked|increased)\b/i

const GUIDANCE_CUT_RE = /\b(?:cuts|cut|lowers|lowered|slashes|slashed|withdraws|withdrew|reduces|reduced|trims|trimmed)\b/i
const GUIDANCE_RAISE_RE = /\b(?:raises|raised|lifts|lifted|boosts|boosted|hikes|hiked)\b/i
const EARNINGS_MISS_RE = /\b(?:miss(?:es|ed)?|disappoint(?:s|ed)?|falls short)\b/i
const EARNINGS_BEAT_RE = /\b(?:beat|beats|surge|surges|tops|crushes|crushed)\b/i

/**
 * Weights are a named table, not magic numbers at the call site.
 * product_launch and insider_inst_buy are 3.0 (not the illustrative 2.5) so
 * a single clear launch or insider buy meets {@link CATALYST_MIN_SCORE}.
 * analyst stays at 2 so it qualifies only with {@link ANALYST_BIG_FIRM_BONUS}
 * or {@link ANALYST_PT_BONUS}. breaking stays at 2 and does not qualify alone.
 */
export const CATALYST_CATEGORIES: readonly CatalystCategoryDef[] = [
  {
    id: 'mna',
    label: 'M&A',
    weight: 5,
    direction: 'positive',
    strong: true,
    patterns: [
      /\b(?:to be acquired|being acquired|agreed to (?:be )?acquir\w*|acquire[sd]?|acquisition|buyout|takeover|merger|tender offer|go-private|going private)\b/i,
    ],
  },
  {
    id: 'fda_clinical',
    label: 'FDA / clinical',
    weight: 5,
    direction: 'positive',
    strong: true,
    patterns: [
      /\bFDA\b[\s\S]{0,40}\b(?:approv\w*|cleared|clearance)\b/i,
      /\b(?:approv\w*|cleared|clearance)\b[\s\S]{0,40}\bFDA\b/i,
      /\bbreakthrough designation\b/i,
      /\bPDUFA\b/i,
      /\bphase\s*(?:2|3|ii|iii)\b[\s\S]{0,40}\b(?:results?|data|readout|outcome)\b/i,
      /\b(?:topline|top-line)\b/i,
      /\bprimary endpoint met\b/i,
      /\btrial results?\b/i,
      /\bpositive phase\s*(?:1|2|3|i|ii|iii)\b/i,
    ],
  },
  {
    id: 'fda_reject',
    label: 'FDA rejection',
    weight: 5,
    direction: 'negative',
    patterns: [
      /\b(?:CRL|complete response letter)\b/i,
      /\bFDA\b[\s\S]{0,40}\b(?:reject\w*|declin\w*|refus\w*)\b/i,
      /\b(?:reject\w*|declin\w*)\b[\s\S]{0,30}\bFDA\b/i,
      /\b(?:failed|halted|discontinued)\b[\s\S]{0,40}\b(?:trial|study|development)\b/i,
    ],
  },
  {
    id: 'earnings',
    label: 'Earnings',
    weight: 4,
    direction: 'positive',
    patterns: [
      /\b(?:reports|reported|results)\b[\s\S]{0,40}\b(?:q[1-4]|earnings|eps|revenue|quarter)\b/i,
      /\b(?:q[1-4]|quarterly)\b[\s\S]{0,24}\b(?:earnings|results|eps|revenue)\b/i,
      /\b(?:earnings|eps|revenue)\b[\s\S]{0,24}\b(?:beat|beats|miss|misses|surge|surges|tops|crushes|crushed)\b/i,
      /\b(?:beat|beats|miss|misses|tops|crushes)\b[\s\S]{0,24}\b(?:earnings|eps|revenue|estimates)\b/i,
    ],
  },
  {
    id: 'guidance',
    label: 'Guidance',
    weight: 4,
    direction: 'positive',
    patterns: [
      /\b(?:raises|raised|lifts|lifted|boosts|boosted|hikes|hiked|cuts|cut|lowers|lowered|slashes|slashed|withdraws|withdrew|reduces|reduced|trims|trimmed|issues|issued|updated)\b[\s\S]{0,40}\b(?:guidance|outlook|forecast)\b/i,
      // "Live Updates of … Outlook" is a blog title, not a guidance change.
      /\bupdates\b(?!\s+of\b)[\s\S]{0,40}\b(?:guidance|outlook|forecast)\b/i,
      /\b(?:guidance|outlook|forecast)\b[\s\S]{0,40}\b(?:raise|raised|cut|lowered|above|below|boosted|reduced|withdrawn)\b/i,
    ],
  },
  {
    id: 'offering_dilution',
    label: 'Offering / dilution',
    weight: 4,
    direction: 'negative',
    patterns: [
      /\b(?:secondary|public|follow-on|registered direct)\s+offering\b/i,
      /\bprices?\s+(?:a\s+)?(?:\$[\d.]+\s*(?:million|billion)\s+)?(?:stock|share|public|secondary)?\s*offering\b/i,
      /\b(?:dilution|dilutive)\b/i,
      /\bat-the-market\b|\bATM offering\b/i,
    ],
  },
  {
    id: 'contract_deal',
    label: 'Contract / partnership',
    weight: 3.5,
    direction: 'positive',
    patterns: [
      /\b(?:wins?|won|awarded|secures?|secured)\b[\s\S]{0,40}\b(?:contract|order|agreement|program)\b/i,
      /\bmulti-year agreement\b/i,
      /\b(?:partnership|collaboration|strategic (?:deal|partnership|collaboration)|supply agreement)\b/i,
      /\$\s?[\d.]+\s*(?:billion|million)\b[\s\S]{0,40}\border\b/i,
    ],
  },
  {
    id: 'index_inclusion',
    label: 'Index inclusion',
    weight: 3.5,
    direction: 'positive',
    patterns: [
      /\b(?:added|addition|joins?|joining|to join)\b[\s\S]{0,40}\b(?:S&P\s*500|Nasdaq-100|Russell)\b/i,
      /\b(?:S&P\s*500|Nasdaq-100|Russell)\b[\s\S]{0,24}\b(?:addition|inclusion|adds)\b/i,
    ],
  },
  {
    id: 'buyback_dividend',
    label: 'Buyback / dividend',
    weight: 3,
    direction: 'positive',
    patterns: [
      /\b(?:announces?|announced|authoriz(?:e|es|ed)|approv(?:e|es|ed))\b[\s\S]{0,80}\b(?:share\s+)?(?:repurchase|buyback|buy\s*back)s?\b/i,
      /\b(?:share\s+)?(?:repurchase|buyback|buy\s*back)\s+(?:program|authorization|plan)\b/i,
      /\b(?:special dividend|dividend hike|hikes? (?:its )?dividend|initiates? (?:a )?dividend|raises? (?:its )?dividend)\b/i,
      /\bstock split\b/i,
    ],
  },
  {
    id: 'activist_squeeze',
    label: 'Activist / squeeze',
    weight: 3,
    direction: 'positive',
    patterns: [
      /\bactivist\b[\s\S]{0,24}\b(?:stake|investor|campaign)\b/i,
      /\b(?:schedule\s*)?13D\b/i,
      /\bshort squeeze\b/i,
      /\btakes?\s+(?:a\s+)?(?:[\d.]+\s*%\s+)?stake\b/i,
    ],
  },
  {
    id: 'regulatory_win',
    label: 'Regulatory win',
    weight: 3,
    direction: 'positive',
    patterns: [
      /\bcourt\s+win\b/i,
      /\btariff exemption\b/i,
      /\bregulatory approval\b/i,
      /\bgovernment (?:order|contract)\b/i,
      /\bSEC\b[\s\S]{0,40}\binvestigation closed\b/i,
      /\binvestigation closed\b/i,
    ],
  },
  {
    id: 'spinoff',
    label: 'Spin-off',
    weight: 3,
    direction: 'positive',
    patterns: [
      /\bspin-?off\b/i,
      /\bseparation\b[\s\S]{0,24}\b(?:unit|division|business)\b/i,
      /\bIPO of\b/i,
    ],
  },
  {
    id: 'downgrade',
    label: 'Downgrade',
    weight: 3,
    direction: 'negative',
    patterns: [
      /\bdowngrad(?:e|es|ed|ing)\b/i,
      /\bcut(?:s|ting)?\b[\s\S]{0,48}\b(?:ratings?|price targets?)\b/i,
      /\bcut(?:s|ting)?\b[\s\S]{0,40}\bto\s+(?:sell|underperform|underweight|neutral|hold|reduce|market\s+perform|peer\s+perform|sector\s+perform)\b/i,
      /\blowers?\b[\s\S]{0,40}\b(?:price targets?|ratings?)\b/i,
      /\blowered\b[\s\S]{0,40}\b(?:price targets?|ratings?)\b/i,
      /\breduc(?:e|es|ed)\b[\s\S]{0,40}\b(?:price targets?|ratings?)\b/i,
      /\bprice targets?\b[\s\S]{0,24}\b(?:cut|cuts|lowered|reduced|slashed)\b/i,
    ],
  },
  {
    id: 'lawsuit_probe',
    label: 'Lawsuit / probe',
    weight: 3,
    direction: 'negative',
    patterns: [
      /\b(?:class action|bankruptcy|chapter 11)\b/i,
      /\b(?:SEC|DOJ)\b[\s\S]{0,30}\b(?:investigation|probe|charges)\b/i,
      /\b(?:investigation|probe)\b[\s\S]{0,20}\b(?:SEC|DOJ)\b/i,
    ],
  },
  {
    id: 'product_launch',
    label: 'Product launch',
    weight: 3,
    direction: 'positive',
    patterns: [
      /\b(?:launches|launched|unveils|unveiled|introduces|introduced)\b[\s\S]{0,40}\b(?:product|platform|chip|drug|device)\b/i,
    ],
  },
  {
    id: 'insider_inst_buy',
    label: 'Insider / institutional buy',
    weight: 3,
    direction: 'positive',
    patterns: [
      /\binsider buying\b/i,
      /\b(?:CEO|CFO|director|insider)\s+buys?\b/i,
      /\bBerkshire\b[\s\S]{0,40}\b(?:stake|buys?|bought|purchase)\b/i,
      /\binstitutional stake raised\b/i,
      /\blarge purchase\b/i,
    ],
  },
  {
    id: 'analyst',
    label: 'Analyst',
    weight: 2,
    direction: 'positive',
    patterns: [
      /\bupgrad(?:e|es|ed)\b/i,
      /\binitiates? coverage\b[\s\S]{0,40}\b(?:buy|outperform|overweight)\b/i,
    ],
  },
  {
    id: 'breaking',
    label: 'Breaking',
    weight: 2,
    direction: 'positive',
    patterns: [
      /\bbreaking news\b/i,
      /\b(?:halted|resumed)\s+trading\b/i,
      /\btrading (?:halted|resumed)\b/i,
    ],
  },
] as const

const NOISE_PATTERNS: RegExp[] = [
  /\bstocks to watch\b/i,
  /\btop stocks\b/i,
  /\bbest stocks\b/i,
  /\bstocks to buy\b/i,
  /\bwhy\b[\s\S]{0,40}\b(?:is|are)\b[\s\S]{0,24}\b(?:down|up) today\b/i,
  /\bshould you buy\b/i,
  /\bis it a buy\b/i,
  /\bhere['’]?s\s+(?:the|why|how|what)\b/i,
  /\breturned\s+\$\s?[\d.]+\s*(?:billion|million|thousand)?\s*to\s+shareholders\b/i,
  /\bwhich\b[\s\S]{0,80}\bstocks?\b/i,
  /\bvs\.?\b/i,
  /\bbetter\s+(?:buy|stocks?)\b/i,
  /\bis\b[\s\S]{0,50}\b(?:a\s+)?(?:buy|stocks?)\b/i,
  /\bwhy\s+did\b[\s\S]{0,60}\b(?:jump(?:s|ed)?|fall|falls|fell|drop(?:s|ped)?|rise|rises|rose|surge[sd]?|soar(?:s|ed)?|sink|sinks|sank|crash(?:es|ed)?|pop(?:s|ped)?|tank(?:s|ed)?|slide|slides|slid|climb(?:s|ed)?|gain(?:s|ed)?|plunge[sd]?|rall(?:y|ies|ied))\b/i,
  /\b[A-Z]{2,5}\s+or\s+[A-Z]{2,5}\b/,
  /\b[A-Z][a-z]+\s+or\s+[A-Z][a-z]+\b/,
  /\bzacks rank\b/i,
  /\btrending stock\b/i,
  /\bwhat you (?:need|should) to know\b/i,
  /\bwhat you should know\b/i,
  /\banalyst says\b/i,
  /\b(?:reiterates|maintains|reaffirms)\b/i,
  /\b(?:keeps|stays)\b[\s\S]{0,16}\b(?:buy|hold|sell|neutral|overweight|underweight|rating)\b/i,
  /\bahead of earnings\b/i,
  /\bearnings preview\b/i,
  /\bwhat to expect\b/i,
  /\bearnings call transcript\b/i,
  /\bpodcast\b/i,
]

const SOURCE_NOISE_RE = /motley fool/i
/** "Soars 15.8% as …" is a recap unless the same headline is earnings or guidance. */
const SOAR_RECAP_RE = /\b(?:soars?|surges?)\s+[\d.]+\s*%\s+as\b/i

const STRONG_IDS = new Set(
  CATALYST_CATEGORIES.filter((c) => c.strong).map((c) => c.id),
)

function textOf(headline: string, summary?: string): string {
  const head = headline.trim()
  const sum = (summary ?? '').trim().slice(0, 400)
  return sum ? `${head}\n${sum}` : head
}

function guidanceDirection(text: string): 'positive' | 'negative' {
  const cut = GUIDANCE_CUT_RE.test(text)
  const raise = GUIDANCE_RAISE_RE.test(text)
  if (cut && !raise) return 'negative'
  return 'positive'
}

function earningsDirection(text: string): 'positive' | 'negative' {
  const miss = EARNINGS_MISS_RE.test(text)
  const beat = EARNINGS_BEAT_RE.test(text)
  if (miss && !beat) return 'negative'
  return 'positive'
}

function namesBigFirm(text: string): boolean {
  return FIRM_RE.test(text)
}

function priceTargetRaised(text: string): boolean {
  return PT_RAISE_RE.test(text)
}

function earningsOrGuidanceHeadline(headline: string): boolean {
  return CATALYST_CATEGORIES.some(
    (category) =>
      (category.id === 'earnings' || category.id === 'guidance') &&
      category.patterns.some((re) => re.test(headline)),
  )
}

function isNoise(headline: string, source: string | undefined): boolean {
  // Noise is a headline (or publisher) property. A summary must not veto
  // a real headline or invent a category.
  if (NOISE_PATTERNS.some((re) => re.test(headline))) return true
  if (source && SOURCE_NOISE_RE.test(source)) return true
  // A price-pop recap ("Soars 15.8% as") is noise unless the headline
  // itself carries earnings or guidance (Accenture-style earnings pops).
  if (SOAR_RECAP_RE.test(headline) && !earningsOrGuidanceHeadline(headline)) return true
  return false
}

function matchCategories(headline: string, confirmingText: string): ClassifiedCategory[] {
  const out: ClassifiedCategory[] = []
  for (const cat of CATALYST_CATEGORIES) {
    // The category itself has to appear in the headline. A summary can
    // confirm direction or the analyst bonus, but it cannot invent a category:
    // Finnhub summaries often wander into unrelated deals.
    if (!cat.patterns.some((re) => re.test(headline))) continue
    if (cat.id === 'lawsuit_probe' && /\binvestigation closed\b/i.test(headline)) continue
    let direction = cat.direction
    if (cat.id === 'guidance') direction = guidanceDirection(confirmingText)
    if (cat.id === 'earnings') direction = earningsDirection(confirmingText)
    out.push({ id: cat.id, label: cat.label, weight: cat.weight, direction })
  }
  return out
}

function directionOf(categories: ClassifiedCategory[]): CatalystDirection | undefined {
  if (!categories.length) return undefined
  const hasPos = categories.some((c) => c.direction === 'positive')
  const hasNeg = categories.some((c) => c.direction === 'negative')
  if (hasPos && hasNeg) return 'mixed'
  return hasNeg ? 'negative' : 'positive'
}

export function classifyHeadline(
  headline: string,
  summary?: string,
  source?: string,
): HeadlineClassification {
  const text = textOf(headline, summary)
  const categories = matchCategories(headline, text)
  const noise = isNoise(headline, source)
  const strongOnHeadline = categories.some(
    (c) => STRONG_IDS.has(c.id) && CATALYST_CATEGORIES.find((d) => d.id === c.id)?.patterns.some((re) => re.test(headline)),
  )
  const vetoed = noise && !strongOnHeadline
  if (!categories.length || vetoed) {
    return { categories, score: 0, noise, important: false, direction: directionOf(categories) }
  }
  const maxW = Math.max(...categories.map((c) => c.weight))
  const extra = Math.min(
    CATALYST_EXTRA_CATEGORY_CAP,
    CATALYST_EXTRA_CATEGORY_BONUS * Math.max(0, categories.length - 1),
  )
  let bonus = 0
  if (categories.some((c) => c.id === 'analyst')) {
    if (namesBigFirm(text)) bonus += ANALYST_BIG_FIRM_BONUS
    if (priceTargetRaised(text)) bonus += ANALYST_PT_BONUS
  }
  const score = Math.round((maxW + extra + bonus) * 100) / 100
  return {
    categories,
    score,
    noise,
    important: score >= CATALYST_MIN_SCORE,
    direction: directionOf(categories),
  }
}

export function earningsDateIsRecentReport(
  earningsDate: string | null | undefined,
  nowMs: number,
  windowHours: number = CATALYST_WINDOW_HOURS,
): boolean {
  if (!earningsDate || !/^\d{4}-\d{2}-\d{2}$/.test(earningsDate)) return false
  const start = Date.parse(`${earningsDate}T00:00:00.000Z`)
  if (!Number.isFinite(start)) return false
  if (start > nowMs + CATALYST_CLOCK_SKEW_MS) return false
  return nowMs - start <= windowHours * 3600 * 1000
}

const EARNINGS_CAT: ClassifiedCategory = {
  id: 'earnings',
  label: 'Earnings',
  weight: 4,
  direction: 'positive',
}

function ageHours(nowMs: number, datetimeMs: number): number {
  return Math.round(((nowMs - datetimeMs) / 3600000) * 10) / 10
}

/**
 * Pick the best important item inside the rolling window.
 * `earningsDate`, when it is a real past/same-day date inside the window,
 * injects the Earnings category without inventing a news URL.
 */
export function evaluateCatalyst(
  items: CatalystNewsInput[],
  nowMs: number,
  earningsDate?: string | null,
  issuer?: { ticker: string; name?: string | null },
): CatalystEvaluation {
  const windowMs = CATALYST_WINDOW_HOURS * 3600 * 1000
  const relevant = issuer
    ? items.filter((item) => itemConcernsIssuer(item, issuer.ticker, issuer.name))
    : items
  type Hit = {
    classification: HeadlineClassification
    item: CatalystNewsInput
  }
  const hits: Hit[] = []
  for (const item of relevant) {
    if (!item.headline?.trim() || !Number.isFinite(item.datetimeMs)) continue
    const age = nowMs - item.datetimeMs
    if (age < -CATALYST_CLOCK_SKEW_MS || age > windowMs) continue
    const classification = classifyHeadline(item.headline, item.summary, item.source)
    if (!classification.important) continue
    hits.push({ classification, item })
  }
  hits.sort((a, b) => {
    if (b.classification.score !== a.classification.score) {
      return b.classification.score - a.classification.score
    }
    return b.item.datetimeMs - a.item.datetimeMs
  })

  const labelWeight = new Map<string, { label: string; weight: number; direction: 'positive' | 'negative' }>()
  for (const hit of hits) {
    for (const cat of hit.classification.categories) {
      const prev = labelWeight.get(cat.id)
      if (!prev || cat.weight > prev.weight) labelWeight.set(cat.id, cat)
    }
  }

  const recentEarnings = earningsDateIsRecentReport(earningsDate, nowMs)
  if (recentEarnings && !labelWeight.has('earnings')) {
    labelWeight.set('earnings', EARNINGS_CAT)
  }

  const ordered = [...labelWeight.values()].sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
  const directions = ordered.map((c) => c.direction)
  const direction: CatalystDirection | undefined = !ordered.length
    ? undefined
    : directions.includes('positive') && directions.includes('negative')
      ? 'mixed'
      : directions.includes('negative')
        ? 'negative'
        : 'positive'

  const top = hits[0]
  const calendarOnly = !top && recentEarnings
  const hasCatalyst = hits.length > 0 || calendarOnly
  const score = top
    ? top.classification.score
    : calendarOnly
      ? EARNINGS_CAT.weight
      : 0

  const evaluation: CatalystEvaluation = {
    hasCatalyst,
    categories: ordered.map((c) => c.label),
    score,
    count: hits.length + (calendarOnly || (recentEarnings && top && !top.classification.categories.some((c) => c.id === 'earnings')) ? 1 : 0),
  }
  if (direction) evaluation.direction = direction
  if (top) {
    evaluation.topHeadline = top.item.headline.trim()
    if (top.item.url) evaluation.topUrl = top.item.url
    if (top.item.source) evaluation.topSource = top.item.source
    evaluation.topDatetime = new Date(top.item.datetimeMs).toISOString()
    evaluation.ageHours = ageHours(nowMs, top.item.datetimeMs)
  } else if (calendarOnly && earningsDate) {
    evaluation.topHeadline = `Earnings reported ${earningsDate}`
    evaluation.topSource = 'earnings calendar'
    evaluation.topDatetime = `${earningsDate}T00:00:00.000Z`
    evaluation.ageHours = ageHours(nowMs, Date.parse(`${earningsDate}T00:00:00.000Z`))
  }
  return evaluation
}

/** Tooltip / README sentence. Built from the named constants and the category table. */
export function catalystDefinitionText(): string {
  const labels = CATALYST_CATEGORIES.map((c) => `${c.label} (${c.weight}${c.direction === 'negative' ? ', negative' : ''})`).join(', ')
  return `An idea has a catalyst when at least one important news item was published within the last ${CATALYST_WINDOW_HOURS} hours (rolling, from fetch time, using the publication datetime). Important means a headline in one of: ${labels}. The category pattern has to match the headline. A summary may only confirm direction or add the big-firm or price-target analyst bonus; it cannot add a category. The issuer must be the subject of the headline: the ticker as (TICKER), $TICKER, NASDAQ:TICKER or NYSE:TICKER, or a standalone uppercase ticker of 3 or more letters, or the company's first significant name word, at a word index below ${SUBJECT_MAX_WORD_INDEX} (the first ${SUBJECT_MAX_WORD_INDEX} words), or in a leading Company (TICKER) pattern of at most ${SUBJECT_LEADING_NAME_WORDS} capitalized words. A name or ticker immediately followed by a hyphen modifier (-backed, -owned, -linked, -powered, -based, -led, -funded, -supported, -focused, -related, -style, -ready, -rival) is not the subject. A possessive such as AMD's still counts. A mention that appears only after another party's acquires, buys, purchases, orders, deploys, or adopts is dropped. An M&A target still counts when the issuer is inside that window in "to acquire", "to be acquired", or "agrees to be acquired". Related-ticker lists (Yahoo relatedTickers and Finnhub related, including a Finnhub stamp of the queried symbol) never admit an item on their own. If a list is present and omits the symbol, the item is kept only when the subject match is in the first ${SUBJECT_RELATED_OVERRIDE_WORDS} words. Score is the heaviest category plus up to ${CATALYST_EXTRA_CATEGORY_CAP} for extra categories. The floor is ${CATALYST_MIN_SCORE}, so a lone analyst item (weight 2) qualifies only with a big-firm name (+${ANALYST_BIG_FIRM_BONUS}) or a price-target raise (+${ANALYST_PT_BONUS}). Earnings already reported inside the same ${CATALYST_WINDOW_HOURS}h window count. Both directions count. A downgrade requires the word downgrade or a cut, lower, or reduce of a rating or price target, not the words down, cuts, or lowered on their own. A buyback requires an announcement (announces, authorizes, or approves a repurchase or buyback, or a special, raised, or initiated dividend), not a returned-capital recap. Noise (listicles, here's the/why/how/what, returned-dollar shareholder recaps, which-stock and vs. and or and better-buy comparisons, is-it-a-buy, why-did-it-jump/fall, reiterations, earnings previews, opinion) is excluded unless M&A or FDA / clinical also matches the headline. Soars or surges N% as is noise unless the headline also matches earnings or guidance.`
}

const ISSUER_NAME_NOISE = new Set([
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'ltd',
  'limited',
  'plc',
  'company',
  'group',
  'holdings',
  'holding',
  'the',
  'and',
  'class',
  'common',
  'stock',
  'shares',
  'trust',
  'fund',
  'technologies',
  'technology',
  'therapeutics',
  'pharmaceuticals',
  'pharma',
  'labs',
  'laboratories',
  'international',
  'enterprises',
])

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** First name token of 4+ letters that is not a legal suffix or generic word. */
export function firstSignificantNameWord(name?: string | null): string | null {
  const tokens = (name ?? '')
    .replace(/&/g, ' ')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !ISSUER_NAME_NOISE.has(word.toLowerCase()))
  return tokens[0] ?? null
}

interface IssuerMention {
  charIndex: number
  wordIndex: number
}

function wordIndexAt(headline: string, charIndex: number): number {
  const prefix = headline.slice(0, charIndex)
  if (!prefix.trim()) return 0
  const parts = prefix.trim().split(/\s+/)
  if (/\s$/.test(prefix)) return parts.length
  return parts.length - 1
}

/**
 * A hyphenated modifier of some other company (`Nvidia-Backed`, `NVDA-powered`).
 * The issuer token is not the subject. A possessive (`AMD's`) is not this pattern.
 */
const HYPHEN_MODIFIER_RE =
  /^-(?:backed|owned|linked|powered|based|led|funded|supported|focused|related|style|ready|rival)\b/i

function followedByHyphenModifier(headline: string, matchEnd: number): boolean {
  return HYPHEN_MODIFIER_RE.test(headline.slice(matchEnd))
}

function pushMatches(headline: string, re: RegExp, into: IssuerMention[]): void {
  re.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(headline))) {
    if (!followedByHyphenModifier(headline, match.index + match[0].length)) {
      into.push({ charIndex: match.index, wordIndex: wordIndexAt(headline, match.index) })
    }
    if (match.index === re.lastIndex) re.lastIndex += 1
  }
}

const OBJECT_VERB_SOURCE =
  'acquir(?:e|es|ed|ing)|buys|bought|purchas(?:e|es|ed|ing)|orders|ordered|deploys|deployed|deploying|adopts|adopted|adopting'

/**
 * True when the headline opens with a short capitalized name and `(TICKER)`.
 * An acquisition verb in that prefix is not this pattern (the issuer is the
 * object, handled separately).
 */
function hasLeadingCompanyTicker(headline: string, sym: string): boolean {
  const match = new RegExp(
    `^\\s*(?:[A-Z][\\w.'&-]*[,.]?\\s+){1,${SUBJECT_LEADING_NAME_WORDS}}\\(${escapeRegExp(sym)}\\)`,
  ).exec(headline.trim())
  if (!match) return false
  const prefix = match[0].slice(0, match[0].lastIndexOf('('))
  return !new RegExp(`\\b(?:${OBJECT_VERB_SOURCE})\\b`, 'i').test(prefix)
}

function collectIssuerMentions(headline: string, sym: string, name?: string | null): IssuerMention[] {
  const found: IssuerMention[] = []
  pushMatches(headline, new RegExp(`\\(${escapeRegExp(sym)}\\)`, 'gi'), found)
  pushMatches(headline, new RegExp(`\\$${escapeRegExp(sym)}\\b`, 'gi'), found)
  const exchange = new RegExp(`\\b(?:NASDAQ|NYSE)\\s*:\\s*([A-Za-z]{1,6})\\b`, 'gi')
  exchange.lastIndex = 0
  let exch: RegExpExecArray | null
  while ((exch = exchange.exec(headline))) {
    if (exch[1]?.toUpperCase() === sym && !followedByHyphenModifier(headline, exch.index + exch[0].length)) {
      found.push({ charIndex: exch.index, wordIndex: wordIndexAt(headline, exch.index) })
    }
    if (exch.index === exchange.lastIndex) exchange.lastIndex += 1
  }
  if (sym.length >= 3) {
    pushMatches(headline, new RegExp(`\\b${escapeRegExp(sym)}\\b`, 'g'), found)
  }
  const word = firstSignificantNameWord(name)
  if (word) pushMatches(headline, new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi'), found)
  return found
}

/**
 * The issuer is only the object of another party's acquisition or purchase.
 * "to acquire <Issuer>" stays when the issuer is still inside the subject window.
 * "to be acquired" / "agrees to be acquired" keep the issuer when that name
 * leads the verb (the mention is not after it).
 */
function issuerOnlyAfterObjectVerb(headline: string, mention: IssuerMention): boolean {
  const verbRe = new RegExp(`\\b(?:${OBJECT_VERB_SOURCE})\\b`, 'gi')
  const verb = verbRe.exec(headline)
  if (!verb || mention.charIndex < verb.index) return false
  const toAcquire = /\bto\s+acquire\b/i.exec(headline)
  if (
    toAcquire &&
    verb.index >= toAcquire.index &&
    mention.charIndex > toAcquire.index &&
    mention.wordIndex < SUBJECT_MAX_WORD_INDEX
  ) {
    return false
  }
  return true
}

/**
 * True when this issuer is the subject of the headline.
 * The ticker matches as `(TICKER)`, `$TICKER`, `NASDAQ:TICKER` / `NYSE:TICKER`,
 * or a standalone uppercase word of 3 or more letters. A 1–2 letter ticker
 * has no standalone match. The company's first significant name word matches
 * only inside the first {@link SUBJECT_MAX_WORD_INDEX} words. A name or ticker
 * immediately followed by a hyphen-modifier suffix (`-backed`, `-owned`,
 * `-linked`, `-powered`, `-based`, `-led`, `-funded`, `-supported`,
 * `-focused`, `-related`, `-style`, `-ready`, `-rival`) does not count.
 * A possessive (`AMD's`) still does.
 */
export function headlineMentionsIssuer(
  headline: string,
  ticker: string,
  name?: string | null,
): boolean {
  const head = headline.trim()
  const sym = ticker.trim().toUpperCase()
  if (!head || !sym) return false
  const mentions = collectIssuerMentions(head, sym, name)
  const leading = hasLeadingCompanyTicker(head, sym)
  if (!mentions.length && !leading) return false
  const earliest = mentions.reduce<IssuerMention | null>(
    (best, mention) => (!best || mention.charIndex < best.charIndex ? mention : best),
    null,
  )
  const inWindow = earliest != null && earliest.wordIndex < SUBJECT_MAX_WORD_INDEX
  if (!inWindow && !leading) return false
  if (earliest && issuerOnlyAfterObjectVerb(head, earliest)) return false
  return true
}

/**
 * True when this news row is about the company as the subject of the headline.
 *
 * Yahoo `relatedTickers` and Finnhub `related` never admit a row on their own.
 * Finnhub company-news stamps the queried symbol onto every row, and Yahoo
 * tags loosely, so a list that includes the symbol is only compatibility
 * context. A non-empty list that omits the symbol drops the row unless the
 * subject match is in the first {@link SUBJECT_RELATED_OVERRIDE_WORDS} words.
 */
export function itemConcernsIssuer(
  item: { headline: string; related?: readonly string[] | null; sourceFeed?: NewsFeed },
  ticker: string,
  name?: string | null,
): boolean {
  const sym = ticker.trim().toUpperCase()
  if (!sym || !item.headline?.trim()) return false
  if (!headlineMentionsIssuer(item.headline, sym, name)) return false
  const related = (item.related ?? [])
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
  if (related.length > 0 && !related.includes(sym)) {
    const mentions = collectIssuerMentions(item.headline.trim(), sym, name)
    const earliest = mentions.reduce<IssuerMention | null>(
      (best, mention) => (!best || mention.charIndex < best.charIndex ? mention : best),
      null,
    )
    return earliest != null && earliest.wordIndex < SUBJECT_RELATED_OVERRIDE_WORDS
  }
  return true
}

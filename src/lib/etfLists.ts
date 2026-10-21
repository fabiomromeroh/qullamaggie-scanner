/**
 * Curated ETF lists for the Market Pulse module. Names are static labels;
 * every number shown next to them comes from Yahoo daily bars at request time.
 */

export interface EtfEntry {
  ticker: string
  name: string
}

export type EtfListId = 'group' | 'sectors' | 'equal' | 'country'

export const GROUP_ETFS: EtfEntry[] = [
  { ticker: 'KBE', name: 'SPDR S&P Bank' },
  { ticker: 'KRE', name: 'SPDR S&P Regional Banking' },
  { ticker: 'KIE', name: 'SPDR S&P Insurance' },
  { ticker: 'IAI', name: 'iShares US Broker-Dealers & Exchanges' },
  { ticker: 'SMH', name: 'VanEck Semiconductor' },
  { ticker: 'XSD', name: 'SPDR S&P Semiconductor' },
  { ticker: 'SOXX', name: 'iShares Semiconductor' },
  { ticker: 'IGV', name: 'iShares Expanded Tech-Software' },
  { ticker: 'CLOU', name: 'Global X Cloud Computing' },
  { ticker: 'SKYY', name: 'First Trust Cloud Computing' },
  { ticker: 'WCLD', name: 'WisdomTree Cloud Computing' },
  { ticker: 'HACK', name: 'Amplify Cybersecurity' },
  { ticker: 'CIBR', name: 'First Trust Nasdaq Cybersecurity' },
  { ticker: 'BOTZ', name: 'Global X Robotics & AI' },
  { ticker: 'AIQ', name: 'Global X AI & Technology' },
  { ticker: 'ARKK', name: 'ARK Innovation' },
  { ticker: 'FDN', name: 'First Trust Dow Jones Internet' },
  { ticker: 'SOCL', name: 'Global X Social Media' },
  { ticker: 'ESPO', name: 'VanEck Video Gaming & eSports' },
  { ticker: 'IBUY', name: 'Amplify Online Retail' },
  { ticker: 'IPAY', name: 'Amplify Mobile Payments' },
  { ticker: 'BLOK', name: 'Amplify Transformational Data Sharing' },
  { ticker: 'IBB', name: 'iShares Biotechnology' },
  { ticker: 'XBI', name: 'SPDR S&P Biotech' },
  { ticker: 'IHI', name: 'iShares US Medical Devices' },
  { ticker: 'XPH', name: 'SPDR S&P Pharmaceuticals' },
  { ticker: 'IHF', name: 'iShares US Healthcare Providers' },
  { ticker: 'ITB', name: 'iShares US Home Construction' },
  { ticker: 'XHB', name: 'SPDR S&P Homebuilders' },
  { ticker: 'XRT', name: 'SPDR S&P Retail' },
  { ticker: 'PEJ', name: 'Invesco Leisure & Entertainment' },
  { ticker: 'JETS', name: 'US Global Jets' },
  { ticker: 'IYT', name: 'iShares US Transportation' },
  { ticker: 'XTN', name: 'SPDR S&P Transportation' },
  { ticker: 'ITA', name: 'iShares US Aerospace & Defense' },
  { ticker: 'XAR', name: 'SPDR S&P Aerospace & Defense' },
  { ticker: 'PAVE', name: 'Global X US Infrastructure' },
  { ticker: 'GRID', name: 'First Trust Smart Grid Infrastructure' },
  { ticker: 'XME', name: 'SPDR S&P Metals & Mining' },
  { ticker: 'COPX', name: 'Global X Copper Miners' },
  { ticker: 'GDX', name: 'VanEck Gold Miners' },
  { ticker: 'GDXJ', name: 'VanEck Junior Gold Miners' },
  { ticker: 'SIL', name: 'Global X Silver Miners' },
  { ticker: 'LIT', name: 'Global X Lithium & Battery Tech' },
  { ticker: 'REMX', name: 'VanEck Rare Earth & Strategic Metals' },
  { ticker: 'URA', name: 'Global X Uranium' },
  { ticker: 'NLR', name: 'VanEck Uranium & Nuclear' },
  { ticker: 'TAN', name: 'Invesco Solar' },
  { ticker: 'ICLN', name: 'iShares Global Clean Energy' },
  { ticker: 'XOP', name: 'SPDR S&P Oil & Gas E&P' },
  { ticker: 'OIH', name: 'VanEck Oil Services' },
  { ticker: 'AMLP', name: 'Alerian MLP' },
  { ticker: 'KWEB', name: 'KraneShares CSI China Internet' },
  { ticker: 'IWO', name: 'iShares Russell 2000 Growth' },
  { ticker: 'IWN', name: 'iShares Russell 2000 Value' },
  { ticker: 'IPO', name: 'Renaissance IPO' },
  { ticker: 'MOO', name: 'VanEck Agribusiness' },
  { ticker: 'PBJ', name: 'Invesco Food & Beverage' },
  { ticker: 'VNQ', name: 'Vanguard Real Estate' },
  { ticker: 'UFO', name: 'Procure Space' },
]

export const SECTOR_ETFS: EtfEntry[] = [
  { ticker: 'SPY', name: 'SPDR S&P 500' },
  { ticker: 'QQQ', name: 'Invesco QQQ (Nasdaq-100)' },
  { ticker: 'DIA', name: 'SPDR Dow Jones Industrial Average' },
  { ticker: 'IWM', name: 'iShares Russell 2000' },
  { ticker: 'MDY', name: 'SPDR S&P MidCap 400' },
  { ticker: 'IJH', name: 'iShares Core S&P Mid-Cap' },
  { ticker: 'IJK', name: 'iShares S&P Mid-Cap 400 Growth' },
  { ticker: 'IJJ', name: 'iShares S&P Mid-Cap 400 Value' },
  { ticker: 'IJR', name: 'iShares Core S&P Small-Cap' },
  { ticker: 'IJT', name: 'iShares S&P Small-Cap 600 Growth' },
  { ticker: 'IJS', name: 'iShares S&P Small-Cap 600 Value' },
  { ticker: 'XLK', name: 'Technology Select Sector SPDR' },
  { ticker: 'XLF', name: 'Financial Select Sector SPDR' },
  { ticker: 'XLV', name: 'Health Care Select Sector SPDR' },
  { ticker: 'XLE', name: 'Energy Select Sector SPDR' },
  { ticker: 'XLI', name: 'Industrial Select Sector SPDR' },
  { ticker: 'XLY', name: 'Consumer Discretionary Select Sector SPDR' },
  { ticker: 'XLP', name: 'Consumer Staples Select Sector SPDR' },
  { ticker: 'XLU', name: 'Utilities Select Sector SPDR' },
  { ticker: 'XLB', name: 'Materials Select Sector SPDR' },
  { ticker: 'XLRE', name: 'Real Estate Select Sector SPDR' },
  { ticker: 'XLC', name: 'Communication Services Select Sector SPDR' },
]

export const EQUAL_WEIGHT_ETFS: EtfEntry[] = [
  { ticker: 'RSP', name: 'Invesco S&P 500 Equal Weight' },
  { ticker: 'QQQE', name: 'Direxion NASDAQ-100 Equal Weighted' },
  { ticker: 'RSPT', name: 'Invesco S&P 500 EW Technology' },
  { ticker: 'RSPF', name: 'Invesco S&P 500 EW Financials' },
  { ticker: 'RSPH', name: 'Invesco S&P 500 EW Health Care' },
  { ticker: 'RSPG', name: 'Invesco S&P 500 EW Energy' },
  { ticker: 'RSPN', name: 'Invesco S&P 500 EW Industrials' },
  { ticker: 'RSPD', name: 'Invesco S&P 500 EW Consumer Discretionary' },
  { ticker: 'RSPS', name: 'Invesco S&P 500 EW Consumer Staples' },
  { ticker: 'RSPU', name: 'Invesco S&P 500 EW Utilities' },
  { ticker: 'RSPM', name: 'Invesco S&P 500 EW Materials' },
  { ticker: 'RSPR', name: 'Invesco S&P 500 EW Real Estate' },
  { ticker: 'RSPC', name: 'Invesco S&P 500 EW Communication Services' },
]

export const COUNTRY_ETFS: EtfEntry[] = [
  { ticker: 'EWJ', name: 'iShares MSCI Japan' },
  { ticker: 'EWZ', name: 'iShares MSCI Brazil' },
  { ticker: 'EWG', name: 'iShares MSCI Germany' },
  { ticker: 'EWU', name: 'iShares MSCI United Kingdom' },
  { ticker: 'EWQ', name: 'iShares MSCI France' },
  { ticker: 'EWI', name: 'iShares MSCI Italy' },
  { ticker: 'EWP', name: 'iShares MSCI Spain' },
  { ticker: 'EWL', name: 'iShares MSCI Switzerland' },
  { ticker: 'EWN', name: 'iShares MSCI Netherlands' },
  { ticker: 'EWD', name: 'iShares MSCI Sweden' },
  { ticker: 'FXI', name: 'iShares China Large-Cap' },
  { ticker: 'MCHI', name: 'iShares MSCI China' },
  { ticker: 'INDA', name: 'iShares MSCI India' },
  { ticker: 'EWW', name: 'iShares MSCI Mexico' },
  { ticker: 'EWC', name: 'iShares MSCI Canada' },
  { ticker: 'EWA', name: 'iShares MSCI Australia' },
  { ticker: 'EWY', name: 'iShares MSCI South Korea' },
  { ticker: 'EWT', name: 'iShares MSCI Taiwan' },
  { ticker: 'EWH', name: 'iShares MSCI Hong Kong' },
  { ticker: 'EWS', name: 'iShares MSCI Singapore' },
  { ticker: 'EIDO', name: 'iShares MSCI Indonesia' },
  { ticker: 'THD', name: 'iShares MSCI Thailand' },
  { ticker: 'VNM', name: 'VanEck Vietnam' },
  { ticker: 'ARGT', name: 'Global X MSCI Argentina' },
  { ticker: 'ECH', name: 'iShares MSCI Chile' },
  { ticker: 'EPU', name: 'iShares MSCI Peru' },
  { ticker: 'EZA', name: 'iShares MSCI South Africa' },
  { ticker: 'TUR', name: 'iShares MSCI Turkey' },
  { ticker: 'EPOL', name: 'iShares MSCI Poland' },
  { ticker: 'KSA', name: 'iShares MSCI Saudi Arabia' },
  { ticker: 'EIS', name: 'iShares MSCI Israel' },
  { ticker: 'EFA', name: 'iShares MSCI EAFE' },
  { ticker: 'EEM', name: 'iShares MSCI Emerging Markets' },
]

/** Index proxies for the ticker tape (ETFs, not the cash indices). */
export const TAPE_INDEXES: { ticker: string; label: string }[] = [
  { ticker: 'DIA', label: 'DOW' },
  { ticker: 'QQQ', label: 'NASDAQ' },
  { ticker: 'SPY', label: 'S&P 500' },
  { ticker: 'IWM', label: 'RUSSELL' },
]

export const ETF_LISTS: Record<EtfListId, EtfEntry[]> = {
  group: GROUP_ETFS,
  sectors: SECTOR_ETFS,
  equal: EQUAL_WEIGHT_ETFS,
  country: COUNTRY_ETFS,
}

export function isEtfListId(value: string): value is EtfListId {
  return value in ETF_LISTS
}

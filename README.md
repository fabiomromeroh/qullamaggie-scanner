# Qullamaggie Ideas Dashboard

Dark, desktop-first scanner + watchlist for a swing trader who follows **Kristjan Qullamaggie** / **Kyle (@kyletrades_)** breakout process:

1. Hunt **strong uptrending industry groups** first  
2. **Scan** a liquid US universe for leaders forming a **coil / base about to break**  
3. Surface **setup readiness** (`watching` → `coiled` → `triggering`) and maintain a **dynamic watchlist**  
4. Currently take only **A+ setups with a specific catalyst** (catalysts are never invented from APIs)

> **Default mode is live market data.** Demo seed rows load only when you explicitly set `VITE_MARKET_DATA_MODE=demo`. Live failures show an error UI — they never silently fall back to fake prices.

## How to run

```bash
cd /workspace/qullamaggie-dashboard
cp .env.example .env
# Edit .env and set FINNHUB_API_KEY (see below)
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

**Run a scan:** open the app (or click **Refresh**). Live mode scores every symbol in `SCAN_UNIVERSE` (`src/data/watchlist.ts`), derives Kyle metrics + `setupStage`, and auto-adds coiled/triggering names with `kyleScore ≥ 4` to the dynamic watchlist.

Production build:

```bash
npm run build
npm run preview   # preview also runs the /api/market proxy middleware
```

Optional: copy `dist/` into the Windows package at `/workspace/qullamaggie-dashboard-win/app/dist` after a successful build.

## Finnhub API key

1. Sign up at [https://finnhub.io](https://finnhub.io) (free tier).  
2. Copy your API key into `.env` (gitignored):

```bash
VITE_MARKET_DATA_MODE=live
FINNHUB_API_KEY=your_key_here
```

The Vite server middleware (`server/marketProxy.ts`) reads `FINNHUB_API_KEY` or `VITE_FINNHUB_API_KEY` at runtime and calls Finnhub **server-side**, so the key is not required in the browser bundle. Prefer the non-`VITE_` name.

**Never commit or print the key.**

If the key is missing or Finnhub errors/rate-limits, the proxy falls through the cascade (below).

## How scanning works

1. **Universe** — `SCAN_UNIVERSE` in `src/data/watchlist.ts` (~100 liquid US names across semis, software, cyber, aero, biotech, retail, fintech, energy). This is broader than a fixed personal watchlist.  
2. **Fetch** — client requests `/api/market/snapshot?symbol=…` with **concurrency 2** and **~200 ms gap** (`SCAN_CONCURRENCY` / `SCAN_GAP_MS`).  
3. **Cascade (server)** — Finnhub → Yahoo (unofficial) → Stooq.  
4. **Cache** — in-memory snapshot TTL (**10 minutes** by default; override with `MARKET_CACHE_TTL_MS`). Refresh within the window reuses bars (Finnhub free-tier friendly).  
5. **Score** — `src/lib/metrics.ts` computes priorRunPct, tightDays, baseLengthDays, MA surfers, ADR, DolVol, above 200/50, kyleScore, A+.  
6. **Stage** — `src/lib/setupStage.ts` assigns readiness (see below). Names **below 200 SMA are excluded** from results.  
7. **Watchlist** — UI pins + **auto-add** when `kyleScore ≥ 4` and stage is `coiled` or `triggering` (see `AUTO_ADD_MIN_KYLE_SCORE`). Persisted in **localStorage**; optional seed file `src/data/userWatchlist.json`.

### Rate limits / free tier

| Lever | Default | Notes |
|-------|---------|--------|
| Client concurrency | 2 | Keep low for Finnhub free tier |
| Client gap | 200 ms | Between symbol requests |
| Snapshot cache TTL | 10 min | `MARKET_CACHE_TTL_MS` |
| Cascade | Finnhub → Yahoo → Stooq | Yahoo/Stooq unofficial |

Health: `GET /api/market/health` reports key presence (length only), cascade, and cache size — **not** the key value.

## Setup readiness stages

| Stage | Meaning (heuristic) |
|-------|---------------------|
| **watching** | Passes hard trend gate (above 200 SMA); building / on radar |
| **coiled** | Tight days (≥5 of last 15) + near highs (≤10% from 52w) + 10/20 MA surfer (+ prior run help) |
| **triggering** | Elevated RVOL / breakout-day heuristic (e.g. RVOL≥1.8 near highs with green day) |

**Default view:** show **coiled + triggering** first (filter toggles; Watching opt-in). Sort order: triggering → coiled → watching, then kyleScore / A+.

**QQQ regime:** header still shows **QQQ 10>20** and ST direction. When ST is **Downtrend**, UI soft-warns and **deprioritizes** triggering breakouts in sort order (not a hard block).

## Dynamic watchlist

- Panel: pin / unpin / remove  
- Storage key: `qullamaggie.userWatchlist.v1` (browser localStorage)  
- Seed: `src/data/userWatchlist.json` (empty by default; documented threshold)  
- **Auto-add threshold:** `kyleScore >= 4` **and** stage ∈ {`coiled`, `triggering`}  
- Catalysts are **never** invented from market APIs

## Market data cascade (no silent demo)

For each scan symbol the server tries, in order:

1. **Finnhub REST** (official free tier) — `/quote` (+ `/stock/candle` when the plan allows). If candles are blocked on free tier, Finnhub quote is kept and daily bars are filled from Yahoo (`finnhub+yahoo`).  
2. **Yahoo Finance chart** (full) — **unofficial** public endpoints; no key; **may break** without notice; not an official API  
3. **Stooq** daily CSV — optional third public source  

If **all** providers fail for **all** symbols:

- The app does **not** load `DEMO_DASHBOARD`
- UI shows **“Could not load live data”** with Retry
- Zero fake tickers/prices

Partial symbol failures are skipped; surviving live rows still render.

### Demo mode (explicit only)

```bash
VITE_MARKET_DATA_MODE=demo
```

Use only for local UI work. Default when unset: **`live`**.

## Stack

- Vite + React + TypeScript  
- Tailwind CSS v4 (`@tailwindcss/vite`)  
- Recharts (sparklines)  
- Lucide icons  
- Vite middleware proxy for Finnhub / Yahoo / Stooq (`/api/market/*`)

## Project layout

| Path | Role |
|------|------|
| `src/data/watchlist.ts` | `SCAN_UNIVERSE` + industry groups + scan batch defaults |
| `src/data/userWatchlist.json` | Optional watchlist seed (threshold documented) |
| `src/data/demoData.ts` | Seed data — demo mode only |
| `src/adapters/marketData.ts` | Live scan / demo adapters (no live→demo fallback) |
| `src/lib/metrics.ts` | RVOL, ADR%, SMAs, Kyle proxies, A+ |
| `src/lib/setupStage.ts` | watching / coiled / triggering |
| `src/lib/userWatchlistStore.ts` | localStorage pin + auto-add |
| `server/marketProxy.ts` | Cascade + TTL cache + Vite middleware |
| `src/hooks/useDashboard.ts` | Load + filters + stage sort |
| `src/components/WatchlistPanel.tsx` | Dynamic watchlist UI |
| `src/components/*` | Header, table, filters, drawer |

## How to extend the scan universe

1. Open `src/data/watchlist.ts`.  
2. Ensure the industry group exists in `WATCHLIST_GROUPS` (or add one).  
3. Append `{ ticker, name, groupId }` to `SCAN_UNIVERSE`.  
4. Keep free-tier friendly: prefer liquid names; rely on cache + low concurrency.  
5. **Catalysts** stay `null` from market APIs — fill later via brief/notes.  

## Metrics & A+ badge

| Term | Meaning |
|------|---------|
| **RVOL** | Last day volume ÷ 20-day average volume |
| **ADR%** | 20-day average of (high−low)/close × 100 |
| **% from 52w high** | Distance below ~252-day high |
| **1M / 3M perf** | Close vs ~21 / ~63 trading days ago |
| **DolVol / Avg $ volume** | 20-day average of close × volume |
| **SMA200 / SMA50 / SMA20 / SMA10** | Simple moving averages of daily closes |
| **aboveSma200** | Hard trend gate: price must be above daily 200-SMA or the name is **not** a valid setup |
| **aboveSma50** | Soft preference; filter **Require 50 SMA** defaults **ON** |
| **priorRunPct / tightDays / baseLengthDays** | Kyle-style consolidation proxies |
| **kyleScore** | Heuristic 3–5 for sorting — **not** Kyle’s official Rating |
| **setupStage** | watching / coiled / triggering |
| **A+ (heuristic)** | Above 200 **and** 50 SMA, near highs, ADR% ≥ 2.5, elevated RVOL **or** prior run, preferably MA surfer — heuristic, not a signal |
| **Catalyst** | Always blank from APIs (Earnings/GAP tags only if catalyst text is present) |

## Kyle Breakout Database field mapping (@kyletrades_)

All Kyle-style fields are **computed from live daily bars** in `src/lib/metrics.ts`. This dashboard does **not** read Notion rows for scoring.

| Kyle / Characteristics column (approx.) | Our field | Proxy definition |
|------------------------------------------|-----------|------------------|
| Inc% / prior run into base | `priorRunPct` | % from the lowest low in the ~63 sessions **before** a recent ~15-day base window into that base’s high |
| Tight / consolidation days | `tightDays` | Count of last 15 sessions with range &lt; 0.75× window ADR **or** close within 1.5% of SMA10/SMA20 |
| Over Days / base length | `baseLengthDays` | Trailing streak of below-average-range days (up to ~40) |
| 10MA / 20MA / 50MA Surfer | `aboveSma10`, `aboveSma20`, `aboveSma50` + badges | Price above respective SMA |
| Above / below 200MA | `aboveSma200` | Hard gate; below → excluded |
| DolVol | `dollarVolume` | 20-day avg close × volume |
| ADR% | `adrPct` | Same as above |
| Rating (stars) | `kyleScore` | Heuristic 3–5; **not** Kyle’s official Rating |
| Market 10&gt;20 / ST | `marketRegime` | From live **QQQ** bars |

## License / disclaimer

Personal dashboard UI. Not affiliated with Kristjan Qullamaggie or Kyle. Not financial advice. Yahoo Finance and Stooq access is unofficial and unsupported.

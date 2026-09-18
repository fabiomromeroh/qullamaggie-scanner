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

**Run a scan:** open the app (or click **Refresh**). Live mode runs Stage 1 (Yahoo liquid screen) → Stage 1.5 (above 200+50 SMA quotes) → Stage 2 deep Kyle metrics, and auto-adds coiled/triggering names with `kyleScore ≥ 4` to the dynamic watchlist.

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

Three-stage **server-side** scan (Stage 1 → Stage 1.5 SMA → Stage 2). The browser never walks thousands of symbols on page load — it only reads `GET /api/market/dashboard` (file cache).

### Stage 1 — Yahoo EquityQuery screener (universe)

Unofficial Yahoo Finance screener POST (`/v1/finance/screener`) with cookie + crumb, paginated at ≤250 rows.

| Filter | Value | Notes |
|--------|-------|--------|
| Region | `us` | US listings |
| Quote type | `EQUITY` | **No ETFs / funds** |
| Price | `intradayprice > 5` | Min price **above $5** |
| Liquidity | `avgdailyvol3m ≥ 750_000` | Mid-band of 500k–1M avg share volume |
| Exchanges | NMS, NYQ, NGM, NCM | Nasdaq + NYSE |
| Cap | 800 names | `SCAN_STAGE1_CAP` (deep-scan budget) |

If the custom screener fails (crumb / 401 / empty), Stage 1 falls back to Yahoo **predefined** screens (most actives / gainers / losers / etc.), still equity-filtered.

Observed in a workspace smoke test (2026-09-18): custom EquityQuery returned crumb **429**, predefined fallback still produced **~608** liquid equities (≫ emergency ~100 list). On Render, crumb often works and EquityQuery pagination applies.

If that also fails, Stage 1 uses the tiny emergency `SCAN_UNIVERSE` (~100 names) and labels the dashboard **Emergency universe**.

### Stage 1.5 — SMA prefilter (cheap Yahoo quotes)

Before any full bar history download, Stage 1.5 batches Yahoo `/v7/finance/quote` for Stage-1 symbols and keeps only names where:

| Gate | Rule |
|------|------|
| Trend | `regularMarketPrice > twoHundredDayAverage` |
| Soft → hard | `regularMarketPrice > fiftyDayAverage` |
| Missing data | **Fail closed** — drop symbol if either average is absent / quote fails |

Prefers light Yahoo quote fields (`fiftyDayAverage`, `twoHundredDayAverage`, price) when crumb auth works. If quote/crumb is blocked (401/429), falls back to Yahoo **spark** closes-only (`/v8/finance/spark`, 1y daily closes) to compute SMA50/SMA200 — still **not** full OHLCV candle history. Batched (~20 symbols; Yahoo spark rejects larger batches) with short gaps + brief in-memory cache (`SMA_QUOTE_CACHE_TTL_MS`, default 5 min).

Only Stage 1.5 survivors become the Stage-2 shortlist (`stage15Count` / `shortlistCount` in cache + UI).

### Stage 2 — deep metrics on SMA survivors only

For each Stage-1.5 survivor (Yahoo-first cascade: Yahoo → Finnhub → Stooq):

1. Daily bars → Kyle / Qullamaggie proxies (`computeIdeaMetrics`)
2. Hard gate: **above daily 200 SMA** (recomputed from bars) or excluded
3. Earnings overlay (Finnhub calendar → Nasdaq)
4. Dynamic industry groups from Yahoo sector/industry (static `WATCHLIST_GROUPS` when ticker is known)
5. QQQ regime from live bars

Results are written to `data/scan-cache.json` (gitignored). Default staleness **45 minutes** (`SCAN_CACHE_STALE_MS`).

### API

| Endpoint | Role |
|----------|------|
| `GET /api/market/dashboard` | Cached dashboard JSON (fast UI) |
| `GET /api/market/scan/status` | Scanning flag, cache age, Stage-1 counts |
| `POST /api/market/scan/refresh` | Kick background rescan (lock; 202 if started) |
| `GET /api/market/health` | Key presence + cascade (no secrets) |
| `GET /api/market/snapshot?symbol=` | On-demand single-symbol cascade |

On server boot: load cache; if missing/stale, start a background scan. UI **Refresh** triggers `POST /api/market/scan/refresh` then reloads the cache.

### Rate limits / free tier

| Lever | Default | Notes |
|-------|---------|--------|
| Stage 1 | Yahoo screener | Avoids Finnhub 60/min for universe pass |
| Stage 1.5 | Yahoo quote SMA batch | Drops below 200/50 before deep bars |
| Stage 2 concurrency | 3 | `SCAN_STAGE2_CONCURRENCY` |
| Stage 2 gap | 150 ms | `SCAN_STAGE2_GAP_MS` |
| Snapshot cache TTL | 10 min | `MARKET_CACHE_TTL_MS` |
| Scan cache stale | 45 min | `SCAN_CACHE_STALE_MS` |
| Cascade | Yahoo-first on bulk scan | Finnhub still used when helpful |

### Limitations

- Yahoo screener / chart endpoints are **unofficial** and may break or rate-limit (crumb 429).
- Stage-1 liquidity uses **share volume**, not dollar volume (Yahoo screener field `avgdailyvol3m`).
- Stage-1 is capped (~800); Stage 1.5 further shrinks the deep-scan budget via SMA quotes.
- Near-high / momentum narrowing is intentionally light in Stage 1 so coiled bases are not missed; Stage 1.5 enforces above-200 **and** above-50; Stage 2 + UI filters refine.

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
| `server/yahooScreener.ts` | Stage-1 Yahoo EquityQuery client (crumb + pagination) |
| `server/scanEngine.ts` | Stage-1→1.5→2 orchestration + cache writer |
| `server/scanCache.ts` | `data/scan-cache.json` load/save + scan lock |
| `server/marketProxy.ts` | Cascade + TTL cache + Vite middleware |
| `src/hooks/useDashboard.ts` | Load + filters + stage sort |
| `src/components/WatchlistPanel.tsx` | Dynamic watchlist UI |
| `src/components/*` | Header, table, filters, drawer |

## How to extend / tune the scan

1. **Liquidity / price** — env `SCAN_MIN_AVG_VOL` (default 750000), `SCAN_MIN_PRICE` (default 5), `SCAN_STAGE1_CAP` (default 800).
2. **Stage 1.5 SMA** — `SMA_QUOTE_BATCH` (default 20), `SMA_QUOTE_GAP_MS` (default 120), `SMA_QUOTE_CACHE_TTL_MS` (default 5m). Always requires above 200 **and** above 50.
3. **Staleness** — `SCAN_CACHE_STALE_MS` (default 45m).
4. **Emergency list** — edit `SCAN_UNIVERSE` in `src/data/watchlist.ts` only as a last-resort fallback.
5. **Catalysts** stay `null` from market APIs — fill later via notes.

## Metrics & A+ badge

| Term | Meaning |
|------|---------|
| **RVOL** | Last day volume ÷ 20-day average volume |
| **ADR%** | 20-day average of (high−low)/close × 100 |
| **% from 52w high** | Distance below ~252-day high |
| **1M / 3M / 6M perf** | Close vs ~21 / ~63 / ~126 trading days ago |
| **Group 1M / 3M / 6M** | Average of scan members' 1M/3M/6M returns in that industry (GroupStrength) |
| **earningsDate / daysToEarnings / earningsStatus** | Next earnings from Finnhub calendar (Nasdaq fallback); `avoid` = same/next trading day (hard fail for entry / not A+); `alert` ≈ 2 trading days; `clear` otherwise |
| **DolVol / Avg $ volume** | 20-day average of close × volume |
| **SMA200 / SMA50 / SMA20 / SMA10** | Simple moving averages of daily closes |
| **aboveSma200** | Hard trend gate: price must be above daily 200-SMA or the name is **not** a valid setup |
| **aboveSma50** | Soft preference; filter **Require 50 SMA** defaults **ON** |
| **priorRunPct / tightDays / baseLengthDays** | Kyle-style consolidation proxies |
| **kyleScore** | Heuristic 3–5 for sorting — **not** Kyle’s official Rating |
| **setupStage** | watching / coiled / triggering |
| **A+ (heuristic)** | Above 200 **and** 50 SMA, near highs, ADR% ≥ 2.5, elevated RVOL **or** prior run, preferably MA surfer; **earningsStatus must not be `avoid`** — heuristic, not a signal |
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

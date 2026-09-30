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
4. Industry labels from Yahoo sector/industry (static `WATCHLIST_GROUPS` when the ticker is known). Those labels feed idea `groupId` / `groupName` and the internal group fallback. The Group Strength panel itself uses live Finviz groups (`GET /api/groups`).
5. QQQ regime from live bars

Results are written to `data/scan-cache.json` (gitignored). Default staleness **45 minutes** (`SCAN_CACHE_STALE_MS`).

Payloads are stamped with `SCAN_CACHE_SCHEMA` (`server/scanCache.ts`). Schema 2 discards scans from before the 1D-change fix: Yahoo `chartPreviousClose` on a 1-year chart is the close before that range, not the prior session, so those files stored a wrong `dayPct`. The next start throws them out and runs a fresh scan.

### API

| Endpoint | Role |
|----------|------|
| `GET /api/market/dashboard` | Cached dashboard JSON (fast UI) |
| `GET /api/market/scan/status` | Scanning flag, cache age, Stage-1 counts |
| `POST /api/market/scan/refresh` | Kick background rescan (lock; 202 if started) |
| `GET /api/market/health` | Key presence + cascade (no secrets) |
| `GET /api/market/snapshot?symbol=` | On-demand single-symbol cascade |
| `GET /api/groups` | Leading industry groups (Finviz live, or internal fallback) |
| `GET /api/groups/leaders?period=&slugs=` | Top snapshot members for up to 12 group slugs, ranked by computed performance (lazy; may return `pending`) |
| `GET /api/groups/:slug/stocks?period=` | That group's top 20 snapshot members by the selected period, scored with the same Stage-2 pipeline as the scan |

On server boot: load cache; if missing/stale, start a background scan. UI **Refresh** triggers `POST /api/market/scan/refresh` then reloads the cache.

### Group strength — Finviz leading groups

The panel (**Leading groups · Finviz live**) reads `GET /api/groups`. The server fetches the [Finviz industry performance](https://finviz.com/groups?g=industry&v=210&o=-perf13w&st=d1) page with a normal desktop Chrome User-Agent and parses the embedded `FinvizInitGroupsPerformance([...])` JSON. Columns are Finviz's own figures (1D / 1M / 3M is 13-week / 6M, plus 1W, 1Y, and YTD on the tooltip). Missing numbers stay `—`. Nothing is estimated. The **1W** figure stays on the row tooltip; the table columns stay **# / Group / Leaders / 1D / 1M / 3M / 6M** so the panel width does not change.

| Situation | Response |
|-----------|----------|
| Cache younger than **12 minutes** | `source: "finviz"`, `stale: false` |
| Cache older than that | One shared refetch. Concurrent requests wait on the same fetch |
| Refetch fails and a previous payload exists | That payload with `stale: true` |
| Finviz blocked (403 / 429 / 503 or a challenge page), unparseable, or no cache yet | `source: "fallback"` — the existing internal ranking (`buildDynamicGroups` on current scan ideas) |

`fetchedAt` is when Finviz was fetched, or when the fallback ranking was computed. The UI polls about every 5 minutes and keeps the last good payload if a request fails. It shows **Finviz**, an amber **Fallback: internal ranking**, and/or an amber **stale** badge, plus local `updated HH:MM`.

**Period.** A segmented control in the header (`1D | 1W | 1M | 3M | 6M`, default **3M**) is stored in `localStorage` key `qm-groups-period`. The selected period:

- re-ranks the table client-side (that period's performance descending; ties break toward the next-longer period, then the other Finviz performance fields; missing numbers sort last)
- highlights that period's column when the column exists (1W has no column)
- chooses which performance window ranks leaders and the group drill-down
- resets the column sort to that period, descending

| Period | Finviz `o=` |
|--------|-------------|
| 1D | `-change` |
| 1W | `-perf1w` |
| 1M | `-perf4w` |
| 3M | `-perf13w` |
| 6M | `-perf26w` |

**Sortable headers.** Click **#**, **Group**, **Leaders**, **1D**, **1M**, **3M**, or **6M** to sort. Click again to flip direction. The active header shows a chevron. Dragging a column resize handle does not sort (the handle stops the click, and a drag larger than a few pixels is ignored). **Leaders** sorts by the in-scan count; groups whose count is still loading, failed, or unknown sort last in both directions. Column widths stay in `qm-groups-col-widths`. The mobile strip shows the selected period first.

**Leader definition.** A leader is one of the top 20 names in that group's membership snapshot (price &gt; $5 and average volume &gt; 750K at the time the snapshot was built) whose **computed** selected-period performance is **&gt; 0** and that **also appears in the current scan cache**. Scan membership stands in for "above the 200-day SMA": the cached scan only contains names that already passed Stage 1, Stage 1.5 (above 200 and above 50), and Stage 2. The cell is `N/D` (for example `3/18`), where `D` is how many of those top 20 have a real performance number. The tooltip lists up to five tickers, best selected-period performance first, and marks which are in the scan. One or two of those tickers also sit in small type on the group-name line. While the list is loading or the server still has members to price, the cell is `…`. On error it is `—` and the tooltip carries the error. If the scan cache is not ready, the cell shows the top ticker(s) without a count and the tooltip says the count is unknown. Groups outside the fetch window show `·` rather than spinning. The client requests leaders only for the first 25 groups in the current sort, plus the selected group, in batches of at most 12, and again when the period changes. A `pending: true` entry is retried with backoff (3s, then 6s, then 12s, up to 12 attempts).

`GET /api/groups/leaders?period=3m&slugs=a,b` validates `period` (`1d|1w|1m|3m|6m`) and each slug (`[a-z0-9]+`, max 12). Each entry is `{ slug, period, fetchedAt, stale, error?, pending?, leaders, top5, inScanCount, parsedCount, memberCount?, membership? }`. A leader row is `{ ticker, company, perf, price, changePct, relVolume, avgVolume, inScan }`. `perf` is the computed selected-period percent (`null` when there are not enough bars). `membership` is `{ source: "snapshot", generatedAt, stale }` when the snapshot was used. See **Membership snapshot** below.

**Group drill-down.** Clicking a Finviz group name (desktop row or mobile card) loads `GET /api/groups/:slug/stocks?period=`. The server ranks that group's snapshot members by the selected period, keeps the top 20 that have a performance number, then runs `scoreTickers` — the Stage-2 function the full scan uses (`fetchSymbolSnapshot` → `computeIdeaMetrics` → earnings). Tickers already in the scan cache are reused. Names that fail the scan rules (below the 200-day SMA, or the price/volume screens) are **kept and flagged** (`aboveSma200: false`, characteristic `Below 200MA`, stage badge **Below 200**). Group view ignores scanner filters that still equal their defaults, so the default stage gate (`coiled` and `triggering` only) and the default SMA50 / SMA10 / SMA20 requirements do not hide members. Min RVOL, max % from the high, setup type, A+ only, catalyst, and earnings status are ignored the same way until the user changes that control. Free-text search always applies. The table lists every scored name in the top 20, ordered by the selected period's `finvizPerf` descending (nulls last, ticker ascending on a tie) — the same order as Finviz's list for that period. Above-200 names are not floated to the top; below-200 names stay in performance order and keep the flag. When a changed filter does hide rows, the banner adds `Showing N of M group stocks (filters hiding K)` and **Show all** resets filters to the defaults while keeping the selected group. The `N shown` count, the empty state, and TradingView copy use the rows on screen. The normal scan (no group selected) is unchanged: default stage and SMA gates still apply, and rows still sort by setup stage and kyleScore. Names with no bars go in `failed: [{ ticker, reason }]` and the table shows `N of D tickers had no data`. The response is `{ slug, label, period, order, source: "snapshot", fetchedAt, stale, ideas, failed, finvizPerf, perfByTicker, parsedCount, membership }`. `source` may still be `"finviz"` when `FINVIZ_SCREENER_LIVE=1` and that fetch succeeds. `finvizPerf` and `perfByTicker` both carry the computed period percent on the snapshot path. If the snapshot is missing, the slug is absent, or every member lacks performance data, the route returns **502** `{ error }` and the table shows that message with **Retry**. No rows are invented. Changing the period reloads the selected group. **Reset** (header, next to the period control, and in the results banner) clears the selection and puts the existing dashboard scan back in the table. It does not start a new scan. The external Finviz icon still opens `screener.ashx?v=111&f=ind_<slug>&o=<period order>` in the browser. Resizable columns still apply. TradingView copy uses the rows on screen. The row tooltip shows the computed period percent; the 1M / 3M columns stay the scanner's figures from the scored bars (the ideas table has no column-sort state, so group view order is the performance order). The banner reads `Group: X · top 20 by <period> perf · membership snapshot <date>`, with an amber **stale** tag when the snapshot is older than 14 days. The internal fallback panel still filters by `groupId` and still uses its own leader count (members within 10% of the 52-week high).

**Finviz request budget.** The groups page (`finviz.com/groups`) is still fetched at request time: concurrency **2**, at least **400 ms** between request starts, **10 s** timeout, desktop Chrome User-Agent, redirects followed. No proxy, cookie, or browser automation. That payload is cached **12 minutes**. A failed refetch keeps the last good groups payload and marks it `stale`. A challenge or consent page, or HTTP 403 / 429 / 503, falls back to the internal ranking when nothing is cached. With `FINVIZ_SCREENER_LIVE` unset, leaders and drill-down make **no** request to `finviz.com/screener.ashx`. Scored group payloads are cached **12 minutes** per `(slug, period, snapshot time)`.

### Membership snapshot

Render's IPs receive **HTTP 403** from `finviz.com/screener.ashx`. The groups page still answers from Render and stays the source of industry performance (1D / 1W / 1M / 3M / 6M columns). Membership is a file built where the screener answers, then read at request time. The build does not use a proxy, a cookie, or a browser, and it does not require Finviz Elite. There is no GitHub Action for this refresh: the available token cannot write workflows, and Finviz was not verified from GitHub runners. Refresh it by hand.

```bash
npm run build:groups
```

That runs `scripts/buildGroupMembers.ts` (esbuild, then node). It reads industry slugs and names from the live groups page, then for each slug walks `screener.ashx?v=141` with `f=ind_<slug>,sh_price_o5,sh_avgvol_o750`, pages `r=1`, `r=21`, `r=41`, … until a page has fewer than 20 rows, and stops after 15 pages. The same polite queue as the groups fetch is used (concurrency 2, ≥400 ms gap, desktop Chrome User-Agent, 10 s timeout). A failed page is retried at most twice. A 403, 429, 503, or challenge page aborts the run. The destination `server/data/finviz-group-members.json` is replaced only after every group succeeds (temp file, then rename). An empty Finviz screen (`result_count` 0 and no table) is stored as zero tickers.

The file shape is `{ version: 1, source: "finviz", sourceNote, generatedAt, filters: { minPrice: 5, minAvgVolume: 750000 }, groups: { [slug]: { name, tickers, companies?, count } } }`. Commit the file with the app. Render cannot rebuild it.

**When to refresh.** About weekly. Industry membership drifts slowly. The header and the group banner show `Membership: snapshot YYYY-MM-DD`. Older than **14 days** adds an amber **stale** tag. Leaders still compute from a stale file; the tag is the reminder. A slug that Finviz adds after the snapshot returns `not in membership snapshot; run npm run build:groups` on that entry (leaders) or as the stocks error. A missing or invalid file returns `Membership snapshot missing` / `Membership snapshot invalid` the same way. Nothing is filled in with a guess.

**Period math.** For each snapshot member the server loads one daily-bar snapshot (`fetchSymbolSnapshot`: Yahoo chart, then Finnhub, then Stooq). That one fetch fills every period, so changing 1D / 1W / 1M / 3M / 6M does not fetch again. The quote cache lives about **15 minutes** (a failed symbol about **60 seconds**) and in-flight loads share one call.

Lookback is completed daily bars **before** the session that produced `price`:

| Period | Return |
|--------|--------|
| 1D | `price / prevClose − 1`, with `prevClose` from `resolvePrevClose` (the prior session close; Yahoo `chartPreviousClose` on a 1-year chart is about a year ago and is not used) |
| 1W | price vs the close **5** sessions back |
| 1M | **21** sessions |
| 3M | **63** sessions |
| 6M | **126** sessions |

Finviz's own columns are Perf Week, Perf Month (about 4 weeks), Perf Quart (13 weeks) and Perf Half (26 weeks), roughly 5 / 20 / 65 / 130 sessions. A few percentage points of difference versus Finviz is expected. Too few bars returns `null` (shown as `—`). Relative volume, when present, is the price-session share volume divided by the mean of the 20 completed bars before it and is **not** scaled up for the portion of the session still ahead, so an intraday print sits below Finviz's relative volume. Average volume is the mean of up to 63 daily bars. The scan cache's idea perf fields are a different window and are not copied; bars already in the market-data cache are reused.

Members are ordered by that percent descending, nulls last, ticker ascending on a tie. The leader pool is the top 20.

**Request-time cost.** One leaders call prices cached symbols immediately and starts at most **40** uncached symbols or about **8 seconds**, with **4** workers and a **50 ms** gap. Groups that still have unpriced members come back `{ pending: true }` with an empty leader list so the UI keeps showing `…` and polls. Drill-down of a single group prices every member of that group, then scores the top 20. After the scan cache exists, a background warm-up (at most **2** workers, **200 ms** gap) prices members of the top **25** industries by the current Finviz 3-month figure. It never blocks the scan. `GROUP_WARMUP=0` turns it off. The default is on.

On Render's free tier a cold instance has an empty quote cache and the dyno may be asleep. The first leaders paint can take several poll rounds (each round up to about 8 seconds, plus Yahoo latency) before the visible groups finish. Warm-up shortens the next load of the top 25 while the process stays up. A sleeping free instance pays the cold cost again.

**Env**

| Variable | Default | Effect |
|----------|---------|--------|
| `GROUP_WARMUP` | on | `0` disables the background member warm-up |
| `FINVIZ_SCREENER_LIVE` | off | `1` tries `finviz.com/screener.ashx` first for leaders and drill-down, then uses the snapshot if that fetch fails. Leave unset in production |
| `GROUP_MEMBERS_PATH` | `server/data/finviz-group-members.json` | Override the snapshot path |

**Limitations of the snapshot path**

- Performance is computed here. It can differ from Finviz's 4-week / 13-week / 26-week figures by a few points, and 1W is 5 sessions.
- A cold leaders request for many groups is bounded per call and finishes across polls. It is not a single instant answer.
- "In the scan" is membership in the cached full scan, which is also above the 50-day SMA. It is not a fresh 200-SMA check of every snapshot ticker outside that cache.
- Names Finviz adds to an industry show up after the next `npm run build:groups`. Until then that slug errors.
- The 15-page cap is 300 names. A group that still had a full page at the cap is stored with `truncated: true`.
- Provider failures stay as `null` performance or, on drill-down when nobody in the group has a number, as an error. No figure is estimated.

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
| Finviz groups cache | 12 min | `finviz.com/groups` only, unless `FINVIZ_SCREENER_LIVE=1` |
| Finviz concurrency | 2 | Groups fetch (and the snapshot build): 400 ms minimum gap, 10 s timeout |
| Member quote cache | 15 min | One daily-bar snapshot covers every leader period. Failures expire in 60 s |
| Leaders budget | 8 s or 40 symbols | Uncached names per leaders call; unfinished groups return `pending` |
| Group warm-up | top 25, 2 workers | After the scan cache exists. `GROUP_WARMUP=0` disables it |
| Leaders batch | 12 slugs | Client asks only for the visible window (about 25) plus the selected group, and polls pending slugs |

### Limitations

- Yahoo screener / chart endpoints are **unofficial** and may break or rate-limit (crumb 429).
- Stage-1 liquidity uses **share volume**, not dollar volume (Yahoo screener field `avgdailyvol3m`).
- Stage-1 is capped (~800); Stage 1.5 further shrinks the deep-scan budget via SMA quotes.
- Near-high / momentum narrowing is intentionally light in Stage 1 so coiled bases are not missed; Stage 1.5 enforces above-200 **and** above-50; Stage 2 + UI filters refine.
- Finviz HTML for the groups page can change or block the request. A block is shown as fallback or an error. Leader counts are computed from the membership snapshot, not estimated.
- The screener parser (snapshot build, and the optional live path) maps columns by header text. A missing expected header fails the parse. The build walks every page until a short page or 15 pages. Request-time leaders do not call the screener unless `FINVIZ_SCREENER_LIVE=1`.
- "In the scan" is membership in the cached full scan, which is also above the 50-day SMA. It is not a fresh 200-SMA check of every snapshot ticker outside that cache.
- Group drill-down prices every snapshot member of that one group, then scores the top 20. Names already in the scan cache skip the scorer. Provider keys are optional; Yahoo is tried first. A cold group can take a while.
- The membership file goes stale as industries change. Refresh with `npm run build:groups` about weekly. See **Membership snapshot**.
- The 1W period ranks and fetches leaders, but it has no table column.

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
| `server/finvizGroups.ts` | Finviz leading-groups fetch, 12-minute cache, `/api/groups` routes |
| `server/finvizParse.ts` | Pure `FinvizInitGroupsPerformance` parser |
| `server/finvizHttp.ts` | Shared Finviz fetch queue (concurrency 2, 400 ms gap, 10 s) |
| `server/finvizScreener.ts` | Optional live screener fetch (`FINVIZ_SCREENER_LIVE=1` only) |
| `server/finvizScreenerParse.ts` | Header-driven screener HTML parser |
| `server/groupMembers.ts` | Snapshot load, validation, staleness, page collection |
| `server/groupPerformance.ts` | Period returns from provider bars, quote cache, leaders time budget |
| `server/groupLeaders.ts` | `GET /api/groups/leaders` from the snapshot |
| `server/groupStocks.ts` | Group drill-down: snapshot top 20 + `scoreTickers`, 12-minute cache |
| `server/groupWarmup.ts` | Background warm-up of the top 25 groups |
| `server/data/finviz-group-members.json` | Committed membership snapshot (`npm run build:groups`) |
| `scripts/buildGroupMembers.ts` | Builds that file from a host that can reach Finviz |
| `server/fixtures/finviz-screener-performance-sample.html` | Trimmed real screener table used by parser tests |
| `src/lib/groupPeriod.ts` | Period → Finviz order, slug checks, leader-count definition |
| `src/hooks/useGroups.ts` | Client poll of `/api/groups` (keeps last good payload) |
| `src/hooks/useGroupLeaders.ts` | Lazy `/api/groups/leaders` for the visible groups |
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
| **Group 1D / 1W / 1M / 3M / 6M** | Finviz industry performance (3M = 13-week, 6M = 26-week). The panel ranks by the selected period. 1W is on the tooltip, not its own column. Fallback: average of scan members' returns in that internal group |
| **Leaders `N/D`** | Of the top 20 snapshot members with a computed selected-period performance (price &gt; $5 and avg volume &gt; 750K when the snapshot was built), how many are &gt; 0 and also sit in the current scan cache |
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

# Qullamaggie Ideas Dashboard

Dark, desktop-first scanner + watchlist for a swing trader who follows **Kristjan Qullamaggie** / **Kyle (@kyletrades_)** breakout process:

1. Hunt **strong uptrending industry groups** first  
2. **Scan** a liquid US universe for leaders forming a **coil / base about to break**  
3. Surface **setup readiness** (`watching` → `coiled` → `triggering`) and maintain a **manual watchlist**  
4. Prefer **A+ setups with a real catalyst** (an important headline inside 48 hours, or earnings reported in that window — never invented)

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

**Run a scan:** open the app (or click **Refresh**). Live mode runs Stage 1 (Yahoo liquid screen) → Stage 1.5 (above 200+50 SMA quotes) → Stage 2 deep Kyle metrics. Pin a results row or type tickers in the Watchlist panel to keep names across refresh.

Production build:

```bash
npm run build
npm run preview   # preview also runs the /api/market proxy middleware
```

Optional: copy `dist/` into the Windows package at `/workspace/qullamaggie-dashboard-win/app/dist` after a successful build.

## Metric tooltips

Every calculated label in the dashboard (table headers and cells, filter chips, the detail panel, group strength, the watchlist, the header, and the chart) opens a definition from `src/lib/metricDefinitions.ts`.

Add one by extending `METRIC_DEFS` with a `label`, a one-line `short`, and a `how` (one to three sentences). Where a threshold already exists, interpolate that constant (`SURFER_CONFIG`, `TIGHT_CONFIG`, `STAGE_CONFIG`, `APLUS_CONFIG`, `KYLE_SCORE_CONFIG`, and the other exported configs) instead of typing the number again. Then render `<MetricTip id="yourId">` or spread `metricTipAttrs('yourId')` on a control that is already focusable. Pass `extra` when a row has a live detail (distance versus its average, a headline, an earnings date) that should sit under the shared definition.

Hover opens the tip after a short delay. Tab focuses the trigger and shows it immediately. Escape hides it. A tap on a touch screen toggles it, and a tap elsewhere closes it. One tooltip is shared for the whole page, so a large ideas table does not mount a popover per cell. Column-resize drags do not open it.

## Finnhub API key

1. Sign up at [https://finnhub.io](https://finnhub.io) (free tier).  
2. Copy your API key into `.env` (gitignored):

```bash
VITE_MARKET_DATA_MODE=live
FINNHUB_API_KEY=your_key_here
```

The Vite server middleware (`server/marketProxy.ts`) reads `FINNHUB_API_KEY` or `VITE_FINNHUB_API_KEY` at runtime and calls Finnhub **server-side**, so the key is not required in the browser bundle. Prefer the non-`VITE_` name.

**Never commit or print the key.**

If the key is missing or Finnhub errors/rate-limits, the proxy falls through the cascade (below). News then uses Yahoo search; profile facts and the Wikipedia lookup are skipped (no company name to verify).

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

Only Stage 1.5 survivors become the Stage-2 shortlist (`stage15Count` / `shortlistCount` in cache + UI). The dashboard chip **Above 200 DMA** does not put those dropped names back. The normal scan prefilters below-200 names server-side; toggle off only reveals names present in the payload, group view includes them.

### Stage 2 — deep metrics on SMA survivors only

For each Stage-1.5 survivor (Yahoo-first cascade: Yahoo → Finnhub → Stooq):

1. Daily bars → Kyle / Qullamaggie proxies (`computeIdeaMetrics`)
2. Hard gate: **above daily 200 SMA** (recomputed from bars) or excluded
3. Earnings overlay (Finnhub calendar → Nasdaq)
4. Industry labels from Yahoo sector/industry (static `WATCHLIST_GROUPS` when the ticker is known). Those labels feed idea `groupId` / `groupName` and the internal group fallback. The Group Strength panel itself uses live Finviz groups (`GET /api/groups`).
5. QQQ regime from live bars

**ADR extension from the 50 SMA** (`extensionAdr50` on every idea, scan and group drill-down):

- Canonical: `(price - sma50) / (price * (adrPct / 100))`
- Equivalent: `pctAboveSma50 / adrPct` when `pctAboveSma50 = ((price - sma50) / price) * 100`
- `TradingIdea.pctAboveSma50` stays `(price / SMA50 − 1) × 100` (SMA50 in the denominator) and is not removed
- ADR% is the mean of `(high − low) / close × 100` over the prior 20 sessions, excluding the latest bar
- Positive = extended above the 50 SMA; negative = below; zero when price equals the 50 SMA
- Null (UI `—`) when `adrPct <= 0`, `price <= 0`, or `sma50` is missing/non-finite
- Rounded to 2 decimals on the idea

The ideas table has an **Ext50** column, the detail panel a chip **Ext. 50SMA: +2.3 ADR**, and the daily chart a matching chip next to the SMA toggles (uses the idea field, or recomputes from bars + ADR if that field is missing).

**Max ADR extension from 50 SMA** filter (Numeric group, after Max % from high): presets Any | < 5 ADR | < 4 | < 3 | < 2 | < 1. Default **Any** (no filter). When threshold T is selected, ideas with `extensionAdr50 != null` AND `extensionAdr50 > T` are excluded. Unknown (`null`) values are kept. Negative extensions (below the 50 SMA) always pass.

Results are written to `data/scan-cache.json` (gitignored). Default staleness **45 minutes** (`SCAN_CACHE_STALE_MS`).

Payloads are stamped with `SCAN_CACHE_SCHEMA` (`server/scanCache.ts`). Schema 5 discards scans from before `extensionAdr50` (ADR multiples from the 50-day SMA). Schema 4 had discarded scans from before the ADR-relative surfer detail and the tight-consolidation 50/200 SMA fields. Catalyst fields are not stored in this file; they are merged onto the HTTP response from a separate cache. Schema 3 had added the first strict surfer / tight fields. Schema 2 had discarded scans from before the 1D-change fix: Yahoo `chartPreviousClose` on a 1-year chart is the close before that range, not the prior session, so those files stored a wrong `dayPct`. The next start throws an older file out and runs a fresh scan.

### API

| Endpoint | Role |
|----------|------|
| `GET /api/market/dashboard` | Cached dashboard JSON (fast UI) |
| `GET /api/market/scan/status` | Scanning flag, cache age, Stage-1 counts |
| `POST /api/market/scan/refresh` | Kick background rescan (lock; 202 if started) |
| `GET /api/market/health` | Key presence + cascade (no secrets) |
| `GET /api/market/snapshot?symbol=` | On-demand single-symbol cascade |
| `GET /api/market/bars/:symbol` | Last ~260 daily OHLCV bars for the detail chart (max 500; 15 min cache) |
| `GET /api/market/news/:symbol` | Latest headlines (Finnhub company-news, Yahoo search fallback; 10 min cache) |
| `GET /api/market/profile/:symbol` | Company facts (Finnhub profile2) + verified Wikipedia extract (24h cache) |
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

**Group drill-down.** Clicking a Finviz group name (desktop row or mobile card) loads `GET /api/groups/:slug/stocks?period=`. The server ranks that group's snapshot members by the selected period, keeps the top 20 that have a performance number, then runs `scoreTickers` — the Stage-2 function the full scan uses (`fetchSymbolSnapshot` → `computeIdeaMetrics` → earnings). Tickers already in the scan cache are reused. Names that fail the scan rules (below the 200-day SMA, or the price/volume screens) are **kept and flagged** (`aboveSma200: false`, characteristic `Below 200MA`, stage badge **Below 200**, trend badge `<200`). Client filters are the **Scanner filters** section below. **Above 200 DMA** starts on, so below-200 members count as hidden until that chip is turned off or **Show all (incl. below 200 DMA)** is pressed. The table order is the selected period's `finvizPerf` descending (nulls last, ticker ascending on a tie). Above-200 names are not floated; below-200 names that pass the filters stay in that order and keep the flag. The `N shown` count, the empty state, and TradingView copy use the rows on screen. The normal scan (no group selected) still sorts by setup stage and kyleScore. Names with no bars go in `failed: [{ ticker, reason }]` and the table shows `N of D tickers had no data`. The response is `{ slug, label, period, order, source: "snapshot", fetchedAt, stale, ideas, failed, finvizPerf, perfByTicker, parsedCount, membership }`. `source` may still be `"finviz"` when `FINVIZ_SCREENER_LIVE=1` and that fetch succeeds. `finvizPerf` and `perfByTicker` both carry the computed period percent on the snapshot path. If the snapshot is missing, the slug is absent, or every member lacks performance data, the route returns **502** `{ error }` and the table shows that message with **Retry**. No rows are invented. Changing the period reloads the selected group. **Reset** (header, next to the period control, and in the results banner) clears the selection and puts the existing dashboard scan back in the table. It does not start a new scan. The external Finviz icon still opens `screener.ashx?v=111&f=ind_<slug>&o=<period order>` in the browser. Resizable columns still apply. TradingView copy uses the rows on screen. The row tooltip shows the computed period percent; the 1M / 3M columns stay the scanner's figures from the scored bars (the ideas table has no column-sort state, so group view order is the performance order). The banner reads `Group: X · top 20 by <period> perf · membership snapshot <date>`, with an amber **stale** tag when the snapshot is older than 14 days. The internal fallback panel still filters by `groupId` and still uses its own leader count (members within 10% of the 52-week high).

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

- Finnhub free tier is **60 calls/min**. News, profile, and quote/candle share that budget with the scan.
- Yahoo search news and Wikipedia REST were not verified from Render IPs; they may 403 / 429 there. The UI then shows empty or error states.
- Wikipedia matching is conservative: a disambiguation or a page whose title/extract does not share the company core name yields **no description**.
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

## Ticker detail panel

Clicking a result row (or a watchlist row) opens a **split detail sheet** immediately: a daily candlestick chart on the left and the existing detail content on the right (metrics, news, company profile). There is no second expand step and no dimmed backdrop. The results table stays in the page underneath, so another row click switches the ticker. The chart and the panel update together. While the new bars load, the previous chart stays up with a small “Loading SYMBOL…” label. A slower response for an earlier ticker is ignored.

The chart is TradingView Lightweight Charts (lazy-loaded chunk): volume histogram, SMA 10 / 20 / 50 / 200 chips (20 / 50 / 200 on by default), and a crosshair legend with OHLCV. The chart header shows ticker, name, and last price / day change from the selected idea. The mini sparkline in the panel is a visual only.

**Desktop (1024px and up).** The sheet is fixed to the right. It defaults to about 70% of the viewport and always leaves the leading-groups column plus a 240px strip of the results table clickable. Drag the sheet’s left edge to change that width, and drag the divider between the chart and the panel to change the split. Preferred floors are 560px for the chart and 380px for the panel; on a viewport that cannot fit both plus the strip, the panes scale down (absolute floors 200px / 160px) instead of covering the table. **Maximize chart** expands the same side-by-side split over the whole viewport and toggles back. Maximize is not remembered. Widths are stored in `qm-split-sheet-width` and `qm-split-panel-width`.

**Keyboard.** While the sheet is open, ArrowUp / ArrowDown move through the rows currently shown in the results table and wrap at the ends. Those keys are ignored when focus is in an input, textarea, select, or contentEditable. Esc and the X close the chart and the panel together and move focus back to the selected row when that row is on screen. Esc still closes from the search box (search does not handle Esc). It does not close when focus is on a native `<select>`, a datalist input, or a date / time / color input, so that control can dismiss its own popup.

**Narrow screens (under 1024px).** One full-viewport sheet scrolls as a single column: header (ticker, name, close), chart at about 52vh (minimum 280px, pinch-zoom and touch pan on the chart), then metrics, news, and profile. Tap targets are at least 40px. The sheet pads for the safe area, and the page behind it does not scroll.

Bars come from `GET /api/market/bars/:symbol`, which reuses `fetchSymbolSnapshot` (Yahoo chart → Finnhub → Stooq). About a year of daily bars is typical (~260); the handler returns at most the last 500, sorted ascending, with null/NaN rows dropped. Cache **15 minutes** per symbol, with in-flight de-dup. A failed load shows the error and **Retry**. Nothing is invented.

**Limitations.** Arrow keys follow the results table, not the watchlist order. The watchlist column sits under the desktop sheet until you close it, narrow it, or leave Maximize. On a short desktop the 560 / 380 floors cannot be met without covering the results strip, so both panes are narrower than that. The divider and the left edge are pointer drags (same handles as the main layout) and are not shown under 1024px.

**Latest news** (`GET /api/market/news/:symbol`): Finnhub `/company-news` for the last 7 days when `FINNHUB_API_KEY` is set. On missing key, HTTP 401 / 403 / 429, other errors, or zero items, the server falls back to Yahoo Finance search (`/v1/finance/search?newsCount=10&quotesCount=0`) with a normal desktop User-Agent. Only `http(s)` URLs are kept; items are deduped by URL/headline, newest first, capped at 10. Cache **10 minutes**, in-flight de-dup, stale-on-error. The panel shows up to 8 headlines (new tab, `rel="noopener noreferrer"`), an honest empty state (**No recent news found**), or **News unavailable**.

**Company description** (`GET /api/market/profile/:symbol`): facts from Finnhub `/stock/profile2` (name, industry, exchange, market cap in USD, website). Finnhub has no prose extract, and Yahoo `quoteSummary` is not used (it needs a crumb/cookie session). A short description is taken from the public Wikipedia REST summary **only when the page is verified**: OpenSearch by the Finnhub company name, skip disambiguation pages, and require the normalized core name (Inc / Corp / Ltd / Holdings / Group / Co / PLC / Class stripped) to match the title or extract. Otherwise the description is omitted. Trimmed to 2–3 sentences (≤ ~420 characters). Cache **24 hours**; negative results **1 hour**.

All three routes validate `:symbol` with `/^[A-Z0-9.\-^]{1,12}$/` after upper-casing and return **400** `{ error: "Invalid symbol" }` otherwise. Timeouts are 8 seconds. Nothing is invented: empty and error states are shown as-is.

| Cache | TTL | Notes |
|-------|-----|--------|
| Bars | 15 min | Wraps `fetchSymbolSnapshot` |
| News | 10 min | Stale payload kept if a refresh fails |
| Profile | 24 h / 1 h negative | Wikipedia miss is not guessed |

## Setup readiness stages

| Stage | Meaning (heuristic) |
|-------|---------------------|
| **watching** | Passes hard trend gate (above 200 SMA); building / on radar |
| **coiled** | Legacy: tight days (≥5 of last 15) + near highs (≤10% from 52w) + loose `aboveShortMas` (above SMA10 or SMA20, unrelated to the strict surfer label) + prior-run help. Extra route: strict tight consolidation and near highs |
| **triggering** | Elevated RVOL / breakout-day heuristic (e.g. RVOL≥1.8 near highs with green day) |

**Default view (normal scan):** **coiled + triggering** and **Above 200 DMA** on. Watching is opt-in. Sort order: triggering → coiled → watching, then kyleScore / A+.

**QQQ regime:** header still shows **QQQ 10>20** and ST direction. When ST is **Downtrend**, UI soft-warns and **deprioritizes** triggering breakouts in sort order (not a hard block).

## Scanner filters

One shared predicate (`passesFilters` in `src/lib/ideaFilters.ts`) applies every control in the normal scan and in group view. The only group-view difference inside the predicate is that `groupId` is not applied again, because that id already selected the group payload.

The request was clarified to ONE filter labeled **Above 200 DMA** (`requireAbove200`, default **on**). It means price above the 200-day SMA (`idea.aboveSma200`, not recomputed in the browser). Below-200 names are not valid setups. The chip sits in the **Above** group with the other SMA toggles, starts checked, and uses the same on/off chip colors as the other filter chips. Turning it off lets below-200 names through this predicate. It does not add a second 200-day control and it is not three filters.

Filter bar order (the same chips in the normal scan and in group view; only the baseline defaults differ). Each group has a small muted label:

1. **Search** — ticker / name text.
2. **Group** — selected industry (`groupId`), with a clear control when one is set.
3. **Numeric** — Min RVOL, Max % from high, Max ADR extension from 50 SMA.
4. **Above** — Above 10 SMA, Above 20 SMA, Above 50 SMA, Above 200 DMA (`requireSma10` / `requireSma20` / `requireSma50` / `requireAbove200`). "Above 50 SMA" is the old Require 50 SMA control; the field name is still `requireSma50`.
5. **Surfer (ADR-based)** — 10MA Surfer, 20MA Surfer, 50MA Surfer. Chip text does not repeat a strict suffix; the tooltip states the ADR-relative rule.
6. **Tight consolidation** — its own chip, not inside the surfer group.
7. **Stage** — Watching, Coiled, Triggering.
8. **Setup type** — one chip per setup type.
9. **Earnings** — Clear, Alert, Avoid.
10. **Other** — A+ only, Has catalyst. When catalyst coverage is known the bar shows `Catalyst: checked X of Y candidates`. With Has catalyst on, pending and unchecked ideas are excluded and the bar adds `N ideas not yet checked`.

**Normal scan baseline** (`DEFAULT_FILTERS`): Above 200 DMA on, stages coiled + triggering, Above 50 SMA on, Above 10/20 SMA off, surfer chips off, Tight consolidation off, min RVOL 0, max % from high 100, max ADR extension from 50 SMA **Any** (no filter), all setup types, all earnings statuses, A+ only off, Has catalyst off, search empty. With Above 200 DMA on, the table matches the old hard gate that dropped every `aboveSma200: false` row before the other checks.

**Group-view baseline** (`GROUP_VIEW_DEFAULT_FILTERS`): the same values except stages are all three (`watching`, `coiled`, `triggering`) and Above 50 SMA, Above 10/20 SMA, the surfer chips, and Tight consolidation are off. Above 200 DMA stays on. Max ADR extension from 50 SMA stays **Any**. While a group is selected the filter bar shows and edits this state. The normal scan filters are left alone, so they come back when the group is cleared. Changing the group, or pressing **Reset** on the filter bar, returns the group-view state to that baseline. Filter-bar **Reset** also restores the normal scan filters to `DEFAULT_FILTERS` and keeps the selected group. The group-panel **Reset** (next to the period control, and in the results banner) clears the group and brings those scan filters back. It does not start a new scan.

Every control applies as soon as it is pressed, including when the value equals a baseline. Re-enabling coiled + triggering, turning Above 50 SMA back on, or selecting every setup type hides or shows rows immediately. PR #5's rule (ignore a group filter that still equals the scanner default) is gone, which is why those controls used to look dead in group view.

The banner `Showing N of M group stocks (filters hiding K)` counts every row the active group filters remove, including Above 200 DMA. A group whose members include below-200 names therefore opens as, for example, `Showing 18 of 20 group stocks (filters hiding 2)`. **Show all (incl. below 200 DMA)** turns Above 200 DMA off and sets every other group filter to its most permissive value (all stages, no SMA requirement, min RVOL 0, max % from high 100, max ADR extension from 50 SMA Any, all setup types, all earnings statuses, A+ only off, catalyst off, search cleared) so the full member list is shown. The Above 200 DMA chip toggles that gate by itself. Rows that are shown below the 200-day SMA keep the **Below 200** stage badge, the `<200` trend badge, and the `Below 200MA` characteristic. TradingView copy and the shown count use the rows on screen. Order stays the selected period's performance descending, nulls last, ticker ascending on a tie.

The normal scan prefilters below-200 names server-side; toggle off only reveals names present in the payload, group view includes them. Stage 1.5 drops below-200 and below-50 names before deep scoring, and this change does not alter that server scan. Names that do reach the normal payload with `aboveSma200: false` are still subject to the other chips (they are staged `watching`, and Above 50 SMA is on by default). Filter values are not written to localStorage. If a stored filter object has no `requireAbove200`, it is read as on (`migrateStoredFilters`) and does not throw. `hasCatalyst` and the surfer flags migrate as booleans and do not throw. A missing `maxExtensionAdr50` is read as `null` (Any).

## Watchlist (manual)

The Watchlist panel holds **only** tickers you add or pin. Scans never insert names.

- **Storage:** `qm.userWatchlist.v2` in browser localStorage. Insertion order is stored (oldest first). The panel **displays newest first**. Cap **200**; adding past the cap is refused with an inline message. Corrupt JSON or a wrong shape loads as an empty list and never throws.
- **Add:** type or paste in the panel (Enter or **Add**). Separators: commas, spaces, semicolons, newlines. A leading `$` is stripped; symbols are uppercased. Pattern: 1–5 letters, optional class suffix (`BRK.B` / `BRK-B` / `PBR-A`). Duplicates against the current list are skipped. Feedback looks like `Added 3, skipped 2 duplicates, rejected: FOO$ (invalid)`.
- **Pin:** the ideas table star and the detail-panel pin write the same list (same module/hook). Unpin or the row **x** removes that ticker.
- **Clear all:** inline confirm (`Clear all N? Yes / No`, no `window.confirm`). Disabled when empty. After a clear, **Cleared N tickers — Undo** restores the previous list until the next add/remove/pin or 15 seconds.
- **Not in the current scan:** the row still shows. If the ticker is in `data.ideas`, the panel uses that scan row (price, 1D %, stage, kyleScore, RVOL, ADR%). Otherwise it lazily calls `GET /api/market/quote/:symbol` (price, prevClose, dayPct, asOf, source; symbol validated with `parseMarketSymbol`; cache ~60s; at most 3 in flight). Scan-only metrics render as `-`. States: `Loading...`, `Unavailable` + Retry, `No data` (invalid/delisted) with remove. Fetch never blocks the panel; display order does not wait on quotes.
- **Migration:** `qullamaggie.userWatchlist.v1` is read once when v2 is missing. Tickers you had explicitly pinned or added (`pinned` or `source === 'manual'`) are kept; scan-populated **auto-added** unpinned rows are dropped. The result is written to v2 and the v1 key is removed.
- **Limitations:** localStorage is per-browser / per-device and is not synced. Clearing site data clears the list.

Catalyst text is a real headline (or a dated earnings-calendar line). It is never invented. The scan file leaves `catalyst` null; the HTTP response fills it.

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
- TradingView Lightweight Charts (`lightweight-charts`, Apache-2.0) for the split-view daily candle chart  
- Lucide icons  
- Vite middleware proxy for Finnhub / Yahoo / Stooq (`/api/market/*`)

## Project layout

| Path | Role |
|------|------|
| `src/data/watchlist.ts` | `SCAN_UNIVERSE` + industry groups + scan batch defaults |
| `src/data/demoData.ts` | Seed data — demo mode only |
| `src/adapters/marketData.ts` | Live scan / demo adapters (no live→demo fallback) |
| `src/lib/metrics.ts` | RVOL, ADR%, SMAs, Kyle proxies, A+ |
| `src/lib/surfer.ts` | Strict MA-surfer (`SURFER_CONFIG`, `evaluateSurfer`) |
| `src/lib/tightConsolidation.ts` | Tight consolidation (`TIGHT_CONFIG`) |
| `src/lib/setupStage.ts` | watching / coiled / triggering |
| `src/lib/userWatchlistStore.ts` | Manual watchlist localStorage (`qm.userWatchlist.v2`) |
| `server/yahooScreener.ts` | Stage-1 Yahoo EquityQuery client (crumb + pagination) |
| `server/scanEngine.ts` | Stage-1→1.5→2 orchestration + cache writer |
| `server/scanCache.ts` | `data/scan-cache.json` load/save + scan lock |
| `server/marketProxy.ts` | Cascade + TTL cache + Vite middleware (`/api/market/*` including bars/news/profile/quote) |
| `server/marketQuote.ts` | Quote payload (price, prevClose, dayPct) + 60s cache |
| `server/marketBars.ts` | Bars payload shaping (last 500, sort, drop NaN) + 15 min cache |
| `server/tickerNews.ts` | Finnhub company-news + Yahoo search fallback, 10 min cache |
| `server/tickerProfile.ts` | Finnhub profile2 facts + verified Wikipedia summary, 24h cache |
| `src/lib/chartData.ts` | Pure `toCandles` / `toVolume` / `smaSeries` helpers |
| `src/lib/splitLayout.ts` | Split-sheet width clamp, row keyboard index, Esc / typing guards |
| `src/components/DailyChartPanel.tsx` | Lazy-loaded candlestick + volume + SMA chart (fills its parent) |
| `src/components/SplitDetailSheet.tsx` | Row-click split sheet: chart beside detail, maximize, Esc / X |
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
| `src/components/WatchlistPanel.tsx` | Manual watchlist UI |
| `src/components/*` | Header, table, filters, drawer |

## How to extend / tune the scan

1. **Liquidity / price** — env `SCAN_MIN_AVG_VOL` (default 750000), `SCAN_MIN_PRICE` (default 5), `SCAN_STAGE1_CAP` (default 800).
2. **Stage 1.5 SMA** — `SMA_QUOTE_BATCH` (default 20), `SMA_QUOTE_GAP_MS` (default 120), `SMA_QUOTE_CACHE_TTL_MS` (default 5m). Always requires above 200 **and** above 50.
3. **Staleness** — `SCAN_CACHE_STALE_MS` (default 45m).
4. **Emergency list** — edit `SCAN_UNIVERSE` in `src/data/watchlist.ts` only as a last-resort fallback.
5. **Catalysts** — categories, weights, the 48h window, and the Finnhub budget live in `src/lib/catalyst.ts` and `server/catalystService.ts` (`CATALYST_FETCH`). They are not part of the scan file.

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
| **aboveSma200** | **Above 200 DMA** filter (default on). Price above the daily 200-SMA, or the name is not a valid setup. The normal scan also drops these names in Stage 1.5 before the payload is built |
| **aboveSma50** | Soft preference; filter **Above 50 SMA** (`requireSma50`) defaults **ON** |
| **priorRunPct / tightDays / baseLengthDays** | Kyle-style consolidation proxies |
| **kyleScore** | Heuristic 3–5 for sorting — **not** Kyle’s official Rating. Surfer points still use loose `aboveSma10` / `aboveSma20`. |
| **setupStage** | watching / coiled / triggering. The legacy coiled rule uses loose `aboveShortMas` (`aboveSma10 \|\| aboveSma20`), which is not the strict surfer label. |
| **surfer10 / surfer20 / surfer50** | ADR-relative ride-the-MA flags (see below). Table badges **10S / 20S / 50S** mean these, not merely price above the SMA. |
| **tightConsolidation** | Strict contraction flag (see below). **Tight** badge is separate from the surfer badges. Requires price above the 50-day and 200-day SMAs. |
| **A+ (heuristic)** | Above 200 **and** 50 SMA, near highs, ADR% ≥ 2.5, elevated RVOL **or** prior run, preferably loose MA surfer; **earningsStatus must not be `avoid`** — heuristic, not a signal. “Surfer” here is still loose price-above-SMA10/20. |
| **hasCatalyst / catalyst** | True when an important headline (or a past earnings date) falls inside the rolling 48h window. `catalyst` is the display headline. See Catalyst classification. |

## Kyle Breakout Database field mapping (@kyletrades_)

All Kyle-style fields are **computed from live daily bars** in `src/lib/metrics.ts`. This dashboard does **not** read Notion rows for scoring.

| Kyle / Characteristics column (approx.) | Our field | Proxy definition |
|------------------------------------------|-----------|------------------|
| Inc% / prior run into base | `priorRunPct` | % from the lowest low in the ~63 sessions **before** a recent ~15-day base window into that base’s high |
| Tight / consolidation days | `tightDays` | Count of last 15 sessions with range &lt; 0.75× window ADR **or** close within 1.5% of SMA10/SMA20 |
| Over Days / base length | `baseLengthDays` | Trailing streak of below-average-range days (up to ~40) |
| 10MA / 20MA / 50MA Surfer | `surfer10`, `surfer20`, `surfer50` + 10S/20S/50S badges | ADR-relative proximity (see below). Loose price-above-SMA stays on `aboveSma*` / **Above 10/20/50 SMA** |
| Above / below 200MA | `aboveSma200` | **Above 200 DMA** (ONE filter, default on). Off shows names present in the payload; group view includes below-200 names and flags them |
| DolVol | `dollarVolume` | 20-day avg close × volume |
| ADR% | `adrPct` | Same as above |
| Rating (stars) | `kyleScore` | Heuristic 3–5; **not** Kyle’s official Rating |
| Market 10&gt;20 / ST | `marketRegime` | From live **QQQ** bars |

## Strict MA surfer

A **10MA / 20MA / 50MA Surfer** badge means the stock is riding that SMA, measured as percent distance relative to the stock's own ADR% (`src/lib/surfer.ts`). Discrete test counts are not used. Price merely sitting above the SMA is the loose `aboveSma10` / `aboveSma20` / `aboveSma50` flag and a different filter.

ADR% is the mean of `(high − low) / close × 100` over the 20 sessions before the latest bar. `computeIdeaMetrics` passes that already-computed value into `evaluateSurfer` so the two cannot diverge. SMA at bar *i* is the average of closes up to and including that bar.

`proximityPct = kProximity × adrPct`. A bar is **near** the SMA when `((low − SMA) / SMA) × 100` is at most `proximityPct` (the low is within that percent above the SMA, or through it). A high-ADR name may sit farther from the average, in percent, and still count.

`breakTolerancePct = kBreak × adrPct` (must be ≥ 0). Over the lookback window, all of the following hold:

1. Every close is at least `SMA × (1 − breakTolerancePct / 100)`. A deeper close fails even if price later comes back.
2. A close under the SMA but inside that tolerance is allowed when a later close, within `recoverySessions`, is back at or above that later bar's SMA. A dip that has not recovered by the latest bar fails. The latest bar cannot recover itself.
3. The stock was near the SMA on at least `nearFraction` of the window bars (0.40), **or** at least once in the last `recentNearSessions` bars of the window.
4. Latest price is at or above the SMA, allowing `latestToleranceAdr × adrPct` underneath, and is not extended: distance above the SMA is at most `maxExtensionAdrMultiple × adrPct`. A name that has already run far above the average is not a surfer.
5. SMA now is strictly greater than SMA `slopeLookback` sessions ago. `slopeAllowFlat` is false, so a flat slope fails. Soften it to `>=` only if a live scan shows the up-slope gate is too rare.

| Constant | 10MA | 20MA | 50MA |
|----------|------|------|------|
| `kProximity` | 0.35 | 0.50 | 0.75 |
| `kBreak` | 0.50 | 0.50 | 0.50 |
| `windowSessions` | 15 | 15 | 25 |
| `slopeLookback` | 5 | 5 | 10 |

Shared constants: `latestToleranceAdr` 0.05, `maxExtensionAdrMultiple` 1.75, `nearFraction` 0.40, `recentNearSessions` 4, `recoverySessions` 3, `slopeAllowFlat` false, `adrSessions` 20.

The slower average uses a larger proximity multiple because a normal pullback sits farther from a 50-day mean than from a 10-day mean. These are the values in `SURFER_CONFIG`. They were chosen so each flag stays roughly 3–15% of a full scan (the old test-count rule, schema 3 on 2026-10-02, printed 4 / 3 / 12 surfers out of 187 ideas). Retune `kProximity` if a fresh scan falls outside that band, and record the before/after counts.

Each idea stores `surferDetail` per average: `ok`, `distancePct`, `distanceAdr`, `nearBars`, `windowBars`, `minDistancePct`, `maxCloseBelowPct`, `recovered`, `slopePct`, `adrPct`, `proximityPct`, and `reason` when `ok` is false. The badge tooltip reads like `+0.8% above 20MA = 0.2 ADR`.

**Filters.** **Above 10 SMA** / **Above 20 SMA** / **Above 50 SMA** (`requireSma10` / `requireSma20` / `requireSma50`) are the loose price-above-SMA chips. **10MA Surfer** / **20MA Surfer** / **50MA Surfer** (`requireSurfer10` / `requireSurfer20` / `requireSurfer50`) default off in both `DEFAULT_FILTERS` and `GROUP_VIEW_DEFAULT_FILTERS`. Missing stored fields migrate to `false` and do not throw.

**A+ and kyleScore** still use the loose `aboveSma10` / `aboveSma20` flags. Switching them to the strict label would shrink A+ counts for a different reason than the original heuristic.

**Coiled stage.** The legacy branch uses a local named `aboveShortMas` (`aboveSma10 || aboveSma20`). That name is deliberate: it is not the strict surfer label. The extra coiled route is `tightConsolidation && near highs` and does not depend on SMA10 or SMA20.

**Limitations.** Daily bars only; an intraday poke that never prints is invisible. The SMA uses closes only, with that bar included. A flat average fails the slope rule. Extension is capped in ADR multiples, so a strong trend that has left the average behind is not tagged.

## Tight consolidation

`src/lib/tightConsolidation.ts` flags a short contraction. It does not share helpers, fields, or filters with the surfer rule. `ok` requires every criterion:

1. **Above the 50-day SMA and the 200-day SMA.** Price must be above both. SMA10 and SMA20 are not part of this rule. The result exposes `aboveSma50` and `aboveSma200` (there is no `aboveMas` flag). Fewer than 200 bars fails closed.
2. **Range contraction.** Average daily range% `(high−low)/close×100` over `recentWindow` divided by the average over the `baselineSessions` immediately before that window ≤ `rangeRatioMax`.
3. **Close-to-close spread.** `(max close − min close) / min close` over the recent window, as a percent, ≤ `min(closeSpreadMaxMultipleOfAdr × baseline ADR%, closeSpreadAbsMaxPct)`.
4. **Volume contraction.** Recent average volume / trailing `volumeAvgSessions` average ≤ `volumeRatioMax`.
5. **Location.** Price within `nearHighMaxPct` of the 52-week high (`pctFrom52wHigh >= -10`, same convention as metrics).

| Constant | Value | Notes |
|----------|-------|-------|
| `sma50Period` | 50 | Price must be above this average |
| `sma200Period` | 200 | Price must be above this average |
| `recentWindow` | 7 | Documented range 5–10 |
| `baselineSessions` | 30 | Documented range 20–50 |
| `rangeRatioMax` | 0.85 | Recent range vs prior baseline. 0.6 printed 0/187 ideas on a 2026-10-02 live scan; 0.85 still requires contraction. |
| `closeSpreadMaxMultipleOfAdr` | 1.5 | Times baseline ADR% |
| `closeSpreadAbsMaxPct` | 6 | Absolute cap on close spread |
| `volumeRatioMax` | 0.9 | Recent vol vs 50-session avg |
| `volumeAvgSessions` | 50 | Includes the recent window |
| `nearHighMaxPct` | 10 | `pctFrom52wHigh >= -10` |
| `highLookback` | 252 | Same 52-week window as metrics |
| `useInCoiled` | `true` | Extra coiled OR-route. 2026-10-02 live scan: 66 → 67 coiled (+1.5%, NET only). |

The **Tight** badge is its own badge, not a surfer badge. Filter chip **Tight consolidation** (`requireTight`, default off) is its own group. The detail panel lists range ratio, volume ratio, close spread, days, near the 52-week high, above SMA50, and above the 200-day SMA. The surfer section of the same panel lists distance in percent and in ADR multiples, near-bar count, slope, and the recovered flag.

**Coiled OR-route.** `coiled = (existing tightDays + aboveShortMas) OR (tightConsolidation && near highs)`. `TIGHT_CONFIG.useInCoiled` is **true**. A 2026-10-02 live scan of 187 ideas had 66 coiled on the legacy rule and 67 with the OR-route (NET only, +1.5%), under the ~25% inflation cap. Triggering still wins over coiled. Dropping the SMA10/SMA20 gate from tight does not change the legacy branch.

**Limitations.** The 7-day window is short; a single wide bar blows the range ratio. Volume uses a trailing 50-day average that includes the recent window, so contraction is slightly harder to print. 52-week high is the high of the last 252 daily bars, not a split-adjusted vendor field. Requiring 200 bars means a newly listed name cannot pass.

## Catalyst classification

An idea **has a catalyst** when at least one **important** news item was published within the last **48 hours** (`CATALYST_WINDOW_HOURS`, 2 × 24h rolling, measured from fetch time, using the publication datetime, not the calendar day). Important means the **headline** classifies into a volume-moving category and the score is at least `CATALYST_MIN_SCORE` (3.0). The issuer has to be the **subject** of that headline. Precision wins over recall: a loose ticker tag or a name buried later in the headline does not count.

Score = heaviest matching category weight + `CATALYST_EXTRA_CATEGORY_BONUS` (0.25) per extra distinct category, capped at `CATALYST_EXTRA_CATEGORY_CAP` (0.75), plus analyst bonuses. A lone analyst item weighs 2, so it qualifies only with a big-firm name (`ANALYST_BIG_FIRM_BONUS` +1) or a price-target raise (`ANALYST_PT_BONUS` +1). `breaking` weighs 2 and does not qualify alone. `product_launch` and `insider_inst_buy` are 3.0 rather than the illustrative 2.5 so one clear launch or insider buy meets the floor.

Earnings **already reported** inside the same 48h window count as category Earnings (a real earnings-calendar date, source “earnings calendar”, no invented URL). That path does not change future-earnings `earningsStatus` / `classifyEarningsProximity`. A name can be `avoid` for an upcoming report and still have a catalyst from a different headline. Previews (“ahead of earnings”, “earnings preview”, “what to expect”) are noise.

The Has-catalyst filter counts **both** directions. It is about volume-moving news. The table badge and the detail panel show direction (positive, negative, or mixed) explicitly. Pending and unchecked ideas do not pass the filter. The bar states how many ideas are not yet checked.

| id | Label | Weight | Direction |
|----|-------|--------|-----------|
| `mna` | M&A | 5 | positive, strong (noise does not veto) |
| `fda_clinical` | FDA / clinical | 5 | positive, strong |
| `fda_reject` | FDA rejection | 5 | negative |
| `earnings` | Earnings | 4 | positive, or negative on a miss |
| `guidance` | Guidance | 4 | positive, or negative on a cut |
| `offering_dilution` | Offering / dilution | 4 | negative |
| `contract_deal` | Contract / partnership | 3.5 | positive |
| `index_inclusion` | Index inclusion | 3.5 | positive |
| `buyback_dividend` | Buyback / dividend | 3 | positive |
| `activist_squeeze` | Activist / squeeze | 3 | positive |
| `regulatory_win` | Regulatory win | 3 | positive |
| `spinoff` | Spin-off | 3 | positive |
| `downgrade` | Downgrade | 3 | negative |
| `lawsuit_probe` | Lawsuit / probe | 3 | negative |
| `product_launch` | Product launch | 3 | positive |
| `insider_inst_buy` | Insider / institutional buy | 3 | positive |
| `analyst` | Analyst | 2 | positive; needs a big firm or a price-target raise |
| `breaking` | Breaking | 2 | positive; does not qualify alone |

A category counts only when its pattern matches the **headline**. The summary may only confirm direction (an earnings miss or a guidance cut on a headline that already matched) or add the big-firm / price-target analyst bonus. It cannot add a category, and it cannot mark the item as noise. A 2026-10-02 Finnhub pass showed company-news returning wires about other companies, with `related` set to the queried symbol on every row, and summaries mentioning deals the headline never did. A same-day Yahoo pass tagged other companies' stories onto NVDA and AMD the same way.

**Category guards.** `downgrade` matches `downgrad(e|es|ed|ing)`, or `cut` / `cuts` / `cutting` of a rating or price target (including “cut to Sell / Hold / Underperform”), or `lower(s)` / `lowered` / `reduce(s|d)` of a rating or price target. It does not match “down”, a cost or production cut, or “lowered expenses”. `buyback_dividend` matches an announcement: announces, authorizes, or approves a share repurchase or buyback, a repurchase or buyback program, a special dividend, a dividend hike, raises or initiates a dividend, or a stock split. “Returned $X to shareholders” and a “buyback-to-dividend split” explainer do not match. “Live Updates of … Outlook” is not a guidance change.

An item counts only when the issuer is the **subject** of the headline (`headlineMentionsIssuer`, then `itemConcernsIssuer`):

- The ticker appears as `(TICKER)`, `$TICKER`, `NASDAQ:TICKER`, or `NYSE:TICKER`, or as a **standalone uppercase** word of 3 or more letters, at a word index below `SUBJECT_MAX_WORD_INDEX` (**5**, the first five whitespace-separated words). A 1–2 letter ticker has no standalone match.
- Or the company's **first significant name word** (4+ letters; legal suffixes and generic words such as Inc, Corp, Holdings, Technologies stripped) is in that same window. Later words in the name do not match on their own. A closed compound does not match a shorter word (`ExxonMobil` is not `Exxon`).
- A name or ticker immediately followed by a hyphen modifier (`-backed`, `-owned`, `-linked`, `-powered`, `-based`, `-led`, `-funded`, `-supported`, `-focused`, `-related`, `-style`, `-ready`, `-rival`) is not the subject. “Nvidia-Backed Nebius Acquires …” is not an NVDA catalyst. A possessive still counts: “AMD's World Labs Buyout” is AMD.
- Or the headline opens with a leading `Company (TICKER)` pattern: at most `SUBJECT_LEADING_NAME_WORDS` (**4**) capitalized words, then `(TICKER)`. An acquisition verb in that prefix does not count.
- The issuer is not only the **object** of another party's `acquires` / `buys` / `purchases` / `orders` / `deploys` / `adopts` (including those inflections). `<Issuer> acquires …`, `<Issuer> to be acquired`, and `<Issuer> agrees to be acquired by …` stay. `<Other> to acquire <Issuer>` stays when the issuer is still inside the first five words. `<Other> acquires <Issuer>` does not, even inside the window.
- Yahoo `relatedTickers` and Finnhub `related` **never admit a row on their own**, including a Finnhub list that is only the queried symbol and a multi-ticker list. If a list is present and **omits** the symbol, the row is dropped unless the subject match is in the first `SUBJECT_RELATED_OVERRIDE_WORDS` (**3**) words.

Checked on 2026-10-02 headlines: “Nvidia-Backed Nebius Acquires Inferize…” is not an NVDA catalyst (the name is only a hyphen modifier of Nebius). “AMD's World Labs Buyout” is an AMD catalyst. “La Rosa Holdings Acquires Next-Generation NVIDIA GPUs…” is not an NVDA catalyst (NVIDIA is the sixth word and the object of Acquires). “ExxonMobil Returned $9.4 Billion to Shareholders… Here's the Buyback-to-Dividend Split.” is not an NVDA buyback. “EMS Broadens Product Offering … with Acquisition of …” is not an AMD deal, and “Product Offering” is not a share offering. “HPE stock … $1.2 billion AMD Helios order” counts for HPE and not for AMD. “Paramount antitrust settlement approved, Warner Bros. merger cleared” **does** count for Warner Bros. Discovery as M&A: “Warner” is word index 4, and the line is a merger clearance rather than a comparison or an acquires-object.

When every Finnhub row fails that check, the ticker falls through to Yahoo search, same as an empty Finnhub body. Yahoo does not spend a Finnhub token.

**Noise** vetoes the item unless M&A or FDA / clinical also matches **in the headline**: listicles (“stocks to watch”, “top/best stocks”, “stocks to buy”), “why it is up/down today” recaps, “should you buy”, “is it a buy”, “is … a buy/stock”, “here's the/why/how/what”, “returned $… to shareholders”, “which … stock”, “vs.” / “vs” comparisons, “X or Y” (ticker or capitalized name), “better buy/stock”, “why did … jump/fall/…”, Zacks rank, trending-stock blurbs, “what you need to know”, “analyst says”, rating reiterations (reiterates, maintains, reaffirms, keeps/stays a rating), earnings previews, earnings-call transcripts, podcasts. “Soars/Surges N% as” is noise **unless** the same headline matches earnings or guidance, so “Accenture (ACN) Soars 15.8% as Q4 Earnings …” stays an earnings catalyst. Publisher “Motley Fool” is noise. A bare “Zacks” publisher is not.

**Research encoded in the weights** (keyword classifier, not a model of abnormal returns):

- Qullamaggie, “How to master a setup: Episodic Pivots” (qullamaggie.com): earnings and guidance, FDA / biotech, contracts and partnerships, regulatory / political news, sector-wide repricing.
- Qullamaggie / Kullamägi EP study guide (kristjankullamagi.com/setups/episodic-pivot/): earnings and guidance, regulatory decisions, FDA / clinical events, major contracts, partnerships.
- qullamaggie.net, “Catalysts that create explosive moves”: earnings surprise, new contracts or orders, rapid earnings or sales growth, guidance above consensus.
- NBER w13090, “The Earnings Announcement Premium and Trading Volume”: earnings announcements concentrate abnormal volume.
- PLOS ONE 2024, “How does news affect biopharma stock prices?” (about 503k releases): acquisition news had the most positive abnormal returns; product development, investment, regulation, earnings guidance, and analyst ratings were significant; failed or halted development was strongly negative.
- PMC9439234, “Reaction of sponsor stock prices to clinical trial outcomes”: Phase 2/3 and Phase 3 outcomes matter most, especially for small or early biotech.
- Review of Financial Studies 2011 / NBER w14971, “When are analyst recommendation changes influential?”: only about 10–12% of rating changes move the price visibly, more often from star analysts and away from consensus. Upgrades and price-target raises count at a lower weight; reiterations are excluded; a named large firm adds a small bonus.
- EventStudyTools comparative event-type page: M&A targets, then buybacks (about +3–4%), earnings surprises, dividend increases or splits (about +1–3%), analyst recommendations (about 1–3%).

**Rate limit and honesty.** Finnhub’s free tier is 60 calls/min shared with the scan, so catalyst Finnhub calls are capped at **25/min** with concurrency 2 (`CATALYST_FETCH`). Yahoo search does not spend a Finnhub token. A 429 respects Retry-After (capped at 60s) and that ticker falls through to Yahoo. Candidates are ideas with stage coiled or triggering, or RVOL ≥ 1.5, or |day %| ≥ 4, or A+. The set is capped at 120, prioritized triggering, then coiled, then higher RVOL. Group view enriches that group’s ideas (already the top 20) with the same cap. Per-ticker cache TTL is 20 minutes, including a checked miss. Failures use a 5-minute negative TTL and keep a previous success (stale-on-error). Enrichment runs in the background after a scan and on dashboard / group-stock reads. It does not block the response and it is not written into `data/scan-cache.json`.

A cold cache reports `hasCatalyst: false` and `catalystStatus: 'pending'` for candidates, `'unchecked'` for everyone else. The payload includes `catalystMeta: { checked, pending, failed, unchecked, candidates, asOf, windowHours, finnhubCalls, yahooCalls, maxFinnhubCallsPer60s }`. The client refetches the dashboard a few times with backoff while `pending > 0`. There is no separate catalyst polling route.

**Limitations.** Keywords miss paraphrases and can fire on a coincidental phrase. The subject window drops a real item when the company is named only after the first five words, including an analyst-led line such as “Wells Fargo bullish on BP, downgrades Exxon Mobil…”. A line that leads with the issuer (“Exxon Mobil downgraded, BP upgraded…”) still counts; “upgraded” in that same headline also matches Analyst, so the direction is mixed. A closed compound such as “ExxonMobil” does not match the word “Exxon”. Related-ticker lists never create a catalyst. The classifier does not read the article body. Yahoo and Finnhub headlines are whatever those feeds returned; an empty feed is an honest miss, not a fabricated catalyst. Unchecked names are hidden when the filter is on, and the bar says so. Big-firm detection is a name list, not a measure of analyst influence.

## License / disclaimer

Personal dashboard UI. Not affiliated with Kristjan Qullamaggie or Kyle. Not financial advice. Yahoo Finance and Stooq access is unofficial and unsupported.

# Deploy to Render (free web service)

## 1. Push to GitHub

1. Create a new GitHub repository (public or private).
2. From this project root:

```bash
git init   # if needed
git add .
git commit -m "Prepare Render deploy"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Do **not** commit `.env` (it is gitignored). Secrets stay on Render.

## 2. Create the Render web service

1. Go to [Render Dashboard](https://dashboard.render.com/) → **New** → **Web Service**.
2. Connect the GitHub repo.
3. Render will pick up `render.yaml`, or set manually:
   - **Runtime:** Node
   - **Plan:** Free
   - **Build command:** `npm install && npm run build && npm run build:server`
   - **Start command:** `npm start`
4. Add environment variable:
   - `FINNHUB_API_KEY` = your Finnhub free-tier key ([finnhub.io](https://finnhub.io/))
5. Deploy.

## 3. What the server does

- Listens on `process.env.PORT` (Render sets this) or `5173`, host **`0.0.0.0`**.
- Serves the Vite `dist/` SPA.
- Proxies live market data at `/api/market/*` (health, snapshot, dashboard, scan, **bars / news / profile / quote** for the ticker detail panel and watchlist).
- Serves leading industry groups at `GET /api/groups` (Finviz **groups** page, 12-minute memory cache). If Finviz fails and a previous payload exists, that payload is returned with `stale: true`. With no cache, the response falls back to the internal scan ranking (`source: "fallback"`).
- Group **membership** comes from the committed file `server/data/finviz-group-members.json`, not from `finviz.com/screener.ashx` at request time. Render's IPs get HTTP 403 from that screener. The build does not try to get around the block. The intended refresh is a weekly Actions job (Mondays **06:00 UTC**): `npm run build:groups`, commit `server/data/finviz-group-members.json` when Finviz is reachable, and **exit 0** on HTTP 403 so a blocked runner leaves the file unchanged. That workflow file cannot ship until a token with the `workflow` scope pushes it, so it is not on this branch. Until then, run `npm run build:groups` weekly on a home or other machine that can reach Finviz, commit `server/data/finviz-group-members.json`, and push before deploy. Render's build command cannot regenerate it.
- `GET /api/groups/leaders?period=3m&slugs=a,b` ranks snapshot members with Yahoo / Finnhub / Stooq bars. One call computes at most about 8 seconds or 40 uncached symbols, then returns `pending: true` for groups that are not finished. The UI polls those. A slug missing from the file returns an error string and no invented rows.
- `GET /api/groups/:slug/stocks?period=3m` scores the top 20 snapshot members (by computed period performance) with the scan's Stage-2 pipeline and caches the `TradingIdea[]` for 12 minutes. Names below the 200-day SMA are included and flagged. Names with no data are listed in `failed`. A missing snapshot, unknown slug, or a group with no performance data returns HTTP 502 `{ "error": "..." }`.
- `GROUP_WARMUP` defaults on: after the scan cache exists, two background workers price members of the top 25 industries so the first page is faster. Set `GROUP_WARMUP=0` to disable. It does not block the scan. On the free tier a cold (or freshly woken) instance still pays the leaders budget until that warm-up finishes.
- `FINVIZ_SCREENER_LIVE` defaults off. Leave it unset on Render so the process never calls `finviz.com/screener.ashx`. `1` tries the live screener first and falls back to the snapshot.
- Ignores scan caches from before schema 8 (`SCAN_CACHE_SCHEMA` in `server/scanCache.ts`). Schema 8 stores `isA`, `rangeBaseScore`, and `rangeBaseDetail`. Schema 7 is the selected-period top-12 Finviz universe (default 1-month). Schema 6 adds `rangeBreakoutDetail` and replaces the Range Breakout label gates. Schema 5 had added `extensionAdr50` (ADR multiples from the 50-day SMA). Schema 4 had changed the surfer detail to ADR-relative proximity and the tight rule to price above the 50-day and 200-day SMAs. Catalyst fields are merged at response time and are not in the scan file. Older files are discarded and startup runs a fresh scan. Schema 2 had dropped `dayPct` values taken from Yahoo's pre-range `chartPreviousClose`.

## 4. Local production smoke test

```bash
npm install
npm run build
npm run build:server
# Refresh membership where finviz.com/screener.ashx answers, then commit the JSON.
# Intended Actions job: Mondays 06:00 UTC, npm run build:groups, commit the JSON
# when Finviz is reachable, exit 0 on 403. That workflow file cannot ship until
# a token with the workflow scope pushes it. Until then, run it here:
# npm run build:groups
GROUP_WARMUP=0 PORT=4173 npm start
# curl http://127.0.0.1:4173/api/market/health
# curl -sS http://127.0.0.1:4173/api/groups
# Leaders may return pending on a cold cache; repeat the same URL until pending is gone:
# curl -sS "http://127.0.0.1:4173/api/groups/leaders?period=3m&slugs=oilgasrefiningmarketing"
# The stocks route calls market-data providers and can take a while:
# curl -sS "http://127.0.0.1:4173/api/groups/oilgasrefiningmarketing/stocks?period=3m"
```

Never put the API key in the client bundle; keep it as `FINNHUB_API_KEY` on the server only.

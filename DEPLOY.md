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
- Proxies live market data at `/api/market/*` (health, snapshot, dashboard, scan).
- Serves leading industry groups at `GET /api/groups` (Finviz performance view, 12-minute memory cache). If Finviz fails and a previous payload exists, that payload is returned with `stale: true`. With no cache, the response falls back to the internal scan ranking (`source: "fallback"`).
- `GET /api/groups/leaders?period=3m&slugs=a,b` returns the Finviz performance-screener top page (≤20, price &gt; $5, average volume &gt; 750K) for up to 12 slugs. Same 12-minute cache, shared with drill-down. Finviz calls are queued (concurrency 2, 400 ms gap). A block or parse failure is an error on that slug, not invented rows.
- `GET /api/groups/:slug/stocks?period=3m` scores that top list with the scan's Stage-2 pipeline and caches the `TradingIdea[]` for 12 minutes. Names below the 200-day SMA are included and flagged. Names with no data are listed in `failed`. If Finviz is unavailable and nothing is cached, the route returns HTTP 502 `{ "error": "..." }`.

## 4. Local production smoke test

```bash
npm install
npm run build
npm run build:server
PORT=4173 npm start
# curl http://127.0.0.1:4173/api/market/health
# curl -sS http://127.0.0.1:4173/api/groups
# curl -sS "http://127.0.0.1:4173/api/groups/leaders?period=3m&slugs=oilgasrefiningmarketing"
# The stocks route calls market-data providers and can take a while:
# curl -sS "http://127.0.0.1:4173/api/groups/oilgasrefiningmarketing/stocks?period=3m"
```

Never put the API key in the client bundle; keep it as `FINNHUB_API_KEY` on the server only.

// packaging/standalone-server.ts
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// server/marketProxy.ts
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === void 0) process.env[key] = val;
  }
}
loadDotEnv();
function getFinnhubKey() {
  const key = process.env.FINNHUB_API_KEY?.trim() || process.env.VITE_FINNHUB_API_KEY?.trim();
  return key || void 0;
}
var BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
var BROWSER_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://finance.yahoo.com/",
  Origin: "https://finance.yahoo.com"
};
async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}
async function fetchJson(url, init) {
  const isYahoo = url.includes("finance.yahoo.com");
  const attempts = isYahoo ? 3 : 1;
  let lastErr = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(500 * attempt);
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          ...BROWSER_HEADERS,
          ...init?.headers ?? {}
        }
      });
      if (res.status === 429 && isYahoo) {
        lastErr = new Error(`HTTP 429 (${url.split("?")[0]})`);
        continue;
      }
      if (!res.ok) {
        let detail = "";
        try {
          const body = await res.json();
          if (body.error) detail = `: ${body.error}`;
        } catch {
        }
        throw new Error(`HTTP ${res.status}${detail} (${url.split("?")[0]})`);
      }
      return res.json();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (!isYahoo) throw lastErr;
    }
  }
  throw lastErr ?? new Error("fetchJson failed");
}
async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      ...BROWSER_HEADERS,
      Accept: "text/csv,text/plain,*/*"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
function nowSec() {
  return Math.floor(Date.now() / 1e3);
}
async function finnhubQuote(symbol, token) {
  const quote = await fetchJson(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`
  );
  if (typeof quote.c !== "number" || !(quote.c > 0)) {
    throw new Error(`Finnhub quote empty for ${symbol}`);
  }
  return {
    c: quote.c,
    pc: typeof quote.pc === "number" && quote.pc > 0 ? quote.pc : quote.c
  };
}
async function finnhubCandles(symbol, token) {
  const to = nowSec();
  const from = to - 400 * 86400;
  const candle = await fetchJson(
    `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${encodeURIComponent(token)}`
  );
  if (candle.error) throw new Error(candle.error);
  if (candle.s !== "ok" || !candle.t?.length || !candle.c?.length) {
    throw new Error(`Finnhub candle unavailable (s=${candle.s ?? "missing"})`);
  }
  return candle.t.map((t, i) => ({
    t,
    o: candle.o[i],
    h: candle.h[i],
    l: candle.l[i],
    c: candle.c[i],
    v: candle.v[i] ?? 0
  }));
}
function parseYahooChart(raw, symbol) {
  const data = raw;
  const result = data.chart?.result?.[0];
  if (!result?.timestamp?.length) {
    throw new Error(`Yahoo chart empty for ${symbol}`);
  }
  const q = result.indicators?.quote?.[0];
  if (!q?.close?.length) throw new Error(`Yahoo quote arrays missing for ${symbol}`);
  const bars = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const c = q.close[i];
    if (c == null || !Number.isFinite(c)) continue;
    bars.push({
      t: result.timestamp[i],
      o: q.open?.[i] ?? c,
      h: q.high?.[i] ?? c,
      l: q.low?.[i] ?? c,
      c,
      v: q.volume?.[i] ?? 0
    });
  }
  if (bars.length < 25) throw new Error(`Yahoo insufficient bars for ${symbol}`);
  const last = bars[bars.length - 1];
  const meta = result.meta ?? {};
  const price = typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0 ? meta.regularMarketPrice : last.c;
  const prevClose = typeof meta.previousClose === "number" && meta.previousClose > 0 ? meta.previousClose : typeof meta.chartPreviousClose === "number" && meta.chartPreviousClose > 0 ? meta.chartPreviousClose : bars.length > 1 ? bars[bars.length - 2].c : last.c;
  return {
    bars,
    name: meta.longName || meta.shortName,
    price,
    prevClose
  };
}
async function yahooChart(symbol) {
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  const errors = [];
  for (const host of hosts) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&includePrePost=false`;
    try {
      const raw = await fetchJson(url);
      return parseYahooChart(raw, symbol);
    } catch (err) {
      errors.push(`${host}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(errors.join("; "));
}
async function fromFinnhub(symbol, token) {
  const quote = await finnhubQuote(symbol, token);
  try {
    const bars = await finnhubCandles(symbol, token);
    return {
      symbol,
      price: quote.c,
      prevClose: quote.pc,
      bars,
      provider: "finnhub"
    };
  } catch {
    const y = await yahooChart(symbol);
    return {
      symbol,
      name: y.name,
      price: quote.c,
      prevClose: quote.pc,
      bars: y.bars,
      provider: "finnhub+yahoo"
    };
  }
}
async function fromYahoo(symbol) {
  const y = await yahooChart(symbol);
  return {
    symbol,
    name: y.name,
    price: y.price,
    prevClose: y.prevClose,
    bars: y.bars,
    provider: "yahoo"
  };
}
async function fromStooq(symbol) {
  const stooqSym = `${symbol.toLowerCase()}.us`;
  const urls = [
    `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSym)}&i=d`,
    `https://stooq.pl/q/d/l/?s=${encodeURIComponent(stooqSym)}&i=d`
  ];
  let text = "";
  const errors = [];
  for (const url of urls) {
    try {
      text = await fetchText(url);
      break;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (!text) throw new Error(`Stooq fetch failed: ${errors.join("; ")}`);
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 30 || !lines[0].toLowerCase().includes("date")) {
    throw new Error(`Stooq CSV unusable for ${symbol}`);
  }
  const bars = [];
  for (const line of lines.slice(1)) {
    const [date, o, h, l, c, v] = line.split(",");
    if (!date || !c || c === "null") continue;
    const close = Number(c);
    if (!Number.isFinite(close)) continue;
    const t = Math.floor((/* @__PURE__ */ new Date(`${date}T20:00:00Z`)).getTime() / 1e3);
    bars.push({
      t,
      o: Number(o) || close,
      h: Number(h) || close,
      l: Number(l) || close,
      c: close,
      v: Number(v) || 0
    });
  }
  const sliced = bars.slice(-280);
  if (sliced.length < 25) throw new Error(`Stooq insufficient bars for ${symbol}`);
  const last = sliced[sliced.length - 1];
  const prev = sliced[sliced.length - 2];
  return {
    symbol,
    price: last.c,
    prevClose: prev.c,
    bars: sliced,
    provider: "stooq"
  };
}
async function fetchSymbolSnapshot(symbol) {
  const sym = symbol.trim().toUpperCase();
  const errors = [];
  const key = getFinnhubKey();
  if (key) {
    try {
      return await fromFinnhub(sym, key);
    } catch (err) {
      errors.push(`finnhub: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    errors.push("finnhub: no API key (FINNHUB_API_KEY)");
  }
  try {
    return await fromYahoo(sym);
  } catch (err) {
    errors.push(`yahoo: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return await fromStooq(sym);
  } catch (err) {
    errors.push(`stooq: ${err instanceof Error ? err.message : String(err)}`);
  }
  throw new Error(`All providers failed for ${sym}: ${errors.join("; ")}`);
}
function createMarketMiddleware() {
  return async function marketMiddleware(req, res, next) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/market")) {
      next();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    try {
      if (url.pathname === "/api/market/health") {
        const key = getFinnhubKey();
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            ok: true,
            finnhubKeyPresent: Boolean(key),
            finnhubKeyLength: key ? key.length : 0,
            cascade: ["finnhub", "yahoo", "stooq"]
          })
        );
        return;
      }
      if (url.pathname === "/api/market/snapshot") {
        const symbol = url.searchParams.get("symbol");
        if (!symbol) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "symbol query required" }));
          return;
        }
        const snap = await fetchSymbolSnapshot(symbol);
        res.statusCode = 200;
        res.end(JSON.stringify(snap));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (err) {
      res.statusCode = 502;
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : "Market proxy error"
        })
      );
    }
  };
}

// packaging/standalone-server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
function packageRoot() {
  const candidate = path.resolve(__dirname, "..");
  if (fs.existsSync(path.join(candidate, "runtime")) || fs.existsSync(path.join(candidate, ".env"))) {
    return candidate;
  }
  return path.resolve(process.cwd());
}
function loadEnvFrom(root) {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === void 0) process.env[key] = val;
  }
}
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8"
};
function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": mime,
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=86400"
  });
  res.end(data);
}
function tryListen(server, host, port) {
  return new Promise((resolve2, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve2(port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}
async function main() {
  const root = packageRoot();
  process.chdir(root);
  loadEnvFrom(root);
  const distDir = path.join(__dirname, "dist");
  if (!fs.existsSync(distDir)) {
    console.error(`Missing dist folder at ${distDir}`);
    process.exit(1);
  }
  const market = createMarketMiddleware();
  const host = "127.0.0.1";
  const preferred = [5173, 17865];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.pathname.startsWith("/api/market")) {
      void market(
        req,
        {
          get statusCode() {
            return res.statusCode;
          },
          set statusCode(v) {
            res.statusCode = v;
          },
          setHeader: (k, v) => {
            res.setHeader(k, v);
          },
          end: (body) => {
            res.end(body);
          }
        },
        () => {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Not found" }));
        }
      );
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(distDir, safe);
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      sendFile(res, filePath);
      return;
    }
    const indexPath = path.join(distDir, "index.html");
    if (fs.existsSync(indexPath)) {
      sendFile(res, indexPath);
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });
  let port = 0;
  for (const p of preferred) {
    try {
      port = await tryListen(server, host, p);
      break;
    } catch (err) {
      const e = err;
      if (e.code !== "EADDRINUSE") throw err;
    }
  }
  if (!port) {
    console.error("Could not bind 5173 or 17865");
    process.exit(1);
  }
  const keyPresent = Boolean(getFinnhubKey());
  console.log(
    JSON.stringify({
      ready: true,
      url: `http://${host}:${port}/`,
      host,
      port,
      finnhubKeyPresent: keyPresent,
      dist: distDir,
      root
    })
  );
}
main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

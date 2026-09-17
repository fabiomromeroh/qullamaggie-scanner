/**
 * Production server for Render (and similar hosts).
 * Serves Vite dist/ and exposes /api/market/* (Finnhub→Yahoo→Stooq cascade).
 * Binds process.env.PORT || 5173 on 0.0.0.0 (Render requirement).
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createMarketMiddleware,
  getFinnhubKey,
} from './marketProxy.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function projectRoot(): string {
  // Bundled to server/prod.mjs → parent is repo root
  return path.resolve(__dirname, '..')
}

function loadEnvFrom(root: string): void {
  const envPath = path.join(root, '.env')
  if (!fs.existsSync(envPath)) return
  const text = fs.readFileSync(envPath, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

function sendFile(res: http.ServerResponse, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase()
  const mime = MIME[ext] ?? 'application/octet-stream'
  const data = fs.readFileSync(filePath)
  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=86400',
  })
  res.end(data)
}

async function main(): Promise<void> {
  const root = projectRoot()
  process.chdir(root)
  loadEnvFrom(root)

  const distDir = path.join(root, 'dist')
  if (!fs.existsSync(distDir)) {
    console.error(`Missing dist folder at ${distDir} — run npm run build first`)
    process.exit(1)
  }

  const market = createMarketMiddleware()
  const host = '0.0.0.0'
  const port = Number(process.env.PORT) || 5173

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`)

    if (url.pathname.startsWith('/api/market')) {
      void market(
        req,
        {
          get statusCode() {
            return res.statusCode
          },
          set statusCode(v: number) {
            res.statusCode = v
          },
          setHeader: (k: string, v: string) => {
            res.setHeader(k, v)
          },
          end: (body?: string) => {
            res.end(body)
          },
        },
        () => {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Not found' }))
        },
      )
      return
    }

    let rel = decodeURIComponent(url.pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '')
    const filePath = path.join(distDir, safe)

    if (!filePath.startsWith(distDir)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      sendFile(res, filePath)
      return
    }

    const indexPath = path.join(distDir, 'index.html')
    if (fs.existsSync(indexPath)) {
      sendFile(res, indexPath)
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })

  const keyPresent = Boolean(getFinnhubKey())
  console.log(
    JSON.stringify({
      ready: true,
      url: `http://${host}:${port}/`,
      host,
      port,
      finnhubKeyPresent: keyPresent,
      dist: distDir,
      root,
    }),
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

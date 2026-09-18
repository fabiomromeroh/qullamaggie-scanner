/**
 * Standalone production server for the Windows desktop package.
 * Serves app/dist and exposes /api/market/* using the Finnhub→Yahoo→Stooq cascade.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createMarketMiddleware,
  getFinnhubKey,
} from '../server/marketProxy.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** Package root: parent of app/ when running as app/server.mjs */
function packageRoot(): string {
  // When bundled to app/server.mjs, __dirname is .../app
  const candidate = path.resolve(__dirname, '..')
  if (fs.existsSync(path.join(candidate, 'runtime')) || fs.existsSync(path.join(candidate, '.env'))) {
    return candidate
  }
  // Dev / dry-run from packaging/
  return path.resolve(process.cwd())
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

function tryListen(
  server: http.Server,
  host: string,
  port: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve(port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

async function main(): Promise<void> {
  const root = packageRoot()
  // Prefer package-root .env (desktop layout); cwd also set to root by launcher.
  process.chdir(root)
  loadEnvFrom(root)

  const distDir = path.join(__dirname, 'dist')
  if (!fs.existsSync(distDir)) {
    console.error(`Missing dist folder at ${distDir}`)
    process.exit(1)
  }

  const market = createMarketMiddleware()
  const host = '127.0.0.1'
  const preferred = [5173, 17865]

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`)

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
    // Prevent path traversal
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

    // SPA fallback
    const indexPath = path.join(distDir, 'index.html')
    if (fs.existsSync(indexPath)) {
      sendFile(res, indexPath)
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  let port = 0
  for (const p of preferred) {
    try {
      port = await tryListen(server, host, p)
      break
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code !== 'EADDRINUSE') throw err
    }
  }
  if (!port) {
    console.error('Could not bind 5173 or 17865')
    process.exit(1)
  }

  const keyPresent = Boolean(getFinnhubKey())
  // Do not log the key — only presence.
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

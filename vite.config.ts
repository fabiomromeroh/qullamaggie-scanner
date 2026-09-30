import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { createGroupsMiddleware } from './server/finvizGroups.ts'
import { startGroupWarmup } from './server/groupWarmup.ts'
import { createMarketMiddleware, startBackgroundScanIfNeeded } from './server/marketProxy.ts'

function marketDataProxyPlugin(): Plugin {
  return {
    name: 'market-data-proxy',
    configureServer(server) {
      // /api/groups, /api/groups/leaders, and /api/groups/:slug/stocks
      server.middlewares.use(createGroupsMiddleware())
      server.middlewares.use(createMarketMiddleware())
      startBackgroundScanIfNeeded()
      startGroupWarmup()
    },
    configurePreviewServer(server) {
      server.middlewares.use(createGroupsMiddleware())
      server.middlewares.use(createMarketMiddleware())
      startBackgroundScanIfNeeded()
      startGroupWarmup()
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), marketDataProxyPlugin()],
  // Keep FINNHUB_API_KEY server-only — do not expose via define / envPrefix.
  envPrefix: ['VITE_'],
})

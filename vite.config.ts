import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { createMarketMiddleware } from './server/marketProxy.ts'

function marketDataProxyPlugin(): Plugin {
  return {
    name: 'market-data-proxy',
    configureServer(server) {
      server.middlewares.use(createMarketMiddleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use(createMarketMiddleware())
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), marketDataProxyPlugin()],
  // Keep FINNHUB_API_KEY server-only — do not expose via define / envPrefix.
  envPrefix: ['VITE_'],
})

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MARKET_DATA_MODE?: string
  readonly VITE_FINNHUB_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

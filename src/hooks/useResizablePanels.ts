import { useCallback, useEffect, useState } from 'react'
import { readJson, writeJson } from '../lib/persist'

export const PANEL_WIDTHS_KEY = 'qm-panel-widths'

export interface PanelWidths {
  groups: number
  watchlist: number
}

/** Wider groups default so # / Group / Leaders / 1D / 1M / 3M / 6M fit without clipping. */
export const DEFAULT_PANEL_WIDTHS: PanelWidths = {
  groups: 340,
  watchlist: 280,
}

export const PANEL_MIN = {
  groups: 240,
  watchlist: 200,
  results: 360,
} as const

export const PANEL_MAX = {
  groups: 520,
  watchlist: 440,
} as const

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(n)))
}

function normalize(raw: Partial<PanelWidths> | null): PanelWidths {
  return {
    groups: clamp(raw?.groups ?? DEFAULT_PANEL_WIDTHS.groups, PANEL_MIN.groups, PANEL_MAX.groups),
    watchlist: clamp(
      raw?.watchlist ?? DEFAULT_PANEL_WIDTHS.watchlist,
      PANEL_MIN.watchlist,
      PANEL_MAX.watchlist,
    ),
  }
}

export function useResizablePanels() {
  const [widths, setWidths] = useState<PanelWidths>(() =>
    normalize(readJson<Partial<PanelWidths>>(PANEL_WIDTHS_KEY)),
  )

  useEffect(() => {
    writeJson(PANEL_WIDTHS_KEY, widths)
  }, [widths])

  const resizeGroups = useCallback((deltaPx: number) => {
    setWidths((w) => ({
      ...w,
      groups: clamp(w.groups + deltaPx, PANEL_MIN.groups, PANEL_MAX.groups),
    }))
  }, [])

  const resizeWatchlist = useCallback((deltaPx: number) => {
    // Dragging the left edge of watchlist: positive dx = grow watchlist (handle moves right)
    // Our handle sits between results and watchlist; dragging right grows watchlist.
    setWidths((w) => ({
      ...w,
      watchlist: clamp(w.watchlist + deltaPx, PANEL_MIN.watchlist, PANEL_MAX.watchlist),
    }))
  }, [])

  return { widths, resizeGroups, resizeWatchlist }
}

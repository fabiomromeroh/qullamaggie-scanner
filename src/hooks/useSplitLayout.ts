import { useCallback, useEffect, useState } from 'react'
import { readJson, writeJson } from '../lib/persist'
import {
  SPLIT_DEFAULT_PANEL,
  SPLIT_MIN_CHART,
  SPLIT_MIN_PANEL,
  SPLIT_PANEL_WIDTH_KEY,
  SPLIT_SHEET_WIDTH_KEY,
  clampSheetWidth,
  clampSplitWidths,
  defaultSheetWidth,
} from '../lib/splitLayout'

const SPLIT_MINS = { chart: SPLIT_MIN_CHART, panel: SPLIT_MIN_PANEL }

function readWidth(key: string): number | null {
  if (typeof window === 'undefined') return null
  const raw = readJson<unknown>(key)
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  if (raw < 200 || raw > 8000) return null
  return Math.round(raw)
}

function viewportWidth(): number {
  if (typeof window === 'undefined') return 1440
  return window.innerWidth
}

/**
 * Desktop sheet and panel widths. Preferences persist; the rendered sizes
 * are clamped to the current viewport. Maximize is not stored here.
 */
export function useSplitLayout(reservedLeft: number, maximized: boolean) {
  const [viewport, setViewport] = useState(viewportWidth)
  const [sheetPref, setSheetPref] = useState(() => {
    return readWidth(SPLIT_SHEET_WIDTH_KEY) ?? defaultSheetWidth(viewportWidth(), reservedLeft)
  })
  const [panelPref, setPanelPref] = useState(
    () => readWidth(SPLIT_PANEL_WIDTH_KEY) ?? SPLIT_DEFAULT_PANEL,
  )

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    writeJson(SPLIT_SHEET_WIDTH_KEY, sheetPref)
  }, [sheetPref])

  useEffect(() => {
    writeJson(SPLIT_PANEL_WIDTH_KEY, panelPref)
  }, [panelPref])

  const sheet = maximized ? viewport : clampSheetWidth(sheetPref, viewport, reservedLeft)
  const split = clampSplitWidths(sheet, sheet - panelPref, panelPref, SPLIT_MINS)

  const resizeSheetEdge = useCallback(
    (deltaPx: number) => {
      setSheetPref((prev) => clampSheetWidth(prev - deltaPx, window.innerWidth, reservedLeft))
    },
    [reservedLeft],
  )

  const resizeDivider = useCallback(
    (deltaPx: number) => {
      setPanelPref((prev) => {
        const vp = window.innerWidth
        const total = maximized ? vp : clampSheetWidth(sheetPref, vp, reservedLeft)
        const nextPanel = prev - deltaPx
        return clampSplitWidths(total, total - nextPanel, nextPanel, SPLIT_MINS).panel
      })
    },
    [maximized, reservedLeft, sheetPref],
  )

  return {
    sheet,
    chart: split.chart,
    panel: split.panel,
    resizeSheetEdge,
    resizeDivider,
  }
}

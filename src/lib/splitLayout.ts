/**
 * Pure layout and keyboard helpers for the chart + detail split sheet.
 * Widths are pixels. Callers persist preferences; these functions only clamp.
 */

export const SPLIT_MIN_CHART = 560
export const SPLIT_MIN_PANEL = 380
/**
 * Floors used when the viewport cannot hold both preferred minimums.
 * Keeps a drag on a short desktop from collapsing either pane.
 */
export const SPLIT_FLOOR_CHART = 200
export const SPLIT_FLOOR_PANEL = 160
export const SPLIT_SHEET_RATIO = 0.7
/** Results-table strip kept visible to the left of the desktop sheet. */
export const SPLIT_RESULTS_STRIP = 240
export const SPLIT_DEFAULT_PANEL = 400
export const SPLIT_SHEET_WIDTH_KEY = 'qm-split-sheet-width'
export const SPLIT_PANEL_WIDTH_KEY = 'qm-split-panel-width'

const NATIVE_POPUP_INPUT_TYPES = new Set([
  'color',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
])

export interface SplitMins {
  chart: number
  panel: number
}

export interface SplitWidths {
  chart: number
  panel: number
}

function finiteNonNeg(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return 0
  return n
}

function finiteNonNegInt(n: number): number {
  return Math.round(finiteNonNeg(n))
}

function ratioSplit(total: number, chartShare: number): SplitWidths {
  const chart = Math.min(total, Math.max(0, Math.round(total * chartShare)))
  return { chart, panel: total - chart }
}

/**
 * Fit chart + panel into `totalWidth`.
 *
 * Returned widths are >= 0 and sum to the rounded total.
 * The requested ratio is scaled to that total, then clamped.
 * Preferred minimums apply when they both fit. Otherwise absolute floors
 * apply when those fit. If the total is tighter than the floors, minimums
 * are dropped and the requested ratio is kept (the preferred-min ratio is
 * used when the request is empty).
 */
export function clampSplitWidths(
  totalWidth: number,
  chartWidth: number,
  panelWidth: number,
  mins: SplitMins,
): SplitWidths {
  const total = finiteNonNegInt(totalWidth)
  if (total === 0) return { chart: 0, panel: 0 }

  const minChart = finiteNonNegInt(mins.chart)
  const minPanel = finiteNonNegInt(mins.panel)
  const reqChart = finiteNonNeg(chartWidth)
  const reqPanel = finiteNonNeg(panelWidth)
  const reqSum = reqChart + reqPanel
  const basis = minChart + minPanel
  const requestedShare = reqSum > 0 ? reqChart / reqSum : basis > 0 ? minChart / basis : 0.5

  let floorChart = minChart
  let floorPanel = minPanel
  if (floorChart + floorPanel > total) {
    const absChart = Math.min(minChart, SPLIT_FLOOR_CHART)
    const absPanel = Math.min(minPanel, SPLIT_FLOOR_PANEL)
    if (absChart + absPanel <= total && absChart + absPanel > 0) {
      floorChart = absChart
      floorPanel = absPanel
    } else {
      return ratioSplit(total, requestedShare)
    }
  }

  const panelShare = reqSum > 0 ? reqPanel / reqSum : 0.5
  const maxPanel = total - floorChart
  const panel = Math.min(maxPanel, Math.max(floorPanel, Math.round(total * panelShare)))
  return { chart: total - panel, panel }
}

/** Largest sheet that still leaves `reservedLeft` pixels of the page visible. */
export function maxSheetWidth(viewportWidth: number, reservedLeft: number): number {
  return Math.max(0, finiteNonNegInt(viewportWidth) - finiteNonNegInt(reservedLeft))
}

/**
 * Clamp a preferred sheet width. The preferred minimum is chart + panel,
 * but it shrinks to the max that still leaves `reservedLeft` visible.
 */
export function clampSheetWidth(
  sheetWidth: number,
  viewportWidth: number,
  reservedLeft: number,
): number {
  const max = maxSheetWidth(viewportWidth, reservedLeft)
  if (max <= 0) return 0
  const min = Math.min(SPLIT_MIN_CHART + SPLIT_MIN_PANEL, max)
  const raw = Number.isFinite(sheetWidth) ? Math.round(sheetWidth) : min
  return Math.min(max, Math.max(min, raw))
}

/** Default sheet: ~70% of the viewport, clamped by `clampSheetWidth`. */
export function defaultSheetWidth(viewportWidth: number, reservedLeft: number): number {
  const preferred = Math.round(finiteNonNeg(viewportWidth) * SPLIT_SHEET_RATIO)
  return clampSheetWidth(preferred, viewportWidth, reservedLeft)
}

/** Groups column plus the results strip the desktop sheet must not cover. */
export function splitReservedLeft(groupsWidth: number): number {
  return finiteNonNegInt(groupsWidth) + SPLIT_RESULTS_STRIP
}

/**
 * Next index for ArrowUp (-1) / ArrowDown (1) inside the displayed rows.
 * Wraps at the ends. Empty list → -1. A single row stays put.
 * Unknown `current`: Down starts at 0, Up starts at the last row.
 * Duplicate tickers resolve to the first match.
 */
export function nextTickerIndex(
  rows: readonly string[],
  current: string | null,
  direction: 1 | -1,
): number {
  const n = rows.length
  if (n === 0) return -1
  const step: 1 | -1 = direction < 0 ? -1 : 1
  const idx = current == null ? -1 : rows.indexOf(current)
  if (idx === -1) return step > 0 ? 0 : n - 1
  return (idx + step + n) % n
}

function tagNameOf(el: unknown): string {
  if (el == null || typeof el !== 'object') return ''
  const tag = (el as { tagName?: unknown }).tagName
  return typeof tag === 'string' ? tag.toUpperCase() : ''
}

/** True when arrow-key row navigation should ignore the event target. */
export function isTypingTarget(el: unknown): boolean {
  if (el == null || typeof el !== 'object') return false
  if ((el as { isContentEditable?: unknown }).isContentEditable === true) return true
  const tag = tagNameOf(el)
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Esc closes the split sheet unless the target may have a native popup open:
 * a `<select>`, an input bound to a datalist, or a date/time/color input.
 * Plain text inputs and textareas do not swallow Esc.
 */
export function escClosesSheet(el: unknown): boolean {
  const tag = tagNameOf(el)
  if (tag === 'SELECT') return false
  if (tag !== 'INPUT') return true
  const node = el as { type?: unknown; list?: unknown }
  if (node.list != null && node.list !== false) return false
  const type = typeof node.type === 'string' ? node.type.toLowerCase() : 'text'
  return !NATIVE_POPUP_INPUT_TYPES.has(type)
}

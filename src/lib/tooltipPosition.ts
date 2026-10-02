/** Pure placement for the single metric tooltip. Viewport coordinates, origin top-left. */

export const TOOLTIP_GAP = 8
export const TOOLTIP_VIEWPORT_PAD = 8
export const TOOLTIP_MAX_WIDTH = 320

export interface AnchorRect {
  top: number
  left: number
  right: number
  bottom: number
}

export interface ViewportBox {
  width: number
  height: number
  pad?: number
}

export interface TooltipPlacement {
  top: number
  left: number
  placement: 'above' | 'below'
}

/**
 * Shift a top-left box so it stays inside the viewport inset by `pad`.
 * When the box is larger than the viewport, it pins to the padded origin.
 */
export function clampToViewport(
  left: number,
  top: number,
  tipWidth: number,
  tipHeight: number,
  viewport: ViewportBox,
): { left: number; top: number } {
  const pad = viewport.pad ?? TOOLTIP_VIEWPORT_PAD
  const maxLeft = viewport.width - pad - tipWidth
  const maxTop = viewport.height - pad - tipHeight
  return {
    left: Math.min(Math.max(left, pad), Math.max(pad, maxLeft)),
    top: Math.min(Math.max(top, pad), Math.max(pad, maxTop)),
  }
}

/**
 * Prefer below the anchor. Flip above when below does not fit and above does,
 * or when above has more room and neither side fits. Horizontally center on
 * the anchor, then clamp.
 */
export function placeTooltip(
  anchor: AnchorRect,
  tipWidth: number,
  tipHeight: number,
  viewport: ViewportBox,
): TooltipPlacement {
  const pad = viewport.pad ?? TOOLTIP_VIEWPORT_PAD
  const spaceBelow = viewport.height - pad - (anchor.bottom + TOOLTIP_GAP)
  const spaceAbove = anchor.top - TOOLTIP_GAP - pad
  const fitsBelow = spaceBelow >= tipHeight
  const fitsAbove = spaceAbove >= tipHeight
  let placement: 'above' | 'below'
  if (fitsBelow) placement = 'below'
  else if (fitsAbove) placement = 'above'
  else placement = spaceBelow >= spaceAbove ? 'below' : 'above'

  const rawTop =
    placement === 'below' ? anchor.bottom + TOOLTIP_GAP : anchor.top - TOOLTIP_GAP - tipHeight
  const center = (anchor.left + anchor.right) / 2
  const rawLeft = center - tipWidth / 2
  const clamped = clampToViewport(rawLeft, rawTop, tipWidth, tipHeight, viewport)
  return { top: clamped.top, left: clamped.left, placement }
}

/**
 * When the metric tooltip should close. Kept pure so it can be unit-tested
 * without a DOM.
 */

export type TipReason = 'hover' | 'focus' | 'tap'

export type DismissEvent =
  /** Pointer left the trigger (mouseout / pointerleave). */
  | { kind: 'leave'; pointerType: string }
  /** Pointer is moving somewhere that is not the trigger (catches missed mouseout, re-rendered rows). */
  | { kind: 'move-outside'; pointerType: string }
  | { kind: 'scroll' }
  | { kind: 'blur' }
  | { kind: 'escape' }
  /** Trigger was removed from the DOM or collapsed to zero size. */
  | { kind: 'detached' }

/** Grace period after the pointer leaves; must stay at or under ~100ms. */
export const TOOLTIP_HIDE_MS = 80

function isTouchLike(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen'
}

/**
 * Milliseconds until the tooltip should hide, or null to keep it open.
 * A pointer leaving hides the tip regardless of whether it was opened by
 * hover or by the focus a mouse click gives the trigger; only a touch/pen
 * tap tip survives a "leave" (touch has no hover, so it closes on tap-away).
 */
export function dismissDelay(reason: TipReason, event: DismissEvent): number | null {
  switch (event.kind) {
    case 'scroll':
    case 'blur':
    case 'escape':
    case 'detached':
      return 0
    case 'leave':
    case 'move-outside':
      if (isTouchLike(event.pointerType) && reason !== 'hover') return null
      return TOOLTIP_HIDE_MS
  }
}

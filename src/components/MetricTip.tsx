import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { getMetricDef, isMetricId, type MetricId } from '../lib/metricDefinitions'
import { dismissDelay, type DismissEvent, type TipReason } from '../lib/tooltipDismiss'
import { placeTooltip, TOOLTIP_MAX_WIDTH } from '../lib/tooltipPosition'

const TOOLTIP_ID = 'qm-metric-tooltip'
const HOVER_MS = 250

type Reason = TipReason

interface TipModel {
  id: MetricId
  extra: string
  el: HTMLElement
  reason: Reason
}

let tip: TipModel | null = null
let pendingEl: HTMLElement | null = null
let hoverTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let openedAt = 0
let lastPointer = 'mouse'
let dismissedEl: HTMLElement | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): TipModel | null {
  return tip
}

function getServerSnapshot(): TipModel | null {
  return null
}

function setTip(next: TipModel | null): void {
  tip = next
  if (next) openedAt = Date.now()
  emit()
}

function cancelHover(): void {
  if (hoverTimer != null) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
  pendingEl = null
}

function cancelHide(): void {
  if (hideTimer != null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function hide(): void {
  cancelHide()
  if (tip) setTip(null)
}

function resizing(): boolean {
  return typeof document !== 'undefined' && document.body.classList.contains('qm-resizing')
}

function isResizeHandle(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('.qm-resize-handle'))
}

function inPopover(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-metric-popover]'))
}

function findTrigger(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  if (target.closest('.qm-resize-handle')) return null
  if (target.closest('[data-metric-popover]')) return null
  const el = target.closest('[data-metric]')
  return el instanceof HTMLElement ? el : null
}

function readTip(el: HTMLElement): { id: MetricId; extra: string } | null {
  const raw = el.getAttribute('data-metric')
  if (!raw || !isMetricId(raw)) return null
  return { id: raw, extra: el.getAttribute('data-metric-extra') ?? '' }
}

function show(el: HTMLElement, reason: Reason): void {
  if (resizing()) return
  const data = readTip(el)
  if (!data) return
  cancelHide()
  cancelHover()
  setTip({ ...data, el, reason })
}

function scheduleHover(el: HTMLElement): void {
  cancelHover()
  pendingEl = el
  hoverTimer = setTimeout(() => {
    hoverTimer = null
    pendingEl = null
    if (resizing()) return
    show(el, 'hover')
  }, HOVER_MS)
}

/** Apply the dismiss policy to the open tip (if any). */
function dismiss(event: DismissEvent): void {
  if (!tip) return
  const delay = dismissDelay(tip.reason, event)
  if (delay == null) return
  if (delay <= 0) {
    hide()
    return
  }
  if (hideTimer != null) return
  const target = tip
  hideTimer = setTimeout(() => {
    hideTimer = null
    if (tip === target) hide()
  }, delay)
}

function onOver(event: MouseEvent): void {
  if (resizing()) return
  const el = findTrigger(event.target)
  if (!el) return
  if (dismissedEl === el) return
  if (tip?.el === el) {
    cancelHide()
    return
  }
  if (pendingEl === el) return
  scheduleHover(el)
}

function onOut(event: MouseEvent): void {
  const el = findTrigger(event.target)
  if (!el) return
  const next = event.relatedTarget
  if (next instanceof Node && el.contains(next)) return
  if (pendingEl === el) cancelHover()
  if (tip?.el === el) dismiss({ kind: 'leave', pointerType: lastPointer })
}

/**
 * Safety net for a missed mouseout (trigger re-rendered or removed under the
 * pointer): any pointer movement outside the open trigger starts the hide.
 */
function onPointerMove(event: PointerEvent): void {
  if (!tip) return
  if (event.pointerType) lastPointer = event.pointerType
  if (!tip.el.isConnected) {
    dismiss({ kind: 'detached' })
    return
  }
  const target = event.target
  if (target instanceof Node && tip.el.contains(target)) {
    cancelHide()
    return
  }
  dismiss({ kind: 'move-outside', pointerType: event.pointerType || 'mouse' })
}

function onScroll(): void {
  cancelHover()
  dismiss({ kind: 'scroll' })
}

function onWindowBlur(): void {
  cancelHover()
  dismiss({ kind: 'blur' })
}

function onFocusIn(event: FocusEvent): void {
  const el = findTrigger(event.target)
  if (!el) return
  if (dismissedEl === el) return
  show(el, 'focus')
}

function onFocusOut(event: FocusEvent): void {
  const el = findTrigger(event.target)
  if (dismissedEl && el === dismissedEl) dismissedEl = null
  const next = event.relatedTarget
  if (el && next instanceof Node && el.contains(next)) return
  if (tip && tip.el === el) dismiss({ kind: 'blur' })
}

function onPointerDown(event: PointerEvent): void {
  lastPointer = event.pointerType || 'mouse'
  if (isResizeHandle(event.target) || resizing()) {
    cancelHover()
    hide()
  }
}

function onClick(event: MouseEvent): void {
  const touch = lastPointer === 'touch' || lastPointer === 'pen'
  const el = findTrigger(event.target)
  const inside = inPopover(event.target)
  if (!touch) {
    if (!el && !inside && tip?.reason === 'tap') hide()
    return
  }
  if (el) {
    if (tip?.el === el && Date.now() - openedAt > 450) {
      hide()
      dismissedEl = el
    } else {
      show(el, 'tap')
    }
    return
  }
  if (!inside) hide()
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !tip) return
  const active = document.activeElement
  if (active instanceof Node && (tip.el === active || tip.el.contains(active))) {
    dismissedEl = tip.el
  }
  event.preventDefault()
  event.stopPropagation()
  cancelHover()
  dismiss({ kind: 'escape' })
}

function bindTipListeners(): () => void {
  document.addEventListener('mouseover', onOver)
  document.addEventListener('mouseout', onOut)
  document.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  window.addEventListener('blur', onWindowBlur)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('click', onClick)
  document.addEventListener('keydown', onKey, true)
  return () => {
    document.removeEventListener('mouseover', onOver)
    document.removeEventListener('mouseout', onOut)
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('blur', onWindowBlur)
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('focusout', onFocusOut)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('click', onClick)
    document.removeEventListener('keydown', onKey, true)
    cancelHover()
    cancelHide()
  }
}

export function MetricTipRoot({ children }: { children: ReactNode }) {
  const model = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const popRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => bindTipListeners(), [])

  useEffect(() => {
    const el = model?.el
    if (!el) return
    const previous = el.getAttribute('aria-describedby')
    el.setAttribute('aria-describedby', TOOLTIP_ID)
    return () => {
      if (el.getAttribute('aria-describedby') === TOOLTIP_ID) {
        if (previous) el.setAttribute('aria-describedby', previous)
        else el.removeAttribute('aria-describedby')
      }
    }
  }, [model])

  useLayoutEffect(() => {
    const node = popRef.current
    if (!model || !node) return
    const place = () => {
      const rect = model.el.getBoundingClientRect()
      if (!model.el.isConnected || (rect.width === 0 && rect.height === 0)) {
        dismiss({ kind: 'detached' })
        return
      }
      const placed = placeTooltip(
        { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom },
        node.offsetWidth || TOOLTIP_MAX_WIDTH,
        node.offsetHeight,
        { width: window.innerWidth, height: window.innerHeight },
      )
      node.style.top = `${placed.top}px`
      node.style.left = `${placed.left}px`
      node.style.visibility = 'visible'
    }
    place()
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('resize', place)
    }
  }, [model])

  const def = model ? getMetricDef(model.id) : null
  const pop =
    model && def && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popRef}
            id={TOOLTIP_ID}
            role="tooltip"
            data-metric-popover=""
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              zIndex: 60,
              maxWidth: TOOLTIP_MAX_WIDTH,
              visibility: 'hidden',
            }}
            className="pointer-events-none max-h-72 w-max overflow-y-auto rounded-md border border-terminal-border-bright bg-terminal-elevated px-2.5 py-2 text-left shadow-[0_8px_24px_rgb(0_0_0/0.45)]"
          >
            <div className="text-[12px] font-semibold leading-snug text-terminal-fg">{def.label}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-terminal-muted">{def.short}</div>
            <p className="mt-1 text-[12px] leading-snug text-terminal-fg">{def.how}</p>
            {def.notes ? (
              <p className="mt-1 text-[11px] leading-snug text-terminal-dim">{def.notes}</p>
            ) : null}
            {model.extra ? (
              <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-snug text-terminal-amber">
                {model.extra}
              </p>
            ) : null}
          </div>,
          document.body,
        )
      : null

  return (
    <>
      {children}
      {pop}
    </>
  )
}

/**
 * Focusable wrapper for a metric label or value. Carries `data-metric` for the
 * single delegated tooltip. Does not stop click propagation.
 */
export function MetricTip({
  id,
  extra,
  children,
  className = '',
  style,
}: {
  id: MetricId
  extra?: string
  children?: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      data-metric={id}
      {...(extra ? { 'data-metric-extra': extra } : {})}
      tabIndex={0}
      style={style}
      className={`cursor-help rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-terminal-blue ${className}`}
    >
      {children}
    </span>
  )
}

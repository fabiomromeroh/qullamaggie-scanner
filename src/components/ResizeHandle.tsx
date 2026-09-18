import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'

interface Props {
  /** Called with horizontal delta (px) since last pointer move. */
  onDelta: (deltaX: number) => void
  /** Optional: invert so dragging right shrinks the left pane (for right-side panel edge). */
  invert?: boolean
  className?: string
  /** Accessible label */
  label?: string
  /** 'col' = column border inside a table header; 'panel' = section divider */
  variant?: 'col' | 'panel'
}

/**
 * Desktop-only drag handle (pointer events). Parent should hide on mobile.
 * Uses setPointerCapture for smooth tracking outside the handle hit area.
 */
export function ResizeHandle({
  onDelta,
  invert = false,
  className = '',
  label = 'Resize',
  variant = 'col',
}: Props) {
  const lastX = useRef<number | null>(null)

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      lastX.current = e.clientX
      e.currentTarget.setPointerCapture(e.pointerId)
      document.body.classList.add('qm-resizing')
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (lastX.current == null) return
      const dx = e.clientX - lastX.current
      if (dx === 0) return
      lastX.current = e.clientX
      onDelta(invert ? -dx : dx)
    },
    [invert, onDelta],
  )

  const end = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (lastX.current == null) return
    lastX.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    document.body.classList.remove('qm-resizing')
  }, [])

  const base =
    variant === 'panel'
      ? 'qm-resize-handle qm-resize-handle--panel'
      : 'qm-resize-handle qm-resize-handle--col'

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={-1}
      className={`${base} ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    />
  )
}

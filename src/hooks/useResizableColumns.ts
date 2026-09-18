import { useCallback, useEffect, useState } from 'react'
import { readJson, writeJson } from '../lib/persist'

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function useResizableColumns(
  storageKey: string,
  defaults: Record<string, number>,
  opts?: { min?: number; max?: number },
) {
  const min = opts?.min ?? 40
  const max = opts?.max ?? 480

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const saved = readJson<Record<string, number>>(storageKey)
    const next = { ...defaults }
    if (saved && typeof saved === 'object') {
      for (const key of Object.keys(defaults)) {
        if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) {
          next[key] = clamp(saved[key], min, max)
        }
      }
    }
    return next
  })

  useEffect(() => {
    writeJson(storageKey, widths)
  }, [storageKey, widths])

  const resizeColumn = useCallback(
    (key: string, deltaPx: number) => {
      setWidths((w) => {
        const base = w[key] ?? defaults[key] ?? min
        return { ...w, [key]: clamp(base + deltaPx, min, max) }
      })
    },
    [defaults, min, max],
  )

  const widthOf = useCallback(
    (key: string) => widths[key] ?? defaults[key] ?? min,
    [widths, defaults, min],
  )

  return { widths, resizeColumn, widthOf }
}

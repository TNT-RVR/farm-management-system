import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type PanelPosition = { top: number; left: number; width: number; maxHeight: number }

/**
 * A panel anchored to a button, kept on screen, dismissed the usual ways.
 *
 * Extracted from ColumnHelp rather than copied: the placement rules below were
 * worked out against real failures — right-hand table columns opening off the
 * edge, and a long panel near the bottom of the page turning into a letterbox
 * you scroll inside to finish a sentence. A second copy would drift from this
 * one and only one of them would get the next fix.
 *
 * Positions `fixed` rather than `absolute` on purpose: these sit inside tables
 * wrapped in `overflow-x-auto`, which would clip an absolutely positioned panel
 * to the scroll box.
 */
export function useAnchoredPanel(width: number) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<PanelPosition | null>(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (!r) return
      const margin = 8
      // Never wider than the screen. A panel sized past the viewport is what
      // forces the page itself to scroll sideways to read the end of a line.
      const w = Math.min(width, window.innerWidth - margin * 2)
      const left = Math.min(Math.max(margin, r.left), window.innerWidth - w - margin)
      const maxAvail = window.innerHeight - margin * 2

      // Slide the panel up until the whole of it fits, rather than anchoring it
      // under the button and letting the bottom half fall off the screen into a
      // scroll box.
      const natural = panelRef.current?.scrollHeight ?? 0
      const h = Math.min(natural || maxAvail, maxAvail)
      let top = r.bottom + 6
      if (top + h > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - margin - h)
      }
      setPos({ top, left, width: w, maxHeight: maxAvail })
    }
    place()
    // Place once more after the content has rendered, when its real height is
    // known — the first pass has nothing to measure.
    const raf = requestAnimationFrame(place)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, width])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panelRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return { open, setOpen, btnRef, panelRef, pos }
}

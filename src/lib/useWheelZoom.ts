import { useEffect, useState } from 'react'

export type ZoomDomain = [number, number] | null

/**
 * Mouse-wheel zoom for a numeric (time) X axis on a recharts chart.
 *
 * Attach `attach` (a callback ref) to the element wrapping the chart and feed the
 * data's full [min,max] range. Returns `domain` to pass to `<XAxis domain>` (with
 * `allowDataOverflow`), plus `reset`/`zoomed`. Scroll up zooms in toward the
 * cursor, scroll down zooms out; it stops capturing the wheel once fully zoomed
 * out so the page can scroll. Call `reset()` when the underlying range changes.
 *
 * With `requireCtrl` only Ctrl + scroll (or a trackpad pinch, which arrives as
 * Ctrl + wheel) zooms; a plain scroll moves the page past the chart, as the
 * maps do. The browser's own Ctrl + scroll page zoom is suppressed over it.
 */
export function useWheelZoom(min: number, max: number, opts: { requireCtrl?: boolean } = {}) {
  const requireCtrl = Boolean(opts.requireCtrl)
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [domain, setDomain] = useState<ZoomDomain>(null)

  useEffect(() => {
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!isFinite(min) || !isFinite(max) || max <= min) return
      if (requireCtrl && !e.ctrlKey && !e.metaKey) return
      const zoomingOut = e.deltaY > 0
      if (zoomingOut && domain == null) {
        // Nothing to zoom out of. With Ctrl held the browser would zoom the
        // whole page instead, which is never what was meant over a chart.
        if (requireCtrl) e.preventDefault()
        return
      }
      e.preventDefault()

      const [lo, hi] = domain ?? [min, max]
      const full = max - min
      const rect = el.getBoundingClientRect()
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const cursor = lo + (hi - lo) * frac
      const factor = zoomingOut ? 1.3 : 0.75
      const newRange = Math.min(full, Math.max(full * 0.02, (hi - lo) * factor))
      if (newRange >= full) {
        setDomain(null)
        return
      }
      let nlo = cursor - (cursor - lo) * (newRange / (hi - lo))
      let nhi = nlo + newRange
      if (nlo < min) {
        nlo = min
        nhi = min + newRange
      }
      if (nhi > max) {
        nhi = max
        nlo = max - newRange
      }
      setDomain([nlo, nhi])
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [el, min, max, domain, requireCtrl])

  return { attach: setEl, domain, reset: () => setDomain(null), zoomed: domain != null }
}

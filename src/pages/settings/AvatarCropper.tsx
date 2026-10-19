import { useEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { Modal } from '@/components/Modal'
import type { AvatarCrop } from '@/lib/avatar'

const VIEW = 256 // the circle on screen, in CSS pixels
const MAX_ZOOM = 4

type Fit = { w: number; h: number; base: number }
type View = { zoom: number; left: number; top: number }

/** Keep the photo covering the circle: no gap at any edge. */
function clamp(v: View, fit: Fit): View {
  const k = fit.base * v.zoom
  return {
    zoom: v.zoom,
    left: Math.min(0, Math.max(VIEW - fit.w * k, v.left)),
    top: Math.min(0, Math.max(VIEW - fit.h * k, v.top)),
  }
}

/** Zoom about a point of the circle (its centre, or under the mouse). */
function zoomTo(v: View, fit: Fit, zoom: number, at = { x: VIEW / 2, y: VIEW / 2 }): View {
  const z = Math.min(MAX_ZOOM, Math.max(1, zoom))
  const r = z / v.zoom
  return clamp({ zoom: z, left: at.x - (at.x - v.left) * r, top: at.y - (at.y - v.top) * r }, fit)
}

/**
 * Move and zoom a photo inside the circle before it is saved: drag it (mouse
 * or finger); zoom with the slider, the mouse wheel or two fingers.
 */
export function AvatarCropper({
  source,
  saving,
  error,
  onCancel,
  onSave,
}: {
  source: Blob
  saving: boolean
  error?: string
  onCancel: () => void
  onSave: (crop: AvatarCrop) => void
}) {
  const [url] = useState(() => URL.createObjectURL(source))
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  const [fit, setFit] = useState<Fit | null>(null)
  const [view, setView] = useState<View>({ zoom: 1, left: 0, top: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<number | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const loaded = (img: HTMLImageElement) => {
    const f = { w: img.naturalWidth, h: img.naturalHeight, base: VIEW / Math.min(img.naturalWidth, img.naturalHeight) }
    setFit(f)
    // Start centred, the photo just filling the circle.
    setView({ zoom: 1, left: (VIEW - f.w * f.base) / 2, top: (VIEW - f.h * f.base) / 2 })
  }

  // The wheel needs a non-passive listener, or the page scrolls instead.
  useEffect(() => {
    const el = box.current
    if (!el || !fit) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setView((v) => zoomTo(v, fit, v.zoom * Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top }))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [fit])

  const spread = () => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null
  }
  const release = (id: number) => {
    pointers.current.delete(id)
    pinch.current = spread()
  }

  const save = () => {
    if (!fit) return
    const k = fit.base * view.zoom
    onSave({ x: -view.left / k, y: -view.top / k, side: VIEW / k })
  }

  return (
    <Modal title="Fit your picture" onClose={onCancel}>
      <p className="mb-3 text-sm text-gray-600">Drag to move it, zoom to fit it in the circle.</p>
      <div
        ref={box}
        className="relative mx-auto cursor-grab touch-none select-none overflow-hidden rounded-lg bg-gray-900 active:cursor-grabbing"
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          pinch.current = spread()
        }}
        onPointerMove={(e) => {
          const last = pointers.current.get(e.pointerId)
          if (!last || !fit) return
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pointers.current.size >= 2) {
            const d = spread()
            if (d && pinch.current) {
              const ratio = d / pinch.current
              pinch.current = d
              setView((v) => zoomTo(v, fit, v.zoom * ratio))
            }
            return
          }
          const dx = e.clientX - last.x
          const dy = e.clientY - last.y
          setView((v) => clamp({ ...v, left: v.left + dx, top: v.top + dy }, fit))
        }}
        onPointerUp={(e) => release(e.pointerId)}
        onPointerCancel={(e) => release(e.pointerId)}
      >
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={(e) => loaded(e.currentTarget)}
          className="pointer-events-none absolute left-0 top-0 max-w-none"
          style={
            fit
              ? { width: fit.w * fit.base * view.zoom, height: fit.h * fit.base * view.zoom, transform: `translate(${view.left}px, ${view.top}px)` }
              : { opacity: 0 }
          }
        />
        {/* Everything outside the circle is dimmed: it will be cut off. */}
        <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/80" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }} />
      </div>

      <div className="mx-auto mt-3 flex items-center gap-2" style={{ maxWidth: VIEW }}>
        <button type="button" aria-label="Zoom out" className="rounded p-1 text-gray-500 hover:bg-gray-100" onClick={() => fit && setView((v) => zoomTo(v, fit, v.zoom - 0.25))}>
          <ZoomOut className="h-4 w-4" />
        </button>
        <input
          type="range"
          aria-label="Zoom"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={view.zoom}
          onChange={(e) => fit && setView((v) => zoomTo(v, fit, Number(e.target.value)))}
          className="min-w-0 flex-1 accent-brand-600"
        />
        <button type="button" aria-label="Zoom in" className="rounded p-1 text-gray-500 hover:bg-gray-100" onClick={() => fit && setView((v) => zoomTo(v, fit, v.zoom + 0.25))}>
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>

      {error && <p className="mt-2 text-center text-xs text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button
          type="button"
          disabled={!fit || saving}
          onClick={save}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save picture'}
        </button>
      </div>
    </Modal>
  )
}

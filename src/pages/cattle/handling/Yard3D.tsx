import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { areaFt2, boundsCentre, framedBounds, gateLeaves, layoutBounds, penCapacity, toLocalFt } from '@/lib/handling'
import { buildScene, fitScene, northOnScreen, type Camera, type Pen, type Piece } from '@/lib/handling-3d'
import type { CatalogRow, ItemRow, PathRow } from '@/lib/handling-data'

/**
 * The yard stood up.
 *
 * A view, not an editor: nothing is placed or moved here. The plan view is
 * where a layout is built, and this is where it is looked at — which is why
 * there are no handles on anything and the only controls are the ones that
 * move the viewer.
 *
 * The arithmetic is all in lib/handling-3d. What is left here is turning a
 * layout into pieces, dragging to orbit, and the SVG.
 */

const FIT_COLOR: Record<string, string> = {
  empty: '#eab308',
  fits: '#22c55e',
  marginal: '#f97316',
  over: '#ef4444',
}

const VIEWS: { label: string; cam: Camera }[] = [
  { label: 'N', cam: { azimuth: 0, elevation: 32 } },
  { label: 'E', cam: { azimuth: 90, elevation: 32 } },
  { label: 'S', cam: { azimuth: 180, elevation: 32 } },
  { label: 'W', cam: { azimuth: 270, elevation: 32 } },
  { label: 'Top', cam: { azimuth: 0, elevation: 89 } },
]

type Props = {
  catalog: CatalogRow[]
  items: ItemRow[]
  paths: PathRow[]
  penHead: Record<string, number>
  showPens: boolean
}

export function Yard3D({ catalog, items, paths, penHead, showPens }: Props) {
  const box = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [cam, setCam] = useState<Camera>({ azimuth: 25, elevation: 30 })
  const [zoom, setZoom] = useState(1)
  /** Shifted sideways, for when the yard is bigger than the screen. */
  const [pan, setPan] = useState({ x: 0, y: 0 })

  // Measured from the observer's own callback rather than from the effect
  // body: ResizeObserver reports the first size as soon as it observes, so
  // this needs no separate initial measurement (and setting state straight
  // from an effect body is the thing the compiler rules rightly object to).
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const byId = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog])

  /** The middle of the layout: everything is measured in feet from here. */
  const origin = useMemo(() => {
    const b = framedBounds(layoutBounds(items, paths))
    return b ? boundsCentre(b) : null
  }, [items, paths])

  const pieces = useMemo((): Piece[] => {
    if (!origin) return []
    const out: Piece[] = []
    for (const it of items) {
      const cat = byId.get(it.catalog_id)
      if (!cat) continue
      const centre = toLocalFt(origin, [it.lng, it.lat])
      const base = {
        centre,
        rotation: it.rotation,
        widthFt: cat.width_ft,
        depthFt: cat.depth_ft,
        heightFt: cat.height_ft,
        color: cat.color,
      }
      // A five-way sorter is not a box, it is five arms off a hub — drawn as
      // five short runs of fence so you can see which way the gates throw.
      if (cat.category === 'Sorting gate') {
        const arm = cat.width_ft / 2
        for (const deg of [0, 72, 144, 216, 288]) {
          const b = ((deg + 90) * Math.PI) / 180
          out.push({
            ...base,
            id: `${it.id}-${deg}`,
            rotation: it.rotation + deg,
            widthFt: arm,
            centre: {
              x: centre.x + Math.sin(b) * (arm / 2),
              y: centre.y + Math.cos(b) * (arm / 2),
            },
            look: 'gate',
          })
        }
        continue
      }
      // A gate standing open is not where its row says it is: the leaf has
      // swung about its hinge, and both leaves of a double gate swing.
      if (cat.gate_type && cat.gate_type !== 'drive-over') {
        gateLeaves(centre, cat.width_ft, it.rotation, it.swing_deg, cat.gate_type === 'two-panel').forEach((leaf, i) => {
          out.push({
            ...base,
            id: `${it.id}-leaf${i}`,
            centre: leaf.centre,
            rotation: leaf.rotation,
            widthFt: leaf.lengthFt,
            look: 'gate',
          })
        })
        continue
      }
      const look: Piece['look'] =
        cat.panel_type === 'wind-fence'
          ? 'wind'
          : cat.panel_type
            ? 'bars'
            : cat.gate_type
              ? 'gate'
              : cat.animal_type
                ? 'animal'
                : cat.category === 'Equipment'
                  ? 'machine'
                  : cat.width_ft === cat.depth_ft
                    ? 'round'
                    : 'box'
      out.push({ ...base, id: it.id, look, beast: cat.animal_type as Piece['beast'] })
    }
    return out
  }, [items, byId, origin])

  const pens = useMemo((): Pen[] => {
    if (!origin || !showPens) return []
    return paths.map((p) => {
      const pts = p.points.map((pt) => toLocalFt(origin, pt))
      const head = penHead[p.id] ?? 0
      let colour = p.color
      if (p.is_closed) {
        const cap = penCapacity(areaFt2(p.points), p.usage_type)
        colour =
          FIT_COLOR[head <= 0 ? 'empty' : head <= cap.low ? 'fits' : head <= cap.high ? 'marginal' : 'over']
      }
      return { id: p.id, pts, color: colour, label: p.label || 'Pen', closed: p.is_closed }
    })
  }, [paths, penHead, origin, showPens])

  /** The sheet of ground under it all, a little wider than the yard itself. */
  const ground = useMemo(() => {
    const pts = [...pieces.map((p) => p.centre), ...pens.flatMap((p) => p.pts)]
    if (!pts.length) return undefined
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    // A margin of grass in proportion to the yard. A fixed one swamps the
    // first few panels of a layout and is a hairline round a finished corral.
    const pad = Math.max(15, span * 0.12)
    return {
      x1: Math.min(...xs) - pad,
      y1: Math.min(...ys) - pad,
      x2: Math.max(...xs) + pad,
      y2: Math.max(...ys) + pad,
      gridFt: span > 600 ? 100 : span > 250 ? 50 : 25,
    }
  }, [pieces, pens])

  const scene = useMemo(() => buildScene({ cam, pieces, pens, ground }), [cam, pieces, pens, ground])
  const fit = useMemo(() => fitScene(scene.faces, size), [scene.faces, size])
  /** Where a point of the scene lands on the screen, for the text the group transform cannot carry. */
  const place = useCallback(
    (p: { x: number; y: number }) => ({
      x: pan.x + size.w / 2 + (fit.ox - size.w / 2 + p.x * fit.scale) * zoom,
      y: pan.y + size.h / 2 + (fit.oy - size.h / 2 + p.y * fit.scale) * zoom,
    }),
    [fit, zoom, size, pan],
  )

  // ── Walking round it ─────────────────────────────────────────────────────
  // Drag turns the yard; Shift-drag slides it, which is what you want the
  // moment you have zoomed into a corral bigger than the pane.
  const drag = useRef<{ x: number; y: number; cam: Camera; pan: { x: number; y: number }; sliding: boolean } | null>(
    null,
  )
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      if (d.sliding) {
        setPan({ x: d.pan.x + (e.clientX - d.x), y: d.pan.y + (e.clientY - d.y) })
        return
      }
      setCam({
        azimuth: (((d.cam.azimuth + (e.clientX - d.x) * 0.4) % 360) + 360) % 360,
        elevation: Math.max(4, Math.min(89, d.cam.elevation + (e.clientY - d.y) * 0.3)),
      })
    }
    const onUp = () => {
      drag.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  // Non-passive, or the page scrolls instead of the yard zooming.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => Math.max(0.4, Math.min(8, z * (e.deltaY > 0 ? 0.9 : 1.1))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const north = northOnScreen(cam)
  const compass = { x: 44, y: size.h - 52 }

  return (
    <div
      ref={box}
      className="relative h-full w-full touch-none overflow-hidden bg-gradient-to-b from-sky-200 to-sky-50"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, cam, pan, sliding: e.shiftKey }
      }}
      style={{ cursor: 'grab' }}
    >
      {size.w > 0 && (
        <svg className="absolute inset-0 h-full w-full" aria-label="The yard in three dimensions">
          <g
            transform={`translate(${pan.x} ${pan.y}) translate(${size.w / 2} ${size.h / 2}) scale(${zoom}) translate(${fit.ox - size.w / 2} ${fit.oy - size.h / 2}) scale(${fit.scale})`}
          >
            {scene.faces.map((f, i) =>
              f.pts.length === 2 || f.fill === null ? (
                <polyline
                  key={i}
                  points={f.pts.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={f.stroke ?? 'none'}
                  strokeWidth={f.strokeWidth}
                  strokeDasharray={f.dash}
                  strokeOpacity={f.opacity}
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <polygon
                  key={i}
                  points={f.pts.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill={f.fill}
                  fillOpacity={f.opacity}
                  stroke={f.stroke ?? 'none'}
                  strokeWidth={f.strokeWidth}
                  strokeDasharray={f.dash}
                  vectorEffect="non-scaling-stroke"
                />
              ),
            )}
          </g>

          {scene.labels.map((l) => {
            const p = place(l.at)
            return (
              <text
                key={l.text + l.at.x}
                x={p.x}
                y={p.y}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill="#fff"
                stroke="#1f2937"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {l.text}
              </text>
            )
          })}

          {/* North, which is the one thing you lose by being able to turn the yard. */}
          <g>
            <circle cx={compass.x} cy={compass.y} r={20} fill="#fff" fillOpacity={0.85} stroke="#94a3b8" />
            <line
              x1={compass.x - north.x * 13}
              y1={compass.y - north.y * 13}
              x2={compass.x + north.x * 13}
              y2={compass.y + north.y * 13}
              stroke="#334155"
              strokeWidth={2}
            />
            <circle cx={compass.x + north.x * 13} cy={compass.y + north.y * 13} r={3.5} fill="#dc2626" />
            <text
              x={compass.x + north.x * 13}
              y={compass.y + north.y * 13 - 7}
              textAnchor="middle"
              fontSize={9}
              fontWeight={700}
              fill="#dc2626"
            >
              N
            </text>
          </g>
        </svg>
      )}

      {pieces.length === 0 && pens.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-gray-500">
          Nothing on this layout yet. Place some panels on the plan and they will stand up here.
        </p>
      )}

      <div className="pointer-events-auto absolute left-3 top-3 flex items-center gap-1 rounded-lg bg-white/90 p-1 text-xs shadow ring-1 ring-black/5">
        {VIEWS.map((v) => (
          <button
            key={v.label}
            onClick={() => setCam(v.cam)}
            className="rounded px-2 py-1 font-medium text-gray-600 hover:bg-gray-100"
            title={`Look from the ${v.label === 'Top' ? 'top' : v.label}`}
          >
            {v.label}
          </button>
        ))}
        <button
          onClick={() => {
            setCam({ azimuth: 25, elevation: 30 })
            setZoom(1)
            setPan({ x: 0, y: 0 })
          }}
          className="rounded px-1.5 py-1 text-gray-500 hover:bg-gray-100"
          aria-label="Fit the yard to the screen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-gray-900/80 px-3 py-1.5 text-xs text-white">
        Drag to walk round it · shift-drag to slide it · scroll to zoom
        <span className="ml-2 tabular-nums text-white/70">
          {Math.round(cam.azimuth)}° · {Math.round(cam.elevation)}° up
        </span>
      </p>
    </div>
  )
}

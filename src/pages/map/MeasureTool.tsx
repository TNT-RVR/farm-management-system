import { useEffect, useRef, useState } from 'react'
import type { Position } from 'geojson'
import maplibregl from 'maplibre-gl'
import { Ruler, Trash2, Undo2, X } from 'lucide-react'
import {
  AREA_UNITS,
  DISTANCE_UNITS,
  formatArea,
  formatDistance,
  haversineM,
  pathAreaM2,
  pathLengthM,
  type AreaUnit,
  type DistanceUnit,
} from '@/lib/geo/measure'
import { cn } from '@/lib/utils'

/**
 * Measuring off the map.
 *
 * Click the corners; it gives the distance along them and, from three corners
 * on, the area they enclose. Double-click or Enter finishes, Escape clears,
 * Backspace takes back the last corner.
 *
 * BOTH NUMBERS AT ONCE, rather than a distance tool and an area tool. The
 * question is usually both at the same time — how far along that headland, and
 * how much is in the corner I am cutting off — and nobody wants to re-click
 * four corners to find out the second one.
 *
 * The units are the point of it. A pivot run gets measured in feet, a field in
 * acres, a haul in kilometres, and a seed rep asks in hectares; the choice is
 * remembered per browser, because the answer somebody wants is the answer they
 * wanted last time.
 */
const SRC = 'measure'
const UNIT_KEY = 'rvr.measure.units'

type Units = { distance: DistanceUnit; area: AreaUnit }

const readUnits = (): Units => {
  try {
    const raw = localStorage.getItem(UNIT_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Units>
      return {
        distance: DISTANCE_UNITS.some((u) => u.key === p.distance) ? p.distance! : 'ft',
        area: AREA_UNITS.some((u) => u.key === p.area) ? p.area! : 'ac',
      }
    }
  } catch {
    // A private window, or storage turned off. The tool still measures.
  }
  // Feet and acres: what gets said out loud on this farm.
  return { distance: 'ft', area: 'ac' }
}

export function MeasureTool({
  map,
  mapReady,
  onClose,
}: {
  map: maplibregl.Map | null
  mapReady: boolean
  onClose: () => void
}) {
  const [points, setPoints] = useState<Position[]>([])
  /** Where the cursor is, so the segment being drawn is measured before it is
   *  committed — otherwise the length only updates after the click. */
  const [hover, setHover] = useState<Position | null>(null)
  const [done, setDone] = useState(false)
  const [units, setUnits] = useState<Units>(readUnits)
  // The map handlers are registered once and would otherwise close over the
  // first value of `done` for ever. Mirrored in an effect rather than during
  // render, which is the same thing a beat later and is allowed to be read from
  // a listener.
  const doneRef = useRef(false)
  useEffect(() => {
    doneRef.current = done
  }, [done])

  useEffect(() => {
    try {
      localStorage.setItem(UNIT_KEY, JSON.stringify(units))
    } catch {
      // Not being able to remember the choice is not a reason to refuse it.
    }
  }, [units])

  // Collecting the corners. Registered only while the tool is on, so the map's
  // own click behaviour is untouched the rest of the time.
  useEffect(() => {
    if (!map || !mapReady) return

    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (doneRef.current) return
      setPoints((p) => [...p, [e.lngLat.lng, e.lngLat.lat]])
    }
    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (doneRef.current) return
      setHover([e.lngLat.lng, e.lngLat.lat])
    }
    // Finishing on a double-click is the convention everywhere else that draws
    // a shape, so the zoom has to get out of the way while measuring.
    const onDouble = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault()
      setDone(true)
      setHover(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPoints([])
        setHover(null)
        setDone(false)
      } else if (e.key === 'Enter') {
        setDone(true)
        setHover(null)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        setPoints((p) => p.slice(0, -1))
        setDone(false)
      }
    }

    const canvas = map.getCanvas()
    const cursor = canvas.style.cursor
    canvas.style.cursor = 'crosshair'
    map.doubleClickZoom.disable()
    map.on('click', onClick)
    map.on('mousemove', onMove)
    map.on('dblclick', onDouble)
    window.addEventListener('keydown', onKey)

    return () => {
      map.off('click', onClick)
      map.off('mousemove', onMove)
      map.off('dblclick', onDouble)
      window.removeEventListener('keydown', onKey)
      window.setTimeout(() => {
        // Restored on the next tick: MapLibre fires its own dblclick handling
        // after ours, and re-enabling the zoom in the same frame lets the
        // finishing double-click zoom the map as it ends the measurement.
        if (map.getCanvas()) map.doubleClickZoom.enable()
      }, 0)
      canvas.style.cursor = cursor
    }
  }, [map, mapReady])

  // The line, the enclosed shape and the corners: one source, three layers,
  // created once and taken away with the component. Cleanup happens here rather
  // than by watching a flag, because this component is only mounted while the
  // tool is out — which is also what makes putting it away reset it.
  useEffect(() => {
    if (!map || !mapReady) return
    if (!map.getSource(SRC)) {
      map.addSource(SRC, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'measure-fill',
        type: 'fill',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'area'],
        paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.18 },
      })
      map.addLayer({
        id: 'measure-line',
        type: 'line',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'line'],
        paint: { 'line-color': '#f59e0b', 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
      })
      map.addLayer({
        id: 'measure-point',
        type: 'circle',
        source: SRC,
        filter: ['==', ['get', 'kind'], 'point'],
        paint: {
          'circle-radius': 4.5,
          'circle-color': '#f59e0b',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })
    }
    return () => {
      try {
        for (const id of ['measure-fill', 'measure-line', 'measure-point']) {
          if (map.getLayer(id)) map.removeLayer(id)
        }
        if (map.getSource(SRC)) map.removeSource(SRC)
      } catch {
        // The map was torn down first — there is nothing left to tidy.
      }
    }
  }, [map, mapReady])

  // What is on it, redrawn as the corners come in.
  useEffect(() => {
    if (!map || !mapReady) return
    const line = hover && !done ? [...points, hover] : points
    const data = {
      type: 'FeatureCollection' as const,
      features: [
        ...(line.length >= 2
          ? [
              {
                type: 'Feature' as const,
                properties: { kind: 'line' },
                geometry: { type: 'LineString' as const, coordinates: line },
              },
            ]
          : []),
        ...(line.length >= 3
          ? [
              {
                type: 'Feature' as const,
                properties: { kind: 'area' },
                geometry: {
                  type: 'Polygon' as const,
                  coordinates: [[...line, line[0]]],
                },
              },
            ]
          : []),
        ...points.map((p, i) => ({
          type: 'Feature' as const,
          properties: { kind: 'point', index: i },
          geometry: { type: 'Point' as const, coordinates: p },
        })),
      ],
    }

    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
    src?.setData(data)
  }, [map, mapReady, points, hover, done])

  const live = hover && !done ? [...points, hover] : points
  const total = pathLengthM(live)
  const area = pathAreaM2(live)
  const lastLeg =
    live.length >= 2 ? haversineM(live[live.length - 2], live[live.length - 1]) : null

  return (
    <div className="absolute bottom-3 left-2 z-10 w-64 rounded-lg border border-amber-300 bg-white/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <Ruler className="h-4 w-4 text-amber-600" /> Measure
        </h2>
        <button
          onClick={onClose}
          title="Put the tape measure away"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {points.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500">
          Click the corners. Double-click to finish, Escape to start over.
        </p>
      ) : (
        <dl className="mt-2 space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-gray-500">Distance</dt>
            <dd className="font-semibold tabular-nums text-gray-900">
              {formatDistance(total, units.distance)}
            </dd>
          </div>
          {lastLeg != null && live.length > 2 && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-xs text-gray-400">Last leg</dt>
              <dd className="text-xs tabular-nums text-gray-500">
                {formatDistance(lastLeg, units.distance)}
              </dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-gray-500">
              Area
              {live.length < 3 && <span className="ml-1 text-gray-300">(3 corners)</span>}
            </dt>
            <dd className="font-semibold tabular-nums text-gray-900">
              {live.length >= 3 ? formatArea(area, units.area) : '—'}
            </dd>
          </div>
        </dl>
      )}

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <label className="text-[11px] text-gray-500">
          Distance in
          <select
            value={units.distance}
            onChange={(e) =>
              setUnits((u) => ({ ...u, distance: e.target.value as DistanceUnit }))
            }
            className="mt-0.5 w-full rounded-md border border-gray-200 px-1.5 py-1 text-xs text-gray-700"
          >
            {DISTANCE_UNITS.map((u) => (
              <option key={u.key} value={u.key}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-gray-500">
          Area in
          <select
            value={units.area}
            onChange={(e) => setUnits((u) => ({ ...u, area: e.target.value as AreaUnit }))}
            className="mt-0.5 w-full rounded-md border border-gray-200 px-1.5 py-1 text-xs text-gray-700"
          >
            {AREA_UNITS.map((u) => (
              <option key={u.key} value={u.key}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <button
          onClick={() => {
            setPoints((p) => p.slice(0, -1))
            setDone(false)
          }}
          disabled={!points.length}
          className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          <Undo2 className="h-3 w-3" /> back
        </button>
        <button
          onClick={() => {
            setPoints([])
            setHover(null)
            setDone(false)
          }}
          disabled={!points.length}
          className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          <Trash2 className="h-3 w-3" /> clear
        </button>
        {points.length >= 2 && !done && (
          <button
            onClick={() => {
              setDone(true)
              setHover(null)
            }}
            className={cn(
              'ml-auto rounded-md bg-amber-500 px-2 py-1 text-[11px] font-semibold text-white',
              'hover:bg-amber-600',
            )}
          >
            finish
          </button>
        )}
        {done && <span className="ml-auto text-[11px] text-gray-400">finished</span>}
      </div>
    </div>
  )
}

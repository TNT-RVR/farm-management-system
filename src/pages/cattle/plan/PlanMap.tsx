import { useEffect, useMemo, useRef } from 'react'
import maplibregl, { type MapMouseEvent } from 'maplibre-gl'
import type { FeatureCollection, Point, Position } from 'geojson'
import { useFarmMap, useGeoJsonSource } from '@/lib/geo/use-farm-map'
import { centroid, nearestFencePair, shortName, type PlanMapPasture } from './plan-geo'

const SRC = 'plan-pastures'
const FILL = 'plan-fill'
const LINE = 'plan-line'
const PICKED = 'plan-picked'
const LABEL = 'plan-label'
const GATE_SRC = 'plan-gates'
const GATE_DOT = 'plan-gate-dot'
const GATE_LABEL = 'plan-gate-label'
const MOVE_SRC = 'plan-moves'
const MOVE_LINE = 'plan-move-line'

/** A stay drawn on a pasture: its step number and when the cattle are in it. */
export type PlanStop = { step: number; months: string }

/** One move, drawn from pasture to pasture through the gate it uses. */
export type PlanMove = { from: string; to: string; via: Position | null }

/** A recorded gate, marked out when this year's route goes through it. */
export type PlanGate = { at: Position; label: string; used: boolean; move: string }

/**
 * The planner's map: ranch pastures shaded with their step number and the
 * month the cattle are in them, the recorded gates as dots — the ones this
 * year's route goes through marked out — and the moves as a line that runs
 * through the gate it actually uses. A tap picks a pasture — or, in gate
 * mode, the fence between the two nearest.
 */
export function PlanMap({
  pastures,
  stops,
  selectedPasture,
  gates,
  moves,
  gateMode,
  onPickPasture,
  onPickFence,
  className,
}: {
  pastures: PlanMapPasture[]
  /** The selected group's stays, per pasture, in plan order. */
  stops: Map<string, PlanStop[]>
  selectedPasture: string | null
  gates: PlanGate[]
  /** The selected group's moves, in order. */
  moves: PlanMove[]
  gateMode: boolean
  onPickPasture: (id: string) => void
  onPickFence: (pair: [string, string], at: Position) => void
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { map, ready } = useFarmMap(containerRef, { zoom: 11, controls: { scale: true }, readyWhen: 'style' })

  const features = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: pastures.map((p) => {
        const mine = stops.get(p.id) ?? []
        const name = shortName(p.name)
        return {
          type: 'Feature',
          id: p.id,
          properties: {
            id: p.id,
            planned: mine.length > 0,
            picked: p.id === selectedPasture,
            label: [name, ...mine.map((s) => `${s.step} · ${s.months}`)].join('\n'),
          },
          geometry: p.geojson,
        }
      }),
    }),
    [pastures, stops, selectedPasture],
  )

  const gateFc = useMemo<FeatureCollection<Point>>(
    () => ({
      type: 'FeatureCollection',
      features: gates.map((g) => ({
        type: 'Feature',
        properties: { label: g.label, used: g.used, move: g.move },
        geometry: { type: 'Point', coordinates: g.at },
      })),
    }),
    [gates],
  )

  const moveFc = useMemo<FeatureCollection>(() => {
    const at = new Map(pastures.map((p) => [p.id, centroid(p.geojson)]))
    return {
      type: 'FeatureCollection',
      features: moves.flatMap((m) => {
        const a = at.get(m.from)
        const b = at.get(m.to)
        if (!a || !b) return []
        // Through the gate where one is recorded, so the line crosses the
        // fence where the cattle actually do.
        const coordinates = m.via ? [a, m.via, b] : [a, b]
        return [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates } }]
      }),
    }
  }, [pastures, moves])

  useGeoJsonSource(map, ready, SRC, features, (m) => {
    m.addLayer({
      id: FILL,
      type: 'fill',
      source: SRC,
      paint: {
        'fill-color': ['case', ['get', 'picked'], '#facc15', ['get', 'planned'], '#16a34a', '#94a3b8'],
        'fill-opacity': ['case', ['get', 'picked'], 0.5, ['get', 'planned'], 0.42, 0.18],
      },
    })
    m.addLayer({ id: LINE, type: 'line', source: SRC, paint: { 'line-color': '#ffffff', 'line-width': 1.4, 'line-opacity': 0.85 } })
    m.addLayer({
      id: PICKED,
      type: 'line',
      source: SRC,
      filter: ['==', ['get', 'picked'], true],
      paint: { 'line-color': '#facc15', 'line-width': 3 },
    })
  })
  useGeoJsonSource(map, ready, MOVE_SRC, moveFc, (m) => {
    m.addLayer({
      id: MOVE_LINE,
      type: 'line',
      source: MOVE_SRC,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fde68a', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.9 },
    })
  })
  useGeoJsonSource(map, ready, GATE_SRC, gateFc, (m) => {
    m.addLayer({
      id: GATE_DOT,
      type: 'circle',
      source: GATE_SRC,
      paint: {
        // The gates this year's moves go through are drawn twice the size and
        // yellow, so the one to open for each move is picked out of the rest.
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          ['case', ['get', 'used'], 5, 2.5],
          15,
          ['case', ['get', 'used'], 11, 6],
        ],
        'circle-color': ['case', ['get', 'used'], '#facc15', '#f97316'],
        'circle-stroke-color': ['case', ['get', 'used'], '#78350f', '#ffffff'],
        'circle-stroke-width': ['case', ['get', 'used'], 2, 1],
      },
    })
    // Labels last, so they sit over the gates and the move line.
    m.addLayer({
      id: LABEL,
      type: 'symbol',
      source: SRC,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 18],
        'text-line-height': 1.15,
        'text-allow-overlap': false,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#1f2937', 'text-halo-width': 1.6 },
    })
    m.addLayer({
      id: GATE_LABEL,
      type: 'symbol',
      source: GATE_SRC,
      filter: ['==', ['get', 'used'], true],
      layout: {
        'text-field': ['get', 'move'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 14],
        'text-offset': [0, -1.4],
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#fef3c7', 'text-halo-color': '#78350f', 'text-halo-width': 1.6 },
    })
  })

  // Clicks read the latest props through a ref, so the handler is bound once.
  const latest = useRef({ gateMode, onPickPasture, onPickFence, pastures })
  useEffect(() => {
    latest.current = { gateMode, onPickPasture, onPickFence, pastures }
  })
  useEffect(() => {
    if (!map || !ready) return
    const onClick = (e: MapMouseEvent) => {
      const l = latest.current
      const at: Position = [e.lngLat.lng, e.lngLat.lat]
      if (l.gateMode) {
        const pair = nearestFencePair(l.pastures, at)
        if (pair) l.onPickFence(pair, at)
        return
      }
      const hit = map.queryRenderedFeatures(e.point, { layers: [FILL] })[0]
      if (hit?.properties?.id) l.onPickPasture(String(hit.properties.id))
    }
    const enter = () => (map.getCanvas().style.cursor = 'pointer')
    const leave = () => (map.getCanvas().style.cursor = latest.current.gateMode ? 'crosshair' : '')
    map.on('click', onClick)
    map.on('mouseenter', FILL, enter)
    map.on('mouseleave', FILL, leave)
    return () => {
      map.off('click', onClick)
      map.off('mouseenter', FILL, enter)
      map.off('mouseleave', FILL, leave)
    }
  }, [map, ready])

  useEffect(() => {
    if (map) map.getCanvas().style.cursor = gateMode ? 'crosshair' : ''
  }, [map, gateMode])

  // Frame the ranch's pastures once they are known.
  const framed = useRef(false)
  useEffect(() => {
    if (!map || !ready || framed.current || pastures.length === 0) return
    const b = new maplibregl.LngLatBounds()
    for (const p of pastures) for (const poly of p.geojson.coordinates) for (const ring of poly) for (const c of ring) b.extend(c as [number, number])
    if (!b.isEmpty()) map.fitBounds(b, { padding: 30, duration: 0 })
    framed.current = true
  }, [map, ready, pastures])

  return <div ref={containerRef} className={className} />
}

import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type MapLayerMouseEvent, type MapMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { MapPinPlus, Pencil, Spline, Trash2, Undo2, X } from 'lucide-react'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { farmMapCenter } from '@/lib/farm-setup'
import { useAllBoundaries, useFields } from '@/lib/queries'
import {
  fieldRoute,
  useDeleteTrail,
  useFieldEntries,
  usePlaces,
  useRecomputeRoutes,
  useRoadLine,
  useRoadRoutes,
  useSaveFieldEntry,
  useSaveOperatingSetting,
  useSaveSite,
  useSaveTrail,
  useSetRouteThrough,
  useSites,
  useTrails,
  type FarmPlace,
} from '@/lib/hauling-data'
import { metresBetween, type LatLng, type StartKey } from '@/lib/road-routes'
import { SNAP_M, snapCoord, type Coord } from '@/lib/trail-router'
import { cn } from '@/lib/utils'
import { input } from './ui'

/**
 * The Distances map: the shop and the bins, the silage pit, every elevator
 * and plant, every field with its entry pin, the farm's trails, and the route
 * to the picked field.
 *
 * Pins are HTML markers, as on the cattle water map: `draggable: true` is all
 * a manager needs to move one, and they always draw above the imagery. A
 * pin a person dropped is solid; the router's suggestion is a dashed ring
 * until somebody confirms it or drags it. Every move asks the router again.
 *
 * Trails are drawn the way the measuring tool draws: click the points,
 * double-click (or Finish) to end, name it, save. A saved trail's shape is
 * edited in place (Sam, 7 Oct 2026): drag its points, drag a hollow
 * midpoint to add a bend, pick a point to delete it, or carry on from either
 * end. A point let go within SNAP_M of another trail, or of the shop or the
 * bins, lands on it, so the trails join into one network for the router.
 */
const FIELDS_SRC = 'rt-fields'
const TRAILS_SRC = 'rt-trails'
const DRAFT_SRC = 'rt-draft'
const ROUTE_SRC = 'rt-route'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

function placeEl(letter: string, colour: string, title: string): HTMLDivElement {
  const el = document.createElement('div')
  el.title = title
  el.textContent = letter
  Object.assign(el.style, {
    width: '24px',
    height: '24px',
    borderRadius: '6px',
    background: colour,
    color: '#fff',
    font: '700 13px/24px system-ui, sans-serif',
    textAlign: 'center',
    border: '2px solid #fff',
    boxShadow: '0 1px 4px rgba(0,0,0,.5)',
    cursor: 'grab',
  } satisfies Partial<CSSStyleDeclaration>)
  return el
}

function entryEl(pinned: boolean, selected: boolean, title: string): HTMLDivElement {
  const el = document.createElement('div')
  el.title = title
  const size = selected ? 18 : 14
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    background: pinned ? '#16a34a' : 'rgba(255,255,255,.25)',
    border: pinned ? '2px solid #fff' : '2px dashed #fff',
    boxShadow: selected ? '0 0 0 3px #facc15' : '0 0 0 1px rgba(0,0,0,.45)',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>)
  return el
}

const ringsOf = (g: Geometry | null): number[][][] =>
  !g ? [] : g.type === 'Polygon' ? (g.coordinates as number[][][]) : g.type === 'MultiPolygon' ? (g.coordinates as number[][][][]).flat() : []

function vertexEl(picked: boolean, mid: boolean): HTMLDivElement {
  const el = document.createElement('div')
  el.title = mid ? 'Drag to add a bend here' : 'Drag to move; click to pick it'
  const size = mid ? 10 : 13
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    background: mid ? 'rgba(255,255,255,.55)' : picked ? '#dc2626' : '#fff',
    border: `2px solid ${mid ? '#f59e0b' : picked ? '#fff' : '#d97706'}`,
    boxShadow: '0 0 0 1px rgba(0,0,0,.4)',
    cursor: 'grab',
  } satisfies Partial<CSSStyleDeclaration>)
  return el
}

export function RouteMap({
  isManager,
  selected,
  onSelect,
  start,
  onStart,
}: {
  isManager: boolean
  selected: string | null
  onSelect: (fieldId: string | null) => void
  start: StartKey
  onStart: (s: StartKey) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const { data: fields } = useFields()
  const { data: boundaries } = useAllBoundaries()
  const { data: entries } = useFieldEntries()
  const { data: routes } = useRoadRoutes()
  const { data: trails } = useTrails()
  const places = usePlaces()
  const { data: sites } = useSites()
  const saveEntry = useSaveFieldEntry()
  const saveSetting = useSaveOperatingSetting()
  const saveSite = useSaveSite()
  const saveTrail = useSaveTrail()
  const deleteTrail = useDeleteTrail()
  const recompute = useRecomputeRoutes()
  const setThrough = useSetRouteThrough()
  // Via points: where the picked field's route must pass (fields.route_through), to keep equipment off the highway.
  const [addingVia, setAddingVia] = useState(false)
  const vias: LatLng[] = useMemo(() => {
    const f = (fields ?? []).find((x) => x.id === selected) as { route_through?: LatLng[] | null } | undefined
    return Array.isArray(f?.route_through) ? f.route_through : []
  }, [fields, selected])

  const [drawing, setDrawing] = useState(false)
  const [draft, setDraft] = useState<Coord[]>([])
  const [finished, setFinished] = useState(false)
  const [name, setName] = useState('')
  const [trailId, setTrailId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  // Editing a saved trail's shape: its points as they stand, the steps back, the picked point, and which end is being carried on.
  const [edit, setEdit] = useState<{ id: string; coords: Coord[]; history: Coord[][] } | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [extend, setExtend] = useState<'start' | 'end' | null>(null)

  // Map handlers are registered once; they read the current values here.
  const live = useRef({ drawing, finished, onSelect, saveEntry, saveSetting, saveSite, recompute, editing: !!edit, extend, addingVia, selected, vias, setThrough })
  useEffect(() => {
    live.current = { drawing, finished, onSelect, saveEntry, saveSetting, saveSite, recompute, editing: !!edit, extend, addingVia, selected, vias, setThrough }
  })

  /** Change the trail being edited, keeping the old shape for undo. */
  const reshape = (fn: (c: Coord[]) => Coord[]) => setEdit((e) => (e ? { ...e, coords: fn(e.coords), history: [...e.history.slice(-30), e.coords] } : e))

  const current = useMemo(() => (boundaries ?? []).filter((b) => b.valid_to == null), [boundaries])
  const names = useMemo(() => new Map((fields ?? []).map((f) => [f.id, f.name])), [fields])

  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: farmMapCenter(),
      zoom: 12,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.on('load', () => {
      map.addSource(FIELDS_SRC, { type: 'geojson', data: EMPTY })
      map.addSource(TRAILS_SRC, { type: 'geojson', data: EMPTY })
      map.addSource(ROUTE_SRC, { type: 'geojson', data: EMPTY })
      map.addSource(DRAFT_SRC, { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'rt-field-fill', type: 'fill', source: FIELDS_SRC, paint: { 'fill-color': '#ffffff', 'fill-opacity': ['case', ['get', 'sel'], 0.18, 0.04] } })
      map.addLayer({
        id: 'rt-field-line',
        type: 'line',
        source: FIELDS_SRC,
        paint: { 'line-color': ['case', ['get', 'sel'], '#facc15', '#ffffff'], 'line-width': ['case', ['get', 'sel'], 3, 1.5], 'line-opacity': 0.9 },
      })
      map.addLayer({
        id: 'rt-trail',
        type: 'line',
        source: TRAILS_SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#f59e0b', 'line-width': ['case', ['get', 'sel'], 6, 3.5] },
      })
      map.addLayer({
        id: 'rt-route-road',
        type: 'line',
        source: ROUTE_SRC,
        filter: ['==', ['get', 'part'], 'road'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2563eb', 'line-width': 4, 'line-opacity': 0.9 },
      })
      map.addLayer({
        id: 'rt-route-off',
        type: 'line',
        source: ROUTE_SRC,
        filter: ['==', ['get', 'part'], 'off'],
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': ['match', ['get', 'method'], 'road+trail', '#ea580c', 'road+straight', '#ef4444', '#ffffff'],
          'line-width': 4,
          'line-dasharray': [1.5, 1],
        },
      })
      map.addLayer({ id: 'rt-draft-line', type: 'line', source: DRAFT_SRC, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#f59e0b', 'line-width': 3, 'line-dasharray': [2, 1] } })
      map.addLayer({
        id: 'rt-draft-pt',
        type: 'circle',
        source: DRAFT_SRC,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 4, 'circle-color': '#f59e0b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
      })
      setReady(true)
    })
    const pickField = (e: MapLayerMouseEvent) => {
      if (live.current.drawing || live.current.editing || live.current.addingVia) return
      const id = e.features?.[0]?.properties?.id as string | undefined
      if (id) live.current.onSelect(id)
    }
    const pickTrail = (e: MapLayerMouseEvent) => {
      if (live.current.drawing || live.current.editing) return
      setTrailId((e.features?.[0]?.properties?.id as string | undefined) ?? null)
      e.preventDefault()
    }
    const addPoint = (e: MapMouseEvent) => {
      const at: Coord = [e.lngLat.lng, e.lngLat.lat]
      // A via point for the picked field, after the ones it has.
      const L = live.current
      if (L.addingVia && L.selected) {
        setAddingVia(false)
        L.setThrough.mutate({ fieldId: L.selected, points: [...L.vias, { lat: at[1], lng: at[0] }] }, { onSuccess: () => L.recompute.mutate(false) })
        return
      }
      // Carrying an edited trail on from one of its ends.
      const end = live.current.editing ? live.current.extend : null
      if (end) {
        setEdit((ed) => (ed ? { ...ed, coords: end === 'end' ? [...ed.coords, at] : [at, ...ed.coords], history: [...ed.history.slice(-30), ed.coords] } : ed))
        return
      }
      if (!live.current.drawing || live.current.finished) return
      setDraft((d) => [...d, at])
    }
    const finish = (e: MapMouseEvent) => {
      if (live.current.editing && live.current.extend) {
        e.preventDefault()
        setExtend(null)
        return
      }
      if (!live.current.drawing) return
      e.preventDefault()
      setFinished(true)
    }
    map.on('click', 'rt-field-fill', pickField)
    map.on('click', 'rt-trail', pickTrail)
    map.on('click', addPoint)
    map.on('dblclick', finish)
    for (const id of ['rt-field-fill', 'rt-trail']) {
      map.on('mouseenter', id, () => {
        if (!live.current.drawing && !live.current.editing) map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', id, () => {
        if (!live.current.drawing && !live.current.editing) map.getCanvas().style.cursor = ''
      })
    }
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // While drawing, a double-click ends the trail instead of zooming.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (drawing || extend || addingVia) {
      map.doubleClickZoom.disable()
      map.getCanvas().style.cursor = 'crosshair'
      return
    }
    map.getCanvas().style.cursor = ''
    // Next tick: MapLibre's own dblclick runs after ours.
    const t = window.setTimeout(() => map.getCanvas() && map.doubleClickZoom.enable(), 0)
    return () => window.clearTimeout(t)
  }, [drawing, extend, addingVia, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const features: Feature[] = current.map((b) => ({
      type: 'Feature',
      properties: { id: b.field_id, name: names.get(b.field_id) ?? '', sel: b.field_id === selected },
      geometry: b.geometry as unknown as Geometry,
    }))
    ;(map.getSource(FIELDS_SRC) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
  }, [ready, current, names, selected])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const features: Feature[] = (trails ?? [])
      .filter((t) => t.id !== edit?.id)
      .map((t) => ({
        type: 'Feature',
        properties: { id: t.id, name: t.name, sel: t.id === trailId },
        geometry: { type: 'LineString', coordinates: t.coords },
      }))
    ;(map.getSource(TRAILS_SRC) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
  }, [ready, trails, trailId, edit?.id])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    // A trail being edited shows its line here; its points are the draggable markers below.
    const line = edit ? edit.coords : draft
    const features: Feature[] = edit ? [] : draft.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }))
    if (line.length >= 2) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } })
    ;(map.getSource(DRAFT_SRC) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
  }, [ready, draft, edit])

  // The edited trail's points: drag one to move it, drag a hollow midpoint to
  // add a bend, click one to pick it. Let go near another trail (or the shop
  // or the bins) and it lands on it.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !edit) return
    const others = (trails ?? []).filter((t) => t.id !== edit.id).map((t) => t.coords)
    const homes = (['shop', 'bins'] as const).map((k) => places[k]).filter((p): p is FarmPlace => !!p).map((p): Coord => [p.lng, p.lat])
    const snap = (c: Coord) => snapCoord(c, others, homes)
    const change = (fn: (c: Coord[]) => Coord[]) => setEdit((e) => (e ? { ...e, coords: fn(e.coords), history: [...e.history.slice(-30), e.coords] } : e))
    const made: maplibregl.Marker[] = []
    edit.coords.forEach((c, i) => {
      const el = vertexEl(picked === i, false)
      let moved = false
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        if (!moved) setPicked((p) => (p === i ? null : i))
        moved = false
      })
      const m = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' }).setLngLat(c).addTo(map)
      m.on('dragstart', () => {
        moved = true
      })
      m.on('dragend', () => {
        const { lng, lat } = m.getLngLat()
        change((cs) => cs.map((x, k) => (k === i ? snap([lng, lat]) : x)))
      })
      made.push(m)
      if (i === 0) return
      const prev = edit.coords[i - 1]
      const mid = new maplibregl.Marker({ element: vertexEl(false, true), draggable: true, anchor: 'center' })
        .setLngLat([(prev[0] + c[0]) / 2, (prev[1] + c[1]) / 2])
        .addTo(map)
      mid.on('dragend', () => {
        const { lng, lat } = mid.getLngLat()
        setPicked(null)
        change((cs) => [...cs.slice(0, i), snap([lng, lat]), ...cs.slice(i)])
      })
      made.push(mid)
    })
    return () => made.forEach((m) => m.remove())
  }, [ready, edit, picked, trails, places])

  // The picked field's route from the chosen start: the road part asked of
  // the router as a line, then the trail or the straight bit, as stored.
  const route = selected ? fieldRoute(routes, start, selected) : null
  const from: FarmPlace | null = places[start]
  const approach = route?.approach_lat != null && route.approach_lng != null ? { lat: route.approach_lat, lng: route.approach_lng } : null
  const { data: roadLine } = useRoadLine(route && route.method !== 'typed' ? from : null, approach, vias)

  // The picked field's via points: drag to move, click to take one away.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !selected || !vias.length) return
    const made: maplibregl.Marker[] = []
    vias.forEach((v, i) => {
      const el = placeEl(String(i + 1), '#be185d', `Via point ${i + 1}: the route passes here${isManager ? '. Drag to move; click to take it away.' : ''}`)
      Object.assign(el.style, { width: '20px', height: '20px', font: '700 11px/20px system-ui, sans-serif', borderRadius: '50%' })
      if (isManager)
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          if (window.confirm(`Take via point ${i + 1} away?`))
            setThrough.mutate({ fieldId: selected, points: vias.filter((_, k) => k !== i) }, { onSuccess: () => recompute.mutate(false) })
        })
      const m = new maplibregl.Marker({ element: el, draggable: isManager, anchor: 'center' }).setLngLat([v.lng, v.lat]).addTo(map)
      if (isManager)
        m.on('dragend', () => {
          const { lng, lat } = m.getLngLat()
          setThrough.mutate({ fieldId: selected, points: vias.map((x, k) => (k === i ? { lat, lng } : x)) }, { onSuccess: () => recompute.mutate(false) })
        })
      made.push(m)
    })
    return () => made.forEach((m) => m.remove())
    // setThrough and recompute are fresh objects each render; the markers follow the points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selected, vias, isManager])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const features: Feature[] = []
    if (roadLine?.length) features.push({ type: 'Feature', properties: { part: 'road' }, geometry: { type: 'LineString', coordinates: roadLine } })
    const off = Array.isArray(route?.trail_path) ? (route.trail_path as Coord[]) : []
    if (off.length >= 2) features.push({ type: 'Feature', properties: { part: 'off', method: route?.method ?? '' }, geometry: { type: 'LineString', coordinates: off } })
    ;(map.getSource(ROUTE_SRC) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
  }, [ready, roadLine, route])

  // The shop and the bins.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const made: maplibregl.Marker[] = []
    for (const [key, letter, colour, label] of [
      ['shop', 'S', '#7c3aed', 'Shop — field work and spraying start here'],
      ['bins', 'B', '#b45309', 'Bins — grain is measured to here'],
    ] as const) {
      const p = places[key]
      if (!p) continue
      const m = new maplibregl.Marker({ element: placeEl(letter, colour, `${label}${isManager ? '. Drag to move.' : ''}`), draggable: isManager, anchor: 'center' })
        .setLngLat([p.lng, p.lat])
        .addTo(map)
      if (isManager)
        m.on('dragend', () => {
          const { lng, lat } = m.getLngLat()
          live.current.saveSetting.mutate(
            { key, value: { lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7, label: `${p.label.replace(/ \(moved on the map\)$/, '')} (moved on the map)` } },
            { onSuccess: () => live.current.recompute.mutate(false) },
          )
        })
      made.push(m)
    }
    return () => made.forEach((m) => m.remove())
  }, [ready, places, isManager])

  // The silage pit: only the silage haul measures from it. Its note says
  // whether it is still a guess; a drag makes it a pin somebody placed.
  useEffect(() => {
    const map = mapRef.current
    const p = places.pit
    if (!map || !ready || !p) return
    const title = `Silage pit${p.note ? ` — ${p.note}` : ''}${isManager ? '. Drag to the pit.' : ''}`
    const m = new maplibregl.Marker({ element: placeEl('P', '#15803d', title), draggable: isManager, anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(map)
    if (isManager)
      m.on('dragend', () => {
        const { lng, lat } = m.getLngLat()
        live.current.saveSetting.mutate(
          { key: 'silage_pit', value: { lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7, label: 'Silage pit (moved on the map)', note: null } },
          { onSuccess: () => live.current.recompute.mutate(false) },
        )
      })
    return () => {
      m.remove()
    }
  }, [ready, places.pit, isManager])

  // Elevators and plants. A manager drags one onto the real elevator; the
  // "approximate — town centre" note goes with the first move.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const made: maplibregl.Marker[] = []
    for (const s of sites ?? []) {
      if (!s.active || s.lat == null || s.lng == null) continue
      const title = `${s.name}${s.location_note ? ` — ${s.location_note}` : ''}${isManager ? '. Drag to the elevator.' : ''}`
      const el = placeEl('E', s.location_note ? '#64748b' : '#0e7490', title)
      if (s.location_note) el.style.border = '2px dashed #fff'
      const m = new maplibregl.Marker({ element: el, draggable: isManager, anchor: 'center' }).setLngLat([s.lng, s.lat]).addTo(map)
      if (isManager)
        m.on('dragend', () => {
          const { lng, lat } = m.getLngLat()
          live.current.saveSite.mutate(
            { id: s.id, name: s.name, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, location_note: null },
            { onSuccess: () => live.current.recompute.mutate(false) },
          )
        })
      made.push(m)
    }
    return () => made.forEach((m) => m.remove())
  }, [ready, sites, isManager])

  // Entry pins: dropped (solid) or suggested (dashed).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const made: maplibregl.Marker[] = []
    for (const f of fields ?? []) {
      const pin = entries?.get(f.id)
      const r = fieldRoute(routes, 'shop', f.id)
      const at: LatLng | null = pin ? { lat: pin.lat, lng: pin.lng } : r && r.entry_basis === 'suggested' ? { lat: Number(r.to_lat), lng: Number(r.to_lng) } : null
      if (!at) continue
      const title = `${f.name} — ${pin ? 'entry pin' : 'suggested entry'}${isManager ? (pin ? '. Drag to move.' : '. Drag to set it, or pick the field and confirm.') : ''}`
      const el = entryEl(!!pin, f.id === selected, title)
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        live.current.onSelect(f.id)
      })
      const m = new maplibregl.Marker({ element: el, draggable: isManager, anchor: 'center' }).setLngLat([at.lng, at.lat]).addTo(map)
      if (isManager)
        m.on('dragend', () => {
          const { lng, lat } = m.getLngLat()
          live.current.onSelect(f.id)
          live.current.saveEntry.mutate({ fieldId: f.id, at: { lat, lng } }, { onSuccess: () => live.current.recompute.mutate(false) })
        })
      made.push(m)
    }
    return () => made.forEach((m) => m.remove())
  }, [ready, fields, entries, routes, selected, isManager])

  // Frame the home fields once: everything within 25 km of the shop.
  const framed = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    const shop = places.shop
    if (!map || !ready || framed.current || !shop || !current.length) return
    const b = new maplibregl.LngLatBounds([shop.lng, shop.lat], [shop.lng, shop.lat])
    for (const bd of current)
      for (const ring of ringsOf(bd.geometry as unknown as Geometry))
        if (ring[0] && metresBetween(shop, { lat: ring[0][1], lng: ring[0][0] }) < 25_000) for (const c of ring) b.extend([c[0], c[1]])
    map.fitBounds(b, { padding: 40, duration: 0, maxZoom: 15 })
    framed.current = true
  }, [ready, places.shop, current])

  // Picking a field shows it with its start.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !selected) return
    const bd = current.find((b) => b.field_id === selected)
    if (!bd) return
    const b = new maplibregl.LngLatBounds()
    for (const ring of ringsOf(bd.geometry as unknown as Geometry)) for (const c of ring) b.extend([c[0], c[1]])
    // The start too, unless the field is out at East Ranch.
    const p = places[start]
    const mid = b.getCenter()
    if (p && metresBetween(p, { lat: mid.lat, lng: mid.lng }) < 25_000) b.extend([p.lng, p.lat])
    map.fitBounds(b, { padding: 50, duration: 400, maxZoom: 16 })
  }, [ready, selected, current, places, start])

  const stopDrawing = () => {
    setDrawing(false)
    setFinished(false)
    setDraft([])
    setName('')
  }
  const stopEditing = () => {
    setEdit(null)
    setPicked(null)
    setExtend(null)
  }
  const trail = trails?.find((t) => t.id === trailId) ?? null
  const editM = edit ? edit.coords.reduce((s, p, i) => (i ? s + metresBetween({ lat: edit.coords[i - 1][1], lng: edit.coords[i - 1][0] }, { lat: p[1], lng: p[0] }) : 0), 0) : 0
  // The pins that sit outside the home fields' frame: the pit and the elevators.
  const goTo = [
    ...(places.pit ? [{ key: 'pit', label: 'the silage pit', lat: places.pit.lat, lng: places.pit.lng }] : []),
    ...(sites ?? []).filter((s) => s.active && s.lat != null && s.lng != null).map((s) => ({ key: s.id, label: s.name, lat: s.lat!, lng: s.lng! })),
  ]
  const draftM = draft.reduce((s, p, i) => (i ? s + metresBetween({ lat: draft[i - 1][1], lng: draft[i - 1][0] }, { lat: p[1], lng: p[0] }) : 0), 0)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-500">Route from</span>
        {(['shop', 'bins'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onStart(s)}
            className={cn('rounded-full border px-2.5 py-0.5', start === s ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50')}
          >
            {s === 'shop' ? 'the shop (field work)' : 'the bins (grain)'}
          </button>
        ))}
        {goTo.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const g = goTo.find((x) => x.key === e.target.value)
              if (g) mapRef.current?.flyTo({ center: [g.lng, g.lat], zoom: 15, duration: 600 })
            }}
            className={cn(input, 'py-0.5 text-xs')}
            aria-label="Go to a place on the map"
          >
            <option value="">Go to…</option>
            {goTo.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        )}
        {isManager && selected && !drawing && !edit && (
          <>
            <button
              type="button"
              onClick={() => setAddingVia((x) => !x)}
              title="The route has to pass through the points you drop, in order from the yard out — to keep equipment on the back roads."
              className={cn('ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-0.5', addingVia ? 'border-pink-700 bg-pink-50 text-pink-800' : 'border-pink-600 text-pink-800 hover:bg-pink-50')}
            >
              <MapPinPlus className="h-3 w-3" /> {addingVia ? 'Click the road to drop it… (cancel)' : `Add a via point${vias.length ? ` (${vias.length})` : ''}`}
            </button>
            {vias.length > 0 && !addingVia && (
              <button
                type="button"
                onClick={() => setThrough.mutate({ fieldId: selected, points: [] }, { onSuccess: () => recompute.mutate(false) })}
                className="text-gray-600 underline"
              >
                clear via points
              </button>
            )}
          </>
        )}
        {isManager && !drawing && !edit && (
          <button type="button" onClick={() => setDrawing(true)} className="ml-auto inline-flex items-center gap-1 rounded-md border border-amber-500 px-2 py-0.5 text-amber-800 hover:bg-amber-50">
            <Pencil className="h-3 w-3" /> Draw a trail
          </button>
        )}
      </div>

      <div className="relative overflow-hidden rounded-lg border border-gray-200">
        <div ref={containerRef} className="h-[420px] w-full md:h-[520px]" />
        {drawing && (
          <div className="absolute left-2 top-2 max-w-[calc(100%-4rem)] rounded-md bg-white/95 p-2 text-xs shadow">
            {!finished ? (
              <>
                <p className="text-gray-700">
                  Click along the trail from the road to the field. Double-click or Finish to end.{' '}
                  {draft.length > 1 && <span className="tabular-nums text-gray-500">{(draftM / 1000).toFixed(2)} km</span>}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <button type="button" disabled={draft.length < 2} onClick={() => setFinished(true)} className="rounded bg-amber-600 px-2 py-0.5 font-semibold text-white disabled:opacity-50">
                    Finish
                  </button>
                  <button type="button" disabled={!draft.length} onClick={() => setDraft((d) => d.slice(0, -1))} className="inline-flex items-center gap-1 text-gray-600 underline disabled:opacity-40">
                    <Undo2 className="h-3 w-3" /> last point
                  </button>
                  <button type="button" onClick={stopDrawing} className="inline-flex items-center gap-1 text-gray-600 underline">
                    <X className="h-3 w-3" /> cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Trail to the flats" className={cn(input, 'w-48 text-xs')} autoFocus />
                <button
                  type="button"
                  disabled={!name.trim() || draft.length < 2 || saveTrail.isPending}
                  onClick={() =>
                    saveTrail.mutate(
                      { name, coords: draft },
                      {
                        onSuccess: () => {
                          stopDrawing()
                          recompute.mutate(false)
                        },
                      },
                    )
                  }
                  className="rounded bg-amber-600 px-2 py-0.5 font-semibold text-white disabled:opacity-50"
                >
                  Save trail
                </button>
                <button type="button" onClick={() => setFinished(false)} className="text-gray-600 underline">
                  keep drawing
                </button>
                <button type="button" onClick={stopDrawing} className="text-gray-600 underline">
                  cancel
                </button>
                {saveTrail.isError && <span className="text-red-700">{(saveTrail.error as Error).message}</span>}
              </div>
            )}
          </div>
        )}
        {edit && (
          <div className="absolute left-2 top-2 max-w-[calc(100%-4rem)] rounded-md bg-white/95 p-2 text-xs shadow">
            <p className="text-gray-700">
              <span className="font-medium text-gray-900">{trails?.find((t) => t.id === edit.id)?.name ?? 'Trail'}</span>{' '}
              <span className="tabular-nums text-gray-500">{(editM / 1000).toFixed(2)} km</span>
              {' · '}
              {extend
                ? `Click to carry the trail on from its ${extend}. Double-click or Done when finished.`
                : `Drag a point to move it; drag a hollow one to add a bend; click a point to pick it. A point let go within ${SNAP_M} m of another trail, the shop or the bins joins onto it.`}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={edit.coords.length < 2 || saveTrail.isPending}
                onClick={() => {
                  const t = trails?.find((x) => x.id === edit.id)
                  if (!t) return
                  saveTrail.mutate(
                    { id: t.id, name: t.name, coords: edit.coords },
                    {
                      onSuccess: () => {
                        stopEditing()
                        recompute.mutate(false)
                      },
                    },
                  )
                }}
                className="rounded bg-amber-600 px-2 py-0.5 font-semibold text-white disabled:opacity-50"
              >
                {saveTrail.isPending ? 'Saving…' : 'Save shape'}
              </button>
              {(['start', 'end'] as const).map((end) => (
                <button
                  key={end}
                  type="button"
                  onClick={() => setExtend((x) => (x === end ? null : end))}
                  className={cn('rounded border px-1.5 py-0.5', extend === end ? 'border-amber-600 bg-amber-50 text-amber-800' : 'border-gray-300 text-gray-700')}
                >
                  {extend === end ? 'Done' : `carry on from the ${end}`}
                </button>
              ))}
              <button
                type="button"
                disabled={picked == null || edit.coords.length <= 2}
                onClick={() => {
                  const i = picked!
                  setPicked(null)
                  reshape((cs) => cs.filter((_, k) => k !== i))
                }}
                className="inline-flex items-center gap-0.5 text-red-700 underline disabled:text-gray-400 disabled:no-underline"
              >
                <Trash2 className="h-3 w-3" /> delete point
              </button>
              <button
                type="button"
                disabled={!edit.history.length}
                onClick={() => {
                  setPicked(null)
                  setEdit((e) => (e && e.history.length ? { ...e, coords: e.history[e.history.length - 1], history: e.history.slice(0, -1) } : e))
                }}
                className="inline-flex items-center gap-0.5 text-gray-600 underline disabled:opacity-40"
              >
                <Undo2 className="h-3 w-3" /> undo
              </button>
              <button type="button" onClick={stopEditing} className="inline-flex items-center gap-0.5 text-gray-600 underline">
                <X className="h-3 w-3" /> cancel
              </button>
              {saveTrail.isError && <span className="text-red-700">{(saveTrail.error as Error).message}</span>}
            </div>
          </div>
        )}
        {trail && !drawing && !edit && (
          <div className="absolute bottom-8 left-2 rounded-md bg-white/95 p-2 text-xs shadow">
            {renaming === trail.id ? (
              <span className="flex items-center gap-1">
                <input value={name} onChange={(e) => setName(e.target.value)} className={cn(input, 'w-40 text-xs')} autoFocus />
                <button
                  type="button"
                  disabled={!name.trim()}
                  onClick={() => saveTrail.mutate({ id: trail.id, name }, { onSuccess: () => setRenaming(null) })}
                  className="rounded bg-brand-700 px-2 py-0.5 font-semibold text-white disabled:opacity-50"
                >
                  Save
                </button>
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">{trail.name}</span>
                <span className="tabular-nums text-gray-500">{(trail.length_m / 1000).toFixed(2)} km</span>
                {isManager && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEdit({ id: trail.id, coords: trail.coords, history: [] })
                        setPicked(null)
                        setExtend(null)
                      }}
                      className="inline-flex items-center gap-0.5 text-brand-700 underline"
                    >
                      <Spline className="h-3 w-3" /> edit shape
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setName(trail.name)
                        setRenaming(trail.id)
                      }}
                      className="text-brand-700 underline"
                    >
                      rename
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete the trail “${trail.name}”? Routes along it are worked out again without it.`))
                          deleteTrail.mutate(trail.id, {
                            onSuccess: () => {
                              setTrailId(null)
                              recompute.mutate(false)
                            },
                          })
                      }}
                      className="inline-flex items-center gap-0.5 text-red-700 underline"
                    >
                      <Trash2 className="h-3 w-3" /> delete
                    </button>
                  </>
                )}
              </span>
            )}
            <button type="button" onClick={() => setTrailId(null)} className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 shadow" aria-label="Close">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[3px] bg-[#7c3aed]" /> S shop
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[3px] bg-[#b45309]" /> B bins
        </span>
        {places.pit && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-[3px] bg-[#15803d]" /> P silage pit
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[3px] bg-[#0e7490]" /> E elevator or plant (grey: still the town centre)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-white bg-[#16a34a] ring-1 ring-gray-400" /> entry pin
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-dashed border-gray-500" /> suggested entry
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-1 w-5 bg-[#2563eb]" /> road
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-1 w-5 bg-[#f59e0b]" /> farm trail
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-1 w-5 border-t-2 border-dashed border-[#ef4444]" /> straight line (no trail yet)
        </span>
        {recompute.isPending && <span className="text-brand-700">Working the routes out again…</span>}
        {recompute.isSuccess && !recompute.isPending && <span className="text-gray-600">{recompute.data}</span>}
        {(recompute.isError || saveEntry.isError || saveSetting.isError || saveSite.isError || deleteTrail.isError) && (
          <span className="text-red-700">{((recompute.error ?? saveEntry.error ?? saveSetting.error ?? saveSite.error ?? deleteTrail.error) as Error).message}</span>
        )}
      </div>
    </div>
  )
}

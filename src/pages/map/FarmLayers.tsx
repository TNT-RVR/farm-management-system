import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import maplibregl, { type GeoJSONSource, type MapLayerMouseEvent, type MapMouseEvent } from 'maplibre-gl'
import type { Feature, FeatureCollection, Geometry, LineString, Point, Position } from 'geojson'
import { MapPin, Move, Pencil, Route, Trash2, X } from 'lucide-react'
import { Select } from '@/components/Select'
import { useDeleteFeature, useFarmFeatures, useImportMyMapFolder, useSaveFeature, type FarmFeature, type FarmLayer, myMapFolderOf } from '@/lib/farm-layers'
import { useMyMapGeo, useMyMapUrl } from '@/lib/mymaps'
import { cn } from '@/lib/utils'
import { FARM_CLICK_LAYERS, setFarmLayersBusy } from '@/lib/farm-layers-map'

/**
 * The farm's own layers on the main map, editable by managers: tap an item to
 * rename it, write a note on it, move it, reshape a pipeline or delete it; add
 * new pins and lines. These are the app's copies of folders brought in from
 * the Google My Map (the Water folder first), and the winterizing checklist
 * builds its places from them.
 */

const SRC = 'farm-layers'
const EDIT_SRC = 'farm-edit'
const ALL_LAYERS = ['farm-fill', 'farm-line-case', 'farm-line', 'farm-point', 'farm-label', 'farm-edit-line'] as const
const DEFAULT_COLOUR = '#38bdf8'
const colourOf = (f: FarmFeature) => String(f.properties['stroke'] ?? f.properties['icon-color'] ?? f.properties['fill'] ?? DEFAULT_COLOUR)

function toFc(features: FarmFeature[], selected: string | null, hidden: string | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features
      .filter((f) => f.id !== hidden)
      .map((f) => ({
        type: 'Feature',
        geometry: f.geojson,
        properties: { id: f.id, name: f.label ?? '', colour: colourOf(f), selected: f.id === selected ? 1 : 0 },
      })),
  }
}

type Mode = 'none' | 'add-pin' | 'add-line' | 'move-pin' | 'shape'

export function FarmLayersOverlay({
  map,
  ready,
  layers,
  activeIds,
  isManager,
}: {
  map: maplibregl.Map | null
  ready: boolean
  layers: FarmLayer[]
  activeIds: string[]
  isManager: boolean
}) {
  const { data: features } = useFarmFeatures(activeIds)
  const save = useSaveFeature()
  const del = useDeleteFeature()
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('none')
  const [target, setTarget] = useState<string>('')
  const [draft, setDraft] = useState<Position[]>([])
  const [shape, setShape] = useState<Position[] | null>(null)
  const [vertex, setVertex] = useState<number | null>(null)
  const sel = features?.find((f) => f.id === selected) ?? null
  const targetLayer = target || activeIds[0] || ''
  const live = useRef({ mode })
  useEffect(() => {
    live.current = { mode }
  }, [mode])
  useEffect(() => {
    setFarmLayersBusy(mode !== 'none')
    return () => setFarmLayersBusy(false)
  }, [mode])

  // Layers on the map, added once and kept below nothing else of ours.
  useEffect(() => {
    if (!map || !ready) return
    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource(EDIT_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'farm-fill', type: 'fill', source: SRC, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.25 } })
      map.addLayer({ id: 'farm-line-case', type: 'line', source: SRC, filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#0f172a', 'line-width': ['case', ['==', ['get', 'selected'], 1], 8, 5], 'line-opacity': 0.55 } })
      map.addLayer({ id: 'farm-line', type: 'line', source: SRC, filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': ['case', ['==', ['get', 'selected'], 1], '#facc15', ['get', 'colour']], 'line-width': ['case', ['==', ['get', 'selected'], 1], 5, 3] } })
      map.addLayer({
        id: 'farm-point',
        type: 'circle',
        source: SRC,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': ['get', 'colour'],
          'circle-radius': ['case', ['==', ['get', 'selected'], 1], 9, 6],
          'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#facc15', '#ffffff'],
          'circle-stroke-width': 2,
        },
      })
      map.addLayer({
        id: 'farm-label',
        type: 'symbol',
        source: SRC,
        minzoom: 13,
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1 },
      })
      map.addLayer({ id: 'farm-edit-line', type: 'line', source: EDIT_SRC, paint: { 'line-color': '#facc15', 'line-width': 4, 'line-dasharray': [2, 1] } })
    }
    const pick = (e: MapLayerMouseEvent) => {
      if (live.current.mode !== 'none') return
      const id = e.features?.[0]?.properties?.id as string | undefined
      if (id) setSelected(id)
    }
    const enter = () => (map.getCanvas().style.cursor = 'pointer')
    const leave = () => (map.getCanvas().style.cursor = '')
    for (const l of FARM_CLICK_LAYERS) {
      map.on('click', l, pick)
      map.on('mouseenter', l, enter)
      map.on('mouseleave', l, leave)
    }
    return () => {
      for (const l of FARM_CLICK_LAYERS) {
        map.off('click', l, pick)
        map.off('mouseenter', l, enter)
        map.off('mouseleave', l, leave)
      }
    }
  }, [map, ready])

  // Remove our layers when the page goes (or every farm layer is switched off).
  useEffect(() => {
    if (!map) return
    return () => {
      try {
        for (const l of ALL_LAYERS) if (map.getLayer(l)) map.removeLayer(l)
        for (const s of [SRC, EDIT_SRC]) if (map.getSource(s)) map.removeSource(s)
      } catch {
        // The map itself may already be gone.
      }
    }
  }, [map])

  // The features. A line being reshaped is drawn from the edit source instead.
  useEffect(() => {
    if (!map || !ready || !map.getSource(SRC)) return
    ;(map.getSource(SRC) as GeoJSONSource).setData(toFc(activeIds.length ? (features ?? []) : [], selected, shape ? selected : null))
  }, [map, ready, features, selected, shape, activeIds.length])

  // The line being drawn or reshaped.
  useEffect(() => {
    if (!map || !ready || !map.getSource(EDIT_SRC)) return
    const pts = shape ?? (mode === 'add-line' ? draft : [])
    ;(map.getSource(EDIT_SRC) as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: pts.length >= 2 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} }] : [],
    })
    map.getCanvas().style.cursor = mode === 'add-pin' || mode === 'add-line' ? 'crosshair' : ''
  }, [map, ready, shape, draft, mode])

  // Clicks on the map while adding.
  useEffect(() => {
    if (!map || (mode !== 'add-pin' && mode !== 'add-line')) return
    const onClick = (e: MapMouseEvent) => {
      const at: Position = [e.lngLat.lng, e.lngLat.lat]
      if (mode === 'add-pin') void addNew({ type: 'Point', coordinates: at })
      else setDraft((d) => [...d, at])
    }
    const onDbl = (e: MapMouseEvent) => {
      if (mode !== 'add-line') return
      e.preventDefault()
      finishLine()
    }
    map.on('click', onClick)
    map.on('dblclick', onDbl)
    map.doubleClickZoom.disable()
    return () => {
      map.off('click', onClick)
      map.off('dblclick', onDbl)
      map.doubleClickZoom.enable()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mode, draft])

  // Moving a pin: one draggable marker; letting go saves.
  useEffect(() => {
    if (!map || mode !== 'move-pin' || !sel || sel.geojson.type !== 'Point') return
    const m = new maplibregl.Marker({ draggable: true, color: '#facc15' }).setLngLat(sel.geojson.coordinates as [number, number]).addTo(map)
    m.on('dragend', () => {
      const p = m.getLngLat()
      save.mutate({ id: sel.id, layer_id: sel.layer_id, label: sel.label, geojson: { type: 'Point', coordinates: [p.lng, p.lat] } })
      setMode('none')
    })
    return () => void m.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mode, sel?.id])

  // Reshaping a line: a handle on every bend to drag, and a small one between
  // each pair to pull out a new bend.
  useEffect(() => {
    if (!map || !shape) return
    const markers: maplibregl.Marker[] = []
    const handle = (size: number, fill: string, ring: string) => {
      const el = document.createElement('div')
      Object.assign(el.style, { width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: fill, border: `2px solid ${ring}`, cursor: 'grab' })
      return el
    }
    shape.forEach((c, i) => {
      const m = new maplibregl.Marker({ element: handle(14, vertex === i ? '#facc15' : '#fff', '#0f172a'), draggable: true }).setLngLat(c as [number, number]).addTo(map)
      m.getElement().addEventListener('click', (ev) => {
        ev.stopPropagation()
        setVertex(i)
      })
      m.on('dragend', () => {
        const p = m.getLngLat()
        setShape((s) => s && s.map((q, j) => (j === i ? [p.lng, p.lat] : q)))
      })
      markers.push(m)
    })
    for (let i = 0; i < shape.length - 1; i++) {
      const a = shape[i]
      const b = shape[i + 1]
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const m = new maplibregl.Marker({ element: handle(10, 'rgba(250,204,21,.7)', '#fff'), draggable: true }).setLngLat(mid).addTo(map)
      m.on('dragend', () => {
        const p = m.getLngLat()
        setShape((s) => s && [...s.slice(0, i + 1), [p.lng, p.lat], ...s.slice(i + 1)])
      })
      markers.push(m)
    }
    return () => markers.forEach((m) => m.remove())
  }, [map, shape, vertex])

  async function addNew(geojson: Point | LineString) {
    const name = window.prompt(geojson.type === 'Point' ? 'Name this pin' : 'Name this line')
    setMode('none')
    setDraft([])
    if (!targetLayer || name === null) return
    const id = await save.mutateAsync({ layer_id: targetLayer, label: name.trim() || null, geojson })
    setSelected(id)
  }
  function finishLine() {
    if (draft.length >= 2) void addNew({ type: 'LineString', coordinates: draft })
    else {
      setDraft([])
      setMode('none')
    }
  }

  if (!map || !activeIds.length) return null
  const container = map.getContainer()

  return createPortal(
    <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-col gap-2 sm:max-w-sm">
      {isManager && (
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-md bg-white/95 p-1.5 text-xs shadow">
          {activeIds.length > 1 && (
            <Select
              size="sm"
              ariaLabel="Add to layer"
              className="w-32"
              value={targetLayer}
              onChange={setTarget}
              options={layers.filter((l) => activeIds.includes(l.id)).map((l) => ({ value: l.id, label: l.name }))}
            />
          )}
          <button className={cn('flex items-center gap-1 rounded border px-2 py-1', mode === 'add-pin' ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300')} onClick={() => setMode(mode === 'add-pin' ? 'none' : 'add-pin')}>
            <MapPin className="h-3.5 w-3.5" /> Pin
          </button>
          <button
            className={cn('flex items-center gap-1 rounded border px-2 py-1', mode === 'add-line' ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300')}
            onClick={() => {
              setDraft([])
              setMode(mode === 'add-line' ? 'none' : 'add-line')
            }}
          >
            <Route className="h-3.5 w-3.5" /> Line
          </button>
          {mode === 'add-pin' && <span className="text-gray-600">Click the map</span>}
          {mode === 'add-line' && (
            <>
              <span className="text-gray-600">{draft.length < 2 ? 'Click along it…' : `${draft.length} points`}</span>
              <button className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40" disabled={!draft.length} onClick={() => setDraft((d) => d.slice(0, -1))}>Undo</button>
              <button className="rounded bg-brand-700 px-2 py-1 font-semibold text-white disabled:opacity-40" disabled={draft.length < 2} onClick={finishLine}>Finish</button>
            </>
          )}
        </div>
      )}
      {sel && (
        <FeaturePanel
          key={sel.id}
          feature={sel}
          layerName={layers.find((l) => l.id === sel.layer_id)?.name ?? ''}
          isManager={isManager}
          mode={mode}
          shape={shape}
          vertex={vertex}
          onClose={() => {
            setSelected(null)
            setShape(null)
            setVertex(null)
            setMode('none')
          }}
          onRename={(label, description) =>
            save.mutate({ id: sel.id, layer_id: sel.layer_id, label: label || null, properties: { ...sel.properties, name: label, description }, geojson: sel.geojson })
          }
          onMove={() => setMode(mode === 'move-pin' ? 'none' : 'move-pin')}
          onShape={() => {
            setShape((sel.geojson as LineString).coordinates.map((c) => [c[0], c[1]]))
            setVertex(null)
            setMode('shape')
          }}
          onDeleteVertex={() => {
            if (vertex == null || !shape || shape.length <= 2) return
            setShape(shape.filter((_, j) => j !== vertex))
            setVertex(null)
          }}
          onSaveShape={() => {
            if (shape && shape.length >= 2) save.mutate({ id: sel.id, layer_id: sel.layer_id, label: sel.label, geojson: { type: 'LineString', coordinates: shape } })
            setShape(null)
            setVertex(null)
            setMode('none')
          }}
          onCancelShape={() => {
            setShape(null)
            setVertex(null)
            setMode('none')
          }}
          onDelete={() => {
            if (!window.confirm(`Delete “${sel.label || 'this item'}” from the map? Any winterizing place made from it keeps its instructions but stops following it.`)) return
            del.mutate(sel.id)
            setSelected(null)
          }}
          error={(save.error ?? del.error) as Error | null}
        />
      )}
    </div>,
    container,
  )
}

function FeaturePanel({
  feature,
  layerName,
  isManager,
  mode,
  shape,
  vertex,
  onClose,
  onRename,
  onMove,
  onShape,
  onDeleteVertex,
  onSaveShape,
  onCancelShape,
  onDelete,
  error,
}: {
  feature: FarmFeature
  layerName: string
  isManager: boolean
  mode: Mode
  shape: Position[] | null
  vertex: number | null
  onClose: () => void
  onRename: (label: string, description: string) => void
  onMove: () => void
  onShape: () => void
  onDeleteVertex: () => void
  onSaveShape: () => void
  onCancelShape: () => void
  onDelete: () => void
  error: Error | null
}) {
  const [label, setLabel] = useState(feature.label ?? '')
  const description = useMemo(() => String(feature.properties['description'] ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''), [feature.properties])
  const [desc, setDesc] = useState(description)
  const g = feature.geojson as Geometry
  const btn = 'flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50'

  return (
    <div className="pointer-events-auto rounded-md bg-white/95 p-2 text-sm shadow">
      <div className="flex items-start gap-2">
        {isManager ? (
          <input
            className="min-w-0 flex-1 rounded border border-gray-200 px-1.5 py-0.5 font-semibold"
            value={label}
            placeholder="(no name)"
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label !== (feature.label ?? '') && onRename(label.trim(), desc)}
          />
        ) : (
          <span className="flex-1 font-semibold">{feature.label || '(no name)'}</span>
        )}
        <button onClick={onClose} className="rounded p-0.5 text-gray-400 hover:bg-gray-100" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[11px] text-gray-400">
        {layerName} · {g.type === 'Point' ? 'pin' : g.type === 'LineString' ? 'line' : 'area'}
      </p>
      {isManager ? (
        <textarea
          rows={2}
          className="mt-1 w-full rounded border border-gray-200 px-1.5 py-1 text-xs"
          placeholder="Notes"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc !== description && onRename(label.trim(), desc)}
        />
      ) : (
        description && <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600">{description}</p>
      )}
      {isManager && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {g.type === 'Point' && (
            <button className={cn(btn, mode === 'move-pin' && 'border-brand-700 bg-brand-700 text-white hover:bg-brand-800')} onClick={onMove}>
              <Move className="h-3.5 w-3.5" /> {mode === 'move-pin' ? 'Drag the yellow pin' : 'Move'}
            </button>
          )}
          {g.type === 'LineString' && !shape && (
            <button className={btn} onClick={onShape}>
              <Pencil className="h-3.5 w-3.5" /> Reshape
            </button>
          )}
          {shape && (
            <>
              <button className={btn} disabled={vertex == null || shape.length <= 2} onClick={onDeleteVertex}>
                Delete point
              </button>
              <button className="rounded bg-brand-700 px-2 py-1 text-xs font-semibold text-white" onClick={onSaveShape}>
                Save shape
              </button>
              <button className={btn} onClick={onCancelShape}>
                Cancel
              </button>
            </>
          )}
          {!shape && (
            <button className="flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
      )}
      {shape && <p className="mt-1 text-[11px] text-gray-500">Drag the white points; drag a yellow dot to add a bend; tap a point then Delete point.</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error.message}</p>}
    </div>
  )
}

/**
 * The legend's half: a tickbox per farm layer, and for managers a way to
 * copy another My Map folder in.
 */
export function FarmLayersLegend({
  layers,
  active,
  onToggle,
  isManager,
}: {
  layers: FarmLayer[]
  active: Set<string>
  onToggle: (id: string, on: boolean) => void
  isManager: boolean
}) {
  const [importing, setImporting] = useState(false)
  return (
    <div className="mt-2 border-t border-gray-100 pt-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Farm layers</p>
      {layers.map((l) => (
        <label key={l.id} className="flex items-center gap-2 py-0.5">
          <input type="checkbox" checked={active.has(l.id)} onChange={(e) => onToggle(l.id, e.target.checked)} />
          {l.name}
        </label>
      ))}
      {!layers.length && <p className="text-[11px] text-gray-400">None yet.</p>}
      {isManager && !importing && (
        <button onClick={() => setImporting(true)} className="mt-1 text-[11px] font-medium text-brand-700 underline">
          Copy a My Map folder into the app…
        </button>
      )}
      {isManager && importing && <ImportFolder taken={layers.map(myMapFolderOf).filter((x): x is string => !!x)} onDone={() => setImporting(false)} />}
    </div>
  )
}

function ImportFolder({ taken, onDone }: { taken: string[]; onDone: () => void }) {
  const { data: setting } = useMyMapUrl()
  const { data: geo, isLoading, error } = useMyMapGeo(setting?.mymaps_url, true)
  const doImport = useImportMyMapFolder()
  const options = (geo?.layers ?? []).filter((l) => !taken.includes(l))
  const [folder, setFolder] = useState('')
  const pick = folder || options.find((l) => /water/i.test(l)) || options[0] || ''
  const count = (geo?.fc.features ?? []).filter((f: Feature) => f.properties?._layer === pick).length
  return (
    <div className="mt-1 space-y-1 rounded border border-gray-200 p-1.5">
      {isLoading && <p className="text-[11px] text-gray-500">Reading the My Map…</p>}
      {error && <p className="text-[11px] text-red-600">Couldn&apos;t read the My Map.</p>}
      {options.length > 0 && (
        <>
          <Select size="sm" ariaLabel="My Map folder" value={pick} onChange={setFolder} options={options.map((l) => ({ value: l, label: l }))} />
          <p className="text-[11px] text-gray-500">
            Copies {count} items into the app. From then on edit them here — Google&apos;s copy of this folder stops showing.
          </p>
          <div className="flex gap-1.5">
            <button
              className="rounded bg-brand-700 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
              disabled={!pick || doImport.isPending}
              onClick={() => doImport.mutate({ folder: pick, features: (geo?.fc.features ?? []).filter((f: Feature) => f.properties?._layer === pick) }, { onSuccess: onDone })}
            >
              {doImport.isPending ? 'Copying…' : `Copy “${pick}”`}
            </button>
            <button className="rounded border border-gray-300 px-2 py-1 text-[11px]" onClick={onDone}>
              Cancel
            </button>
          </div>
        </>
      )}
      {doImport.error && <p className="text-[11px] text-red-600">{(doImport.error as Error).message}</p>}
    </div>
  )
}

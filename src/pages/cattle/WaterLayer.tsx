import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { Droplet, Trash2 } from 'lucide-react'
import {
  WATER_KINDS,
  WATER_REACH_LAYERS,
  useCattleWater,
  useWaterMutations,
  useWaterReach,
  type WaterKind,
  type WaterSource,
} from '@/lib/cattle-water'
import { cn } from '@/lib/utils'
import { usePastures } from '@/lib/pastures'
import { pastureLabel } from '@/lib/pastureLabel'
import { circleRing } from '@/lib/geo/circle'

/**
 * The water on the cattle map: pins you can drag, rename and delete, and the
 * ground within 800 m of them.
 *
 * Pins are HTML markers rather than a circle layer, because a marker can be
 * dragged with nothing more than `draggable: true` and always draws above the
 * imagery. The reach is a fill layer under the fence lines, so NDVI and the
 * photograph still show through it.
 */
const REACH_SRC = 'water-reach'

function pinElement(w: WaterSource): HTMLDivElement {
  const el = document.createElement('div')
  el.title = w.name || (w.kind === 'trough' ? 'Trough' : 'Water')
  const trough = w.kind === 'trough'
  Object.assign(el.style, {
    width: trough ? '16px' : '14px',
    height: trough ? '16px' : '14px',
    borderRadius: trough ? '3px' : '50%',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px rgba(0,0,0,.35)',
    background: !w.drinkable ? 'rgba(107,114,128,.6)' : trough ? '#f97316' : '#0ea5e9',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>)
  return el
}

export function WaterLayer({
  map,
  mapReady,
  isManager,
  showPins,
  showReach,
  addingTrough,
  onAddingChange,
  onPinSelected,
  onTroughDropped,
  beforeId,
}: {
  map: maplibregl.Map | null
  mapReady: boolean
  isManager: boolean
  showPins: boolean
  showReach: boolean
  addingTrough: boolean
  onAddingChange: (v: boolean) => void
  /** A pin was tapped: the parent closes its own panel so the two do not stack. */
  onPinSelected?: () => void
  /** A trough was just placed: the parent turns the reach layer on so its circle shows. */
  onTroughDropped?: () => void
  /** The layer the reach fill goes under, so lines and letters stay on top. */
  beforeId: string
}) {
  const { data: sources } = useCattleWater()
  const { data: reach } = useWaterReach(showReach)
  const { add, update, remove } = useWaterMutations()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const markers = useRef(new Map<string, maplibregl.Marker>())
  // The mutations are new objects every render; the marker effect reads them
  // through a ref so a re-render does not rebuild sixty markers.
  const mutate = useRef({ add, update, onPinSelected, onTroughDropped })
  useEffect(() => {
    mutate.current = { add, update, onPinSelected, onTroughDropped }
  })
  const selected = sources?.find((s) => s.id === selectedId) ?? null

  // A tap on the map (not on a pin) closes the pin editor, the same way it
  // closes the paddock panel.
  useEffect(() => {
    if (!map || !mapReady) return
    const clear = () => setSelectedId(null)
    map.on('click', clear)
    return () => {
      map.off('click', clear)
    }
  }, [map, mapReady])

  useEffect(() => {
    if (!map || !mapReady) return
    const mine = markers.current
    for (const m of mine.values()) m.remove()
    mine.clear()
    if (!showPins) return
    for (const w of sources ?? []) {
      const el = pinElement(w)
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        setSelectedId(w.id)
        mutate.current.onPinSelected?.()
      })
      const m = new maplibregl.Marker({ element: el, draggable: isManager, anchor: 'center' })
        .setLngLat([w.lon, w.lat])
        .addTo(map)
      if (isManager) {
        m.on('dragend', () => {
          const { lng, lat } = m.getLngLat()
          mutate.current.update.mutate({ id: w.id, lon: lng, lat })
        })
      }
      mine.set(w.id, m)
    }
    return () => {
      for (const m of mine.values()) m.remove()
      mine.clear()
    }
  }, [map, mapReady, sources, showPins, isManager])

  // The 800 m of every trough, as a dashed ring off the pin itself. Not
  // clipped to the fence — that is the reach fill's job — but on screen the
  // moment a trough lands and wherever it is dragged, which the reach fill
  // (recomputed by the database after the drop) is not.
  useEffect(() => {
    if (!map || !mapReady) return
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: (sources ?? [])
        .filter((w) => w.kind === 'trough' && w.drinkable)
        .map((w) => ({
          type: 'Feature' as const,
          properties: { name: w.name },
          geometry: { type: 'Polygon' as const, coordinates: [circleRing([w.lon, w.lat], 800)] },
        })),
    }
    const src = map.getSource('trough-rings') as GeoJSONSource | undefined
    if (src) src.setData(fc)
    else {
      map.addSource('trough-rings', { type: 'geojson', data: fc })
      map.addLayer({
        id: 'trough-ring',
        type: 'line',
        source: 'trough-rings',
        paint: { 'line-color': '#f97316', 'line-width': 2, 'line-dasharray': [3, 2] },
      })
    }
    map.setLayoutProperty('trough-ring', 'visibility', showPins ? 'visible' : 'none')
  }, [map, mapReady, sources, showPins])

  useEffect(() => {
    if (!map || !mapReady) return
    const fc: FeatureCollection = { type: 'FeatureCollection', features: [] }
    for (const r of reach ?? []) {
      if (r.beyond_geojson)
        fc.features.push({
          type: 'Feature',
          properties: { kind: 'beyond', name: r.name, acres: r.beyond_acres },
          geometry: r.beyond_geojson,
        })
      if (r.reach_geojson)
        fc.features.push({
          type: 'Feature',
          properties: { kind: 'within', name: r.name, acres: r.reach_acres },
          geometry: r.reach_geojson,
        })
    }
    const src = map.getSource(REACH_SRC) as GeoJSONSource | undefined
    if (src) src.setData(fc)
    else {
      map.addSource(REACH_SRC, { type: 'geojson', data: fc })
      const before = map.getLayer(beforeId) ? beforeId : undefined
      map.addLayer(
        {
          id: 'water-reach-beyond',
          type: 'fill',
          source: REACH_SRC,
          filter: ['==', ['get', 'kind'], 'beyond'],
          // Strong enough to read over brown prairie AND over an NDVI raster:
          // this is a toggle someone turned on to see exactly this.
          paint: { 'fill-color': '#dc2626', 'fill-opacity': 0.45 },
        },
        before,
      )
      map.addLayer(
        {
          id: 'water-reach-within',
          type: 'fill',
          source: REACH_SRC,
          filter: ['==', ['get', 'kind'], 'within'],
          paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.22 },
        },
        before,
      )
      map.addLayer(
        {
          id: 'water-reach-line',
          type: 'line',
          source: REACH_SRC,
          filter: ['==', ['get', 'kind'], 'within'],
          paint: { 'line-color': '#7dd3fc', 'line-width': 1.2, 'line-dasharray': [2, 2] },
        },
        before,
      )
    }
    for (const id of WATER_REACH_LAYERS)
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showReach ? 'visible' : 'none')
  }, [map, mapReady, reach, showReach, beforeId])

  // Dropping a trough: the next click on the map places it, then the pin is
  // selected so it can be named and dragged into place.
  useEffect(() => {
    if (!map || !mapReady || !addingTrough) return
    map.getCanvas().style.cursor = 'crosshair'
    const onClick = (e: MapMouseEvent) => {
      onAddingChange(false)
      mutate.current.add.mutate(
        { lon: e.lngLat.lng, lat: e.lngLat.lat, kind: 'trough', name: 'Trough', drinkable: true },
        {
          onSuccess: (id) => {
            setSelectedId(id)
            mutate.current.onTroughDropped?.()
          },
        },
      )
    }
    map.once('click', onClick)
    return () => {
      map.off('click', onClick)
      map.getCanvas().style.cursor = ''
    }
  }, [map, mapReady, addingTrough, onAddingChange])

  if (!selected) return null
  return (
    <WaterEditor
      key={selected.id}
      source={selected}
      canEdit={isManager}
      onSave={(patch) => update.mutate({ id: selected.id, ...patch })}
      onDelete={() => {
        if (!window.confirm(`Delete ${selected.name || 'this water pin'}?`)) return
        remove.mutate(selected.id, { onSuccess: () => setSelectedId(null) })
      }}
      onClose={() => setSelectedId(null)}
    />
  )
}

function WaterEditor({
  source,
  canEdit,
  onSave,
  onDelete,
  onClose,
}: {
  source: WaterSource
  canEdit: boolean
  onSave: (patch: { name?: string | null; kind?: WaterKind; drinkable?: boolean; serves?: string[] }) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(source.name ?? '')
  const { data: pastures } = usePastures()
  const lettered = (pastures ?? []).filter((p) => pastureLabel(p.name))
  const [pickingServes, setPickingServes] = useState(false)
  return (
    <div className="absolute bottom-3 left-3 right-3 z-10 max-w-sm rounded-lg border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur md:right-auto">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Droplet className={cn('h-4 w-4', source.drinkable ? 'text-sky-600' : 'text-gray-400')} />
          {source.name || (source.kind === 'trough' ? 'Trough' : 'Water pin')}
        </p>
        <button onClick={onClose} className="-mr-1 -mt-1 rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
          ✕
        </button>
      </div>
      <p className="text-[11px] uppercase tracking-wide text-gray-500">
        {source.pasture_name ?? 'Outside every paddock'}
        {source.source === 'mymap' && ' · from the My Map'}
      </p>
      {canEdit ? (
        <div className="mt-2 space-y-2 text-sm">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() !== (source.name ?? '')) onSave({ name: name.trim() || null })
            }}
            placeholder="Name"
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <div className="flex items-center gap-2">
            <select
              value={source.kind}
              onChange={(e) => onSave({ kind: e.target.value as WaterKind })}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
            >
              {WATER_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={source.drinkable}
                onChange={(e) => onSave({ drinkable: e.target.checked })}
                className="h-3.5 w-3.5"
              />
              Cattle drink here
            </label>
          </div>
          {/* Water outside the fence that cattle walk out to — the corral
              trough both halves of J use — counts for the paddocks named here
              however far away it sits. */}
          <div className="text-xs">
            <button onClick={() => setPickingServes((v) => !v)} className="text-gray-600 underline">
              Counts for {source.serves.length ? source.serves.map((id) => pastureLabel(pastures?.find((p) => p.id === id)?.name)?.text.split(String.fromCharCode(10)).join(' ') ?? '?').join(', ') : 'the paddock it sits in'}
            </button>
            {pickingServes && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {lettered.map((p) => (
                  <label key={p.id} className="flex items-center gap-1 text-[11px] text-gray-700">
                    <input
                      type="checkbox"
                      checked={source.serves.includes(p.id)}
                      onChange={(e) =>
                        onSave({
                          serves: e.target.checked
                            ? [...source.serves, p.id]
                            : source.serves.filter((x) => x !== p.id),
                        })
                      }
                      className="h-3 w-3"
                    />
                    {pastureLabel(p.name)?.text.split(String.fromCharCode(10)).join(' ')}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">Drag the pin to move it.</span>
            <button
              onClick={onDelete}
              className="flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-xs text-gray-600">
          {WATER_KINDS.find((k) => k.value === source.kind)?.label}
          {source.drinkable ? '' : ' · not for drinking'}
        </p>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import maplibregl, { type MapMouseEvent } from 'maplibre-gl'
import { Trash2 } from 'lucide-react'
import {
  MINERAL_KINDS,
  daysOut,
  useCattleMineral,
  useMineralMutations,
  type MineralKind,
  type MineralTub,
} from '@/lib/cattle-mineral'
import { askConfirm } from '@/components/askConfirm'

/**
 * Mineral and salt tubs on the cattle map (Sam, 12 Nov 2026).
 *
 * Pins, the same as the water: drop one where the tub went, drag it when it
 * moves, click it to name it or take it away. HTML markers rather than a
 * circle layer, for the same reason the water uses them — `draggable: true` is
 * the whole of the dragging, and a marker always draws above the imagery.
 *
 * Square and amber so a tub cannot be mistaken for a drink at a glance. The
 * two layers answer opposite questions: water has to be somewhere the cattle
 * can reach, mineral goes where you want to PULL them, which is usually the
 * corner they have been ignoring.
 */
const COLOUR: Record<MineralKind, string> = {
  mineral: '#d97706',
  salt: '#64748b',
  protein: '#7c3aed',
  other: '#a16207',
}

const label = (t: MineralTub) => t.name || MINERAL_KINDS.find((k) => k.value === t.kind)?.label || 'Tub'

function pinElement(t: MineralTub): HTMLDivElement {
  const el = document.createElement('div')
  const out = daysOut(t)
  el.title = out == null ? label(t) : `${label(t)} — out ${out} day${out === 1 ? '' : 's'}`
  Object.assign(el.style, {
    width: '13px',
    height: '13px',
    // A squat rectangle: a tub seen from above, and nothing else on this map
    // is that shape.
    borderRadius: '2px',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px rgba(0,0,0,.35)',
    background: COLOUR[t.kind],
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>)
  return el
}

export function MineralLayer({
  map,
  mapReady,
  isManager,
  showPins,
  adding,
  onAddingChange,
  onPinSelected,
}: {
  map: maplibregl.Map | null
  mapReady: boolean
  isManager: boolean
  showPins: boolean
  /** The next click on the map drops a tub. */
  adding: boolean
  onAddingChange: (v: boolean) => void
  /** A pin was clicked, so the paddock panel can get out of the way. */
  onPinSelected?: () => void
}) {
  const { data: tubs } = useCattleMineral()
  const { add, update, remove } = useMineralMutations()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const markers = useRef(new Map<string, maplibregl.Marker>())
  // Kept in a ref so the marker effect does not tear every pin down and
  // rebuild it each time a mutation object is recreated.
  const mutate = useRef({ add, update, onPinSelected })
  useEffect(() => {
    mutate.current = { add, update, onPinSelected }
  })
  const selected = tubs?.find((t) => t.id === selectedId) ?? null

  // A tap on the map closes the editor, the same as the water pins.
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
    for (const t of tubs ?? []) {
      const el = pinElement(t)
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        setSelectedId(t.id)
        mutate.current.onPinSelected?.()
      })
      const m = new maplibregl.Marker({ element: el, draggable: isManager, anchor: 'center' })
        .setLngLat([t.lon, t.lat])
        .addTo(map)
      if (isManager) {
        m.on('dragend', () => {
          const { lng, lat } = m.getLngLat()
          mutate.current.update.mutate({ id: t.id, lon: lng, lat })
        })
      }
      mine.set(t.id, m)
    }
    return () => {
      for (const m of mine.values()) m.remove()
      mine.clear()
    }
  }, [map, mapReady, tubs, showPins, isManager])

  // Dropping a tub: the next click places it, and it opens for naming.
  useEffect(() => {
    if (!map || !mapReady || !adding) return
    map.getCanvas().style.cursor = 'crosshair'
    const onClick = (e: MapMouseEvent) => {
      onAddingChange(false)
      mutate.current.add.mutate(
        { lon: e.lngLat.lng, lat: e.lngLat.lat, kind: 'mineral' },
        { onSuccess: (id) => setSelectedId(id) },
      )
    }
    map.once('click', onClick)
    return () => {
      map.off('click', onClick)
      map.getCanvas().style.cursor = ''
    }
  }, [map, mapReady, adding, onAddingChange])

  if (!selected) return null
  return (
    <MineralEditor
      key={selected.id}
      tub={selected}
      canEdit={isManager}
      onSave={(patch) => update.mutate({ id: selected.id, ...patch })}
      onDelete={async () => {
        if (!(await askConfirm(`Delete ${label(selected)}?`))) return
        remove.mutate(selected.id, { onSuccess: () => setSelectedId(null) })
      }}
      onClose={() => setSelectedId(null)}
    />
  )
}

function MineralEditor({
  tub,
  canEdit,
  onSave,
  onDelete,
  onClose,
}: {
  tub: MineralTub
  canEdit: boolean
  onSave: (patch: { name?: string | null; kind?: MineralKind; placed_on?: string | null; notes?: string | null }) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(tub.name ?? '')
  const out = daysOut(tub)
  const field = 'w-full rounded-md border border-gray-200 px-2 py-1 text-xs'
  return (
    <div className="absolute bottom-3 left-3 right-3 z-10 max-w-sm rounded-lg border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur md:right-auto">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <span className="h-3 w-3 rounded-sm" style={{ background: COLOUR[tub.kind] }} aria-hidden />
          {label(tub)}
        </p>
        <button onClick={onClose} className="-mr-1 -mt-1 rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
          ✕
        </button>
      </div>
      <p className="text-xs uppercase tracking-wide text-gray-500">
        {tub.pasture_name ?? 'Outside every paddock'}
        {out != null && ` · out ${out} day${out === 1 ? '' : 's'}`}
      </p>
      <code className="mt-1.5 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs tabular-nums text-gray-700">
        {tub.lat.toFixed(5)}, {tub.lon.toFixed(5)}
      </code>
      {canEdit ? (
        <div className="mt-2 space-y-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== (tub.name ?? '') && onSave({ name: name.trim() || null })}
            placeholder="Name"
            aria-label="Tub name"
            className={field}
          />
          <div className="flex gap-1.5">
            <select
              value={tub.kind}
              onChange={(e) => onSave({ kind: e.target.value as MineralKind })}
              aria-label="What is in it"
              className={field}
            >
              {MINERAL_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={tub.placed_on ?? ''}
              onChange={(e) => onSave({ placed_on: e.target.value || null })}
              aria-label="Date it went out"
              className={field}
            />
          </div>
          <button
            onClick={onDelete}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      ) : (
        tub.notes && <p className="mt-2 text-xs text-gray-600">{tub.notes}</p>
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import type { Feature, FeatureCollection, MultiPolygon } from 'geojson'
import { Trash2 } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { useChemicalSearch } from '@/lib/chemicals'
import { PolygonDraw, type DrawState } from '@/lib/geo/polygon-draw'
import { multiPolygonAcres, labelPointOf } from '@/lib/geo/area'
import {
  WEEDS,
  weedBySlug,
  useWeedPatches,
  useSaveWeedPatch,
  useDeleteWeedPatch,
  type WeedPatch,
  type Weed,
} from '@/lib/weeds'
import { cn } from '@/lib/utils'

/**
 * A weed photo, or its colour when there is no photo.
 *
 * Sagebrush went on the list before anybody had taken a picture of it, and a
 * broken-image icon in a row of photographs reads as the app being broken
 * rather than as a picture being missing. The swatch is the same colour the
 * patches are drawn in on the map, so the tile still says which weed it is.
 */
function WeedPhoto({ weed, className }: { weed: Weed; className: string }) {
  const [failed, setFailed] = useState(!weed.photo)
  if (failed) {
    return (
      <div
        className={cn(className, 'flex items-center justify-center')}
        style={{ backgroundColor: weed.color + '22' }}
        aria-label={`${weed.name} — no photo yet`}
      >
        <span
          className="px-1 text-center text-[10px] font-medium leading-tight"
          style={{ color: weed.color }}
        >
          No photo yet
        </span>
      </div>
    )
  }
  return (
    <img
      src={weed.photo}
      alt={weed.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  )
}

/**
 * Which chemical went on, asked at the moment it is recorded.
 *
 * Free text as well as the list: a tank mix has no single product record, and
 * something not in the database is still worth writing down. Refusing anything
 * that is not on the list is how a record ends up saying "sprayed" and nothing
 * more, which is the gap this closes.
 */
function ChemicalPicker({
  onPick,
  onCancel,
}: {
  onPick: (chemical: { id: string | null; name: string }) => void
  onCancel: () => void
}) {
  const [term, setTerm] = useState('')
  // No product-type filter. 'herbicide' matched nothing — the column holds
  // 'HERBICIDE' — and even cased correctly an exact match drops the seven
  // products registered as a herbicide AND something else. Searching by name is
  // what people do anyway, and it cannot go quietly wrong.
  const { data: matches } = useChemicalSearch(term, '', 'name')
  const typed = term.trim()
  return (
    <Modal title="What was sprayed?" onClose={onCancel}>
      <div className="space-y-2">
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search a herbicide, or type what went on"
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
        />
        <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
          {(matches ?? []).slice(0, 25).map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onPick({ id: c.id, name: c.name })}
                className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-gray-50"
              >
                <span className="text-sm text-gray-900">{c.name}</span>
                {c.registration_number && (
                  <span className="text-[11px] text-gray-500">Reg. {c.registration_number}</span>
                )}
              </button>
            </li>
          ))}
          {(matches ?? []).length === 0 && (
            <li className="px-3 py-2 text-xs text-gray-500">
              {typed ? 'Nothing on the list matches.' : 'Start typing to search.'}
            </li>
          )}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-gray-600">
            Cancel
          </button>
          <button
            onClick={() => onPick({ id: null, name: typed || 'not recorded' })}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            {typed ? `Use “${typed}”` : 'Skip — not recorded'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** How a patch was dealt with, for the line under the details. */
const TREATMENT_LABEL: Record<string, string> = {
  sprayed: 'Sprayed',
  mowed: 'Mowed',
  other: 'Treated',
}

const EMPTY_DRAW: DrawState = {
  count: 0,
  acres: 0,
  mode: 'draw',
  selected: null,
  closed: false,
}

const SRC = 'weed-src'
const FILL = 'weed-fill'
const LINE = 'weed-line'

const SEVERITIES = ['light', 'moderate', 'heavy'] as const

function patchFeatures(patches: WeedPatch[]): FeatureCollection {
  const features: Feature[] = []
  for (const p of patches) {
    const w = weedBySlug(p.weed)
    if (!p.geojson) continue
    features.push({
      type: 'Feature',
      id: p.id,
      properties: {
        id: p.id,
        color: w?.color ?? '#94a3b8',
        // A treated patch stays on the map — it is the one you most want to
        // walk back to — but it should not read as an active infestation.
        opacity: p.treated_on ? 0.18 : 0.45,
      },
      geometry: p.geojson,
    })
  }
  return { type: 'FeatureCollection', features }
}

/**
 * Weed patches on the farm map: the layers, drawing, and both dialogs.
 *
 * Mounted for the life of the map page, NOT only while the layer is ticked on
 * or the panel is open. Two reasons, both learned the hard way: the MapLibre
 * layers are added imperatively, so unmounting would strand them on screen with
 * nothing left to hide them; and the button that starts a drawing lives in the
 * layer panel, which anyone would then close to see the ground they are drawing
 * on — taking a half-finished polygon with it.
 *
 * So `drawing` is owned by the page and passed in. The panel only asks.
 */
export function WeedsLayer({
  map,
  mapReady,
  visible,
  isManager,
  drawing,
  onDrawingChange,
}: {
  map: maplibregl.Map | null
  mapReady: boolean
  visible: boolean
  isManager: boolean
  drawing: boolean
  onDrawingChange: (drawing: boolean) => void
}) {
  const { data: patches } = useWeedPatches()
  const save = useSaveWeedPatch()
  const del = useDeleteWeedPatch()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draw, setDraw] = useState<DrawState>(EMPTY_DRAW)
  const [pending, setPending] = useState<MultiPolygon | null>(null)
  const drawRef = useRef<PolygonDraw | null>(null)

  const byId = useMemo(() => new Map((patches ?? []).map((p) => [p.id, p])), [patches])
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null

  // ── The patches themselves ────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !mapReady) return
    const data = patchFeatures(patches ?? [])
    const existing = map.getSource(SRC) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(data)
      return
    }
    map.addSource(SRC, { type: 'geojson', data })
    map.addLayer({
      id: FILL,
      type: 'fill',
      source: SRC,
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] },
    })
    map.addLayer({
      id: LINE,
      type: 'line',
      source: SRC,
      paint: { 'line-color': ['get', 'color'], 'line-width': 2 },
    })
  }, [map, mapReady, patches])

  useEffect(() => {
    if (!map || !mapReady || !map.getLayer(FILL)) return
    const vis = visible ? 'visible' : 'none'
    map.setLayoutProperty(FILL, 'visibility', vis)
    map.setLayoutProperty(LINE, 'visibility', vis)
  }, [map, mapReady, visible, patches])

  // Tap a patch to see what it is. Suspended while drawing, so the click that
  // places a vertex does not also open a dialog on top of it.
  useEffect(() => {
    if (!map || !mapReady || !visible || drawing) return
    const onClick = (e: MapMouseEvent) => {
      if (!map.getLayer(FILL)) return
      const hit = map.queryRenderedFeatures(e.point, { layers: [FILL] })[0]
      if (hit?.properties?.id) setSelectedId(String(hit.properties.id))
    }
    map.on('click', onClick)
    return () => void map.off('click', onClick)
  }, [map, mapReady, visible, drawing])

  // ── Drawing, driven by the flag the page holds ────────────────────────────
  useEffect(() => {
    if (!map || !drawing) return
    const d = new PolygonDraw(map, { color: '#f97316', onChange: setDraw })
    d.start()
    drawRef.current = d
    return () => {
      d.destroy()
      drawRef.current = null
      setDraw(EMPTY_DRAW)
    }
  }, [map, drawing])

  const finishDraw = () => {
    // Read the ring BEFORE clearing the flag — the cleanup above destroys the
    // draw, and with it the vertices.
    const mp = drawRef.current?.finish() ?? null
    onDrawingChange(false)
    if (mp) setPending(mp)
  }

  return (
    <>
      {drawing && (
        <div className="fixed bottom-4 left-1/2 z-40 flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-md border border-orange-300 bg-white px-2.5 py-2 text-xs shadow-lg">
          {/* The area, as it is being drawn. "Is that patch about an acre" is
              the question somebody is asking while they draw it, and it cannot
              be answered from a shape on a screen. */}
          <span className="font-medium text-orange-700">
            {!draw.closed
              ? draw.count < 3
                ? `Click the corners (${draw.count}/3)`
                : `${draw.count} corners · click the first to close`
              : `${draw.count} corners`}
          </span>
          {draw.acres > 0 && (
            <span className="rounded bg-orange-50 px-1.5 py-0.5 font-semibold tabular-nums text-orange-900">
              {draw.acres < 1 ? draw.acres.toFixed(2) : draw.acres.toFixed(1)} ac
            </span>
          )}

          {!draw.closed ? (
            <>
              <button
                onClick={() => drawRef.current?.undoLast()}
                disabled={draw.count === 0}
                className="rounded px-1.5 py-0.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
              >
                Undo
              </button>
              <button
                onClick={() => drawRef.current?.close()}
                disabled={draw.count < 3}
                className="rounded bg-brand-700 px-2 py-0.5 font-medium text-white hover:bg-brand-800 disabled:opacity-40"
              >
                Close shape
              </button>
            </>
          ) : (
            <>
              <span className="hidden text-gray-500 sm:inline">
                Drag a corner to move · drag a hollow dot to add · tap a corner to delete
              </span>
              <button
                onClick={() => drawRef.current?.deleteSelected()}
                disabled={draw.selected == null || draw.count <= 3}
                title={
                  draw.count <= 3
                    ? 'A shape needs at least three corners'
                    : 'Remove the selected corner'
                }
                className="rounded px-1.5 py-0.5 text-red-700 hover:bg-red-50 disabled:opacity-40"
              >
                Delete corner
              </button>
              <button
                onClick={finishDraw}
                className="rounded bg-brand-700 px-2 py-0.5 font-medium text-white hover:bg-brand-800"
              >
                Save
              </button>
            </>
          )}
          <button
            onClick={() => onDrawingChange(false)}
            className="rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      )}

      {pending && (
        <WeedPatchDialog
          geojson={pending}
          onClose={() => setPending(null)}
          onSave={async (row) => {
            await save.mutateAsync(row)
            setPending(null)
          }}
          saving={save.isPending}
        />
      )}

      {/* Hidden rather than closed while drawing: a dialog does not need to be
          dismissed by an effect if it simply has no business being open. */}
      {selected && !drawing && (
        <WeedPatchDetail
          patch={selected}
          isManager={isManager}
          onClose={() => setSelectedId(null)}
          onTreated={(treatment, chemical) =>
            save.mutate({
              id: selected.id,
              weed: selected.weed,
              treated_on: treatment ? new Date().toISOString().slice(0, 10) : null,
              treatment,
              // Cleared along with the date on an undo, so a patch never claims
              // a chemical it is no longer marked as having had.
              chemical: treatment === 'sprayed' ? (chemical?.name ?? null) : null,
              chemical_id: treatment === 'sprayed' ? (chemical?.id ?? null) : null,
            })
          }
          onDelete={async () => {
            await del.mutateAsync(selected.id)
            setSelectedId(null)
          }}
          onZoom={() => {
            if (!map) return
            map.flyTo({ center: labelPointOf(selected.geojson), zoom: 15 })
          }}
        />
      )}
    </>
  )
}

/** Which weed is it? Asked as soon as the polygon is closed. */
function WeedPatchDialog({
  geojson,
  onClose,
  onSave,
  saving,
}: {
  geojson: MultiPolygon
  onClose: () => void
  onSave: (row: {
    weed: string
    geojson: MultiPolygon
    acres: number
    severity: 'light' | 'moderate' | 'heavy'
    notes: string | null
  }) => void
  saving: boolean
}) {
  const [weed, setWeed] = useState(WEEDS[0].slug)
  const [severity, setSeverity] = useState<'light' | 'moderate' | 'heavy'>('moderate')
  const [notes, setNotes] = useState('')
  const chosen = weedBySlug(weed)
  const acres = multiPolygonAcres(geojson)

  return (
    <Modal title="Which weed is it?" onClose={onClose}>
      <div className="space-y-3">
        {/* Picked from pictures, not a list of names — the whole difficulty is
            knowing which one you are looking at. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {WEEDS.map((w) => (
            <button
              key={w.slug}
              type="button"
              onClick={() => setWeed(w.slug)}
              className={cn(
                'overflow-hidden rounded-md border-2 text-left transition-colors',
                weed === w.slug ? 'border-brand-600' : 'border-transparent hover:border-gray-300',
              )}
            >
              <WeedPhoto weed={w} className="aspect-square w-full object-cover" />
              <span className="block px-1 py-1 text-[11px] font-medium leading-tight text-gray-800">
                {w.name}
              </span>
            </button>
          ))}
        </div>

        {chosen && (
          <div className="rounded-md bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-600">
            <p>
              <span className="font-semibold text-gray-800">{chosen.name}</span>{' '}
              <span className="italic">{chosen.latin}</span> ·{' '}
              <span
                className={cn(
                  'font-medium',
                  chosen.status === 'Prohibited noxious' ? 'text-red-700' : 'text-gray-700',
                )}
              >
                {chosen.status}
              </span>
            </p>
            <p className="mt-1">{chosen.id}</p>
            <p className="mt-1 text-gray-500">{chosen.why}</p>
            <p className="mt-1 text-gray-400">
              Photo: {chosen.credit} · {chosen.license}
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <label className="flex-1 text-xs text-gray-500">
            How thick
            <select
              className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-900"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as typeof severity)}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <p className="pt-4 text-xs text-gray-500">
            <span className="font-semibold text-gray-800">{acres.toFixed(1)}</span> acres
          </p>
        </div>

        <label className="block text-xs text-gray-500">
          Notes
          <textarea
            rows={2}
            className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-900"
            placeholder="Along the south ditch, spreading toward the pivot"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={() =>
              onSave({
                weed,
                geojson,
                acres: Number(acres.toFixed(2)),
                severity,
                notes: notes.trim() || null,
              })
            }
            disabled={saving}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save patch'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** What is already marked here. */
function WeedPatchDetail({
  patch,
  isManager,
  onClose,
  onTreated,
  onDelete,
  onZoom,
}: {
  patch: WeedPatch
  isManager: boolean
  onClose: () => void
  onTreated: (
    treatment: 'sprayed' | 'mowed' | null,
    chemical?: { id: string | null; name: string },
  ) => void
  onDelete: () => void
  onZoom: () => void
}) {
  const w = weedBySlug(patch.weed)
  const [pickingChemical, setPickingChemical] = useState(false)

  if (pickingChemical) {
    return (
      <ChemicalPicker
        onCancel={() => setPickingChemical(false)}
        onPick={(chemical) => {
          setPickingChemical(false)
          onTreated('sprayed', chemical)
        }}
      />
    )
  }

  return (
    <Modal title={w?.name ?? patch.weed} onClose={onClose}>
      <div className="space-y-3">
        {w && (
          <div className="flex gap-3">
            <WeedPhoto weed={w} className="h-24 w-24 shrink-0 rounded-md object-cover" />
            <div className="min-w-0 text-[11px] leading-relaxed text-gray-600">
              <p className="italic">{w.latin}</p>
              <p
                className={cn(
                  'font-medium',
                  w.status === 'Prohibited noxious' ? 'text-red-700' : 'text-gray-700',
                )}
              >
                {w.status}
              </p>
              <p className="mt-1">{w.id}</p>
            </div>
          </div>
        )}

        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-gray-500">Size</dt>
            <dd className="font-semibold text-gray-900">
              {patch.acres == null ? '—' : `${patch.acres} ac`}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-gray-500">How thick</dt>
            <dd className="font-semibold capitalize text-gray-900">{patch.severity ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-gray-500">Found</dt>
            <dd className="font-semibold text-gray-900">{patch.observed_on}</dd>
          </div>
        </dl>

        {patch.notes && <p className="rounded-md bg-gray-50 p-2 text-sm text-gray-700">{patch.notes}</p>}

        <p className="text-[11px] text-gray-500">
          {patch.treated_on
            ? `${TREATMENT_LABEL[patch.treatment ?? 'other']} ${patch.treated_on}${
                patch.chemical ? ` — ${patch.chemical}` : ''
              }`
            : 'Not dealt with yet'}
        </p>

        <div className="flex items-center justify-between gap-2">
          {isManager ? (
            <button
              onClick={onDelete}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onZoom} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
              Zoom to
            </button>
            {patch.treated_on ? (
              <button
                onClick={() => onTreated(null)}
                className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Undo
              </button>
            ) : (
              <>
                {/* Which one it was, not just that something happened. A
                    sprayed patch is watched for seedlings; a mowed one is
                    watched because the roots are still down there. */}
                <button
                  onClick={() => onTreated('mowed')}
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Mowed
                </button>
                <button
                  onClick={() => setPickingChemical(true)}
                  className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
                >
                  Sprayed
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useWaterTests, latestByWater } from '@/lib/cattle-papers-data'
import { readingFor, useDistrictWater, fedByLabel } from '@/lib/district-water'
import { judgeWater, VERDICT_LABEL, WATER_CLASSES, worst, type ParamFinding } from '@/lib/livestock-water'
import maplibregl, { type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { Copy, Droplet, FlaskConical, Share2, Trash2 } from 'lucide-react'
import {
  WATER_KINDS,
  WATER_REACH_LAYERS,
  isTrough,
  useCattleWater,
  useWaterMutations,
  useWaterReach,
  type WaterKind,
  type WaterSource,
} from '@/lib/cattle-water'
import { cn } from '@/lib/utils'
import { usePastures } from '@/lib/pastures'
import { pastureLabel } from '@/lib/pastureLabel'
import { askConfirm } from '@/components/askConfirm'
import { WaterReportDialog } from '@/pages/cattle/WaterReport'

/**
 * The water on the cattle map: pins you can drag, rename and delete, and the
 * ground within the recommended distance of them — 250 m, with an outer band
 * at 800 m (see docs/grazing-distance-evidence.md).
 *
 * Pins are HTML markers rather than a circle layer, because a marker can be
 * dragged with nothing more than `draggable: true` and always draws above the
 * imagery. The reach is a fill layer under the fence lines, so NDVI and the
 * photograph still show through it.
 */
const REACH_SRC = 'water-reach'

function pinElement(w: WaterSource): HTMLDivElement {
  const el = document.createElement('div')
  el.title = w.name || (isTrough(w.kind) ? 'Trough' : 'Water')
  const trough = isTrough(w.kind)
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
      if (r.margin_geojson)
        fc.features.push({
          type: 'Feature',
          properties: { kind: 'margin', name: r.name, acres: r.margin_acres },
          geometry: r.margin_geojson,
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
      // The 250-800 m band, between the blue and the red: cattle do come out
      // this far, grazing it less evenly as they go. Amber rather than a
      // lighter red, so it reads as its own band and not as weak evidence of
      // the same thing. This band is the only thing drawn around a trough now
      // -- the dashed ring that used to sit on top of it was drawn in the
      // browser, ignored every fence, and so disagreed with the band beneath
      // it wherever a boundary cut one.
      map.addLayer(
        {
          id: 'water-reach-margin',
          type: 'fill',
          source: REACH_SRC,
          filter: ['==', ['get', 'kind'], 'margin'],
          paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.35 },
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
        // A dropped trough is a moveable one: that is what dropping is for.
        { lon: e.lngLat.lng, lat: e.lngLat.lat, kind: 'trough_portable', name: 'Trough', drinkable: true },
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
      onDelete={async () => {
        if (!(await askConfirm(`Delete ${selected.name || 'this water pin'}?`))) return
        remove.mutate(selected.id, { onSuccess: () => setSelectedId(null) })
      }}
      onClose={() => setSelectedId(null)}
    />
  )
}

/**
 * Where the pin actually is, in a form you can send to somebody.
 *
 * Whoever drives out to set a solar trough needs the coordinates, not "by the
 * north fence". Copy puts the pair on the clipboard. Share hands the phone's
 * own share sheet a line with a Google Maps link, which is what makes it
 * useful in a text message; a browser without a share sheet copies that same
 * line instead, so the button always does something.
 *
 * Five decimal places is about a metre — finer than the pin was placed.
 */
function PinLocation({ source }: { source: WaterSource }) {
  const [said, setSaid] = useState<'' | 'copied' | 'sent'>('')
  const coords = `${source.lat.toFixed(5)}, ${source.lon.toFixed(5)}`
  const label = source.name || (isTrough(source.kind) ? 'Trough' : 'Water')
  const link = `https://www.google.com/maps/search/?api=1&query=${source.lat.toFixed(6)},${source.lon.toFixed(6)}`
  const message = `${label} — ${coords}\n${link}`
  const flash = (what: 'copied' | 'sent') => {
    setSaid(what)
    setTimeout(() => setSaid(''), 3000)
  }
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      flash('copied')
    } catch {
      /* the coordinates are on screen to read off */
    }
  }
  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: label, text: message })
        flash('sent')
      } catch {
        /* they closed the sheet, or it refused — not a failure worth saying */
      }
      return
    }
    await copy(message)
  }
  const btn =
    'flex items-center gap-1 rounded-md border border-gray-200 px-1.5 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50'
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] tabular-nums text-gray-700">{coords}</code>
      <button onClick={() => copy(coords)} className={btn} title="Copy the latitude and longitude">
        <Copy className="h-3 w-3" /> Copy
      </button>
      <button onClick={share} className={btn} title="Send it with a map link">
        <Share2 className="h-3 w-3" /> Share
      </button>
      {said && <span className="text-[11px] font-medium text-brand-700">{said === 'copied' ? 'Copied' : 'Sent'}</span>}
    </div>
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
  const [report, setReport] = useState(false)
  const { data: pastures } = usePastures()
  const lettered = (pastures ?? []).filter((p) => pastureLabel(p.name))
  const [pickingServes, setPickingServes] = useState(false)
  return (
    <div className="absolute bottom-3 left-3 right-3 z-10 max-w-sm rounded-lg border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur md:right-auto">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Droplet className={cn('h-4 w-4', source.drinkable ? 'text-sky-600' : 'text-gray-400')} />
          {source.name || (isTrough(source.kind) ? 'Trough' : 'Water pin')}
        </p>
        <button onClick={onClose} className="-mr-1 -mt-1 rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
          ✕
        </button>
      </div>
      <p className="text-[11px] uppercase tracking-wide text-gray-500">
        {source.pasture_name ?? 'Outside every paddock'}
        {source.source === 'mymap' && ' · from the My Map'}
      </p>
      <PinLocation source={source} />
      <WhatIsInTheWater source={source} />
      {/* The whole report, which is too much to read on a panel over the map:
          every parameter against the chart, the combinations, the bloom lean,
          and where a lab sheet is typed in (Sam, 11 Nov 2026). */}
      <button
        onClick={() => setReport(true)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        <FlaskConical className="h-3.5 w-3.5" /> Water report
      </button>
      {report && <WaterReportDialog source={source} canEdit={canEdit} onClose={() => setReport(false)} />}
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

/**
 * What is in this water, on the pin itself (Sam, 11 Nov 2026).
 *
 * The water-quality card used to sit under the map with every source's
 * readings in one table. The question anyone actually has is about the dugout
 * they are looking at, so the answer is on it: the worst verdict across the
 * classes, the readings that earned it, and what the chart says to do.
 *
 * Nothing here is a model. Every verdict is a band out of Alberta's Agdex
 * 400/716-2 and carries the sentence the publication wrote beside that band —
 * see lib/livestock-water.ts. A source fed by the river or the canal is read
 * from that supply's own monitoring instead of waiting on a lab sheet.
 */
function WhatIsInTheWater({ source }: { source: WaterSource }) {
  const { data: tests } = useWaterTests()
  const { data: district } = useDistrictWater()
  const latest = useMemo(() => latestByWater(tests).get(source.id) ?? null, [tests, source.id])
  const reading = useMemo(
    () => readingFor({ fedBy: source.fed_by, test: latest, district, sampledOn: latest?.sampled_on ?? null }),
    [source.fed_by, latest, district],
  )
  const judged = useMemo(() => (reading ? judgeWater(reading.values) : null), [reading])

  if (!reading || !judged) {
    return (
      <p className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-500">
        Nothing tested on this water yet.
      </p>
    )
  }

  const verdict = worst(WATER_CLASSES.map((c) => judged.byClass[c.key]))
  // Only what the chart marked: an acceptable reading is not news on a pin.
  const flagged = judged.findings.filter((f: ParamFinding) => f.grade !== 'acceptable')
  const when =
    reading.from === 'lab'
      ? reading.sampledOn
        ? `lab sheet, ${new Date(`${reading.sampledOn}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`
        : 'lab sheet'
      : `from the ${fedByLabel(reading.fedBy)} monitoring`

  return (
    <div className="mt-2 border-t border-gray-100 pt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">What is in it</span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium',
            verdict === 'acceptable'
              ? 'bg-green-100 text-green-900'
              : verdict === 'limits'
                ? 'bg-amber-100 text-amber-900'
                : verdict === 'do_not_use'
                  ? 'bg-red-100 text-red-900'
                  : 'bg-gray-100 text-gray-500',
          )}
        >
          {VERDICT_LABEL[verdict]}
        </span>
        <span className="text-[11px] text-gray-400">{when}</span>
      </div>
      {flagged.length === 0 ? (
        <p className="mt-1 text-xs text-gray-600">
          Every reading on the sheet is inside Alberta&rsquo;s livestock bands.
        </p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-xs text-gray-700">
          {flagged.slice(0, 4).map((f: ParamFinding) => (
            <li key={f.param.key}>
              <span className="font-medium">{f.param.label}</span>{' '}
              <span className="tabular-nums">
                {f.value}
                {f.param.unit ? ` ${f.param.unit}` : ''}
              </span>{' '}
              — {f.says}
            </li>
          ))}
        </ul>
      )}
      {judged.untested.length > 0 && (
        <p className="mt-1 text-[11px] text-gray-400">
          Not on this sheet: {judged.untested.slice(0, 5).join(', ')}
          {judged.untested.length > 5 && ` and ${judged.untested.length - 5} more`}.
        </p>
      )}
    </div>
  )
}

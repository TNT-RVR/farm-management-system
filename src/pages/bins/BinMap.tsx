import { useEffect, useMemo, useRef, useState } from 'react'
import { hiddenYardNames, useBinYards, yardRank } from '@/lib/bin-yards'
import maplibregl, { type MapMouseEvent } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import { MapPin, X } from 'lucide-react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useFarmMap, useGeoJsonSource } from '@/lib/geo/use-farm-map'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { byYardThenNumber, useBinAllocations, useBinFieldsIn, useBinOnHand, useBins, type BinRow } from '@/lib/bins'
import { useCrops, useFields } from '@/lib/queries'
import { cropColour, readableOn } from '@/lib/crop-colour'
import { contentLabel, useBinContents } from '@/lib/bin-contents'
import { BinDetail } from './BinDetail'

const SRC = 'bin-pins'
const DOT = 'bin-pin-dot'
const LABEL = 'bin-pin-label'

/**
 * What a pin says: the bin's number alone. The yard is the map you are on and
 * "(Fertilizer Bin)" is the bin's own business, so both come off — a label
 * wider than the pin sits on the satellite image and cannot be read.
 */
export function binLabel(name: string): string {
  const short = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
  const n = short.match(/#\s*(\w+)/)
  return n ? `#${n[1]}` : short.replace(/^.*?-\s*/, '') || name
}


/** A bin with nothing in it. Grey, so it does not read as an uncoloured crop. */
const EMPTY = '#cbd5e1'

export type LocatedBin = {
  id: string
  name: string
  site: string | null
  /** "West Side Hopper Bottom" — how somebody standing in the yard tells it apart. */
  notes: string | null
  /** What it normally holds. Advisory — a fertilizer bin can still take grain. */
  usual: 'grain' | 'fertilizer'
  capacity_bu: number | null
  /** Which switches it offers, and whether they are running: the pin's rings. */
  has_aeration: boolean
  has_heater: boolean
  aeration_on: boolean
  heater_on: boolean
  lng: number | null
  lat: number | null
}

function useLocatedBins() {
  return useQuery({
    queryKey: ['bins', 'located'],
    queryFn: async (): Promise<LocatedBin[]> => {
      const { data, error } = await supabase
        .from('bins_located')
        .select('*')
        .eq('active', true)
        .order('name')
      if (error) throw error
      return (data ?? [])
        .map((r) => {
          const row = r as unknown as Record<string, unknown>
          const n = (v: unknown) => (v == null ? null : Number(v))
          return {
            id: String(row.id),
            name: String(row.name),
            site: (row.site as string) ?? null,
            notes: (row.notes_md as string) ?? null,
            usual:
              row.usual_contents === 'fertilizer' ? ('fertilizer' as const) : ('grain' as const),
            capacity_bu: n(row.capacity_bu),
            has_aeration: row.has_aeration === true,
            has_heater: row.has_heater === true,
            aeration_on: row.aeration_on === true,
            heater_on: row.heater_on === true,
            lng: n(row.lng),
            lat: n(row.lat),
          }
        })
        .sort(byYardThenNumber)
    },
  })
}

function useSetBinLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      lng,
      lat,
    }: {
      id: string
      lng: number | null
      lat: number | null
    }) => {
      const { error } = await supabase.rpc('set_bin_location', {
        p_bin_id: id,
        p_lng: lng,
        p_lat: lat,
      })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bins'] }),
  })
}

/**
 * The yard, drawn.
 *
 * A list beside a map rather than under it: the list is how you find a bin by
 * number, the map is how you find it by where it stands, and having both in
 * view at once is the point. One yard at a time, because Main Yard and Down the
 * Hill are miles apart and a map framed to hold both shows neither.
 *
 * Pins carry the colour of whatever crop is in the bin, so "where is the
 * canola" is answered by looking rather than by clicking each pin in turn.
 */
export type BinActions = {
  weighIn: (bin: BinRow) => void
  add: (bin: BinRow) => void
  move: (bin: BinRow) => void
  ship: (bin: BinRow) => void
  record: (bin: BinRow) => void
}

export function BinMap({ canEdit, cropYear, actions, compact = false }: { canEdit: boolean; cropYear: number; actions?: BinActions; compact?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { map, mapRef, ready } = useFarmMap(containerRef, { zoom: 14 })
  const [placing, setPlacing] = useState<string | null>(null)
  // Opens on the first shown yard in the farm's order (Bins page → Bin yards).
  const [yard, setYard] = useState<string>('')
  const { data: yardList } = useBinYards()
  const [opened, setOpened] = useState<string | null>(null)
  const { data: bins } = useLocatedBins()
  const { data: crops } = useCrops()
  const { data: onhand } = useBinOnHand()
  const { data: allocations } = useBinAllocations(cropYear)
  // What somebody wrote down is in the bin — last year's durum in #2 — and
  // it colours the pin the same as grain the ledger can prove.
  const { data: recorded } = useBinContents()
  const { data: fieldsIn } = useBinFieldsIn()
  const { data: fields } = useFields()
  const fieldName = (id: string | null | undefined) => (fields ?? []).find((f) => f.id === id)?.name ?? ''
  const save = useSetBinLocation()

  // The handler is read from a ref inside the map click listener: the listener
  // is attached once, and a closure over `placing` would keep the value it had
  // when the map loaded — which is null, so the first pin would never land.
  const placingRef = useRef<string | null>(null)
  useEffect(() => {
    placingRef.current = placing
  }, [placing])

  // Same reason as placingRef: the map click listener is attached once, so it
  // cannot close over the bin list — that list changes with every pin dropped.
  const nextUnplacedRef = useRef<(justPlaced: string) => string | null>(() => null)

  // The yards in the farm's order, the hidden ones last: still here, so their
  // bins' pins can be placed, but not where the map opens.
  const yards = useMemo(() => {
    const set = new Set((bins ?? []).map((b) => b.site ?? 'Unsorted'))
    const rank = yardRank(yardList)
    const hidden = hiddenYardNames(yardList)
    return [...set].sort((a, b) => Number(hidden.has(a)) - Number(hidden.has(b)) || rank(a) - rank(b) || a.localeCompare(b))
  }, [bins, yardList])
  const hiddenYards = useMemo(() => hiddenYardNames(yardList), [yardList])

  // A yard that has gone away — every bin in it renamed, say — must not leave
  // the sidebar showing nothing with no way back. Derived rather than corrected
  // in an effect: the fallback is a question about what to render, not a state
  // change, and writing it back would re-render the map for nothing.
  const shownYard = yards.length > 0 && !yards.includes(yard) ? yards[0] : yard

  const inYard = useMemo(
    () => (bins ?? []).filter((b) => (b.site ?? 'Unsorted') === shownYard),
    [bins, shownYard],
  )
  const placed = useMemo(() => inYard.filter((b) => b.lng != null && b.lat != null), [inYard])
  const unplaced = useMemo(() => inYard.filter((b) => b.lng == null), [inYard])

  useEffect(() => {
    nextUnplacedRef.current = (justPlaced: string) => {
      const left = unplaced.filter((b) => b.id !== justPlaced)
      return left.length > 0 ? left[0].id : null
    }
  }, [unplaced])

  const cropById = useMemo(() => new Map((crops ?? []).map((c) => [c.id, c])), [crops])

  /** What is in a bin now, and failing that what the year says is going in it. */
  const contentsOf = useMemo(() => {
    const now = new Map<string, { cropId: string | null; bu: number }>()
    for (const o of onhand ?? []) {
      if (o.onhand_bu <= 0) continue
      const prev = now.get(o.bin_id)
      // A bin holding two crops is a mistake somebody will want to see; show
      // the larger and let the numbers on the detail panel tell the rest.
      if (!prev || o.onhand_bu > prev.bu) now.set(o.bin_id, { cropId: o.crop_id, bu: o.onhand_bu })
    }
    return (binId: string): { cropId: string | null; bu: number; planned: boolean; label?: string; fieldId?: string | null } | null => {
      const actual = now.get(binId)
      if (actual) return { ...actual, planned: false }
      const rec = (recorded ?? []).find((r) => r.bin_id === binId)
      if (rec) return { cropId: rec.crop_id, bu: rec.bushels ?? 0, planned: false, label: contentLabel(rec) }
      const a = (allocations ?? []).find((x) => x.bin_id === binId)
      return a?.crop_id || a?.field_id ? { cropId: a.crop_id, bu: 0, planned: true, fieldId: a.field_id } : null
    }
  }, [onhand, recorded, allocations])

  const colourOf = useMemo(
    () => (binId: string) => {
      const c = contentsOf(binId)
      return c?.cropId ? cropColour(cropById.get(c.cropId)) : EMPTY
    },
    [contentsOf, cropById],
  )

  const current = useMemo(() => (bins ?? []).find((b) => b.id === placing) ?? null, [bins, placing])
  const openBin = useMemo(() => (bins ?? []).find((b) => b.id === opened) ?? null, [bins, opened])
  // The full bin record, for the same detail view the Bins tab opens.
  const { data: fullBins } = useBins()
  const openFull = (fullBins ?? []).find((b) => b.id === opened) ?? null

  const data: FeatureCollection = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: placed.map<Feature>((b) => {
        const colour = colourOf(b.id)
        const planned = contentsOf(b.id)?.planned ?? false
        const running = b.aeration_on || b.heater_on
        return {
          type: 'Feature',
          id: b.id,
          properties: {
            id: b.id,
            // Just the number: "Main Yard - #21 (Fertilizer Bin)" spilled off
            // the pin onto the field and could not be read (Sam, 26 Oct 2026).
            label: binLabel(b.name),
            name: b.name,
            colour,
            // Only planned: a white pin ringed in the crop's colour, so it
            // never reads as a bin with grain in it (Sam, 8 Oct 2026).
            fill: planned ? '#ffffff' : colour,
            // The pin's own ring says what is running (Sam, 27 Oct 2026):
            // red for heat, blue for the fan, red first when both are on.
            ring: b.heater_on ? '#dc2626' : b.aeration_on ? '#0284c7' : planned ? colour : '#ffffff',
            ringWidth: running ? 3.5 : planned ? 3.5 : 2,
            // The number sits ON the pin, so it has to survive a pale crop.
            text: planned ? '#111827' : readableOn(colour),
            // Outlined in the pin's own colour, so a number wider than the pin still reads.
            halo: planned ? '#ffffff' : colour,
          },
          geometry: { type: 'Point', coordinates: [b.lng!, b.lat!] },
        }
      }),
    }),
    [placed, colourOf, contentsOf],
  )

  useGeoJsonSource(map, ready, SRC, data, (map) => {
    map.addLayer({
      id: DOT,
      type: 'circle',
      source: SRC,
      paint: {
        'circle-radius': 11,
        'circle-color': ['get', 'fill'],
        'circle-stroke-color': ['get', 'ring'],
        'circle-stroke-width': ['get', 'ringWidth'],
      },
    })
    map.addLayer({
      id: LABEL,
      type: 'symbol',
      source: SRC,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': ['get', 'text'], 'text-halo-color': ['get', 'halo'], 'text-halo-width': 1.4 },
    })
  })

  // Frame the yard you are looking at, and reframe when you switch yards — the
  // two are far enough apart that keeping the old view would leave the map
  // sitting on empty prairie.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || placed.length === 0) return
    const b = new maplibregl.LngLatBounds()
    for (const p of placed) b.extend([p.lng!, p.lat!])
    map.fitBounds(b, { padding: 80, maxZoom: 17.5, duration: 400 })
  }, [mapRef, ready, shownYard, placed])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const onClick = (e: MapMouseEvent) => {
      const id = placingRef.current
      if (!id) return
      save.mutate(
        { id, lng: Number(e.lngLat.lng.toFixed(6)), lat: Number(e.lngLat.lat.toFixed(6)) },
        {
          // Straight on to the next bin in this yard still missing a pin.
          onSuccess: () => setPlacing(nextUnplacedRef.current(id)),
        },
      )
    }
    map.on('click', onClick)
    return () => void map.off('click', onClick)
  }, [mapRef, ready, save])

  // Clicking a pin opens the bin, the same as clicking its row.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const onPin = (e: MapMouseEvent & { features?: Feature[] }) => {
      if (placingRef.current) return
      const id = e.features?.[0]?.properties?.id
      if (typeof id === 'string') setOpened(id)
    }
    const enter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const leave = () => {
      map.getCanvas().style.cursor = placingRef.current ? 'crosshair' : ''
    }
    map.on('click', DOT, onPin)
    map.on('mouseenter', DOT, enter)
    map.on('mouseleave', DOT, leave)
    return () => {
      map.off('click', DOT, onPin)
      map.off('mouseenter', DOT, enter)
      map.off('mouseleave', DOT, leave)
    }
  }, [mapRef, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.getCanvas().style.cursor = placing ? 'crosshair' : ''
  }, [mapRef, ready, placing])

  return (
    <div className="space-y-3">
      {/* Compact: beside the Bins list (Sam, 23 Oct 2026), which is the list; no sidebar of its own. */}
      <div className={cn('grid gap-3', !compact && 'lg:grid-cols-[19rem_1fr]')}>
        {/* The bin list is a desktop sidebar; on a phone the pins are the list. */}
        <aside className={cn('hidden overflow-hidden rounded-lg border border-gray-200 bg-white', !compact && 'lg:block')}>
          <div className="flex gap-1 border-b border-gray-200 p-2">
            {yards.map((y) => (
              <button
                key={y}
                onClick={() => setYard(y)}
                className={cn(
                  'flex-1 rounded-md px-2 py-1.5 text-xs font-medium',
                  y === shownYard
                    ? 'bg-brand-700 text-white'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                )}
              >
                {y}
                {hiddenYards.has(y) && <span className="ml-1 opacity-70">(hidden)</span>}
              </button>
            ))}
          </div>

          <ul className="max-h-[26rem] divide-y divide-gray-100 overflow-y-auto">
            {inYard.map((b) => {
              const c = contentsOf(b.id)
              const crop = c?.cropId ? cropById.get(c.cropId) : null
              return (
                <li key={b.id}>
                  <button
                    onClick={() => setOpened(b.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50',
                      placing === b.id && 'bg-amber-50',
                    )}
                  >
                    <span
                      className={cn('h-4 w-4 shrink-0 rounded-full', c?.planned ? 'border-[3px] bg-white' : 'border border-black/10')}
                      style={c?.planned ? { borderColor: colourOf(b.id) } : { background: colourOf(b.id) }}
                      title={c?.planned ? `Empty, planned for ${crop?.name ?? 'a field'}` : crop ? crop.name : 'Empty'}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-gray-900">{b.name}</span>
                      <span className="block truncate text-xs text-gray-500">
                        {b.capacity_bu ? `${b.capacity_bu.toLocaleString('en-CA')} bu` : '—'}
                        {c?.label
                          ? ` · ${c.label}`
                          : c?.planned
                            ? ' · empty'
                            : crop
                              ? ` · ${crop.name}${(fieldsIn?.get(b.id) ?? []).length ? ` from ${(fieldsIn?.get(b.id) ?? []).map(fieldName).join(', ')}` : ''}`
                              : ' · empty'}
                        {b.usual === 'fertilizer' ? ' · fert' : ''}
                      </span>
                    </span>
                    {c?.planned && (
                      <span className="shrink-0 rounded border border-dashed border-sky-300 bg-sky-50 px-1 text-[10px] italic text-sky-800">
                        plan: {[crop?.name, fieldName(c.fieldId)].filter(Boolean).join(', ')}
                      </span>
                    )}
                    {b.lng == null && (
                      <span className="shrink-0 text-[10px] font-medium uppercase text-amber-700">
                        no pin
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
            {inYard.length === 0 && (
              <li className="px-3 py-3 text-xs text-gray-500">No bins in this yard.</li>
            )}
          </ul>

          {canEdit && unplaced.length > 0 && (
            <button
              onClick={() => setPlacing(unplaced[0].id)}
              disabled={placing != null}
              className="w-full border-t border-gray-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {placing
                ? 'Placing…'
                : `Place ${unplaced.length} bin${unplaced.length === 1 ? '' : 's'} without a pin`}
            </button>
          )}
        </aside>

        <div className="relative overflow-hidden rounded-lg border border-gray-200">
          <div ref={containerRef} className={cn('w-full', compact ? 'h-[45dvh] min-h-[16rem] lg:h-[calc(100dvh-13rem)]' : 'h-[calc(100dvh-11rem)] min-h-[20rem] lg:h-[28rem]')} />
          {/* The yard switch, over the map on a phone where the list is hidden. */}
          {yards.length > 1 && (
            <div className={cn('absolute left-2 top-2 flex gap-1 rounded-md bg-white/95 p-1 shadow', !compact && 'lg:hidden')}>
              {yards.map((y) => (
                <button
                  key={y}
                  onClick={() => setYard(y)}
                  className={cn('rounded px-2 py-1 text-xs font-medium', y === shownYard ? 'bg-brand-700 text-white' : 'text-gray-700')}
                >
                  {y}
                  {hiddenYards.has(y) && <span className="ml-1 opacity-70">(hidden)</span>}
                </button>
              ))}
            </div>
          )}
          {placing && current && (
            <div className="absolute left-1/2 top-3 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm shadow-lg">
              <MapPin className="h-4 w-4 shrink-0 text-amber-600" />
              <span className="min-w-0">
                Click where <strong>{current.name}</strong> stands
                {current.notes ? <span className="text-gray-500"> — {current.notes}</span> : null}
              </span>
              <button
                onClick={() => setPlacing(null)}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-100"
                aria-label="Stop placing"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-amber-500" /> Grain in it
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-[3px] border-amber-500 bg-white" /> Empty, only planned
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-2 border-sky-600 bg-amber-500" /> Fan running
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-2 border-red-600 bg-amber-500" /> Heat on
        </span>
      </p>

      {save.error && <p className="text-xs text-red-700">{(save.error as Error).message}</p>}

      {openBin && openFull && (
        <BinDetail
          bin={openFull}
          cropYear={cropYear}
          canEdit={canEdit}
          onClose={() => setOpened(null)}
          onWeighIn={() => {
            setOpened(null)
            actions?.weighIn(openFull)
          }}
          onAdd={() => {
            setOpened(null)
            actions?.add(openFull)
          }}
          onMove={() => {
            setOpened(null)
            actions?.move(openFull)
          }}
          onShip={() => {
            setOpened(null)
            actions?.ship(openFull)
          }}
          onRecord={() => {
            setOpened(null)
            actions?.record(openFull)
          }}
          extra={
            openBin.lng != null ? (
              <button
                type="button"
                onClick={() => {
                  setOpened(null)
                  mapRef.current?.flyTo({ center: [openBin.lng!, openBin.lat!], zoom: 18.5 })
                }}
                className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                Show on map
              </button>
            ) : undefined
          }
          pinControls={
            <>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setOpened(null)
                    setPlacing(openBin.id)
                  }}
                  className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  {openBin.lng == null ? 'Place pin' : 'Move pin'}
                </button>
              )}
              {canEdit && openBin.lng != null && (
                <button
                  type="button"
                  onClick={() => {
                    save.mutate({ id: openBin.id, lng: null, lat: null })
                    setOpened(null)
                  }}
                  className="rounded-md px-2.5 py-1.5 text-xs text-red-700 hover:bg-red-50"
                >
                  Clear pin
                </button>
              )}
            </>
          }
        />
      )}
    </div>
  )
}

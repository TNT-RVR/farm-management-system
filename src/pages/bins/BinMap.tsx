import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection } from 'geojson'
import { MapPin, X } from 'lucide-react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { byYardThenNumber, useBinAllocations, useBinOnHand, useBins, type BinRow } from '@/lib/bins'
import { useCrops } from '@/lib/queries'
import { cropColour, readableOn } from '@/lib/crop-colour'
import { contentLabel, useBinContents } from '@/lib/bin-contents'
import { BinDetail } from './BinDetail'
import { farmMapCenter } from '@/lib/farm-setup'

const SRC = 'bin-pins'
const DOT = 'bin-pin-dot'
const LABEL = 'bin-pin-label'

/** The yard everybody means when they say "the yard". */
const DEFAULT_YARD = 'Main Yard'

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
  record: (bin: BinRow) => void
}

export function BinMap({ canEdit, cropYear, actions }: { canEdit: boolean; cropYear: number; actions?: BinActions }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [placing, setPlacing] = useState<string | null>(null)
  const [yard, setYard] = useState<string>(DEFAULT_YARD)
  const [opened, setOpened] = useState<string | null>(null)
  const { data: bins } = useLocatedBins()
  const { data: crops } = useCrops()
  const { data: onhand } = useBinOnHand()
  const { data: allocations } = useBinAllocations(cropYear)
  // What somebody wrote down is in the bin — last year's durum in #2 — and
  // it colours the pin the same as grain the ledger can prove.
  const { data: recorded } = useBinContents()
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

  const yards = useMemo(() => {
    const set = new Set((bins ?? []).map((b) => b.site ?? 'Unsorted'))
    return [...set].sort((a, b) =>
      a === DEFAULT_YARD ? -1 : b === DEFAULT_YARD ? 1 : a.localeCompare(b),
    )
  }, [bins])

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
    return (binId: string): { cropId: string | null; bu: number; planned: boolean; label?: string } | null => {
      const actual = now.get(binId)
      if (actual) return { ...actual, planned: false }
      const rec = (recorded ?? []).find((r) => r.bin_id === binId)
      if (rec) return { cropId: rec.crop_id, bu: rec.bushels ?? 0, planned: false, label: contentLabel(rec) }
      const a = (allocations ?? []).find((x) => x.bin_id === binId)
      return a?.crop_id ? { cropId: a.crop_id, bu: 0, planned: true } : null
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
        return {
          type: 'Feature',
          id: b.id,
          properties: {
            id: b.id,
            // "#13" reads at a glance where "Main Yard - #13" does not fit.
            label: b.name.replace(/^.*?#\s*/, '#') || b.name,
            name: b.name,
            colour,
            // The number sits ON the pin, so it has to survive a pale crop.
            text: readableOn(colour),
          },
          geometry: { type: 'Point', coordinates: [b.lng!, b.lat!] },
        }
      }),
    }),
    [placed, colourOf],
  )

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: farmMapCenter(),
      zoom: 14,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => setReady(true))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource(SRC) as GeoJSONSource | undefined
    if (src) {
      src.setData(data)
      return
    }
    map.addSource(SRC, { type: 'geojson', data })
    map.addLayer({
      id: DOT,
      type: 'circle',
      source: SRC,
      paint: {
        'circle-radius': 11,
        'circle-color': ['get', 'colour'],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    })
    map.addLayer({
      id: LABEL,
      type: 'symbol',
      source: SRC,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': ['get', 'text'] },
    })
  }, [ready, data])

  // Frame the yard you are looking at, and reframe when you switch yards — the
  // two are far enough apart that keeping the old view would leave the map
  // sitting on empty prairie.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || placed.length === 0) return
    const b = new maplibregl.LngLatBounds()
    for (const p of placed) b.extend([p.lng!, p.lat!])
    map.fitBounds(b, { padding: 80, maxZoom: 17.5, duration: 400 })
  }, [ready, shownYard, placed])

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
  }, [ready, save])

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
  }, [ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.getCanvas().style.cursor = placing ? 'crosshair' : ''
  }, [ready, placing])

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[19rem_1fr]">
        {/* The bin list is a desktop sidebar; on a phone the pins are the list. */}
        <aside className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white lg:block">
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
                      className="h-4 w-4 shrink-0 rounded-full border border-black/10"
                      style={{ background: colourOf(b.id) }}
                      title={crop ? crop.name : 'Empty'}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-gray-900">{b.name}</span>
                      <span className="block truncate text-xs text-gray-500">
                        {b.capacity_bu ? `${b.capacity_bu.toLocaleString('en-CA')} bu` : '—'}
                        {c?.label ? ` · ${c.label}` : crop ? ` · ${crop.name}${c?.planned ? ' (planned)' : ''}` : ' · empty'}
                        {b.usual === 'fertilizer' ? ' · fert' : ''}
                      </span>
                    </span>
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
          <div ref={containerRef} className="h-[calc(100dvh-11rem)] min-h-[20rem] w-full lg:h-[28rem]" />
          {/* The yard switch, over the map on a phone where the list is hidden. */}
          {yards.length > 1 && (
            <div className="absolute left-2 top-2 flex gap-1 rounded-md bg-white/95 p-1 shadow lg:hidden">
              {yards.map((y) => (
                <button
                  key={y}
                  onClick={() => setYard(y)}
                  className={cn('rounded px-2 py-1 text-xs font-medium', y === shownYard ? 'bg-brand-700 text-white' : 'text-gray-700')}
                >
                  {y}
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
          onRecord={() => {
            setOpened(null)
            actions?.record(openFull)
          }}
          extra={
            <>
              {openBin.lng != null && (
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
              )}
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

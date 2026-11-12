import { useEffect, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useWaterMutations } from '@/lib/cattle-water'
import { cn } from '@/lib/utils'

/**
 * Where to put one or two troughs in this paddock.
 *
 * The arithmetic is `suggest_trough_sites` in the database — a coverage
 * search over a sample grid, described in its own migration. This is the
 * button, the dashed rings it draws, and the step that turns a suggestion
 * into real pins.
 *
 * The suggestions are deliberately NOT saved. Nothing about them survives
 * closing the panel, because a suggestion the app remembers starts to look
 * like a decision the farm made. Place them or lose them.
 */
export type Suggestion = { ord: number; lon: number; lat: number; gains_ac: number }

const SRC = 'trough-suggest'

export function TroughSuggest({
  map,
  mapReady,
  pastureId,
  canEdit,
  beforeId,
}: {
  map: maplibregl.Map | null
  mapReady: boolean
  pastureId: string
  canEdit: boolean
  beforeId?: string
}) {
  const [picks, setPicks] = useState<Suggestion[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const water = useWaterMutations()

  // Dashed rings where the troughs would go, at the radius they would reach.
  useEffect(() => {
    if (!map || !mapReady) return
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: picks.map((s) => ({
        type: 'Feature' as const,
        properties: { label: String(s.ord) },
        geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
      })),
    }
    const src = map.getSource(SRC) as GeoJSONSource | undefined
    if (src) src.setData(fc)
    else {
      map.addSource(SRC, { type: 'geojson', data: fc })
      map.addLayer(
        {
          id: 'trough-suggest-dot',
          type: 'circle',
          source: SRC,
          paint: {
            'circle-radius': 7,
            'circle-color': '#7c3aed',
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 2,
          },
        },
        beforeId,
      )
      map.addLayer(
        {
          id: 'trough-suggest-label',
          type: 'symbol',
          source: SRC,
          layout: { 'text-field': ['get', 'label'], 'text-size': 10, 'text-offset': [0, -1.4] },
          paint: { 'text-color': '#5b21b6', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
        },
        beforeId,
      )
    }
  }, [map, mapReady, picks, beforeId])

  // Take the layers away with the panel, not just their data: a stale purple
  // dot on another paddock reads as a real trough.
  useEffect(
    () => () => {
      if (!map) return
      for (const id of ['trough-suggest-dot', 'trough-suggest-label']) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(SRC)) map.removeSource(SRC)
    },
    [map],
  )

  if (!canEdit) return null

  const ask = async (count: number) => {
    setBusy(true)
    setNote('')
    const { data, error } = await supabase.rpc('suggest_trough_sites', { p_id: pastureId, p_count: count })
    setBusy(false)
    if (error) {
      setNote('Could not work that out just now.')
      return
    }
    // Postgres numerics arrive as strings, and a string's toLocaleString is a
    // no-op rather than an error — so the acres would quietly print unformatted.
    const rows = ((data ?? []) as Suggestion[]).map((s) => ({
      ord: Number(s.ord),
      lon: Number(s.lon),
      lat: Number(s.lat),
      gains_ac: Number(s.gains_ac),
    }))
    setPicks(rows)
    if (!rows.length) setNote('Every acre here is already within reach of water.')
    else if (rows.length < count) setNote(`One is enough here — a second adds nothing.`)
  }

  const place = async () => {
    setBusy(true)
    for (const s of picks) {
      await water.add.mutateAsync({
        lon: s.lon,
        lat: s.lat,
        kind: 'trough_portable',
        name: picks.length > 1 ? `Suggested trough ${s.ord}` : 'Suggested trough',
        drinkable: true,
      })
    }
    setBusy(false)
    setPicks([])
    setNote('Placed. Drag them where they can actually go.')
  }

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-1">
        <span className="text-[11px] text-gray-600">Suggest troughs:</span>
        {[1, 2].map((n) => (
          <button
            key={n}
            onClick={() => ask(n)}
            disabled={busy}
            className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {n}
          </button>
        ))}
      </div>
      {picks.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {picks.map((s) => (
            <p key={s.ord} className="flex items-center gap-1 text-[11px] text-violet-700">
              <MapPin className="h-3 w-3 shrink-0" />
              {picks.length > 1 ? `${s.ord}: ` : ''}
              brings in {s.gains_ac.toLocaleString('en-CA')} ac
            </p>
          ))}
          <div className="flex gap-1">
            <button
              onClick={place}
              disabled={busy}
              className={cn(
                'rounded-md border border-violet-300 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800',
                'hover:bg-violet-100 disabled:opacity-50',
              )}
            >
              {busy ? 'Placing…' : picks.length > 1 ? 'Place both' : 'Place it'}
            </button>
            <button
              onClick={() => setPicks([])}
              className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
            >
              Clear
            </button>
          </div>
        </div>
      )}
      {note && <p className="mt-0.5 text-[11px] text-gray-500">{note}</p>}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Trash2 } from 'lucide-react'
import { ConfirmDialog, Modal } from '@/components/Modal'
import { DetailList, EditButton, rowClick } from '@/components/RecordEditor'
import { siteDeleteBlocker } from '@/lib/delivery-site-delete'
import { supabase } from '@/lib/supabase'
import { useFields } from '@/lib/queries'
import {
  binsKey,
  fieldKey,
  fieldRoute,
  shopKey,
  siteKey,
  useFieldEntries,
  useFieldPoints,
  usePlaces,
  useRecomputeRoutes,
  useRoadRoutes,
  useSaveFieldEntry,
  useSaveOperatingSetting,
  useSaveSite,
  useSetManualRoute,
  useSetRouteVia,
  useSites,
  useTrailKmh,
  useTrips,
  type FarmPlace,
  type Site,
} from '@/lib/hauling-data'
import { parseLatLng, type LatLng, type StartKey, type Trip } from '@/lib/road-routes'
import { TRAIL_KMH_DEFAULT } from '@/lib/trail-router'
import { HelpNote } from '@/components/HelpNote'
import { cn } from '@/lib/utils'
import { Card, SettingsGroup, input } from './ui'
import { RouteMap } from './RouteMap'
import { FieldLink, Sources, n1 } from '../fertilizer/savings/ui'

const BASIS: Record<Trip['basis'], { label: string; cls: string }> = {
  road: { label: 'road', cls: 'bg-gray-100 text-gray-600' },
  trail: { label: 'road + trail', cls: 'bg-orange-100 text-orange-800' },
  straight: { label: 'road + straight × 1.3', cls: 'bg-amber-100 text-amber-800' },
  manual: { label: 'typed', cls: 'bg-blue-100 text-blue-800' },
}

function Method({ t }: { t: Trip | null }) {
  if (!t) return <span className="text-[11px] text-gray-400">no location</span>
  const b = BASIS[t.basis]
  return (
    <span className={cn('whitespace-nowrap rounded px-1.5 py-px text-[10px] font-medium', b.cls)} title={t.note ?? undefined}>
      {b.label}
    </span>
  )
}

const ENTRY_LABEL: Record<string, string> = { pin: 'pin', suggested: 'suggested', centroid: 'field centre' }

/**
 * How far every field is: from the shop (field work, spraying, every machine
 * going out) and to the bins (grain), each to the field's entry pin, and from
 * each entry to every elevator. The map is where the pins and trails are set;
 * a distance the router gets wrong can still be typed in.
 */
export function DistancesTab({ isManager }: { isManager: boolean }) {
  const { data: fields } = useFields()
  const { data: points } = useFieldPoints()
  const { data: sites } = useSites()
  const { data: routes } = useRoadRoutes()
  const { data: entries } = useFieldEntries()
  const { trip } = useTrips()
  const { shop, bins, pit } = usePlaces()
  const recompute = useRecomputeRoutes()
  const [selected, setSelected] = useState<string | null>(null)
  const [start, setStart] = useState<StartKey>(shopKey)
  const elevators = (sites ?? []).filter((s) => s.active)
  const newest = useMemo(
    () => (routes ?? []).filter((r) => r.from_key === shopKey || r.from_key === binsKey).reduce((m, r) => (r.computed_at > m ? r.computed_at : m), ''),
    [routes],
  )

  const rows = useMemo(
    () =>
      (fields ?? [])
        .map((f) => {
          const k = fieldKey(f.id)
          const pin = entries?.get(f.id)
          const r = fieldRoute(routes, shopKey, f.id)
          const end: LatLng | null = pin ?? (r ? { lat: Number(r.to_lat), lng: Number(r.to_lng) } : (points?.get(f.id) ?? null))
          return { f, shopT: trip(shopKey, k), binsT: trip(binsKey, k), end, basis: pin ? 'pin' : (r?.entry_basis ?? null) }
        })
        .sort((a, b) => (a.shopT?.km ?? 1e9) - (b.shopT?.km ?? 1e9)),
    [fields, trip, points, entries, routes],
  )
  const flagged = rows.filter((r) => r.shopT?.basis === 'straight')
  const pick = rows.find((r) => r.f.id === selected) ?? null

  return (
    <div className="space-y-4">
      <Card
        title="Shop, bins, field entries and trails"
        right={
          isManager && (
            <button
              type="button"
              onClick={() => recompute.mutate(false)}
              disabled={recompute.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              title="Works every route out again. Only points the router has not seen before (a moved pin, a new trail) cost a request; it also runs by itself every morning."
            >
              <RefreshCw className={cn('h-3 w-3', recompute.isPending && 'animate-spin')} />
              Check now
            </button>
          )
        }
      >
        <Sources
          sources={[
            { label: 'Road router: OSRM on OpenStreetMap roads', href: 'https://project-osrm.org/' },
            { label: 'Shop: the Google My Map point “Shop Yard- SE 5-71-13”' },
            { label: 'Bins: centre of the Main Yard bins' },
            { label: 'Trails and entry pins: drawn here' },
          ]}
        />
        {recompute.isError && <p className="mb-2 text-xs text-red-700">{(recompute.error as Error).message}</p>}
        <RouteMap isManager={isManager} selected={selected} onSelect={setSelected} start={start} onStart={setStart} />
        {pick && <PickedField row={pick} isManager={isManager} onClose={() => setSelected(null)} />}
        {flagged.length > 0 && (
          <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            {flagged.length} field{flagged.length === 1 ? '' : 's'} the road does not reach: {flagged.map((r) => r.f.name).join(', ')}. The last bit is a straight line × 1.3 until
            a trail is drawn from the road to the field, or the distance typed in.
          </p>
        )}
        <HelpNote
          className="mt-2"
          summary={
            <>
              Tap a field to see its route. Drag a pin to move it; a dashed pin is the router’s suggestion.
              {newest && ` Last worked out ${new Date(newest).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}.`}
            </>
          }
          title="How a route is found"
        >
          The road router (OpenStreetMap’s roads, the same roads Google draws) goes as close to the field’s entry as the roads go. If the road
          ends within 150 m of the entry, that is the route. If not, it finishes along the farm trails drawn here — road to whichever trailhead
          makes the whole trip shortest, then the trail. With no trail to finish on, the road is followed as close to the field as it goes and the
          rest is a straight line × 1.3, flagged in amber, until somebody draws the trail or types the distance. A field without a pin is measured
          to the point on its boundary nearest where the road arrives; drag the dashed pin to the real gate to set it.
        </HelpNote>
      </Card>

      <Card title="Distances to each field">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-2 py-1 font-medium">Field</th>
                <th className="px-2 py-1 text-right font-medium" title="Field work, spraying, every pass: from the shop to the field's entry">
                  From the shop
                </th>
                <th className="px-2 py-1 font-medium" />
                <th className="px-2 py-1 text-right font-medium" title="Grain: from the field's entry to the bins">
                  To the bins
                </th>
                <th className="px-2 py-1 font-medium" />
                <th className="px-2 py-1 font-medium">Entry</th>
                {elevators.map((s) => (
                  <th key={s.id} className="px-2 py-1 text-right font-medium" title={`From the field's entry to ${s.name}`}>
                    To {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ f, shopT, binsT, end, basis }) => (
                <tr key={f.id} className={cn(f.id === selected && 'bg-yellow-50')}>
                  <td className="px-2 py-1 text-gray-800">
                    <button type="button" onClick={() => setSelected(f.id)} className="text-left hover:underline" title="Show on the map">
                      {f.name}
                    </button>{' '}
                    <span className="text-[10px] text-gray-400">
                      <FieldLink id={f.id} name="work" to="work" />
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <span className="font-medium">{shopT ? n1(shopT.km) : '—'}</span>
                    {shopT?.minutes != null && <span className="ml-1 text-gray-500">{Math.round(shopT.minutes)} min</span>}
                  </td>
                  <td className="px-2 py-1">
                    <Method t={shopT} />
                    {isManager && shop && end && <ManualKm from={shopKey} to={fieldKey(f.id)} fromPt={shop} toPt={end} trip={shopT} />}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <span className="font-medium">{binsT ? n1(binsT.km) : '—'}</span>
                    {binsT?.minutes != null && <span className="ml-1 text-gray-500">{Math.round(binsT.minutes)} min</span>}
                  </td>
                  <td className="px-2 py-1">
                    <Method t={binsT} />
                    {isManager && bins && end && <ManualKm from={binsKey} to={fieldKey(f.id)} fromPt={bins} toPt={end} trip={binsT} />}
                  </td>
                  <td className={cn('px-2 py-1 text-[11px]', basis === 'pin' ? 'text-green-700' : 'text-gray-400')}>{basis ? ENTRY_LABEL[basis] ?? basis : '—'}</td>
                  {elevators.map((s) => {
                    const e = trip(fieldKey(f.id), siteKey(s.id))
                    return (
                      <td key={s.id} className={cn('px-2 py-1 text-right tabular-nums', e?.basis === 'straight' ? 'text-amber-700' : 'text-gray-600')} title={e?.note ?? undefined}>
                        {e ? `${n1(e.km)} km` : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">
          One way. From the shop is what every pass’s road fuel uses (Fuel, Spreading, the Work list, the books); to the bins is what trucking the crop
          uses. Elevators are from the field’s entry, coming out the same way the field is reached.
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <PlaceCard placeKey="shop" title="The shop" place={shop} hint="Field work, spraying and every machine going out to a field start here and come back here." isManager={isManager} />
        <PlaceCard placeKey="bins" title="The bins" place={bins} hint="Grain is trucked from the field to here, and from here to an elevator." isManager={isManager} />
        <PlaceCard placeKey="silage_pit" title="The silage pit" place={pit} hint="Only the silage haul is measured from here." isManager={isManager} />
      </div>
      <TrailSpeedCard isManager={isManager} />
      <ElevatorsCard sites={sites ?? []} isManager={isManager} />
    </div>
  )
}

/** The picked field: how each route was made, and its entry pin. */
function PickedField({
  row,
  isManager,
  onClose,
}: {
  row: { f: { id: string; name: string; route_via?: string | null }; shopT: Trip | null; binsT: Trip | null; basis: string | null }
  isManager: boolean
  onClose: () => void
}) {
  const { data: routes } = useRoadRoutes()
  const { data: entries } = useFieldEntries()
  const save = useSaveFieldEntry()
  const recompute = useRecomputeRoutes()
  const setVia = useSetRouteVia()
  const via = row.f.route_via === 'trails' ? 'trails' : 'auto'
  const r = fieldRoute(routes, shopKey, row.f.id)
  const pinned = entries?.has(row.f.id)
  const after = { onSuccess: () => recompute.mutate(false) }
  const one = (label: string, t: Trip | null) => (
    <div className="min-w-0 flex-1 basis-64">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-gray-500">{label}</span>
        <span className="font-semibold tabular-nums">{t ? `${n1(t.km)} km` : '—'}</span>
        {t?.minutes != null && <span className="tabular-nums text-gray-500">{Math.round(t.minutes)} min</span>}
        <Method t={t} />
      </div>
      {t?.parts && (
        <p className="tabular-nums text-gray-500">
          {n1(t.parts.road)} km road
          {t.parts.trail > 0 && ` + ${n1(t.parts.trail)} km trail`}
          {t.parts.connector >= 0.05 && ` + ${n1(t.parts.connector)} km ${t.basis === 'straight' ? 'straight × 1.3' : 'off the road'}`}
        </p>
      )}
      {t?.note && <p className={cn(t.basis === 'straight' ? 'text-amber-800' : 'text-gray-500')}>{t.note}</p>}
    </div>
  )
  return (
    <div className="mt-2 rounded-md border border-yellow-300 bg-yellow-50/60 p-2.5 text-xs">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900">{row.f.name}</span>
        <button type="button" onClick={onClose} className="text-gray-500 underline">
          close
        </button>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {one('From the shop', row.shopT)}
        {one('To the bins', row.binsT)}
      </div>
      {/* Sam, 7 Oct 2026: 5, 11 and 12 go by the farm's trails, not the main road. */}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-yellow-200 pt-2">
        <span className="text-gray-600">Route:</span>
        {(
          [
            ['auto', 'Fastest (road where it reaches)'],
            ['trails', 'Our trails'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            disabled={!isManager || setVia.isPending}
            onClick={() => k !== via && setVia.mutate({ fieldId: row.f.id, via: k }, after)}
            className={cn('rounded-full border px-2.5 py-0.5', via === k ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50', !isManager && 'cursor-default')}
          >
            {label}
          </button>
        ))}
        {via === 'trails' && (
          <span className="text-gray-500">Along the trails from the shop, or from the nearest trailhead on the road; the road only if no trail reaches the field.</span>
        )}
        {setVia.isError && <span className="text-red-700">{(setVia.error as Error).message}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-yellow-200 pt-2">
        <span className="text-gray-600">
          Entry:{' '}
          {pinned
            ? 'a pin somebody dropped.'
            : row.basis === 'suggested'
              ? 'suggested — the boundary point nearest where the road (or trail) arrives.'
              : row.basis === 'centroid'
                ? 'the middle of the field (no boundary).'
                : 'not worked out yet.'}
        </span>
        {isManager && !pinned && r && r.entry_basis === 'suggested' && (
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate({ fieldId: row.f.id, at: { lat: Number(r.to_lat), lng: Number(r.to_lng) }, note: 'confirmed the suggestion' }, after)}
            className="rounded bg-brand-700 px-2 py-0.5 font-semibold text-white disabled:opacity-50"
          >
            Use the suggested entry
          </button>
        )}
        {isManager && pinned && (
          <button type="button" disabled={save.isPending} onClick={() => save.mutate({ fieldId: row.f.id, at: null }, after)} className="text-gray-600 underline">
            take the pin away (back to the suggestion)
          </button>
        )}
        {isManager && <span className="text-gray-400">or drag the pin on the map to the gate.</span>}
        {save.isError && <span className="text-red-700">{(save.error as Error).message}</span>}
      </div>
    </div>
  )
}

/** Type a distance where the router is wrong, or put it back to the router's. */
function ManualKm({ from, to, fromPt, toPt, trip }: { from: string; to: string; fromPt: LatLng; toPt: LatLng; trip: Trip | null }) {
  const set = useSetManualRoute()
  const [open, setOpen] = useState(false)
  const [km, setKm] = useState('')
  const [min, setMin] = useState('')
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="ml-1.5 text-[11px] text-brand-700 underline decoration-dotted">
        {trip?.basis === 'manual' ? 'change' : 'type'}
      </button>
    )
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      <input value={km} onChange={(e) => setKm(e.target.value)} placeholder="km" inputMode="decimal" className={cn(input, 'w-14 px-1 py-0.5 text-xs')} />
      <input value={min} onChange={(e) => setMin(e.target.value)} placeholder="min" inputMode="decimal" className={cn(input, 'w-14 px-1 py-0.5 text-xs')} />
      <button
        type="button"
        disabled={!(Number(km) > 0) || set.isPending}
        onClick={() => set.mutate({ from, to, fromPt, toPt, km: Number(km), minutes: min.trim() ? Number(min) : null }, { onSuccess: () => setOpen(false) })}
        className="rounded bg-brand-700 px-1.5 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50"
      >
        Save
      </button>
      {trip?.basis === 'manual' && (
        <button type="button" onClick={() => set.mutate({ from, to, fromPt, toPt, km: null, minutes: null }, { onSuccess: () => setOpen(false) })} className="text-[11px] underline">
          back to the router
        </button>
      )}
      <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-gray-500 underline">
        cancel
      </button>
    </span>
  )
}

function PlaceCard({
  placeKey,
  title,
  place,
  hint,
  isManager,
}: {
  placeKey: 'shop' | 'bins' | 'silage_pit'
  title: string
  place: FarmPlace | null
  hint: string
  isManager: boolean
}) {
  const save = useSaveOperatingSetting()
  const recompute = useRecomputeRoutes()
  const [text, setText] = useState('')
  const parsed = parseLatLng(text)
  return (
    <Card title={title}>
      <p className="text-sm text-gray-700">
        {place ? (
          <>
            {place.label} · <span className="tabular-nums">{place.lat.toFixed(5)}, {place.lng.toFixed(5)}</span>{' '}
            <a href={`https://www.google.com/maps?q=${place.lat},${place.lng}`} target="_blank" rel="noreferrer" className="text-xs text-brand-700 underline">
              see it on Google Maps
            </a>
          </>
        ) : (
          'Not set.'
        )}
      </p>
      {place?.note && <p className="mt-0.5 text-xs text-amber-700">{place.note}</p>}
      <p className="mt-1 text-[11px] text-gray-400">{hint} Drag its pin on the map, or paste a location.</p>
      {isManager && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste lat, lng or a Google Maps link" className={cn(input, 'min-w-0 flex-1 basis-56 text-xs')} />
          <button
            type="button"
            disabled={!parsed || save.isPending}
            onClick={() =>
              save.mutate(
                { key: placeKey, value: { ...parsed!, label: `${title.replace(/^The /, '')} (set by hand)`, note: null } },
                {
                  onSuccess: () => {
                    setText('')
                    recompute.mutate(false)
                  },
                },
              )
            }
            className="rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            Move it
          </button>
          {text && !parsed && <span className="text-xs text-amber-700">Not a location in southern Alberta.</span>}
        </div>
      )}
    </Card>
  )
}

function TrailSpeedCard({ isManager }: { isManager: boolean }) {
  const { kmh } = useTrailKmh()
  return (
    <Card title="On a farm trail">
      <SettingsGroup
        settingKey="trail_speed"
        fields={[{ key: 'kmh', label: 'Speed on a trail', unit: 'km/h', hint: 'for the trail part of a trip, and the last straight bit where there is no trail' }]}
        values={{ kmh }}
        defaults={{ kmh: TRAIL_KMH_DEFAULT }}
        isManager={isManager}
      />
      <p className="mt-1 text-[11px] text-gray-400">Times change on the next “Check now” or the morning run.</p>
    </Card>
  )
}

function ElevatorsCard({ sites, isManager }: { sites: Site[]; isManager: boolean }) {
  const [adding, setAdding] = useState(false)
  return (
    <Card
      title="Elevators and plants"
      right={
        isManager && (
          <button type="button" onClick={() => setAdding(true)} className="text-xs text-brand-700 underline">
            Add one
          </button>
        )
      }
    >
      <ul className="divide-y divide-gray-100 text-sm">
        {sites.map((s) => (
          <SiteRow key={s.id} site={s} isManager={isManager} />
        ))}
        {adding && <SiteRow site={null} isManager={isManager} onDone={() => setAdding(false)} />}
      </ul>
      <p className="mt-2 text-[11px] text-gray-400">
        The same list the scale uses for loads that go straight from the field. Drag its E pin on the map above onto the elevator itself, or
        paste a Google Maps link: a pin in the middle of town is a few km out.
      </p>
    </Card>
  )
}

/** What still points at a site: loads hauled there, and fields planned to go there. */
function useSiteUses(id: string) {
  return useQuery({
    queryKey: ['delivery_site_uses', id],
    queryFn: async () => {
      const [loads, plans] = await Promise.all([
        supabase.from('bin_loads').select('id', { count: 'exact', head: true }).eq('delivery_site_id', id),
        supabase.from('field_haul_plans').select('id', { count: 'exact', head: true }).eq('delivery_site_id', id),
      ])
      if (loads.error) throw loads.error
      if (plans.error) throw plans.error
      return { loads: loads.count ?? 0, haulPlans: plans.count ?? 0 }
    },
  })
}

/**
 * Sam, 7 Oct 2026: a site opens to its detail, and one nothing uses can be
 * deleted; one with loads or haul plans can only be retired.
 */
function SiteDetail({ site, isManager, onEdit, onClose }: { site: Site; isManager: boolean; onEdit: () => void; onClose: () => void }) {
  const qc = useQueryClient()
  const save = useSaveSite()
  const { data: uses, error: usesError } = useSiteUses(site.id)
  const blocker = uses ? siteDeleteBlocker(uses) : null
  const [confirming, setConfirming] = useState(false)
  const del = useMutation({
    mutationFn: async () => {
      // The cached routes to it first (managers only, like the Viterra clean-up
      // of 6 Oct); then the site, which the database refuses if a load appeared since.
      for (const col of ['from_key', 'to_key']) {
        const { error } = await supabase.from('road_routes').delete().like(col, `%${site.id}%`)
        if (error) throw error
      }
      const { error } = await supabase.from('delivery_sites').delete().eq('id', site.id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['delivery_sites'] })
      void qc.invalidateQueries({ queryKey: ['road_routes'] })
      setConfirming(false)
      onClose()
    },
  })
  if (confirming)
    return (
      <ConfirmDialog
        title="Delete elevator"
        message={`Delete ${site.name}? Its distances go with it.`}
        busy={del.isPending}
        error={del.error ? (del.error as Error).message : null}
        onClose={() => setConfirming(false)}
        onConfirm={() => del.mutate()}
      />
    )
  return (
    <Modal title={site.name} onClose={onClose}>
      <DetailList
        rows={[
          ['Kind', site.kind],
          ['Status', site.active ? 'In use' : 'Retired'],
          [
            'Location',
            site.lat != null ? (
              <a href={`https://www.google.com/maps?q=${site.lat},${site.lng}`} target="_blank" rel="noreferrer" className="tabular-nums text-brand-700 underline">
                {site.lat.toFixed(5)}, {site.lng?.toFixed(5)}
              </a>
            ) : (
              'Not set — no distances'
            ),
          ],
          ['Location note', site.location_note],
          ['Loads hauled here', uses ? String(uses.loads) : null],
          ['Field haul plans', uses ? String(uses.haulPlans) : null],
        ]}
      />
      {usesError && <p className="mt-2 text-xs text-red-700">{(usesError as Error).message}</p>}
      {isManager && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {blocker && <span className="mr-auto text-xs text-gray-500">{blocker}; retire it instead of deleting.</span>}
          {save.isError && <span className="text-xs text-red-700">{(save.error as Error).message}</span>}
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate({ id: site.id, name: site.name, lat: site.lat, lng: site.lng, location_note: site.location_note, active: !site.active })}
            className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {site.active ? 'Retire' : 'Bring back'}
          </button>
          <button
            type="button"
            disabled={!uses || !!blocker}
            onClick={() => {
              del.reset()
              setConfirming(true)
            }}
            className="flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <EditButton onClick={onEdit} />
        </div>
      )}
    </Modal>
  )
}

function SiteRow({ site, isManager, onDone }: { site: Site | null; isManager: boolean; onDone?: () => void }) {
  const save = useSaveSite()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(site == null)
  const [name, setName] = useState(site?.name ?? '')
  const [where, setWhere] = useState(site?.lat != null ? `${site.lat}, ${site.lng}` : '')
  const parsed = parseLatLng(where)
  if (!editing && site)
    return (
      <li onClick={rowClick(() => setOpen(true))} className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 hover:bg-gray-50">
        {open && (
          <SiteDetail
            site={site}
            isManager={isManager}
            onClose={() => setOpen(false)}
            onEdit={() => {
              setOpen(false)
              setEditing(true)
            }}
          />
        )}
        <span className={cn('font-medium', site.active ? 'text-gray-900' : 'text-gray-400 line-through')}>{site.name}</span>
        <span className="text-xs text-gray-500">{site.kind}</span>
        {site.lat != null ? (
          <a href={`https://www.google.com/maps?q=${site.lat},${site.lng}`} target="_blank" rel="noreferrer" className="text-xs tabular-nums text-brand-700 underline">
            {site.lat.toFixed(4)}, {site.lng?.toFixed(4)}
          </a>
        ) : (
          <span className="text-xs text-amber-700">no location — no distances</span>
        )}
        {site.location_note && <span className="text-xs text-amber-700">{site.location_note}</span>}
        {isManager && (
          <button type="button" onClick={() => setEditing(true)} className="ml-auto text-xs text-brand-700 underline">
            edit
          </button>
        )}
      </li>
    )
  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. the elevator in town" className={cn(input, 'w-48 text-xs')} />
      <input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="lat, lng or a Google Maps link" className={cn(input, 'min-w-0 flex-1 basis-56 text-xs')} />
      <button
        type="button"
        disabled={!name.trim() || (where.trim() !== '' && !parsed) || save.isPending}
        onClick={() =>
          save.mutate(
            {
              id: site?.id,
              name,
              lat: parsed?.lat ?? null,
              lng: parsed?.lng ?? null,
              // A pin somebody dropped is no longer the town-centre guess.
              location_note: parsed && site?.lat != null && parsed.lat === site.lat && parsed.lng === site.lng ? site.location_note : null,
            },
            {
              onSuccess: () => {
                setEditing(false)
                onDone?.()
              },
            },
          )
        }
        className="rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
      >
        Save
      </button>
      {site && (
        <button type="button" onClick={() => save.mutate({ id: site.id, name: site.name, lat: site.lat, lng: site.lng, location_note: site.location_note, active: !site.active })} className="text-xs text-gray-500 underline">
          {site.active ? 'retire' : 'bring back'}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setEditing(false)
          onDone?.()
        }}
        className="text-xs text-gray-500 underline"
      >
        cancel
      </button>
      {save.isError && <span className="text-xs text-red-700">{(save.error as Error).message}</span>}
    </li>
  )
}

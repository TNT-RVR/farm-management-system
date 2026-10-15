import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MOVED_M,
  OSRM_AGENT,
  binsKey,
  fieldKey,
  metresBetween,
  parseSnapTable,
  pitKey,
  planSnapRequests,
  ptKey,
  roundPt,
  shopKey,
  siteKey,
  snapTableUrl,
  type LatLng,
  type Place,
  type RouteRow,
  type Snap,
  type SnapRequest,
} from '../../src/lib/road-routes.ts'
import {
  TRAIL_KMH_DEFAULT,
  buildTrailGraph,
  planFrom,
  planRoute,
  trailFromGeoJson,
  viaLegs,
  withLegs,
  type Boundary,
  type FieldEnd,
  type PlanResult,
  type RoutePlan,
  type TrailLine,
} from '../../src/lib/trail-router.ts'

// Keeps road_routes current: shop → every field and bins → every field (to
// the field's entry pin, or the suggested one), field → every elevator, and
// bins → every elevator. Once the silage pit has a pin (operating_settings
// 'silage_pit'), pit → every field as well, for the silage haul. src/lib/trail-router.ts decides each route; this
// asks the router what it needs and writes the answers.
//
// Every answer the router gives is cached in road_snaps by origin and point,
// so a run asks only about points it has never seen — a pin dropped, a trail
// drawn, the shop moved — and an ordinary day is a few reads and no requests
// at all. The router is OSRM's public demo server, which asks for no more
// than a request a second and an honest User-Agent. A run that runs out of
// time leaves the fields it could not finish as they were; the cache keeps
// what it learnt, so the next run carries on from there.

const GAP_MS = 1_100
/** Road, then trails, then the search round the field, then the elevators: at most this many rounds of asking. */
const ROUNDS = 5

export type RoadRoutesResult = { ok: boolean; computed: number; stale: number; requests: number; detail: string }

type SnapRow = {
  id: string
  from_key: string
  from_lat: number
  from_lng: number
  lat: number
  lng: number
  snap_lat: number | null
  snap_lng: number | null
  snap_m: number | string | null
  road_km: number | string | null
  road_min: number | string | null
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function placeOf(key: string, v: unknown): Place | null {
  const o = v as { lat?: unknown; lng?: unknown } | null
  const lat = num(o?.lat)
  const lng = num(o?.lng)
  return lat != null && lng != null ? { key, lat, lng } : null
}

function boundaryOf(geometry: unknown): Boundary | null {
  const g = geometry as { type?: string; coordinates?: unknown } | null
  if (g?.type === 'MultiPolygon') return g.coordinates as Boundary
  if (g?.type === 'Polygon') return [g.coordinates as Boundary[number]]
  return null
}

async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if ((data ?? []).length < 1000) return out
  }
}

export async function runRoadRoutes(sb: SupabaseClient, opts: { force?: boolean; budgetMs?: number } = {}): Promise<RoadRoutesResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 20_000)
  const [settings, points, active, entries, bounds, sites, trailRows, manual] = await Promise.all([
    sb.from('operating_settings').select('key, value').in('key', ['shop', 'bins', 'yard', 'trail_speed', 'silage_pit']),
    sb.from('field_points').select('id, lat, lng'),
    sb.from('fields').select('id, route_via, route_through').eq('active', true),
    sb.from('field_entries').select('field_id, lat, lng'),
    sb.from('field_boundaries_geojson').select('field_id, geometry').is('valid_to', null),
    sb.from('delivery_sites').select('id, lat, lng').eq('active', true).not('lat', 'is', null).not('lng', 'is', null),
    sb.from('farm_trails_geojson').select('id, name, geometry'),
    sb.from('road_routes').select('from_key, to_key').eq('source', 'manual'),
  ])
  for (const r of [settings, points, active, entries, bounds, sites, trailRows, manual]) if (r.error) throw new Error(r.error.message)
  const snapRows = await readAll<SnapRow>((a, b) => sb.from('road_snaps').select('*').order('id').range(a, b))

  const setting = new Map((settings.data ?? []).map((r) => [r.key as string, r.value as unknown]))
  const shop = placeOf(shopKey, setting.get('shop'))
  // 'yard' was the bins under its old name.
  const bins = placeOf(binsKey, setting.get('bins') ?? setting.get('yard'))
  if (!shop || !bins) {
    const detail = `No ${!shop ? 'shop' : 'bins'} location set (operating_settings.${!shop ? 'shop' : 'bins'})`
    return { ok: false, computed: 0, stale: 0, requests: 0, detail }
  }
  // Optional: only the silage haul measures from it.
  const pit = placeOf(pitKey, setting.get('silage_pit'))
  const homes: Place[] = pit ? [shop, bins, pit] : [shop, bins]
  const trailKmh = num((setting.get('trail_speed') as { kmh?: unknown } | undefined)?.kmh) ?? TRAIL_KMH_DEFAULT
  const elevators: Place[] = (sites.data ?? []).map((s) => ({ key: siteKey(s.id as string), lat: Number(s.lat), lng: Number(s.lng) }))
  // Via points a field's route must pass through (fields.route_through): each is
  // asked about as an origin of its own, for the leg from it to the next.
  const viaKey = (fieldId: string, i: number) => `via:${fieldId}:${i}`
  const viasOf = new Map<string, LatLng[]>()
  for (const f of active.data ?? []) {
    const pts = (Array.isArray(f.route_through) ? f.route_through : [])
      .map((p: { lat?: unknown; lng?: unknown }) => ({ lat: Number(p?.lat), lng: Number(p?.lng) }))
      .filter((p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    if (pts.length) viasOf.set(f.id as string, pts)
  }
  const viaPlaces: Place[] = [...viasOf].flatMap(([id, pts]) => pts.map((p, i) => ({ key: viaKey(id, i), lat: p.lat, lng: p.lng })))
  const origins = new Map<string, Place>([...homes, ...elevators, ...viaPlaces].map((p) => [p.key, p]))

  const live = new Set((active.data ?? []).map((f) => f.id as string))
  // Fields set to take the farm's trails even where the road is shorter.
  const viaTrails = new Set((active.data ?? []).filter((f) => f.route_via === 'trails').map((f) => f.id as string))
  const centre = new Map((points.data ?? []).map((p) => [p.id as string, { lat: Number(p.lat), lng: Number(p.lng) }]))
  const pin = new Map((entries.data ?? []).map((e) => [e.field_id as string, { lat: Number(e.lat), lng: Number(e.lng) }]))
  const boundary = new Map((bounds.data ?? []).map((b) => [b.field_id as string, boundaryOf(b.geometry)]))
  const fields: { id: string; end: FieldEnd }[] = [...live]
    .map((id) => ({ id, end: { pin: pin.get(id) ?? null, centroid: centre.get(id) ?? null, boundary: boundary.get(id) ?? null } }))
    .filter((f) => f.end.pin || f.end.centroid)
  const graph = buildTrailGraph((trailRows.data ?? []).map((t) => trailFromGeoJson(t.id as string, t.name as string, t.geometry)).filter((t): t is TrailLine => !!t))
  const typed = new Set((manual.data ?? []).map((r) => `${r.from_key}>${r.to_key}`))

  // The cache, by origin. An answer from where an origin used to be is no
  // use — it is dropped, and asked again from where it is now.
  const cache = new Map<string, Map<string, Snap>>()
  const moved: string[] = []
  for (const r of snapRows) {
    const o = origins.get(r.from_key)
    if (!o || metresBetween(o, { lat: r.from_lat, lng: r.from_lng }) > MOVED_M) {
      if (o) moved.push(r.id)
      continue
    }
    if (opts.force) continue
    const m = cache.get(r.from_key) ?? new Map<string, Snap>()
    m.set(ptKey(r), { lat: r.lat, lng: r.lng, snapLat: r.snap_lat, snapLng: r.snap_lng, snapM: num(r.snap_m), roadKm: num(r.road_km), roadMin: num(r.road_min) })
    cache.set(r.from_key, m)
  }
  for (let i = 0; i < moved.length; i += 200) await sb.from('road_snaps').delete().in('id', moved.slice(i, i + 200))
  const lookup = (origin: string) => (p: LatLng) => cache.get(origin)?.get(ptKey(p))

  type FieldPlans = { shop: PlanResult; bins: PlanResult; pit: PlanResult | null }
  const compute = () => {
    const needs = new Map<string, Map<string, LatLng>>()
    const need = (origin: string, pts: LatLng[]) => {
      const m = needs.get(origin) ?? new Map<string, LatLng>()
      for (const p of pts) m.set(ptKey(p), roundPt(p))
      needs.set(origin, m)
    }
    const plans = new Map<string, FieldPlans>()
    for (const f of fields) {
      const one = (st: Place): PlanResult => {
        const vias = viasOf.get(f.id)
        if (!vias) {
          const r = planRoute({ start: st, end: f.end, snap: lookup(st.key), trails: graph, trailKmh, preferTrails: viaTrails.has(f.id) })
          if (r.need.length) need(st.key, r.need)
          return r
        }
        // Through the via points: the road to each in turn, then on to the field from the last.
        const legFrom = (i: number) => (i === 0 ? st.key : viaKey(f.id, i - 1))
        const legs = viaLegs(vias, (i) => lookup(legFrom(i)))
        if (!legs) return { plan: null, need: [], why: 'the road does not reach one of the via points' }
        if (legs.need.length) {
          for (const n of legs.need) need(legFrom(n.from), [n.at])
          return { plan: null, need: legs.need.map((n) => n.at) }
        }
        const lastKey = viaKey(f.id, vias.length - 1)
        const r = planRoute({ start: vias[vias.length - 1], end: f.end, snap: lookup(lastKey), trails: graph, trailKmh, preferTrails: viaTrails.has(f.id) })
        if (r.need.length) need(lastKey, r.need)
        return r.plan ? { ...r, plan: withLegs(r.plan, legs) } : r
      }
      const p = { shop: one(shop), bins: one(bins), pit: pit ? one(pit) : null }
      plans.set(f.id, p)
      // Grain leaves for an elevator the way it came in to the bins.
      if (p.bins.plan) for (const e of elevators) if (!lookup(e.key)(p.bins.plan.approach)) need(e.key, [p.bins.plan.approach])
    }
    for (const e of elevators) if (!lookup(binsKey)(e)) need(binsKey, [e])
    return { plans, needs }
  }

  let requests = 0
  const errors: string[] = []
  let outOfTime = false
  const ask = async (req: SnapRequest) => {
    if (Date.now() + GAP_MS > deadline) {
      outOfTime = true
      return
    }
    if (requests > 0) await new Promise((r) => setTimeout(r, GAP_MS))
    requests++
    try {
      const res = await fetch(snapTableUrl(req), { headers: { 'User-Agent': OSRM_AGENT } })
      if (!res.ok) throw new Error(`router ${res.status}`)
      const now = new Date().toISOString()
      const rows = parseSnapTable(await res.json(), req).map(({ origin, snap }) => {
        const m = cache.get(origin.key) ?? new Map<string, Snap>()
        m.set(ptKey(snap), snap)
        cache.set(origin.key, m)
        return {
          from_key: origin.key,
          from_lat: origin.lat,
          from_lng: origin.lng,
          lat: snap.lat,
          lng: snap.lng,
          snap_lat: snap.snapLat,
          snap_lng: snap.snapLng,
          snap_m: snap.snapM,
          road_km: snap.roadKm,
          road_min: snap.roadMin,
          computed_at: now,
        }
      })
      const { error } = await sb.from('road_snaps').upsert(rows, { onConflict: 'from_key,lat,lng' })
      if (error) throw new Error(error.message)
    } catch (e) {
      errors.push((e as Error).message.slice(0, 120))
    }
  }

  for (let round = 0; round < ROUNDS && !outOfTime && errors.length < 3; round++) {
    const { needs } = compute()
    if (!needs.size) break
    // The shop, the bins (and the pit) are asked together: one request answers all of them.
    const homePts = homes.flatMap((h) => [...(needs.get(h.key)?.values() ?? [])])
    const sitePts = elevators.flatMap((e) => [...(needs.get(e.key)?.values() ?? [])])
    // Each via point on its own: only its own field's next leg is asked from it.
    const viaReqs = viaPlaces.flatMap((v) => {
      const pts = [...(needs.get(v.key)?.values() ?? [])]
      return pts.length ? planSnapRequests([v], pts) : []
    })
    const reqs = [...(homePts.length ? planSnapRequests(homes, homePts) : []), ...(sitePts.length ? planSnapRequests(elevators, sitePts) : []), ...viaReqs]
    for (const req of reqs) {
      await ask(req)
      if (outOfTime) break
    }
  }

  // Write every route the cache can now answer in full.
  const { plans } = compute()
  const now = new Date().toISOString()
  const rows: RouteRow[] = []
  const row = (from: Place, toKey: string, to: LatLng, p: RoutePlan): RouteRow => ({
    from_key: from.key,
    to_key: toKey,
    from_lat: from.lat,
    from_lng: from.lng,
    to_lat: to.lat,
    to_lng: to.lng,
    distance_km: p.km,
    duration_min: p.minutes,
    source: 'osrm',
    computed_at: now,
    road_km: p.roadKm,
    trail_km: p.trailKm,
    connector_km: p.connectorKm,
    method: p.method,
    approach_lat: p.approach.lat,
    approach_lng: p.approach.lng,
    trail_path: p.path,
    entry_basis: p.entryBasis,
    note: p.note,
  })
  const counts = new Map<string, number>()
  let waiting = 0
  let routed = 0
  const failed: string[] = []
  for (const f of fields) {
    const p = plans.get(f.id)!
    const fk = fieldKey(f.id)
    if (p.shop.plan && p.bins.plan) routed++
    for (const [st, r] of [
      [shop, p.shop],
      [bins, p.bins],
    ] as const) {
      if (!r.plan) {
        if (r.need.length) waiting++
        else if (r.why && st === shop) failed.push(r.why)
        continue
      }
      if (st === shop) counts.set(r.plan.method, (counts.get(r.plan.method) ?? 0) + 1)
      if (!typed.has(`${st.key}>${fk}`)) rows.push(row(st, fk, r.plan.entry, r.plan))
    }
    if (pit && p.pit?.plan && !typed.has(`${pitKey}>${fk}`)) rows.push(row(pit, fk, p.pit.plan.entry, p.pit.plan))
    else if (pit && p.pit && !p.pit.plan && p.pit.need.length) waiting++
    const b = p.bins.plan
    if (!b) continue
    for (const e of elevators) {
      const leg = planFrom(b, lookup(e.key)(b.approach), trailKmh)
      if (leg && !typed.has(`${fk}>${e.key}`)) rows.push(row({ key: fk, ...b.entry }, e.key, e, leg))
    }
  }
  for (const e of elevators) {
    const s = lookup(binsKey)(e)
    if (s?.roadKm == null || s.roadMin == null || typed.has(`${binsKey}>${e.key}`)) continue
    rows.push({
      from_key: binsKey,
      to_key: e.key,
      from_lat: bins.lat,
      from_lng: bins.lng,
      to_lat: e.lat,
      to_lng: e.lng,
      distance_km: s.roadKm,
      duration_min: s.roadMin,
      source: 'osrm',
      computed_at: now,
      road_km: s.roadKm,
      trail_km: 0,
      connector_km: 0,
      method: 'road',
      approach_lat: s.snapLat,
      approach_lng: s.snapLng,
      trail_path: null,
      entry_basis: null,
      note: null,
    })
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from('road_routes').upsert(rows.slice(i, i + 200), { onConflict: 'from_key,to_key' })
    if (error) errors.push(error.message.slice(0, 120))
  }

  const how = [...counts].map(([m, c]) => `${c} ${m}`).join(', ')
  const detail =
    `${routed} of ${fields.length} fields routed from the shop and the bins` +
    (how ? ` (${how})` : '') +
    ` · ${requests} router request(s)` +
    (waiting ? ` · ${waiting} route(s) still waiting on the router — run it again` : '') +
    (failed.length ? ` · ${failed.length} with no route: ${[...new Set(failed)].join('; ')}` : '') +
    (errors.length ? ` · ${errors.join('; ')}` : '')
  const ok = !errors.length || rows.length > 0
  if (ok) await sb.rpc('record_integration_heartbeat', { p_key: 'road_routes', p_detail: detail, p_data_at: null })
  return { ok, computed: rows.length, stale: waiting, requests, detail }
}

/**
 * Road distances between the shop, the bins, the fields and the elevators.
 *
 * The old figure was a straight line from the Main Yard bins to the field's
 * centre, times 1.3 for "roads are not straight". That is close on a section
 * grid and badly wrong anywhere the river or a coulee is in the way. These
 * come from a road router (OSRM, on OpenStreetMap's roads — the same roads
 * Google draws, without the API key), finished off along the farm's own
 * trails where the road stops short (trail-router.ts), and cached in
 * `road_routes`.
 *
 * Two start points, by what the trip is for (Sam, 2 Oct 2026): field work
 * and spraying go from the SHOP and back; grain goes to the BINS. Every field
 * end is the field's entry pin — where the machines actually go in — or,
 * until somebody drops one, the router's suggestion.
 *
 * Pure: the keys, which start a trip uses, asking the router and reading its
 * answer. The worker that calls it is netlify/shared/road-routes.ts.
 */

export type LatLng = { lat: number; lng: number }
export type Place = LatLng & { key: string }

export type RouteMethod = 'road' | 'road+trail' | 'road+straight' | 'typed'
export type EntryBasis = 'pin' | 'suggested' | 'centroid'

export type RouteRow = {
  from_key: string
  to_key: string
  from_lat: number
  from_lng: number
  to_lat: number
  to_lng: number
  distance_km: number
  duration_min: number
  source: string
  computed_at: string
  road_km?: number | string | null
  trail_km?: number | string | null
  connector_km?: number | string | null
  method?: RouteMethod | string | null
  approach_lat?: number | null
  approach_lng?: number | null
  /** The off-road part, approach → entry, as [lng, lat] pairs. */
  trail_path?: unknown
  entry_basis?: EntryBasis | string | null
  note?: string | null
}

export const OSRM_BASE = 'https://router.project-osrm.org'
export const OSRM_AGENT = 'RVR-Management-App (farm records)'

/** An end that has moved further than this is a different trip. */
export const MOVED_M = 75

/** The public demo router asks for at most ~100 coordinates a request. */
export const MAX_COORDS = 90

export const shopKey = 'shop'
export const binsKey = 'bins'
export const fieldKey = (id: string) => `field:${id}`
export const siteKey = (id: string) => `site:${id}`
export type StartKey = typeof shopKey | typeof binsKey

/**
 * What a trip is for, and so where it starts. Field work, spraying and any
 * machine driving out to work a field leave from the shop and come back to
 * it. Grain goes to the bins, and from the bins out to an elevator. Manure
 * has no pile or pen location on record, so it goes from the shop too.
 */
export type TripPurpose = 'field_work' | 'spraying' | 'spreading' | 'manure' | 'grain'
export function startFor(purpose: TripPurpose): StartKey {
  return purpose === 'grain' ? binsKey : shopKey
}
export const START_LABEL: Record<StartKey, string> = { shop: 'the shop', bins: 'the bins' }

/**
 * The silage pit: a third place routes are measured from, used only by the
 * silage haul (operating_settings 'silage_pit'). Not a start for anything
 * else, so it is not a StartKey.
 */
export const pitKey = 'pit'
export type PitChoice = StartKey | typeof pitKey
export const PIT_LABEL: Record<PitChoice, string> = { ...START_LABEL, pit: 'the silage pit' }

/** Great-circle metres. */
export function metresBetween(a: LatLng, b: LatLng): number {
  const R = 6_371_000
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** A point to the decimetre: the cache key for asking the router about it. */
export const roundPt = (p: LatLng): LatLng => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 })
export const ptKey = (p: LatLng) => {
  const r = roundPt(p)
  return `${r.lat.toFixed(6)},${r.lng.toFixed(6)}`
}

/**
 * The router's answer for one point from one origin: the road point it
 * snapped the point to, how far that is, and the road to it. roadKm null =
 * the router could not join the two.
 */
export type Snap = {
  lat: number
  lng: number
  snapLat: number | null
  snapLng: number | null
  snapM: number | null
  roadKm: number | null
  roadMin: number | null
}

export type SnapRequest = { origins: Place[]; points: LatLng[] }

/**
 * As few router requests as the points allow: the table service answers
 * every origin against every point in one call, up to its size limit.
 */
export function planSnapRequests(origins: Place[], points: LatLng[]): SnapRequest[] {
  const room = Math.max(1, MAX_COORDS - origins.length)
  const uniq = [...new Map(points.map((p) => [ptKey(p), roundPt(p)])).values()]
  const out: SnapRequest[] = []
  for (let i = 0; i < uniq.length; i += room) out.push({ origins, points: uniq.slice(i, i + room) })
  return out
}

/** The OSRM table URL for one request. Coordinates go lng,lat. */
export function snapTableUrl(req: SnapRequest, base = OSRM_BASE): string {
  const all = [...req.origins, ...req.points]
  const coords = all.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  const src = req.origins.map((_, i) => i).join(';')
  const dst = req.points.map((_, i) => i + req.origins.length).join(';')
  return `${base}/table/v1/driving/${coords}?sources=${src}&destinations=${dst}&annotations=distance,duration`
}

type Waypoint = { location?: [number, number]; distance?: number }
type TableBody = {
  code?: string
  message?: string
  distances?: (number | null)[][]
  durations?: (number | null)[][]
  destinations?: Waypoint[]
}

/**
 * One table answer as snaps, per origin.
 *
 * `destinations[j]` is where the router put point j on its road network and
 * how far that is from the point — what OSRM's nearest service would say, for
 * free with the distances. A null cell (no road joins them) is kept with
 * roadKm null, so the point is not asked about again every run.
 */
export function parseSnapTable(body: unknown, req: SnapRequest): { origin: Place; snap: Snap }[] {
  const b = body as TableBody
  if (b?.code !== 'Ok') throw new Error(`Router said ${b?.code ?? 'nothing'}${b?.message ? `: ${b.message}` : ''}`)
  const out: { origin: Place; snap: Snap }[] = []
  req.origins.forEach((o, i) => {
    req.points.forEach((p, j) => {
      const w = b.destinations?.[j]
      const m = b.distances?.[i]?.[j]
      const sec = b.durations?.[i]?.[j]
      const ok = m != null && sec != null && Number.isFinite(m) && Number.isFinite(sec)
      out.push({
        origin: o,
        snap: {
          lat: p.lat,
          lng: p.lng,
          snapLat: w?.location ? w.location[1] : null,
          snapLng: w?.location ? w.location[0] : null,
          snapM: w?.distance != null && Number.isFinite(w.distance) ? Math.round(w.distance * 10) / 10 : null,
          roadKm: ok ? Math.round(m) / 1000 : null,
          roadMin: ok ? Math.round(sec / 6) / 10 : null,
        },
      })
    })
  })
  return out
}

/** Section roads run about a third longer than the crow flies — the old rule, kept as the fallback. */
export const ROAD_FACTOR = 1.3

/**
 * A route this much longer than the straight line, and at least this many
 * km longer, has gone the long way round something (the river), not along
 * the road the truck actually takes.
 */
export const DETOUR_RATIO = 3
export const DETOUR_KM = 5

export const isDetour = (roadKm: number, straightKm: number) => roadKm > straightKm * DETOUR_RATIO && roadKm - straightKm > DETOUR_KM

export const NO_TRAIL_NOTE = 'no trail drawn — draw one or type the distance'

export type Trip = {
  /** One way. */
  km: number
  /** One way, by car at the posted speeds and the trail speed; null when only a straight line is known. */
  minutes: number | null
  /** road: by road to the entry. trail: road, then a farm trail. straight: road as close as it gets, then a guess. */
  basis: 'road' | 'trail' | 'manual' | 'straight'
  /** Why the number is not simply the router's, when it is not. */
  note: string | null
  /** How it was made, when the router made it. */
  parts?: { road: number; trail: number; connector: number } | null
}

const n = (v: unknown): number | null => {
  const x = typeof v === 'string' ? Number(v) : v
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

/**
 * The one-way trip between two places, as every cost should use it.
 *
 * A distance typed in by hand wins. A route the trail router made says how
 * it was made. An older row with no method gets the old detour rule: an
 * obvious detour is costed at the straight line × 1.3, saying so, rather than
 * billing 84 km of fuel to a field across the coulee. No route at all falls
 * back the same way.
 */
export function tripFor(
  route: Pick<RouteRow, 'distance_km' | 'duration_min' | 'source' | 'method' | 'road_km' | 'trail_km' | 'connector_km' | 'note'> | null,
  a: LatLng | null,
  b: LatLng | null,
): Trip | null {
  const straight = a && b ? metresBetween(a, b) / 1000 : null
  if (route) {
    const km = Number(route.distance_km)
    const minutes = Number(route.duration_min)
    if (route.source === 'manual' || route.method === 'typed') return { km, minutes, basis: 'manual', note: 'entered by hand', parts: null }
    const road = n(route.road_km)
    const parts = road != null ? { road, trail: n(route.trail_km) ?? 0, connector: n(route.connector_km) ?? 0 } : null
    if (route.method === 'road+trail') return { km, minutes, basis: 'trail', note: route.note ?? null, parts }
    if (route.method === 'road+straight') return { km, minutes, basis: 'straight', note: route.note ?? NO_TRAIL_NOTE, parts }
    const detour = straight != null && isDetour(km, straight)
    if (!detour) return { km, minutes, basis: 'road', note: route.note ?? null, parts }
    return {
      km: straight! * ROAD_FACTOR,
      minutes: null,
      basis: 'straight',
      note: `the road router drove ${km.toFixed(0)} km — the long way round, likely the river. Using the straight line × ${ROAD_FACTOR} until the real distance is entered.`,
      parts: null,
    }
  }
  if (straight == null) return null
  return { km: straight * ROAD_FACTOR, minutes: null, basis: 'straight', note: `no road route yet — straight line × ${ROAD_FACTOR}`, parts: null }
}

/** A route between two keys, either way round — a road is the same length both ways. */
export function routeBetween<T extends Pick<RouteRow, 'from_key' | 'to_key'>>(routes: T[], a: string, b: string): T | null {
  return routes.find((r) => r.from_key === a && r.to_key === b) ?? routes.find((r) => r.from_key === b && r.to_key === a) ?? null
}

/** "49.874, -108.745" or a Google Maps link pasted whole. */
export function parseLatLng(s: string): LatLng | null {
  const m = s.match(/(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/) ?? s.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  if (!(lat > 40 && lat < 60 && lng < -100 && lng > -125)) return null
  return { lat, lng }
}

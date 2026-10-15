import { hydrateSecrets } from '../shared/secrets.ts'
// Where each gauge is, and what it reads right now.
//
// Same source as river-flow: Environment Canada's hydrometric-realtime
// collection. It is GeoJSON, so the coordinates come with the reading rather
// than needing a second lookup or a hand-kept table of positions that would
// quietly rot.

const API = 'https://api.weather.gc.ca/collections/hydrometric-realtime/items'

type Feature = {
  geometry?: { coordinates?: [number, number] }
  properties?: {
    STATION_NUMBER?: string
    STATION_NAME?: string
    DATETIME?: string
    LEVEL?: number | null
    DISCHARGE?: number | null
  }
}

export type StationReading = {
  station: string
  name: string
  lat: number
  lng: number
  level: number | null
  discharge: number | null
  at: string | null
}

/** The most recent reading for one station, with its position. */
async function latest(station: string): Promise<StationReading | null> {
  const url =
    `${API}?f=json&STATION_NUMBER=${encodeURIComponent(station)}` +
    `&sortby=-DATETIME&limit=1`
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) return null
  const body = (await res.json()) as { features?: Feature[] }
  const f = body.features?.[0]
  const c = f?.geometry?.coordinates
  const p = f?.properties
  if (!c || !p?.STATION_NUMBER) return null
  return {
    station: p.STATION_NUMBER,
    name: p.STATION_NAME ?? p.STATION_NUMBER,
    lng: c[0],
    lat: c[1],
    level: typeof p.LEVEL === 'number' ? p.LEVEL : null,
    discharge: typeof p.DISCHARGE === 'number' ? p.DISCHARGE : null,
    at: p.DATETIME ?? null,
  }
}

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const url = new URL(req.url)
  const wanted = (url.searchParams.get('stations') ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    // A cap, so a mistyped query cannot turn into a hundred upstream requests.
    .slice(0, 24)

  if (wanted.length === 0) {
    return new Response(JSON.stringify({ error: 'stations required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  // One station failing must not lose the others — a map with five pins beats
  // an error page because the sixth gauge is offline.
  const results = await Promise.all(
    wanted.map((s) => latest(s).catch(() => null)),
  )
  const stations = results.filter((r): r is StationReading => r != null)

  return new Response(JSON.stringify({ stations }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      // Readings update hourly at best; this keeps a pan-and-zoom session from
      // re-requesting every gauge on each render.
      'cache-control': 'public, max-age=300',
    },
  })
}

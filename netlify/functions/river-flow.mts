import { hydrateSecrets } from '../shared/secrets.ts'
// Proxy for ECCC/WSC hydrometric data (avoids browser CORS + caches).
//   GET /api/river-flow?station=05AD007                       → latest reading
//   GET /api/river-flow?station=05AD007&from=<iso>&to=<iso>   → time series
//     &daily=1 uses the daily-mean collection (decades of history) instead of
//     the real-time one (~30 days, fine-grained) for long ranges.
type Reading = { t: string; discharge: number | null; level: number | null }

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const url = new URL(req.url)
  const station = url.searchParams.get('station') || '05AD007'
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const daily = url.searchParams.get('daily') === '1'
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
    })
  const num = (v: unknown) => (v == null ? null : Number(v))

  try {
    // ---- latest single reading ----
    if (!from || !to) {
      const res = await fetch(
        `https://api.weather.gc.ca/collections/hydrometric-realtime/items?f=json` +
          `&STATION_NUMBER=${encodeURIComponent(station)}&sortby=-DATETIME&limit=1`,
      )
      if (!res.ok) return json({ error: `fetch ${res.status}` }, 502)
      const j = (await res.json()) as { features?: { properties: Record<string, unknown> }[] }
      const p = j.features?.[0]?.properties
      return json(
        p
          ? {
              station,
              name: (p.STATION_NAME as string) ?? null,
              discharge: num(p.DISCHARGE),
              level: num(p.LEVEL),
              datetime: (p.DATETIME as string) ?? null,
            }
          : { station, name: null, discharge: null, level: null, datetime: null },
      )
    }

    // ---- time series ----
    const collection = daily ? 'hydrometric-daily-mean' : 'hydrometric-realtime'
    const timeField = daily ? 'DATE' : 'DATETIME'
    const res = await fetch(
      `https://api.weather.gc.ca/collections/${collection}/items?f=json` +
        `&STATION_NUMBER=${encodeURIComponent(station)}` +
        `&datetime=${encodeURIComponent(from)}/${encodeURIComponent(to)}` +
        `&sortby=-${timeField}&limit=10000`,
    )
    if (!res.ok) return json({ error: `fetch ${res.status}` }, 502)
    const j = (await res.json()) as {
      features?: { properties: Record<string, unknown> }[]
    }
    const feats = j.features ?? []
    const name = (feats[0]?.properties?.STATION_NAME as string) ?? null
    // Newest-first from the API → reverse to chronological for the chart.
    const series: Reading[] = feats
      .map((f) => ({
        t: (f.properties[timeField] as string) ?? '',
        discharge: num(f.properties.DISCHARGE),
        level: num(f.properties.LEVEL),
      }))
      .filter((r) => r.t)
      .reverse()
    return json({ station, name, daily, series })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
}

import { hydrateSecrets } from '../shared/secrets.ts'
import { farmTz } from '../../src/lib/farm-context.ts'
// Daily mean temperature and wind for cattle cold stress, via Open-Meteo.
//   GET /api/winter-cold?lat=49.91&lon=-111.70&kind=history
//     The last five winters (1 Oct – 31 May), one [°C, km/h] pair a day,
//     grouped by month — the feed plan averages the cold this ranch really
//     gets rather than a single "average winter day", because cold stress is
//     not linear (a mild day adds nothing, a cold one a lot).
//   GET /api/winter-cold?lat=…&lon=…&kind=forecast
//     Seven days back and seven ahead: mean temperature, mean wind, rain and
//     snow — the rain is what wets a coat.
export const config = { path: '/api/winter-cold' }

type Daily = Record<string, (number | string | null)[]>

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const u = new URL(req.url)
  const lat = Number(u.searchParams.get('lat'))
  const lon = Number(u.searchParams.get('lon'))
  const kind = u.searchParams.get('kind') === 'forecast' ? 'forecast' : 'history'
  const json = (b: unknown, s = 200, maxAge = 900) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${maxAge}` },
    })
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: 'lat, lon required' }, 400)

  const vars = 'temperature_2m_mean,wind_speed_10m_mean,rain_sum,snowfall_sum'
  const get = async (url: string) => {
    // The archive answers 429 to back-to-back pulls; one retry after a pause.
    for (let i = 0; i < 2; i++) {
      const r = await fetch(url)
      if (r.ok) return ((await r.json()) as { daily?: Daily }).daily ?? {}
      if (r.status !== 429) throw new Error(`Open-Meteo ${r.status}`)
      await new Promise((res) => setTimeout(res, 1500))
    }
    throw new Error('Open-Meteo busy')
  }
  const rows = (d: Daily) =>
    (d.time ?? []).map((t, i) => ({
      date: t as string,
      t: d.temperature_2m_mean?.[i] == null ? null : Number(d.temperature_2m_mean[i]),
      w: d.wind_speed_10m_mean?.[i] == null ? null : Number(d.wind_speed_10m_mean[i]),
      rain: d.rain_sum?.[i] == null ? null : Number(d.rain_sum[i]),
      snow: d.snowfall_sum?.[i] == null ? null : Number(d.snowfall_sum[i]),
    }))

  try {
    if (kind === 'forecast') {
      const d = await get(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${vars}` +
          `&past_days=7&forecast_days=7&timezone=${encodeURIComponent(farmTz())}&wind_speed_unit=kmh`,
      )
      return json({ days: rows(d) })
    }
    // The last five complete winters.
    const now = new Date()
    const lastEnd = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1
    const start = `${lastEnd - 5}-10-01`
    const end = `${lastEnd}-05-31`
    const d = await get(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}` +
        `&daily=temperature_2m_mean,wind_speed_10m_mean&timezone=${encodeURIComponent(farmTz())}&wind_speed_unit=kmh`,
    )
    const byMonth = new Map<number, [number, number][]>()
    for (const r of rows(d)) {
      const m = Number(r.date.slice(5, 7))
      if (m > 5 && m < 10) continue
      if (r.t == null || r.w == null) continue
      const list = byMonth.get(m) ?? []
      list.push([r.t, r.w])
      byMonth.set(m, list)
    }
    return json(
      { winters: `${lastEnd - 5}–${lastEnd}`, months: [...byMonth].map(([month, days]) => ({ month, days })) },
      200,
      7 * 86_400,
    )
  } catch (e) {
    return json({ error: (e as Error).message }, 502, 60)
  }
}

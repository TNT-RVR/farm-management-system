// Measured precipitation accumulator for a ranch's coordinates over a date
// range. Mirrors irrigation-sync's Open-Meteo approach: the historical archive
// (long history, ~4-day lag) plus a recent forecast window that fills the
// archive's tail up to today. Feeds the grazing forage model.
//   GET /api/ranch-precip?lat=49.9&lon=-111.7&start=2026-04-01[&end=2026-07-24]
//       [&normals=5&end_month=10]
// With `normals`, also the same season in each of the last N whole years, so
// the forecast can plan on a normal season and this year can be read against it.
import { seasonNormal, seasonToDate } from '../shared/ranch-rain.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmTz } from '../../src/lib/farm-context.ts'

export const config = { path: '/api/ranch-precip' }

const farmToday = () => new Date().toLocaleDateString('en-CA', { timeZone: farmTz() })

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const u = new URL(req.url)
  const lat = u.searchParams.get('lat')
  const lon = u.searchParams.get('lon')
  const start = u.searchParams.get('start')
  const end = u.searchParams.get('end') || farmToday()
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
    })
  if (!lat || !lon || !start) return json({ error: 'lat, lon, start required' }, 400)

  try {
    const series = await seasonToDate(lat, lon, start, end)
    const total = series.reduce((s, p) => s + p.mm, 0)
    const through = series.at(-1)?.t ?? end
    const n = Math.min(10, Math.max(0, Number(u.searchParams.get('normals') ?? 0)))
    const normal = n
      ? await seasonNormal(lat, lon, {
          thisYear: Number(start.slice(0, 4)),
          startMonth: Number(start.slice(5, 7)),
          endMonth: Number(u.searchParams.get('end_month') ?? 10),
          n,
          cutoffMd: through.slice(5),
        })
      : null
    return json({
      total_mm: Math.round(total * 10) / 10,
      days: series.length,
      through,
      series,
      normal,
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
}

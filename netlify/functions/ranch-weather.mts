import { hydrateSecrets } from '../shared/secrets.ts'
// Current conditions + 7-day forecast for a ranch's coordinates, via Open-Meteo
// (same source the irrigation model uses). Metric: °C, km/h, mm, %.
//   GET /api/ranch-weather?lat=49.91&lon=-111.70
export const config = { path: '/api/ranch-weather' }

// Only allow known Open-Meteo model ids (avoids passing arbitrary query values).
const MODELS = new Set(['gem_seamless', 'ecmwf_ifs025', 'best_match'])

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const u = new URL(req.url)
  const lat = u.searchParams.get('lat')
  const lon = u.searchParams.get('lon')
  const model = u.searchParams.get('model')
  // 7 by default; up to 16 for tools that look further (the urea spread window).
  const ahead = Math.max(1, Math.min(16, Number(u.searchParams.get('days')) || 7))
  // Hour by hour, for the Weather page's spray windows. Off by default: the
  // dashboard and the meeting grid only need the days.
  const hourly = u.searchParams.get('hourly') === '1'
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=900' },
    })
  if (!lat || !lon) return json({ error: 'lat, lon required' }, 400)

  const num = (v: unknown) => (v == null ? null : Number(v))
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset` +
        (hourly
          ? `&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,precipitation_probability,weather_code,cloud_cover`
          : '') +
        // Three days back as well as seven forward. The Monday meeting's week
        // grid is looked at all week, and on Thursday the first three boxes
        // were blank — which reads as broken rather than as "that already
        // happened". Past days come back as measured values, not a forecast.
        `&forecast_days=${ahead}&past_days=3&timezone=auto&wind_speed_unit=kmh` +
        (model && MODELS.has(model) ? `&models=${model}` : ''),
    )
    if (!res.ok) return json({ error: `Open-Meteo ${res.status}` }, 502)
    const d = (await res.json()) as {
      current?: Record<string, number | string>
      daily?: Record<string, (number | string | null)[]>
      hourly?: Record<string, (number | string | null)[]>
    }
    const c = d.current ?? {}
    const dd = d.daily ?? {}
    const days = (dd.time ?? []).map((t, i) => ({
      date: t as string,
      code: num(dd.weather_code?.[i]),
      hi: num(dd.temperature_2m_max?.[i]),
      lo: num(dd.temperature_2m_min?.[i]),
      precip: num(dd.precipitation_sum?.[i]),
      pop: num(dd.precipitation_probability_max?.[i]),
      windMax: num(dd.wind_speed_10m_max?.[i]),
      gustMax: num(dd.wind_gusts_10m_max?.[i]),
      sunrise: (dd.sunrise?.[i] as string) ?? null,
      sunset: (dd.sunset?.[i] as string) ?? null,
    }))
    const hh = d.hourly ?? {}
    // From yesterday on: the past three days are only there for the meeting grid.
    const since = (dd.time?.[Math.max(0, (dd.time?.length ?? 0) - ahead - 1)] as string) ?? ''
    const hours = hourly
      ? (hh.time ?? [])
          .map((t, i) => ({
            time: t as string,
            temp: num(hh.temperature_2m?.[i]),
            rh: num(hh.relative_humidity_2m?.[i]),
            dew: num(hh.dew_point_2m?.[i]),
            wind: num(hh.wind_speed_10m?.[i]),
            gust: num(hh.wind_gusts_10m?.[i]),
            windDir: num(hh.wind_direction_10m?.[i]),
            precip: num(hh.precipitation?.[i]),
            pop: num(hh.precipitation_probability?.[i]),
            code: num(hh.weather_code?.[i]),
            cloud: num(hh.cloud_cover?.[i]),
          }))
          .filter((h) => h.time >= since)
      : undefined
    return json({
      current: {
        time: (c.time as string) ?? null,
        temp: num(c.temperature_2m),
        apparent: num(c.apparent_temperature),
        humidity: num(c.relative_humidity_2m),
        precip: num(c.precipitation),
        code: num(c.weather_code),
        wind: num(c.wind_speed_10m),
        gusts: num(c.wind_gusts_10m),
        windDir: num(c.wind_direction_10m),
      },
      daily: days,
      ...(hours ? { hourly: hours } : {}),
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
}

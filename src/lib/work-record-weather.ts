import { supabase } from './supabase'
import { summariseWeather, type HourReading, type WorkWeather } from './field-work'

/**
 * The weather at a field for the time some work was done, for the snapshot a
 * hand record keeps.
 *
 * First choice: Open-Meteo's historical-forecast archive at the field's own
 * centre, the same ECMWF model and endpoint the spray passes read their
 * conditions from (netlify/shared/jd-conditions.ts). Hourly back to 2021 with
 * no lag, and it carries gusts and direction.
 *
 * Fallback: the field's station's hourly rows (weather_hourly). They are the
 * same kind of model at the station rather than the field, kept for the last
 * 92 days, with no gust or direction, so they are second. The source is
 * stored with the numbers so the record can say which it got.
 */

const ARCHIVE = 'https://historical-forecast-api.open-meteo.com/v1/forecast'
export const OPEN_METEO_SOURCE = 'Open-Meteo (ECMWF) at the field'

type OmHourly = {
  time?: string[]
  temperature_2m?: (number | null)[]
  relative_humidity_2m?: (number | null)[]
  precipitation?: (number | null)[]
  wind_speed_10m?: (number | null)[]
  wind_gusts_10m?: (number | null)[]
  wind_direction_10m?: (number | null)[]
  shortwave_radiation?: (number | null)[]
}

/** Open-Meteo's hourly arrays as readings. Times are asked for in UTC. */
export function readingsFromOpenMeteo(h: OmHourly | null | undefined): HourReading[] {
  if (!h?.time?.length) return []
  const at = (arr: (number | null)[] | undefined, i: number) => {
    const v = arr?.[i]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  return h.time.map((t, i) => ({
    ts: new Date(`${t.length === 16 ? `${t}:00` : t}Z`).toISOString(),
    temp_c: at(h.temperature_2m, i),
    rh: at(h.relative_humidity_2m, i),
    precip_mm: at(h.precipitation, i),
    wind_kmh: at(h.wind_speed_10m, i),
    gust_kmh: at(h.wind_gusts_10m, i),
    wind_dir_deg: at(h.wind_direction_10m, i),
    solar_wm2: at(h.shortwave_radiation, i),
  }))
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error('timed out')), ms)))])
  } finally {
    if (t) clearTimeout(t)
  }
}

async function fromOpenMeteo(lat: number, lng: number, span: { from: string; to: string }): Promise<WorkWeather | null> {
  // A day either side: the window is in UTC and a farm evening is the next UTC day.
  const d0 = new Date(Date.parse(span.from) - 86_400_000).toISOString().slice(0, 10)
  const d1 = new Date(Date.parse(span.to) + 86_400_000).toISOString().slice(0, 10)
  const url =
    `${ARCHIVE}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&start_date=${d0}&end_date=${d1}` +
    '&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,shortwave_radiation' +
    '&timezone=UTC&models=ecmwf_ifs025&wind_speed_unit=kmh'
  const res = await withTimeout(fetch(url), 10_000)
  if (!res.ok) return null
  // It has answered a 200 with a plain-text error before.
  const body = (await res.json().catch(() => null)) as { hourly?: OmHourly } | null
  return summariseWeather(readingsFromOpenMeteo(body?.hourly), span)
}

async function fromStation(stationId: string, span: { from: string; to: string }): Promise<WorkWeather | null> {
  const lo = new Date(Date.parse(span.from) - 2 * 3_600_000).toISOString()
  const hi = new Date(Date.parse(span.to) + 2 * 3_600_000).toISOString()
  const { data, error } = await supabase
    .from('weather_hourly')
    .select('ts, temp_c, rh, precip_mm, wind_ms, solar_wm2, forecast')
    .eq('station_id', stationId)
    .gte('ts', lo)
    .lte('ts', hi)
    .order('ts')
  if (error || !data?.length) return null
  const rows: HourReading[] = data
    .filter((r) => !r.forecast)
    .map((r) => ({
      ts: new Date(r.ts as string).toISOString(),
      temp_c: r.temp_c == null ? null : Number(r.temp_c),
      rh: r.rh == null ? null : Number(r.rh),
      precip_mm: r.precip_mm == null ? null : Number(r.precip_mm),
      wind_kmh: r.wind_ms == null ? null : Number(r.wind_ms) * 3.6,
      solar_wm2: r.solar_wm2 == null ? null : Number(r.solar_wm2),
    }))
  return summariseWeather(rows, span)
}

export type WeatherResult = { weather: WorkWeather; source: string } | null

/**
 * The weather for a field and a span, or null when neither source has it
 * (no signal, a time still to come, a field with no centre and no station).
 */
export async function weatherForField(fieldId: string, span: { from: string; to: string }): Promise<WeatherResult> {
  const [{ data: point }, { data: field }] = await Promise.all([
    supabase.from('field_points').select('lat, lng').eq('id', fieldId).maybeSingle(),
    supabase.from('fields').select('assigned_station_id').eq('id', fieldId).maybeSingle(),
  ])
  if (point?.lat != null && point?.lng != null) {
    try {
      const w = await fromOpenMeteo(Number(point.lat), Number(point.lng), span)
      if (w) return { weather: w, source: OPEN_METEO_SOURCE }
    } catch {
      // Unreachable or slow: try the station.
    }
  }
  const stationId = field?.assigned_station_id
  if (stationId) {
    const w = await fromStation(stationId, span)
    if (w) {
      const { data: st } = await supabase.from('weather_stations').select('name').eq('id', stationId).maybeSingle()
      return { weather: w, source: `${st?.name ?? 'Field'} station (hourly)` }
    }
  }
  return null
}

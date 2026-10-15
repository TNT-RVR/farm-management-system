import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Hourly weather for a station, from Open-Meteo's keyless forecast API: the
 * last 92 days (its modelled past) and the 7-day forecast, in UTC. Written to
 * weather_hourly for the dry-down (9 Oct 2026); the browser rescales each day
 * to the station's own observed high, low and rain.
 */
export type HourlyRow = {
  station_id: string
  ts: string
  temp_c: number | null
  rh: number | null
  precip_mm: number | null
  wind_ms: number | null
  solar_wm2: number | null
  forecast: boolean
}

export async function fetchHourly(stationId: string, lat: number, lon: number): Promise<HourlyRow[]> {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,shortwave_radiation' +
      '&wind_speed_unit=ms&timezone=UTC&past_days=92&forecast_days=7',
  )
  if (!res.ok) throw new Error(`Open-Meteo hourly ${res.status}`)
  // It has answered a 200 with a plain-text error before (1 Oct 2026).
  const j = (await res.json().catch(() => null)) as {
    hourly?: {
      time: string[]
      temperature_2m: (number | null)[]
      relative_humidity_2m: (number | null)[]
      precipitation: (number | null)[]
      wind_speed_10m: (number | null)[]
      shortwave_radiation: (number | null)[]
    }
  } | null
  const h = j?.hourly
  if (!h?.time?.length) throw new Error('Open-Meteo hourly: no data')
  const now = Date.now()
  return h.time.map((t, i) => {
    const ts = new Date(`${t}:00Z`).toISOString()
    return {
      station_id: stationId,
      ts,
      temp_c: h.temperature_2m[i] ?? null,
      rh: h.relative_humidity_2m[i] ?? null,
      precip_mm: h.precipitation[i] ?? null,
      wind_ms: h.wind_speed_10m[i] ?? null,
      solar_wm2: h.shortwave_radiation[i] ?? null,
      forecast: Date.parse(ts) > now,
    }
  })
}

/** Upsert in chunks; returns how many rows were written. */
export async function saveHourly(sb: SupabaseClient, rows: HourlyRow[]): Promise<number> {
  let n = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: new Date().toISOString() }))
    const { error } = await sb.from('weather_hourly').upsert(chunk, { onConflict: 'station_id,ts' })
    if (error) throw new Error(`weather_hourly: ${error.message}`)
    n += chunk.length
  }
  return n
}

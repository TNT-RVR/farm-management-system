import type { SupabaseClient } from '@supabase/supabase-js'
import { jdGet } from '../functions/_jd.mts'

// Conditions during a pass — the weather it was sprayed in, and the speed it was
// driven at.
//
// ── What Deere actually serves ───────────────────────────────────────────────
//
// Every application advertises links to windSpeed, airTemperature and
// relativeHumidity measurements. Every one of them 404s for this organisation:
// 67 out of 67 operations, checked 2026-08-13, recorded in jd_api_probes. The
// machines do not carry weather sensors, so the links lead nowhere. They are not
// requested any more — three wasted round trips per pass to be told nothing.
//
// ApplicationSpeedResult DOES answer, on all 80 operations tried. It carries the
// measured average ground speed, and — worth knowing for later — the as-applied
// totals: the area actually covered and the material actually put out, which is
// a measured figure rather than the target rate multiplied by the field's acres.
//
// ── So where the weather comes from ──────────────────────────────────────────
//
// ECMWF at the field, for the hour of the pass. The same model the dashboard
// already reads, through Open-Meteo's historical-forecast archive, which keeps
// hourly history back to 2021 with no lag.
//
// This is modelled weather at a location, NOT a reading off the machine. The
// `conditions_source` column exists so the app can say which, because "18 km/h
// at the sprayer" and "18 km/h modelled over the quarter" are different claims
// and only one of them was measured.

const WEATHER_API = 'https://historical-forecast-api.open-meteo.com/v1/forecast'

type Link = { rel?: string; uri?: string }

type Measurement = {
  value?: number
  unitId?: string
}

/**
 * The measured average ground speed, out of an ApplicationSpeedResult.
 *
 * Lives at `applicationProductTotals[].averageSpeed` — one entry per product
 * applied, all reporting the same pass, so the first with a figure is the pass.
 */
export function readAverageSpeed(body: unknown): Measurement | null {
  const totals = (body as { applicationProductTotals?: unknown })?.applicationProductTotals
  if (!Array.isArray(totals)) return null
  for (const t of totals) {
    const s = (t as { averageSpeed?: Measurement })?.averageSpeed
    if (s && typeof s.value === 'number' && Number.isFinite(s.value)) return s
  }
  return null
}

/** One product, as the machine actually put it out. */
export type AsApplied = {
  name: string
  productId: string | null
  /** Water and other carriers — kept, but never counted as a product cost. */
  carrier: boolean
  /** Total material over the area covered, as Deere reported it. */
  totalValue: number | null
  totalUnit: string | null
  /** Measured average rate, e.g. 1.33 l1ha-1. */
  rateValue: number | null
  rateUnit: string | null
}

/**
 * The as-applied totals out of an ApplicationSpeedResult.
 *
 * Returns the area COVERED and what went on it. Area is the max across the
 * pass's mixes rather than the sum: two mixes on one pass covered the same
 * ground, and adding them would halve every per-acre figure derived from it.
 */
export function readAsApplied(body: unknown): { areaHa: number | null; products: AsApplied[] } {
  const totals = (body as { applicationProductTotals?: unknown })?.applicationProductTotals
  if (!Array.isArray(totals)) return { areaHa: null, products: [] }
  let areaHa: number | null = null
  const products: AsApplied[] = []
  for (const t of totals) {
    const mix = t as {
      appliedArea?: Measurement
      area?: Measurement
      productTotals?: unknown
    }
    const a = mix.appliedArea ?? mix.area
    // Hectares is what Deere sends here; anything else is left alone rather
    // than converted on a guess, and simply does not set the area.
    if (a && typeof a.value === 'number' && (a.unitId ?? 'ha').toLowerCase() === 'ha') {
      areaHa = areaHa == null ? a.value : Math.max(areaHa, a.value)
    }
    if (!Array.isArray(mix.productTotals)) continue
    for (const raw of mix.productTotals) {
      const pt = raw as {
        name?: string
        productId?: string
        carrier?: boolean
        totalMaterial?: Measurement
        averageMaterial?: Measurement
      }
      if (!pt.name) continue
      products.push({
        name: pt.name,
        productId: pt.productId ?? null,
        carrier: Boolean(pt.carrier),
        totalValue: typeof pt.totalMaterial?.value === 'number' ? pt.totalMaterial.value : null,
        totalUnit: pt.totalMaterial?.unitId ?? null,
        rateValue: typeof pt.averageMaterial?.value === 'number' ? pt.averageMaterial.value : null,
        rateUnit: pt.averageMaterial?.unitId ?? null,
      })
    }
  }
  return { areaHa, products }
}

const KMH_PER_MPH = 1.609344
const KMH_PER_MS = 3.6

/** Deere writes km/h as `km1hr-1`; mph and m/s are the alternatives. */
export function speedToKmh(m: Measurement | null): number | null {
  if (!m || typeof m.value !== 'number') return null
  const u = (m.unitId ?? '').toLowerCase()
  if (u.includes('mi1hr') || u.includes('mph')) return m.value * KMH_PER_MPH
  if (u.startsWith('m1s')) return m.value * KMH_PER_MS
  return m.value
}

const round = (v: number | null, dp: number) =>
  v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp

export type Conditions = {
  conditions: Record<string, unknown>
  wind_speed_kmh: number | null
  wind_gust_kmh: number | null
  wind_dir_deg: number | null
  air_temp_c: number | null
  humidity_pct: number | null
  app_speed_kmh: number | null
  /** Ground actually covered, which is routinely less than the field. */
  applied_area_ha: number | null
  as_applied: AsApplied[] | null
  conditions_source: 'deere' | 'ecmwf' | 'none'
  /** The instant the weather describes — not always the middle of the pass. */
  weather_at: string | null
  conditions_at: string
}

type Hourly = {
  time?: string[]
  temperature_2m?: (number | null)[]
  relative_humidity_2m?: (number | null)[]
  wind_speed_10m?: (number | null)[]
  wind_gusts_10m?: (number | null)[]
  wind_direction_10m?: (number | null)[]
}

/** Beyond this, an "operation" is several days of spraying, not one pass. */
export const LONG_PASS_MS = 12 * 60 * 60 * 1000

/**
 * The instant a pass's weather should describe.
 *
 * Normally the MIDPOINT: a two-hour pass is not the weather at the minute it
 * started. But 31 of this farm's 166 applications span more than a day and the
 * longest is thirteen — Deere rolls several days of spraying into one operation
 * record. The midpoint of a thirteen-day window is not weather anybody sprayed
 * in, so those anchor on the start, which at least is a moment the sprayer was
 * running. The caller stores the instant so the UI can say which it got.
 */
export function passHourUtc(startedAt: string, endedAt: string | null): Date | null {
  const start = new Date(startedAt).getTime()
  if (!Number.isFinite(start)) return null
  const end = endedAt ? new Date(endedAt).getTime() : NaN
  if (!Number.isFinite(end) || end <= start) return new Date(start)
  if (end - start > LONG_PASS_MS) return new Date(start)
  return new Date((start + end) / 2)
}

/** Index of the hourly reading closest to `when`, or -1. */
export function hourIndex(times: string[] | undefined, when: Date): number {
  if (!times?.length) return -1
  const target = when.getTime()
  let best = -1
  let bestGap = Infinity
  for (let i = 0; i < times.length; i++) {
    // Open-Meteo returns naive local-to-timezone stamps; we ask for UTC.
    const t = new Date(`${times[i]}:00Z`.replace(/(:\d\d)?:00Z$/, ':00Z')).getTime()
    if (!Number.isFinite(t)) continue
    const gap = Math.abs(t - target)
    if (gap < bestGap) {
      bestGap = gap
      best = i
    }
  }
  // More than 90 minutes away is not "the weather during that pass".
  return bestGap <= 90 * 60_000 ? best : -1
}

/** ECMWF at a point, for the hour of a pass. */
export async function fetchFieldWeather(
  lat: number,
  lng: number,
  when: Date,
): Promise<Partial<Conditions> | null> {
  const day = when.toISOString().slice(0, 10)
  const url =
    `${WEATHER_API}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&start_date=${day}&end_date=${day}` +
    '&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m' +
    '&timezone=UTC&models=ecmwf_ifs025&wind_speed_unit=kmh'
  const res = await fetch(url)
  if (!res.ok) return null
  const body = (await res.json()) as { hourly?: Hourly }
  const h = body.hourly
  const i = hourIndex(h?.time, when)
  if (i < 0) return null
  const at = <K extends keyof Hourly>(k: K) => {
    const v = (h?.[k] as (number | null)[] | undefined)?.[i]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  return {
    wind_speed_kmh: round(at('wind_speed_10m'), 1),
    wind_gust_kmh: round(at('wind_gusts_10m'), 1),
    wind_dir_deg: at('wind_direction_10m') == null ? null : Math.round(at('wind_direction_10m')!),
    air_temp_c: round(at('temperature_2m'), 1),
    humidity_pct: round(at('relative_humidity_2m'), 0),
  }
}

/**
 * Everything knowable about the conditions of one pass.
 *
 * Deere for what the machine measured, ECMWF for the weather it never did.
 */
export async function fetchConditions(
  token: string,
  op: { links: Link[]; startedAt: string | null; endedAt: string | null },
  point: { lat: number; lng: number } | null,
  now: string,
): Promise<Conditions> {
  const out: Conditions = {
    conditions: {},
    wind_speed_kmh: null,
    wind_gust_kmh: null,
    wind_dir_deg: null,
    air_temp_c: null,
    humidity_pct: null,
    app_speed_kmh: null,
    applied_area_ha: null,
    as_applied: null,
    conditions_source: 'none',
    weather_at: null,
    conditions_at: now,
  }

  const speedLink = op.links.find(
    (l) => l.rel?.toLowerCase() === 'applicationspeedresult' && l.uri,
  )
  if (speedLink) {
    // Path only — jdGet builds the base URL, and following a full URI out of the
    // payload would let the payload choose where the token gets sent.
    const path = speedLink.uri!.replace(/^https?:\/\/[^/]+/, '')
    try {
      const body = await jdGet<Record<string, unknown>>(token, path)
      out.conditions.applicationSpeedResult = body
      out.app_speed_kmh = round(speedToKmh(readAverageSpeed(body)), 2)
      const applied = readAsApplied(body)
      out.applied_area_ha = round(applied.areaHa, 2)
      out.as_applied = applied.products.length ? applied.products : null
    } catch (e) {
      out.conditions.applicationSpeedResult = { error: (e as Error).message.slice(0, 200) }
    }
  }

  const when = op.startedAt ? passHourUtc(op.startedAt, op.endedAt) : null
  if (point && when) {
    try {
      const w = await fetchFieldWeather(point.lat, point.lng, when)
      if (w) {
        Object.assign(out, w)
        out.conditions_source = 'ecmwf'
        out.weather_at = when.toISOString()
      }
    } catch {
      // A weather outage must not stop the pass being marked as tried; the row
      // simply carries no weather and the next backfill will not retry it.
    }
  }
  if (out.conditions_source === 'none' && out.app_speed_kmh != null) {
    out.conditions_source = 'deere'
  }
  return out
}

/**
 * Fill in conditions for application passes that have none yet.
 *
 * Bounded per run: a first sync of a whole season would otherwise be a couple of
 * hundred requests in one go. Untouched passes get picked up by the next run.
 */
export async function backfillConditions(
  sb: SupabaseClient,
  token: string,
  limit = 40,
): Promise<{ filled: number; withWind: number }> {
  const { data } = await sb
    .from('jd_field_operations')
    .select('id, field_id, started_at, ended_at, raw')
    .eq('operation_type', 'application')
    .is('conditions_at', null)
    .order('started_at', { ascending: false })
    .limit(limit)
  if (!data?.length) return { filled: 0, withWind: 0 }

  // One lookup for every field involved, rather than one per pass.
  const fieldIds = [...new Set(data.map((r) => r.field_id).filter(Boolean))]
  const { data: points } = await sb
    .from('field_points')
    .select('id, lat, lng')
    .in('id', fieldIds as string[])
  const byField = new Map((points ?? []).map((p) => [p.id as string, { lat: p.lat as number, lng: p.lng as number }]))

  const now = new Date().toISOString()
  let filled = 0
  let withWind = 0
  for (const row of data) {
    const links = ((row.raw as { links?: Link[] } | null)?.links ?? []) as Link[]
    const c = await fetchConditions(
      token,
      { links, startedAt: row.started_at as string | null, endedAt: row.ended_at as string | null },
      byField.get(row.field_id as string) ?? null,
      now,
    )
    // Only Deere's speed result knows the area; without one, keep what the row
    // already holds (an invoice record's area and totals were being nulled).
    const patch: Partial<Conditions> = { ...c }
    if (c.applied_area_ha == null) {
      delete patch.applied_area_ha
      delete patch.as_applied
    }
    const { error } = await sb.from('jd_field_operations').update(patch).eq('id', row.id)
    if (error) continue
    filled++
    if (c.wind_speed_kmh != null) withWind++
  }
  return { filled, withWind }
}

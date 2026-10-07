import type { SupabaseClient } from '@supabase/supabase-js'
import { fcoverFromNdvi, kcbFromFcover } from './sat-kc.ts'

// The daily series (spec §4.6).
//
// Satellites deliver an irregular, cloud-interrupted set of looks. The UI needs
// a value for today. Those two facts are reconciled here, and the reconciliation
// is the single most misleading thing this module does — so every served value
// carries the age of the real observation behind it, and the UI is required to
// degrade visibly as that age grows.
//
// The shape of the fit, and why:
//
//   1. Usable observations only. Full and partial count; rejected looks stay in
//      sat_observations for the season-end audit but never reach a colour.
//   2. Linear interpolation onto a daily grid between consecutive observations.
//      Savitzky-Golay assumes evenly spaced samples, and ours are 2 to 10 days
//      apart, so the grid has to come first. This is the same order TIMESAT and
//      most published NDVI smoothing pipelines use.
//   3. Savitzky-Golay smoothing over the grid, quadratic, 7-wide. It removes
//      the kinks the linear pass introduces at each observation without
//      flattening green-up, which a moving average would.
//   4. Forward extrapolation of at most 5 days past the last observation, by
//      holding the last value rather than extending its slope. A slope
//      extended into cloud runs away, and a runaway green-up curve is exactly
//      the kind of confident wrong number §14 forbids.
//
// The double-logistic retrospective refit the spec asks for at end of season is
// for yield work in phase 6, and is not here.

/** How far past the last real look a value may be served at all (spec §4.6). */
export const MAX_EXTRAPOLATION_DAYS = 5

/**
 * The whole-subject case, spelled two different ways.
 *
 * sat_observations stores the all-zero uuid, because NULL cannot be an
 * ON CONFLICT target and the unique index there is the cost control.
 * sat_daily stores NULL and derives the same all-zero uuid into a generated
 * `zone_key` for its primary key — and the views that feed the map filter on
 * `zone_id is null`. Writing the zero uuid into sat_daily therefore produces
 * rows that exist and that the map cannot see, which is a blank map with a
 * full table behind it. Translate at the boundary, in one place.
 */
export const ZONE_ALL = '00000000-0000-0000-0000-000000000000'
const asZoneId = (v: string | null): string | null => (v && v !== ZONE_ALL ? v : null)

/**
 * Savitzky-Golay, quadratic, 7 points.
 *
 * The coefficients are the standard closed form for a second-order fit over a
 * symmetric 7-point window: [-2, 3, 6, 7, 6, 3, -2] / 21. Points nearer than
 * three days to either end of the series keep their interpolated value, because
 * a window that runs off the end has to invent data to fill itself, and
 * inventing data at the leading edge is inventing today's reading.
 */
export const SG_COEFFICIENTS = [-2, 3, 6, 7, 6, 3, -2]
const SG_NORM = 21
const SG_HALF = 3

export function savitzkyGolay(series: number[]): number[] {
  if (series.length < SG_COEFFICIENTS.length) return series.slice()
  return series.map((raw, i) => {
    if (i < SG_HALF || i >= series.length - SG_HALF) return raw
    let acc = 0
    for (let k = -SG_HALF; k <= SG_HALF; k++) acc += SG_COEFFICIENTS[k + SG_HALF] * series[i + k]
    return acc / SG_NORM
  })
}

const DAY_MS = 86_400_000
export const toDay = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)
export const fromDay = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10)

export type UsableObservation = {
  sensedOn: string
  ndvi: number
  quality: 'full' | 'partial'
}

export type DailyValue = {
  day: string
  ndvi: number
  daysSinceObservation: number
  confidence: 'high' | 'medium' | 'low'
}

/**
 * How much to trust a served day.
 *
 * Tied to the age of the last real look, and capped by the quality of that
 * look: a value resting on a partial observation is never 'high', however
 * recent it is. The bands match the UI degradation the spec requires — solid at
 * 0 to 3 days, hatched at 4 to 8, greyed with a warning past 9.
 */
export function confidenceFor(
  daysSince: number,
  lastQuality: 'full' | 'partial',
): 'high' | 'medium' | 'low' {
  if (daysSince > 8) return 'low'
  if (daysSince > 3) return 'medium'
  return lastQuality === 'full' ? 'high' : 'medium'
}

/**
 * How far backscatter may move before it counts as an event, in decibels.
 *
 * Sentinel-1 is noisy: speckle alone moves a field mean by a decibel or so
 * between passes with nothing happening on the ground. Two decibels is set to
 * sit above that and below the four-to-six that irrigation, a rain event, a
 * cut or a harvest produce. Erring high is the safe direction — it makes radar
 * decline to vouch for a gap more often than it wrongly vouches for one.
 */
export const RADAR_STABLE_DB = 2

/**
 * A radar look that says nothing dramatic happened (spec §3.3).
 *
 * `changeDb` is the move since the previous look FROM THE SAME ORBIT
 * DIRECTION. Comparing across directions measures the incidence angle, not
 * the field.
 */
export type RadarCheck = { day: string; changeDb: number | null }

export function radarSaysStable(check: RadarCheck): boolean {
  return check.changeDb != null && Math.abs(check.changeDb) <= RADAR_STABLE_DB
}

/** How near a radar look has to be to speak for a given day. */
export const RADAR_VOUCH_WINDOW_DAYS = 3

/**
 * Let a quiet radar record lift a stale optical value one step, and no more.
 *
 * The spec's second use for radar: confirming a field has not changed
 * dramatically during a long optical gap, "which raises confidence in the
 * interpolated curve". A gap the radar watched quietly is genuinely better
 * evidence than a gap nobody watched.
 *
 * The ceiling is the point. Radar cannot be turned into a vegetation value
 * (§3.3), so it can never make a day 'high' — that would claim the canopy was
 * measured when all that was established is that nothing blew up. It only
 * rescues 'low' to 'medium'.
 */
export function withRadarSupport(
  confidence: 'high' | 'medium' | 'low',
  day: number,
  stableRadarDays: number[],
): 'high' | 'medium' | 'low' {
  if (confidence !== 'low') return confidence
  const vouched = stableRadarDays.some((d) => Math.abs(d - day) <= RADAR_VOUCH_WINDOW_DAYS)
  return vouched ? 'medium' : 'low'
}

/**
 * The daily series for one subject.
 *
 * Returns nothing at all when there is a single observation: two points are the
 * minimum for a line, and one look repeated across a fortnight is a claim about
 * days nobody looked at.
 */
export function buildDailySeries(
  observations: UsableObservation[],
  radarChecks: RadarCheck[] = [],
): DailyValue[] {
  const stableRadarDays = radarChecks.filter(radarSaysStable).map((c) => toDay(c.day))
  const obs = [...observations]
    .filter((o) => Number.isFinite(o.ndvi))
    .sort((a, b) => a.sensedOn.localeCompare(b.sensedOn))
  if (obs.length < 2) return []

  const first = toDay(obs[0].sensedOn)
  const last = toDay(obs[obs.length - 1].sensedOn)

  // Linear interpolation between bracketing observations, over the OBSERVED
  // span only. The extrapolated tail is appended after smoothing rather than
  // included in it: a filter window straddling the last observation carries the
  // slope leading up to it out past the end, which is the slope-extension this
  // is meant to avoid, just quieter. Whatever happened before the last look, it
  // is not evidence about the days after it.
  const grid: number[] = []
  let cursor = 0
  for (let d = first; d <= last; d++) {
    while (cursor < obs.length - 2 && toDay(obs[cursor + 1].sensedOn) < d) cursor++
    const a = obs[cursor]
    const b = obs[cursor + 1]
    const da = toDay(a.sensedOn)
    const db = toDay(b.sensedOn)
    if (d >= db) {
      grid.push(b.ndvi)
    } else if (d <= da) {
      grid.push(a.ndvi)
    } else {
      const t = (d - da) / (db - da)
      grid.push(a.ndvi + t * (b.ndvi - a.ndvi))
    }
  }

  const smoothed = savitzkyGolay(grid)
  // Flat past the last real look, for at most five days (spec §4.6).
  const held = smoothed[smoothed.length - 1]
  for (let i = 0; i < MAX_EXTRAPOLATION_DAYS; i++) smoothed.push(held)

  return smoothed.map((ndvi, i) => {
    const day = first + i
    // The newest observation at or before this day, and how good it was.
    let lastObs = obs[0]
    for (const o of obs) if (toDay(o.sensedOn) <= day) lastObs = o
    const daysSince = day - toDay(lastObs.sensedOn)
    return {
      day: fromDay(day),
      ndvi: Math.max(-1, Math.min(1, ndvi)),
      daysSinceObservation: daysSince,
      confidence: withRadarSupport(
        confidenceFor(daysSince, lastObs.quality),
        day,
        stableRadarDays,
      ),
    }
  })
}

/**
 * Rebuild sat_daily for every subject that has usable observations.
 *
 * A full rebuild rather than an append: a late-arriving scene changes the
 * interpolation on both sides of itself, and a series that is partly old fit
 * and partly new fit has a step in it that nothing in the data put there.
 */
export async function rebuildDaily(
  sb: SupabaseClient,
  subjectType: 'field' | 'pasture' = 'field',
): Promise<{ subjects: number; days: number }> {
  const { data, error } = await sb
    .from('sat_observations')
    .select('subject_id, zone_id, sensed_on, ndvi_harmonized, quality')
    .eq('subject_type', subjectType)
    .in('quality', ['full', 'partial'])
    // Spec §4.5: never mix UNHARMONIZED sensors. Every sensor here is placed on
    // the Sentinel-2 scale first — natively for Sentinel-2, by a published
    // default for Landsat until this farm has 15 same-day pairs of its own.
    // The series reads ndvi_harmonized for that reason and never ndvi_mean,
    // which is kept as the untouched record of what the sensor said.
    .eq('harmonized', true)
    .order('sensed_on')
  if (error) throw new Error(`reading observations: ${error.message}`)

  type Row = {
    subject_id: string
    zone_id: string | null
    sensed_on: string
    ndvi_harmonized: number | string | null
    quality: 'full' | 'partial'
  }

  // Grouped by subject and zone: a zone's series is fitted on its own points,
  // not sliced out of the field's.
  const groups = new Map<string, { subjectId: string; zoneId: string | null; obs: UsableObservation[] }>()
  for (const r of (data ?? []) as Row[]) {
    const ndvi = typeof r.ndvi_harmonized === 'string' ? Number(r.ndvi_harmonized) : r.ndvi_harmonized
    if (ndvi == null || !Number.isFinite(ndvi)) continue
    const zoneId = asZoneId(r.zone_id)
    const key = `${r.subject_id}|${zoneId ?? ''}`
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { subjectId: r.subject_id, zoneId, obs: [] }))
    g.obs.push({ sensedOn: r.sensed_on, ndvi, quality: r.quality })
  }

  // Radar looks, so a gap the radar watched quietly scores better than a gap
  // nobody watched. Read from the view because the change has to be measured
  // against the previous pass from the SAME orbit direction, and that window
  // function belongs in SQL rather than repeated here.
  const radarBySubject = new Map<string, RadarCheck[]>()
  const { data: radar } = await sb
    .from('sat_radar_change')
    .select('subject_id, sensed_on, vv_change_db')
    .eq('subject_type', subjectType)
  for (const r of (radar ?? []) as { subject_id: string; sensed_on: string; vv_change_db: number | string | null }[]) {
    const change = typeof r.vv_change_db === 'string' ? Number(r.vv_change_db) : r.vv_change_db
    const list = radarBySubject.get(r.subject_id) ?? []
    list.push({ day: r.sensed_on, changeDb: Number.isFinite(change as number) ? (change as number) : null })
    radarBySubject.set(r.subject_id, list)
  }

  let subjects = 0
  let days = 0
  for (const g of groups.values()) {
    // Zones get the field's radar record: Sentinel-1 is not resolved to zones
    // here, and a whole-field "nothing happened" still applies to every part
    // of it.
    const series = buildDailySeries(g.obs, radarBySubject.get(g.subjectId) ?? [])
    if (!series.length) continue
    subjects++
    days += series.length

    const rows = series.map((d) => {
      // Canopy cover and the basal crop coefficient it implies (§8.1). Stored
      // for every day regardless of confidence — the irrigation module decides
      // whether to USE it, and it can only decide that if the number is there
      // to compare against the table value.
      const fcover = fcoverFromNdvi(d.ndvi)
      return {
        subject_type: subjectType,
        subject_id: g.subjectId,
        zone_id: g.zoneId,
        day: d.day,
        ndvi: d.ndvi,
        fcover,
        kc: kcbFromFcover(fcover),
        days_since_observation: d.daysSinceObservation,
        confidence: d.confidence,
      }
    })

    // Clear the subject's existing days before writing. Upsert alone leaves
    // orphans: when an observation is regraded to 'rejected' the series gets
    // SHORTER, and the days that fall off keep their old values and go on being
    // served as current. The doc comment above has always claimed a full
    // rebuild; this is what makes that true.
    const { error: delErr } = await sb
      .from('sat_daily')
      .delete()
      .eq('subject_type', subjectType)
      .eq('subject_id', g.subjectId)
      .eq('zone_key', g.zoneId ?? ZONE_ALL)
    if (delErr) throw new Error(`clearing sat_daily: ${delErr.message}`)

    const { error: upErr } = await sb
      .from('sat_daily')
      .upsert(rows, { onConflict: 'subject_type,subject_id,zone_key,day' })
    if (upErr) throw new Error(`writing sat_daily: ${upErr.message}`)
  }
  return { subjects, days }
}

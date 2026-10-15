import type { SupabaseClient } from '@supabase/supabase-js'

// Anomaly detection (spec §7.2) and the to-do it produces (§7.3).
//
// The alert this module is NOT allowed to raise, and the reason it is worth
// stating in code: "NDVI is low". §7.2 opens by ruling that out. A field that
// runs below its neighbours every year is a sandy knoll, not an emergency, and
// an app that says so every week trains its reader to ignore it.
//
// It is also not allowed to name a disease. A 10 m multispectral pixel cannot
// tell sclerotinia from drought stress, and §7.3 calls any copy implying
// otherwise a defect rather than a feature. What the alert produces is a
// candidate list and a waypoint — directed scouting, which is real and
// considerable, not remote diagnosis, which is not.
//
// ZONE-BASED DETECTION IS ABSENT ON PURPOSE. zone_divergence is the strongest
// of the three detectors and it needs zones, which §7.1 forbids generating
// until two seasons of eight-plus full-quality looks exist. sat_zone_readiness
// reports the gap.

/** A decline this large, this fast, is worth a walk (spec §7.2). */
export const RAPID_DECLINE_FRACTION = 0.15
export const RAPID_DECLINE_WINDOW_DAYS = 10

/** For the field-wide test: this field fell, its neighbours did not. */
export const FIELD_WIDE_DECLINE_FRACTION = 0.10
export const PEER_STEADY_FRACTION = 0.05
/** Below this many same-crop neighbours there is no regional baseline to compare against. */
export const MIN_PEERS = 2

/**
 * When a decline means something.
 *
 * §7.2 qualifies rapid_decline with "during a period when the crop should be
 * stable or growing". Outside that, a 15 % drop in ten days is senescence — the
 * crop doing exactly what it is supposed to — and alerting on it would put a
 * scouting task on every field every autumn until the reader stopped looking.
 *
 * Southern Alberta, crop-agnostic: emergence is well past by mid-May, and
 * cereals begin turning in the third week of August. Deliberately conservative
 * at the end: a missed late-August alert costs one walk, a false one every
 * September costs the credibility of the whole feature.
 */
export const GROWING_WINDOW = { from: { month: 5, day: 15 }, to: { month: 8, day: 20 } }

export function inGrowingWindow(day: string): boolean {
  const [, m, d] = day.split('-').map(Number)
  const after = m > GROWING_WINDOW.from.month || (m === GROWING_WINDOW.from.month && d >= GROWING_WINDOW.from.day)
  const before = m < GROWING_WINDOW.to.month || (m === GROWING_WINDOW.to.month && d <= GROWING_WINDOW.to.day)
  return after && before
}

const DAY_MS = 86_400_000
const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)

export type SeriesPoint = { sensedOn: string; ndvi: number }

export type Candidate = {
  alertType: 'rapid_decline' | 'field_wide_decline'
  sensedOn: string
  magnitude: number
  baseline: number
  observed: number
  detail: Record<string, unknown>
}

/**
 * A steep drop against this field's own recent self.
 *
 * Compares only against the most recent earlier look inside the window. Using
 * the best or the mean of the window instead would let a single smoke-hit
 * observation set an artificially high baseline and manufacture a decline out
 * of the recovery back to normal.
 */
export function detectRapidDecline(series: SeriesPoint[]): Candidate | null {
  const sorted = [...series].sort((a, b) => a.sensedOn.localeCompare(b.sensedOn))
  if (sorted.length < 2) return null
  const latest = sorted[sorted.length - 1]
  if (!inGrowingWindow(latest.sensedOn)) return null

  const prior = sorted
    .slice(0, -1)
    .filter((p) => {
      const gap = daysBetween(p.sensedOn, latest.sensedOn)
      return gap > 0 && gap <= RAPID_DECLINE_WINDOW_DAYS
    })
    .pop()
  if (!prior || prior.ndvi <= 0) return null

  const change = (latest.ndvi - prior.ndvi) / prior.ndvi
  if (change > -RAPID_DECLINE_FRACTION) return null
  return {
    alertType: 'rapid_decline',
    sensedOn: latest.sensedOn,
    magnitude: change,
    baseline: prior.ndvi,
    observed: latest.ndvi,
    detail: {
      previous_look: prior.sensedOn,
      days_elapsed: daysBetween(prior.sensedOn, latest.sensedOn),
    },
  }
}

export type PeerChange = { fieldId: string; change: number }

/**
 * This field fell and its same-crop neighbours did not.
 *
 * The one detector §7.2 singles out as "worth building", because it is the one
 * that separates a field problem from a regional weather event. It is also the
 * one this season's smoke argues loudest for: a smoke-depressed NDVI moves
 * every field at once, so a decline that its neighbours share is exactly what
 * this refuses to raise.
 *
 * The peer figure is a MEDIAN. A mean lets one neighbour with its own problem
 * drag the baseline down and mask a real event here.
 */
export function detectFieldWideDecline(
  own: Candidate | { magnitude: number; sensedOn: string; baseline: number; observed: number } | null,
  peers: PeerChange[],
): Candidate | null {
  if (!own) return null
  if (own.magnitude > -FIELD_WIDE_DECLINE_FRACTION) return null
  if (!inGrowingWindow(own.sensedOn)) return null
  if (peers.length < MIN_PEERS) return null

  const changes = [...peers.map((p) => p.change)].sort((a, b) => a - b)
  const mid = Math.floor(changes.length / 2)
  const median =
    changes.length % 2 ? changes[mid] : (changes[mid - 1] + changes[mid]) / 2

  // Neighbours moved too — that is weather, or smoke, and not this field.
  if (median <= -PEER_STEADY_FRACTION) return null

  return {
    alertType: 'field_wide_decline',
    sensedOn: own.sensedOn,
    magnitude: own.magnitude,
    baseline: own.baseline,
    observed: own.observed,
    detail: {
      peer_fields: peers.length,
      peer_median_change: Number(median.toFixed(4)),
    },
  }
}

/**
 * What the to-do says (spec §7.3).
 *
 * A candidate list, ordered — never a diagnosis. Water stress is ranked first
 * only when the water balance independently says that zone is short, which is
 * the one case where the module has a second source rather than a guess.
 */
export function buildCandidateCauses(waterDeficit: boolean): string[] {
  const causes = [
    'nutrient deficiency',
    'disease pressure',
    'insect pressure',
    'an equipment miss (sprayer or seeder skip)',
    'salinity',
  ]
  return waterDeficit ? ['water stress', ...causes] : [...causes, 'water stress']
}

export function buildAlertTask(input: {
  fieldName: string
  alertType: 'rapid_decline' | 'field_wide_decline'
  magnitude: number
  observedOn: string
  previousOn: string | null
  lat: number | null
  lon: number | null
  waterDeficit: boolean
  waterDetail: string | null
  peerNote: string | null
}): { title: string; description: string } {
  const pct = Math.abs(Math.round(input.magnitude * 100))
  const title =
    input.alertType === 'field_wide_decline'
      ? `Scout ${input.fieldName}: down ${pct}% while neighbours held`
      : `Scout ${input.fieldName}: NDVI down ${pct}%`

  const lines: string[] = []
  lines.push(
    `Satellite NDVI fell ${pct}% by ${input.observedOn}` +
      (input.previousOn ? `, against the previous clear look on ${input.previousOn}.` : '.'),
  )
  lines.push('')
  lines.push('Confirmed on two consecutive clear observations, so this is not a single-pass cloud artifact.')
  if (input.peerNote) lines.push(input.peerNote)
  if (input.lat != null && input.lon != null) {
    lines.push('')
    lines.push(`**Waypoint:** ${input.lat.toFixed(5)}, ${input.lon.toFixed(5)} (field centroid)`)
  }
  lines.push('')
  lines.push('**Possible causes — this is a list to check, not a diagnosis:**')
  for (const c of buildCandidateCauses(input.waterDeficit)) lines.push(`- ${c}`)
  if (input.waterDetail) {
    lines.push('')
    lines.push(input.waterDetail)
  }
  lines.push('')
  lines.push(
    '_Satellite imagery detects that something changed and where to walk. It cannot identify a disease or a pest — a 10 m pixel cannot tell one cause from another. Record what you actually find._',
  )
  return { title, description: lines.join('\n') }
}

type SeriesRow = {
  field_id: string
  name: string
  crop_id: string | null
  sensed_on: string
  ndvi_mean: number | string
  centroid_lat: number | string | null
  centroid_lon: number | string | null
}

const num = (v: number | string | null): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export type AlertRunResult = { detected: number; confirmed: number; lapsed: number; detail: string }

/**
 * Detect, confirm and retire anomalies.
 *
 * The state machine is the whole point. §7.2 requires two consecutive
 * full-quality observations, so nothing here creates a task on first sight —
 * it creates a 'pending' row, and the next clear look either confirms it or
 * lapses it. This season's smoke is the argument: four of six August dates
 * showed a whole-field NDVI collapse of roughly 0.4 that was atmospheric, and
 * a one-look detector would have sent someone to walk every field, twice.
 */
export async function runAlertDetection(sb: SupabaseClient): Promise<AlertRunResult> {
  const { data: rows, error } = await sb
    .from('sat_field_series')
    .select('field_id, name, crop_id, sensed_on, ndvi_mean, centroid_lat, centroid_lon')
    .order('sensed_on')
  if (error) throw new Error(`reading series: ${error.message}`)

  const byField = new Map<string, SeriesRow[]>()
  for (const r of (rows ?? []) as SeriesRow[]) {
    const list = byField.get(r.field_id) ?? []
    list.push(r)
    byField.set(r.field_id, list)
  }

  // Each field's own most recent move, so peers can be compared without
  // recomputing the series per field inside the loop.
  const ownChange = new Map<string, { change: number; cropId: string | null }>()
  for (const [fieldId, list] of byField) {
    const series = list
      .map((r) => ({ sensedOn: r.sensed_on, ndvi: num(r.ndvi_mean) }))
      .filter((p): p is SeriesPoint => p.ndvi != null)
      .sort((a, b) => a.sensedOn.localeCompare(b.sensedOn))
    if (series.length < 2) continue
    const [prev, last] = [series[series.length - 2], series[series.length - 1]]
    if (prev.ndvi > 0) {
      ownChange.set(fieldId, {
        change: (last.ndvi - prev.ndvi) / prev.ndvi,
        cropId: list[list.length - 1].crop_id,
      })
    }
  }

  let detected = 0
  let confirmed = 0
  let lapsed = 0
  const notes: string[] = []

  for (const [fieldId, list] of byField) {
    const series = list
      .map((r) => ({ sensedOn: r.sensed_on, ndvi: num(r.ndvi_mean) }))
      .filter((p): p is SeriesPoint => p.ndvi != null)
    const latest = list[list.length - 1]

    const rapid = detectRapidDecline(series)
    const mine = ownChange.get(fieldId)
    const peers: PeerChange[] = mine
      ? [...ownChange.entries()]
          .filter(([id, v]) => id !== fieldId && v.cropId != null && v.cropId === mine.cropId)
          .map(([id, v]) => ({ fieldId: id, change: v.change }))
      : []
    const fieldWide = detectFieldWideDecline(rapid, peers)

    // One row per (field, type): field_wide is the more specific finding, so
    // when both fire the pair is not two separate walks of the same field.
    const found = [fieldWide ?? rapid].filter(Boolean) as Candidate[]

    for (const type of ['rapid_decline', 'field_wide_decline'] as const) {
      const candidate = found.find((c) => c.alertType === type) ?? null
      const { data: open } = await sb
        .from('sat_alerts')
        .select('id, status, first_seen_on, task_id')
        .eq('subject_id', fieldId)
        .eq('alert_type', type)
        .in('status', ['pending', 'confirmed'])
        .maybeSingle()

      if (candidate) {
        if (!open) {
          await sb.from('sat_alerts').insert({
            subject_type: 'field',
            subject_id: fieldId,
            alert_type: type,
            status: 'pending',
            first_seen_on: candidate.sensedOn,
            magnitude: Number(candidate.magnitude.toFixed(4)),
            baseline_ndvi: candidate.baseline,
            observed_ndvi: candidate.observed,
            detail: candidate.detail,
          })
          detected++
          notes.push(`${latest.name} ${type} pending`)
        } else if (open.status === 'pending' && candidate.sensedOn > open.first_seen_on) {
          // Second consecutive clear look, still showing it. Now it is real.
          const taskId = await createAlertTask(sb, fieldId, latest, candidate, type)
          await sb
            .from('sat_alerts')
            .update({
              status: 'confirmed',
              confirmed_on: candidate.sensedOn,
              magnitude: Number(candidate.magnitude.toFixed(4)),
              observed_ndvi: candidate.observed,
              task_id: taskId,
              updated_at: new Date().toISOString(),
            })
            .eq('id', open.id)
          confirmed++
          notes.push(`${latest.name} ${type} CONFIRMED`)
        }
      } else if (open?.status === 'pending') {
        // Gone on the next clear look. Almost always undetected cloud shadow,
        // and this season, smoke.
        await sb
          .from('sat_alerts')
          .update({ status: 'lapsed', updated_at: new Date().toISOString() })
          .eq('id', open.id)
        lapsed++
      }
    }
  }

  return {
    detected,
    confirmed,
    lapsed,
    detail: `alerts: ${detected} pending, ${confirmed} confirmed, ${lapsed} lapsed` +
      (notes.length ? ` · ${notes.join('; ')}` : ''),
  }
}

async function createAlertTask(
  sb: SupabaseClient,
  fieldId: string,
  latest: SeriesRow,
  candidate: Candidate,
  type: 'rapid_decline' | 'field_wide_decline',
): Promise<string | null> {
  const { data: mgr } = await sb
    .from('users')
    .select('id')
    .eq('active', true)
    .in('role', ['owner', 'manager'])
    .limit(1)
    .maybeSingle()
  if (!mgr?.id) return null

  // §7.3: cross-reference the water balance, and rank water stress first only
  // if it independently says the field is short.
  const { data: bal } = await sb
    .from('water_balance_daily')
    .select('dr_mm, raw_mm, status, date, is_forecast')
    .eq('field_id', fieldId)
    .eq('is_forecast', false)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  const b = bal as { dr_mm: number; raw_mm: number; status: string } | null
  const waterDeficit = !!b && (b.status === 'now' || b.status === 'stress')
  const waterDetail = b
    ? `Water balance on the same field: ${Math.round(b.dr_mm)} mm depleted of ${Math.round(b.raw_mm)} mm readily available (status: ${b.status}).`
    : null

  const { title, description } = buildAlertTask({
    fieldName: latest.name,
    alertType: type,
    magnitude: candidate.magnitude,
    observedOn: candidate.sensedOn,
    previousOn: (candidate.detail.previous_look as string) ?? null,
    lat: num(latest.centroid_lat),
    lon: num(latest.centroid_lon),
    waterDeficit,
    waterDetail,
    peerNote:
      type === 'field_wide_decline'
        ? `${candidate.detail.peer_fields} neighbouring fields of the same crop held steady over the same window, so this is not a regional weather effect.`
        : null,
  })

  const { data: task } = await sb
    .from('tasks')
    .insert({
      title,
      description_md: description,
      field_id: fieldId,
      created_by: mgr.id,
      source: 'satellite',
      source_ref: fieldId,
      crop_year: Number(candidate.sensedOn.slice(0, 4)),
    })
    .select('id')
    .single()
  return (task?.id as string) ?? null
}

/**
 * The map as it was on a past day (Sam, 29 Oct 2026). The date picker beside
 * the Map tabs puts `?on=YYYY-MM-DD` in the address; the satellite photo, NDVI,
 * AIMM and FieldNET layers then show that day, or the nearest thing on file:
 *
 *   satellite  the image of each field taken nearest that day, either side
 *   AIMM       each field's water balance on that day (or the last before it)
 *   FieldNET   each pivot from its recorded passes: running if a pass ran that
 *              day, its arm where the last pass up to then left it
 */
import type { Database } from './database.types'

type FieldnetSystem = Database['public']['Tables']['fieldnet_systems']['Row']

/** A valid past day from the address, or null for "now". */
export function asOfDay(raw: string | null | undefined, today: string): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  if (Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) return null
  return raw < today ? raw : null
}

/**
 * When the imagery on screen was actually taken.
 *
 * Each subject is imaged on its own pass, so a map rarely shows one day: this
 * reports the span when they differ. Said plainly, because "as of 14 Oct"
 * showing an image from the 4th is the one way a date picker can mislead.
 */
export function photoDateLabel(days: string[]): string {
  const fmt = (d: string) =>
    // en-CA, not the browser's locale: the rest of the app writes dates this
    // way, and a label that reads "Aug 4" on one machine and "4 Aug" on another
    // is also a label no test can pin down.
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-CA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
  const sorted = [...new Set(days)].sort()
  const oldest = sorted[0]
  const newest = sorted[sorted.length - 1]
  return oldest === newest ? `Taken ${fmt(newest)}.` : `Taken ${fmt(oldest)} to ${fmt(newest)}.`
}

/**
 * One capture day back or forward through `days`.
 *
 * A null `day` means "the latest", which is the last day in the list, so
 * stepping is just walking that list. Landing on the newest day returns null
 * again rather than that date: the map is then showing current imagery, and
 * pinning today's date in the address would only go stale tomorrow.
 *
 * `moved` says whether there was anywhere to go, because null is both "the
 * latest" and, at the ends, "no change" — a caller needs to tell them apart to
 * know whether to disable its button.
 */
export function stepDay(
  days: string[],
  day: string | null,
  dir: -1 | 1,
): { day: string | null; moved: boolean } {
  const sorted = [...new Set(days)].sort()
  const stay = { day, moved: false }
  if (!sorted.length) return stay
  const last = sorted.length - 1
  // Where we are standing. A date typed into the address need not be a capture
  // day, so it stands on the last day up to it, or before the list entirely.
  // Ascending and deduped, so the count of days up to it is its index, plus one.
  const at = day == null ? last : sorted.filter((d) => d <= day).length - 1
  const to = at === -1 ? (dir === 1 ? 0 : -1) : at + dir
  if (to < 0 || to > last) return stay
  return { day: to === last ? null : sorted[to], moved: true }
}

/** Days between two YYYY-MM-DD dates, ignoring sign. */
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000

/** Each subject's row taken nearest the day; on a tie, the earlier one (what was known on the day). */
export function nearestPerSubject<T extends { subject_id: string; sensed_on: string }>(rows: T[], day: string): T[] {
  const best = new Map<string, T>()
  for (const r of rows) {
    const b = best.get(r.subject_id)
    if (!b) {
      best.set(r.subject_id, r)
      continue
    }
    const d = daysApart(r.sensed_on, day)
    const bd = daysApart(b.sensed_on, day)
    if (d < bd || (d === bd && r.sensed_on < b.sensed_on)) best.set(r.subject_id, r)
  }
  return [...best.values()]
}

export type PivotPass = {
  fieldnet_id: string
  started_at: string
  ended_at: string | null
  start_deg: number | string | null
  end_deg: number | string | null
  direction: string | null
}

/**
 * The pivots as they stood on a past day, from their passes. `dayStart` and
 * `dayEnd` bound the day (instants). A pass that overlapped the day makes the
 * pivot "running"; its arm sits where the last pass started by the end of the
 * day left it. Comms and alarms are today's facts, so they are not carried
 * back: a pivot with no pass reads plain off.
 */
export function systemsOn(systems: FieldnetSystem[], passes: PivotPass[], dayStart: Date, dayEnd: Date): FieldnetSystem[] {
  const byPivot = new Map<string, PivotPass[]>()
  for (const p of passes) {
    if (Date.parse(p.started_at) > dayEnd.getTime()) continue
    const list = byPivot.get(p.fieldnet_id) ?? []
    list.push(p)
    byPivot.set(p.fieldnet_id, list)
  }
  return systems.map((s) => {
    const mine = (byPivot.get(s.fieldnet_id) ?? []).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
    const ran = mine.filter((p) => (p.ended_at == null ? Infinity : Date.parse(p.ended_at)) >= dayStart.getTime())
    const last = mine[mine.length - 1]
    const raw = s.raw && typeof s.raw === 'object' && !Array.isArray(s.raw) ? (s.raw as Record<string, unknown>) : {}
    const deg = last ? Number(last.end_deg ?? last.start_deg) : NaN
    return {
      ...s,
      comms_status: 'online',
      is_water_on: ran.length > 0,
      operational_status: ran.length > 0 ? 'running' : 'powered-off',
      direction: (ran[ran.length - 1] ?? last)?.direction ?? s.direction,
      raw: (Number.isFinite(deg) ? { ...raw, pivot_angle: deg } : raw) as FieldnetSystem['raw'],
    }
  })
}

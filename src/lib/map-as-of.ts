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

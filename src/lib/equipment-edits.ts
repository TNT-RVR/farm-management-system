/**
 * Which parts of a machine's record a person may change, and the service-log
 * arithmetic behind editing one (Sam, 7 Oct 2026). Pure, for the tests.
 */

/**
 * The columns the John Deere sync writes on every run (netlify/shared/
 * jd-equipment-core.ts upserts them by jd_id). A change made here to one of
 * these on a Deere machine would be put back by the next sync, so for those
 * machines they are not offered; a hand-added machine is never synced, so all
 * of them are its own.
 */
export const DEERE_SYNCED_COLUMNS = [
  'name',
  'category',
  'make',
  'model',
  'equipment_type',
  'serial_number',
  'vin',
  'engine_hours',
  'engine_hours_at',
  'archived',
] as const

/** Ours on every machine: the sync never writes these. */
export const ALWAYS_OURS = ['notes', 'warranty_provider', 'warranty_starts_on', 'warranty_expires_on', 'warranty_hours', 'warranty_note'] as const

export function editableEquipmentColumns(isManual: boolean): string[] {
  return isManual ? [...DEERE_SYNCED_COLUMNS, ...ALWAYS_OURS] : [...ALWAYS_OURS]
}

/** A hand-added machine's jd_id: unique, and never one of Deere's ids (the same "manual:" prefix the scale loads use). */
export function newManualJdId(uuid: string = crypto.randomUUID()): string {
  return `manual:${uuid}`
}

/**
 * A hand-added machine's edit, ready to save: only its own columns, and a
 * changed hour-meter reading dated now (a reading with no date cannot be
 * judged — see jd_equipment.engine_hours_at).
 */
export function manualEquipmentPatch(
  before: { engine_hours: number | null },
  patch: Record<string, unknown>,
  now: Date = new Date(),
): Record<string, unknown> {
  const allowed = new Set(editableEquipmentColumns(true))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) if (allowed.has(k)) out[k] = v
  if ('archived' in out) out.archived = out.archived === true || out.archived === 'true'
  if ('engine_hours' in out) {
    const was = before.engine_hours == null ? null : Number(before.engine_hours)
    const is = out.engine_hours == null ? null : Number(out.engine_hours)
    if (was !== is) out.engine_hours_at = is == null ? null : now.toISOString()
    else delete out.engine_hours
  }
  return out
}

type LogEntry = { id: string; plan_id: string | null; done_on: string; engine_hours: number | null; created_at?: string }

/**
 * The service a plan's "last done" should rest on: its most recent log entry
 * (by date, then by when it was written). Null when the plan has none left —
 * the caller then leaves the plan's baseline as it was, since it may have been
 * set by hand in the plan form.
 */
export function latestForPlan(logs: LogEntry[], planId: string): { done_on: string; engine_hours: number | null } | null {
  const mine = logs.filter((l) => l.plan_id === planId)
  if (!mine.length) return null
  mine.sort((a, b) => (a.done_on === b.done_on ? (b.created_at ?? '').localeCompare(a.created_at ?? '') : b.done_on.localeCompare(a.done_on)))
  return { done_on: mine[0].done_on, engine_hours: mine[0].engine_hours }
}

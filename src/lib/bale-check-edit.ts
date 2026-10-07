import type { BaleReading } from './bale-checks'

/**
 * What saving an edited bale check does to its readings (Sam, 7 Oct 2026:
 * a check can be corrected, not only deleted). Readings are changed in place
 * by id rather than deleted and re-added, so the audit log shows a corrected
 * temperature as a correction and a failed save loses nothing.
 */
export function diffReadings(
  before: BaleReading[],
  after: BaleReading[],
): { update: (BaleReading & { id: string })[]; insert: BaleReading[]; remove: string[] } {
  const rows = after.map((r, i) => ({ ...r, sort_order: i }))
  const keep = new Set(rows.flatMap((r) => (r.id ? [r.id] : [])))
  return {
    update: rows.filter((r): r is BaleReading & { id: string } => !!r.id && before.some((b) => b.id === r.id)),
    insert: rows.filter((r) => !r.id || !before.some((b) => b.id === r.id)).map((r) => ({ ...r, id: undefined })),
    remove: before.flatMap((b) => (b.id && !keep.has(b.id) ? [b.id] : [])),
  }
}

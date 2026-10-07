/**
 * The small rules behind editing and deleting irrigation records by hand
 * (Sam, 7 Oct 2026: every row opens to its detail, with edit, delete and
 * add). Pure, so they can be tested without a database.
 */

/** 1 acre-foot in cubic metres. */
export const M3_PER_ACRE_FOOT = 1233.48

/**
 * A licence's annual volume both ways. Most licences carry acre-feet in
 * `volume`; some were typed from the licence in m³. Whichever is missing is
 * worked out from the other.
 */
export function licenceVolumes(l: { volume: number | null; volume_m3: number | null }): { af: number | null; m3: number | null } {
  const af = l.volume != null ? Number(l.volume) : l.volume_m3 != null ? Number(l.volume_m3) / M3_PER_ACRE_FOOT : null
  const m3 = l.volume_m3 != null ? Number(l.volume_m3) : l.volume != null ? Number(l.volume) * M3_PER_ACRE_FOOT : null
  return { af, m3 }
}

/**
 * What deleting a licence leaves behind: the pivots on it fall back to no
 * licence (field_pivots.water_licence_id is ON DELETE SET NULL), so the
 * confirm names them.
 */
export function licenceDeleteConfirm(number: string | null, fieldsOnIt: string[]): string {
  const what = `Delete licence ${number ?? '(no number)'}?`
  if (!fieldsOnIt.length) return `${what} This cannot be undone from here.`
  return `${what} ${fieldsOnIt.length === 1 ? 'The pivot on' : `The ${fieldsOnIt.length} pivots on`} ${fieldsOnIt.join(', ')} will be left with no licence, and their water share with it.`
}

/** The same for a pump: the pivots it feeds lose their pump (ON DELETE SET NULL); its photos go with it. */
export function pumpDeleteConfirm(name: string, fieldsFed: string[], sharesMeter: string[]): string {
  const parts = [`Delete ${name}? Its photos go with it.`]
  if (fieldsFed.length) parts.push(`${fieldsFed.length === 1 ? 'The pivot on' : `The ${fieldsFed.length} pivots on`} ${fieldsFed.join(', ')} will be left with no pump.`)
  if (sharesMeter.length) parts.push(`${sharesMeter.join(', ')} ${sharesMeter.length === 1 ? 'runs' : 'run'} off its meter and will show no meter.`)
  return parts.join(' ')
}

/**
 * A pass logged by a person rather than read from FieldNET. FieldNET's rows
 * carry a fieldnet_ref and are rewritten every hour, so deleting or re-dating
 * one would only see it come back; those are corrected instead.
 */
export function isHandLogged(e: { source: string | null; fieldnet_ref?: string | null }): boolean {
  return e.source !== 'fieldnet' && !e.fieldnet_ref
}

/** irrigation_events: delete is the manager's, or the person who logged it (events_delete policy). */
export function canRemoveEvent(e: { created_by: string | null }, userId: string | null | undefined, isManager: boolean): boolean {
  return isManager || (userId != null && e.created_by === userId)
}

/**
 * A soil reading's field capacity, read back off the reading itself: it was
 * saved as available mm and the share of capacity that was, so editing the
 * depth can keep the % honest without the form needing the soil profile.
 */
export function fcFromReading(availMm: number | null, pctOfFc: number | null): number | null {
  if (availMm == null || pctOfFc == null || !(pctOfFc > 0)) return null
  return Number(availMm) / (Number(pctOfFc) / 100)
}

/** The % of capacity for a corrected depth, to one decimal like the form saves it. */
export function pctOfFcFor(availMm: number, fc: number | null): number | null {
  if (fc == null || !(fc > 0)) return null
  return Math.round((availMm / fc) * 1000) / 10
}

/**
 * An edited pivot depth check, ready to save. The panel's depth was worked out
 * for the speed the check was run at, so a corrected speed moves it too (the
 * panel's 100% depth over the new speed); without the 100% depth the stored
 * panel figure stands. Depths are kept to 0.01 mm as the form saves them.
 */
export function depthCheckPatch(
  before: { speed_pct: number | null; panel_mm: number | null },
  edited: { checked_on: string; method: string; speed_pct: number | null; measured_mm: number; note: string | null },
  panel100Mm: number | null,
): { checked_on: string; method: string; speed_pct: number | null; measured_mm: number; note: string | null; panel_mm?: number | null } {
  const speed = edited.speed_pct != null && edited.speed_pct > 0 ? edited.speed_pct : null
  const out: ReturnType<typeof depthCheckPatch> = { ...edited, speed_pct: speed, measured_mm: Math.round(edited.measured_mm * 100) / 100 }
  const speedChanged = (speed ?? 100) !== (before.speed_pct != null ? Number(before.speed_pct) : 100)
  if (speedChanged && panel100Mm != null && panel100Mm > 0) out.panel_mm = Math.round((panel100Mm / ((speed ?? 100) / 100)) * 100) / 100
  return out
}

/** The changed keys only, so an edit does not write back what it did not touch. */
export function changedOnly(before: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    const was = before[k]
    const same = (was == null && v == null) || (typeof v === 'number' && was != null ? Number(was) === v : was === v)
    if (!same) out[k] = v
  }
  return out
}

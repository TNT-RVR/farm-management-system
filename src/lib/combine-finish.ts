import { SETTINGS, type SettingKey } from './combine'

/**
 * "Field finished" (Sam, 17 Oct 2026): the record that a field, or one
 * crop area of it, is done. Saved as a field work record (counts_as
 * 'harvest', field_finished true; why: migration 20261017050000), with what
 * each combine ran written to combine_settings_used and linked to it, so the
 * next field of the crop starts from it. The form is
 * components/FieldFinishedForm.tsx. Pure.
 */

/** The longest operator text combine_settings_used keeps. */
export const OPERATOR_MAX = 80

/** "Alex, Sam, a custom operator", cut to what the column keeps. */
export function operatorText(names: readonly string[]): string | null {
  const t = names.map((n) => n.trim()).filter(Boolean).join(', ')
  if (!t) return null
  return t.length <= OPERATOR_MAX ? t : `${t.slice(0, OPERATOR_MAX - 1)}…`
}

export type ExistingSettingsRow = { id: string; equipment_id: string | null }

export type SettingsSync = {
  /** Rows kept, rewritten with the new values. */
  update: ExistingSettingsRow[]
  /** Combines (or null for "no combine named") that need a new row. */
  insert: (string | null)[]
  /** Rows of combines taken off the finish. */
  remove: string[]
}

/**
 * One settings row per combine on the finish (one with no combine when none
 * is named): keep the rows whose combine is still there, add rows for the
 * new ones, remove the rest. A finish with two combines says both ran these.
 */
export function syncSettingsRows(existing: readonly ExistingSettingsRow[], combineIds: readonly string[]): SettingsSync {
  const want: (string | null)[] = combineIds.length ? [...new Set(combineIds)] : [null]
  const update: ExistingSettingsRow[] = []
  const remove: string[] = []
  const taken = new Set<string | null>()
  for (const r of existing) {
    if (want.includes(r.equipment_id) && !taken.has(r.equipment_id)) {
      update.push(r)
      taken.add(r.equipment_id)
    } else remove.push(r.id)
  }
  return { update, insert: want.filter((w) => !taken.has(w)), remove }
}

/** The values to store, or null when nothing at all was entered. */
export function settingsValues(values: Partial<Record<SettingKey, number | null>>): Partial<Record<SettingKey, number | null>> | null {
  const out: Partial<Record<SettingKey, number | null>> = {}
  let any = false
  for (const s of SETTINGS) {
    const v = values[s.key]
    out[s.key] = v != null && Number.isFinite(v) ? v : null
    if (out[s.key] != null) any = true
  }
  return any ? out : null
}

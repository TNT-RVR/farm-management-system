import { SETTINGS, type SettingKey } from './combine'
import { inchText, parseInches } from './combine-manual'
import type { PickedSetting } from './combine-start'

/** The combine settings as text, the way the display shows them, and back (pages/combine/SettingInputs.tsx). */

/** Openings the display shows in inches (kept in mm). */
export const IN_INCHES: SettingKey[] = ['concave_mm', 'presieve_mm', 'chaffer_mm', 'sieve_mm']

/** A stored value as the box shows it: inches as fractions, the rest as numbers. */
export const settingText = (k: SettingKey, v: number | null | undefined) => (v == null ? '' : IN_INCHES.includes(k) ? inchText(v) : String(v))

/** What was typed, as the value to store; null when blank or not a number. */
export const settingValue = (k: SettingKey, raw: string): number | null => {
  if (raw.trim() === '') return null
  const n = IN_INCHES.includes(k) ? parseInches(raw) : Number(raw)
  return n != null && Number.isFinite(n) ? n : null
}

export const SETTING_LABEL = Object.fromEntries(SETTINGS.map((s) => [s.key, s])) as Record<SettingKey, (typeof SETTINGS)[number]>

/** "Rotor speed 650 · Concave clearance 1 in · …", for one-line summaries. Blanks left out. */
export function settingsLine(v: Partial<Record<SettingKey, number | string | null>>, keys: SettingKey[] = SETTINGS.map((s) => s.key)): string {
  return keys
    .filter((k) => v[k] != null && v[k] !== '' && Number.isFinite(Number(v[k])))
    .map((k) => `${SETTING_LABEL[k].label} ${settingText(k, Number(v[k]))}${IN_INCHES.includes(k) ? ' in' : ` ${SETTING_LABEL[k].unit}`}`)
    .join(' · ')
}

/** The list's values: what was typed, else the prefill. */
export function valuesOf(picked: PickedSetting[], draft: Partial<Record<SettingKey, string>>): Partial<Record<SettingKey, number | null>> {
  const by = new Map(picked.map((p) => [p.key, p]))
  const out: Partial<Record<SettingKey, number | null>> = {}
  for (const s of SETTINGS) out[s.key] = draft[s.key] !== undefined ? settingValue(s.key, draft[s.key]!) : (by.get(s.key)?.value ?? null)
  return out
}

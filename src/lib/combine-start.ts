import { CROP_BASELINES, SETTINGS, type CombineCropKey, type SettingKey } from './combine'
import { startingPoints } from './combine-manual'
import { MONITOR_NAME_MAX, shortenForMonitor } from './combine-monitor'

/**
 * "Start a field" (Sam, 17 Oct 2026): everything to set on the combine
 * display when the combine moves onto a field, in the order it is done in
 * the cab, with the values the app already knows. Pure; the card is
 * pages/combine/StartFieldCard.tsx.
 */

/** The display's Header Type choices this card offers, as the display names them. */
export const HEADER_TYPES = ['Grain', 'Draper', 'Flex', 'Pickup', 'Corn'] as const
export type HeaderType = (typeof HEADER_TYPES)[number]

/** The Operation Instance when no default is set. */
export const DEFAULT_OPERATION_INSTANCE = 'Grain Harv 1'

/** A name as the display takes it: 18 at most, fractions as words. */
export const monitorText = (s: string | null | undefined): string => (s?.trim() ? shortenForMonitor(s.trim()) : '')

/** What a field's harvest method is known from, for the header. */
export type SwathEvidence = { plan: 'swathed' | 'straight' | null; swathedOn: string | null }

/**
 * The header to run, and why. Swathed (the crop plan says so, or the field
 * has a swathing record for its own crop) → a pickup header. Otherwise the
 * crop decides: corn takes a corn head, beans a flex header (low pods),
 * canola a draper, cereals a grain header.
 */
export function suggestHeader(cropKey: CombineCropKey | null, ev: SwathEvidence): { header: HeaderType; why: string } {
  if (cropKey === 'corn') return { header: 'Corn', why: 'Corn: corn head.' }
  if (ev.plan === 'swathed') return { header: 'Pickup', why: 'Swathed (crop plan): pick up the swaths.' }
  if (ev.swathedOn && ev.plan !== 'straight') return { header: 'Pickup', why: `Swathed ${ev.swathedOn} (field work): pick up the swaths.` }
  const how = ev.plan === 'straight' ? 'Straight-cut (crop plan)' : 'Straight-cut (no swathing recorded)'
  if (cropKey === 'beans') return { header: 'Flex', why: `${how}: flex header follows the ground for low pods.` }
  if (cropKey === 'canola') return { header: 'Draper', why: `${how}: draper feeds canola evenly with less shatter.` }
  return { header: 'Grain', why: `${how}.` }
}

/** Managers' Operation Instance defaults (operating_settings 'combine_start'). */
export type StartDefaults = { operation_instance?: { crop?: Partial<Record<string, string>>; header?: Partial<Record<string, string>> } }

export function startDefaultsOf(json: unknown): StartDefaults {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
  const oi = (json as StartDefaults).operation_instance
  const clean = (m: unknown) =>
    m && typeof m === 'object' && !Array.isArray(m)
      ? Object.fromEntries(Object.entries(m as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, (v as string).trim()]))
      : {}
  return oi ? { operation_instance: { crop: clean(oi.crop), header: clean(oi.header) } } : {}
}

/** The Operation Instance: this crop's default, else this header's, else "Grain Harv 1". */
export function operationInstanceFor(d: StartDefaults, cropKey: CombineCropKey | null, header: string | null): { value: string; why: string } {
  const byCrop = cropKey ? d.operation_instance?.crop?.[cropKey] : undefined
  if (byCrop) return { value: monitorText(byCrop), why: 'The default for this crop.' }
  const byHeader = header ? d.operation_instance?.header?.[header] : undefined
  if (byHeader) return { value: monitorText(byHeader), why: `The default for the ${header} header.` }
  return { value: DEFAULT_OPERATION_INSTANCE, why: 'No default set.' }
}

/* ── Which settings, and why ────────────────────────────────────────────── */

/** One row of combine_settings_used: what a combine ran on a field on a day. */
export type UsedSettings = Partial<Record<SettingKey, number | string | null>> & {
  id: string
  crop_key: string
  used_on: string
  created_at?: string | null
  field_id: string | null
  equipment_id: string | null
  header_type?: string | null
  operation_instance?: string | null
  operator?: string | null
  tag?: string | null
  /** The display's Variety (20261017050000). */
  variety?: string | null
  /** The Field finished record these were saved with (20261017050000). */
  work_record_id?: string | null
  notes?: string | null
  crop_year?: number
}

/** One row of combine_settings: the saved setting for a crop in a year. */
export type SavedSettings = Partial<Record<SettingKey, number | string | null>> & { crop_key: string; crop_year: number }

export type SettingSource = 'used' | 'saved' | 'manual' | 'estimate'

export type PickedSetting = {
  key: SettingKey
  value: number
  source: SettingSource
  /** "Last used on Field 3, 12 Oct 2026", "Your saved 2026 setting", "Manual starting point". */
  why: string
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2027-09-10" → "10 Sep 2027". */
export const dayText = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso
}

/**
 * Each setting for a crop, taken from the newest place that has it:
 *   1. the last time it was used on this crop (this combine's last first,
 *      when a combine is picked, then either combine's);
 *   2. the saved setting for the crop, this year's, else the latest year's;
 *   3. the operator's manual starting point (or our estimate where the book
 *      has none).
 * Each setting falls through on its own: a row that left the fan blank does
 * not blank the fan.
 */
export function pickSettings(opts: {
  cropKey: CombineCropKey
  cropYear: number
  used: UsedSettings[]
  saved: SavedSettings[]
  equipmentId?: string | null
  fieldName: (id: string | null) => string | null
  combineName?: (id: string | null) => string | null
}): PickedSetting[] {
  const newest = (a: UsedSettings, b: UsedSettings) => b.used_on.localeCompare(a.used_on) || (b.created_at ?? '').localeCompare(a.created_at ?? '')
  const mine = opts.used.filter((u) => u.crop_key === opts.cropKey).sort(newest)
  const ordered = opts.equipmentId ? [...mine.filter((u) => u.equipment_id === opts.equipmentId), ...mine.filter((u) => u.equipment_id !== opts.equipmentId)] : mine
  const saved = opts.saved
    .filter((s) => s.crop_key === opts.cropKey && s.crop_year <= opts.cropYear)
    .sort((a, b) => b.crop_year - a.crop_year)
  const starts = startingPoints(opts.cropKey)
  return SETTINGS.map((s): PickedSetting => {
    const u = ordered.find((r) => num(r[s.key]) != null)
    if (u) {
      const field = opts.fieldName(u.field_id)
      const other = opts.equipmentId && u.equipment_id && u.equipment_id !== opts.equipmentId ? opts.combineName?.(u.equipment_id) : null
      return { key: s.key, value: num(u[s.key])!, source: 'used', why: `Last used${field ? ` on ${field}` : ''}, ${dayText(u.used_on)}${other ? ` (${other})` : ''}` }
    }
    const sv = saved.find((r) => num(r[s.key]) != null)
    if (sv) return { key: s.key, value: num(sv[s.key])!, source: 'saved', why: `Your saved ${sv.crop_year} setting` }
    const st = starts[s.key]
    return { key: s.key, value: st.value, source: st.source, why: st.source === 'manual' ? 'Manual starting point' : 'Our starting estimate' }
  })
}

/** The crop's label ("Canola"), for headings. */
export const cropLabel = (k: CombineCropKey) => CROP_BASELINES.find((c) => c.key === k)?.label ?? k

/* ── The steps ─────────────────────────────────────────────────────────── */

export type StepKey = 'place' | 'task' | 'operator' | 'header' | 'instance' | 'variety' | 'tag' | 'settings' | 'speed' | 'finish'

/** The checklist, in cab order: title, and the one-line how. */
export const START_STEPS: { key: StepKey; title: string; how: string }[] = [
  { key: 'place', title: 'Grower, Farm, Field', how: 'Run screen → SET UP tab: check Grower, Farm and Field. Not there? Create it in Data Management.' },
  { key: 'task', title: 'New task, area reset', how: 'Start a new Task and reset the area count. The display names it by date and time, e.g. 26/10/15-17:52:56.' },
  { key: 'operator', title: 'Operator', how: `Pick or type the Operator (${MONITOR_NAME_MAX} characters at most).` },
  { key: 'header', title: 'Header type', how: 'Set the Header Type for the header on the machine.' },
  { key: 'instance', title: 'Operation Instance', how: 'Set the Operation Instance.' },
  // The variety goes in the display's Variety (its VarietyZone feature: Crop
  // Type -> Variety, picked from the Variety Legend), not in Tag (17 Oct 2026).
  { key: 'variety', title: 'Variety', how: 'Crop Type → Variety. Not in the list? Add it to the Variety Legend first.' },
  { key: 'tag', title: 'Tag (optional)', how: `Optional, e.g. a seed contract number (${MONITOR_NAME_MAX} characters at most).` },
  { key: 'settings', title: 'Work condition and ACS settings', how: 'Enter or check each one on the Work Condition.' },
  { key: 'speed', title: 'Ground speed', how: 'Start at this and adjust to the loss checks.' },
  { key: 'finish', title: 'Mark this field finished', how: 'When the last of it is off: the finish time and what the combine ran.' },
]

/** Steps that need not be ticked for the field to be set up. */
export const OPTIONAL_STEPS: StepKey[] = ['tag', 'finish']

/** The Work Condition / ACS settings: every stored setting but ground speed, which is its own step. */
export const ACS_KEYS: SettingKey[] = SETTINGS.map((s) => s.key).filter((k) => k !== 'ground_speed_mph')

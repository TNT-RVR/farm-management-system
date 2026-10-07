import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { soilCapacities, useSoilProfiles } from './irrigation'
import { depthToMm, type UnitSystem } from './units'

/**
 * Measured soil moisture (soil_moisture_readings): the AIMM page's
 * "corrected to measured". On a reading's day the irrigation balance is set to
 * it, and two or more readings teach a field its own water-use calibration.
 * Taken on the AIMM page and on the field forms (scouting, crop inspection);
 * both write the same row, so a reading taken while scouting shows on AIMM.
 */

export const SOIL_METHODS = [
  { value: 'hand_feel', label: 'Hand-feel' },
  { value: 'probe', label: 'Probe' },
  { value: 'sensor', label: 'Logger / sensor' },
  { value: 'lab', label: 'Lab (gravimetric)' },
] as const
export type SoilMethod = (typeof SOIL_METHODS)[number]['value']

/** How to take a hand-feel reading; heads the FEEL_GUIDE table. */
export const FEEL_HOW =
  'Take soil from the top, middle and bottom of the root zone (a probe or shovel to ~1 m), squeeze a handful from each, judge the share of available water left, and average the depths.'

/**
 * The hand-feel method in short (after the NRCS "feel and appearance" guide
 * AIMM's Appendix III follows): squeeze a handful from each depth, judge the
 * share of available water left, average the depths.
 */
export const FEEL_GUIDE: [string, string][] = [
  ['0–25%', 'Dry, loose; won’t hold together (sands) or hard, cracked, crumbles to powder (loams, clays).'],
  ['25–50%', 'Holds together weakly; crumbles easily (sands). Forms a crumbly ball that won’t ribbon (loams). Pliable but not sticky (clays).'],
  ['50–75%', 'Forms a weak ball; may stain the hand (sands). A ball that holds; short ribbon (loams). A firm ball; ribbons 2–5 cm (clays).'],
  ['75–100%', 'Wet outline on the hand; forms a ball (sands). Pliable ball, slick; ribbons easily (loams). Sticky, ribbons over 5 cm (clays).'],
  ['Over 100%', 'Free water appears when squeezed — above field capacity.'],
]

/** What a form holds before it is saved. `value` is as typed; '' = no reading. */
export type SoilReadingDraft = {
  by: 'pct' | 'depth'
  value: string
  method: SoilMethod
  note: string
}
export const EMPTY_SOIL_READING: SoilReadingDraft = { by: 'pct', value: '', method: 'hand_feel', note: '' }

/**
 * Available water in mm over the root zone. A percentage needs the field's
 * capacity; a depth is in the display unit. null when it cannot be worked out.
 */
export function readingToMm(d: Pick<SoilReadingDraft, 'by' | 'value'>, fc: number | null, u: UnitSystem): number | null {
  if (d.value.trim() === '') return null
  const v = Number(d.value)
  if (!Number.isFinite(v) || v < 0) return null
  if (d.by === 'pct') return fc != null && fc > 0 ? (v / 100) * fc : null
  return depthToMm(v, u)
}

/** Why a typed reading cannot be saved, or null when it can (or is blank). */
export function readingProblem(d: SoilReadingDraft, fc: number | null, u: UnitSystem): string | null {
  if (d.value.trim() === '') return null
  const mm = readingToMm(d, fc, u)
  if (mm == null)
    return d.by === 'pct' && fc == null
      ? 'This field has no soil capacity yet — enter the reading as a depth instead.'
      : 'Soil moisture must be a number, 0 or more.'
  if (mm >= 600) return 'That is more water than any root zone holds — check the number.'
  return null
}

/** The field's capacity (mm over the max root zone) from its AIMM soil profile. */
export function useFieldCapacity(fieldId: string | null | undefined): number | null {
  const { data: profiles } = useSoilProfiles()
  if (!fieldId) return null
  return soilCapacities(profiles?.find((p) => p.field_id === fieldId))?.fc100 ?? null
}

export type SoilReadingSave = {
  fieldId: string
  readOn: string
  mm: number
  fc: number | null
  method: SoilMethod
  note: string | null
}

/**
 * One whole-field reading per field and day. The table's unique key counts a
 * null zone as always distinct, so an upsert on it inserts a second row rather
 * than replacing the first; look the day up and update it instead.
 */
export async function saveSoilReading(r: SoilReadingSave) {
  const row = {
    avail_mm: Math.round(r.mm * 10) / 10,
    pct_of_fc: r.fc ? Math.round((r.mm / r.fc) * 1000) / 10 : null,
    method: r.method,
    note: r.note,
  }
  const { data: existing, error: findErr } = await supabase
    .from('soil_moisture_readings')
    .select('id')
    .eq('field_id', r.fieldId)
    .is('zone_id', null)
    .eq('read_on', r.readOn)
    .limit(1)
  if (findErr) throw findErr
  const { error } = existing?.length
    ? await supabase.from('soil_moisture_readings').update(row).eq('id', existing[0].id)
    : await supabase.from('soil_moisture_readings').insert({ ...row, field_id: r.fieldId, read_on: r.readOn })
  if (error) throw error
}

export function useSaveSoilReading() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveSoilReading,
    onSuccess: (_d, r) => void qc.invalidateQueries({ queryKey: ['soil_moisture_readings', r.fieldId] }),
  })
}

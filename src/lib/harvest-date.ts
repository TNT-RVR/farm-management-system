import { farmTz } from './farm-context'
/**
 * The harvest date the irrigation balance uses for a field's season. After it
 * the crop curve stops and the field drops to Kc 0.1 (bare soil), so a date
 * left blank keeps a combined field drawing crop water to the end of its curve.
 *
 * AIMM Setup takes it by hand; the rest of the app usually already knows:
 *  1. a date a person typed in AIMM Setup (field_crop_seasons.harvest_date)
 *     always wins — they may know the monitor was logging the wrong field;
 *  2. the load marked "last from field" on the weigh-in form: a person saying
 *     the field is done, on the day the last of it came off;
 *  3. the last day Deere logged a harvest pass on the field. Deere merges every
 *     visit into one operation, so its end is the last time the combine was on
 *     the field; while harvest is still running it moves forward each day.
 *
 * Nothing found leaves the date blank, and the balance runs the crop curve out.
 */

export type HarvestSource = 'manual' | 'last_load' | 'john_deere'

export const HARVEST_SOURCE_LABEL: Record<HarvestSource, string> = {
  manual: 'typed in Setup',
  last_load: 'last load from the field',
  john_deere: 'last Deere harvest pass',
}

export type HarvestEvidence = {
  /** field_crop_seasons.harvest_date — only ever written by a person. */
  typed: string | null
  /** Latest bin_loads.loaded_on with last_from_field, this crop year. */
  lastLoadOn: string | null
  /** Latest farm-local day a Deere harvest operation ended, this crop year. */
  jdLastPassOn: string | null
}

/**
 * Picks the date and says where it came from. A machine date on or before
 * planting (last year's pass filed against this season) or after today (a
 * mistyped load) is not a harvest of this crop and is passed over.
 */
export function effectiveHarvestDate(
  e: HarvestEvidence,
  opts: { plantingDate?: string | null; today?: string | null } = {},
): { date: string | null; source: HarvestSource | null } {
  if (e.typed) return { date: e.typed, source: 'manual' }
  const plausible = (d: string | null): d is string =>
    !!d && (!opts.plantingDate || d > opts.plantingDate) && (!opts.today || d <= opts.today)
  if (plausible(e.lastLoadOn)) return { date: e.lastLoadOn, source: 'last_load' }
  if (plausible(e.jdLastPassOn)) return { date: e.jdLastPassOn, source: 'john_deere' }
  return { date: null, source: null }
}

/** The farm's calendar day for a timestamp: a pass closed at 9 pm is that day's work. */
export function farmDay(iso: string, timeZone = farmTz()): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone })
}

export type LastLoadRow = { field_id: string | null; loaded_on: string | null }
export type HarvestOpRow = {
  field_id: string | null
  crop_season: number | null
  started_at: string | null
  ended_at: string | null
}

/**
 * The latest last-load date and the latest Deere harvest day per field for one
 * crop year. Loads should already be filtered to last_from_field and the year;
 * operations to harvest passes that are neither duplicates nor someone else's.
 * An operation without a crop season counts in the year its last day fell in.
 */
export function harvestEvidenceByField(
  year: number,
  loads: LastLoadRow[],
  ops: HarvestOpRow[],
  timeZone = farmTz(),
): Map<string, { lastLoadOn: string | null; jdLastPassOn: string | null }> {
  const out = new Map<string, { lastLoadOn: string | null; jdLastPassOn: string | null }>()
  const slot = (fieldId: string) => {
    let s = out.get(fieldId)
    if (!s) out.set(fieldId, (s = { lastLoadOn: null, jdLastPassOn: null }))
    return s
  }
  for (const l of loads) {
    if (!l.field_id || !l.loaded_on) continue
    const s = slot(l.field_id)
    if (!s.lastLoadOn || l.loaded_on > s.lastLoadOn) s.lastLoadOn = l.loaded_on
  }
  for (const o of ops) {
    const at = o.ended_at ?? o.started_at
    if (!o.field_id || !at) continue
    const day = farmDay(at, timeZone)
    if ((o.crop_season ?? Number(day.slice(0, 4))) !== year) continue
    const s = slot(o.field_id)
    if (!s.jdLastPassOn || day > s.jdLastPassOn) s.jdLastPassOn = day
  }
  return out
}

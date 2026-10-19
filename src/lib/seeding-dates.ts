import { handDayByField, handWorkDays, type HandWorkRow } from './field-work'
import { farmDay } from './harvest-date'

/**
 * A field's seeding date for one crop year, the way the harvest estimate
 * finds it: the date typed in Irrigation → Setup (the crop area's, else the
 * field's), else the field's earliest Deere seeding pass, else the earliest
 * seeding entered by hand. Shared by the estimate and the missing-information
 * checklist, so "no seeding date" there means exactly "no estimate" here.
 */

export type SeasonPlantRow = { field_id: string; zone_id: string | null; planting_date: string | null }
/** jd_field_operations seeding/planting passes, not duplicates. */
export type SeedOpRow = { field_id: string | null; crop_season: number | null; started_at: string | null }

export function seedingDates(
  cropYear: number,
  seasons: readonly SeasonPlantRow[],
  seedOps: readonly SeedOpRow[],
  handRows: readonly HandWorkRow[],
): (fieldId: string, zoneId?: string | null) => string | null {
  const seasonPlant = new Map<string, string>()
  for (const s of seasons) if (s.planting_date) seasonPlant.set(`${s.field_id}:${s.zone_id ?? ''}`, s.planting_date)
  const jdPlant = new Map<string, string>()
  for (const o of seedOps) {
    if (!o.field_id || !o.started_at) continue
    const d = farmDay(o.started_at)
    // A pass without a season counts in the year it was made.
    if ((o.crop_season ?? Number(d.slice(0, 4))) !== cropYear) continue
    const prev = jdPlant.get(o.field_id)
    if (!prev || d < prev) jdPlant.set(o.field_id, d)
  }
  // Hand seeding only fills a field Deere has no seeding for.
  const handPlant = handDayByField(handWorkDays(handRows, 'seeding', cropYear), 'first')
  return (fieldId, zoneId) =>
    seasonPlant.get(`${fieldId}:${zoneId ?? ''}`) ?? seasonPlant.get(`${fieldId}:`) ?? jdPlant.get(fieldId) ?? handPlant.get(fieldId) ?? null
}

import { supabase } from '@/lib/supabase'
import { plansWithZones } from '@/lib/bins'
import { albertaDay } from '@/lib/spray-products'
import { boundariesForYear, type BoundaryRow } from '@/lib/queries'
import { fetchAll, num } from './framework'
import { applyVarietyToCrop, varietyLookup, type VarietySettingRow } from '@/lib/crop-variety-settings'
import { cropVarietySettingsQuery } from '@/lib/crop-variety-settings-data'
import { finishedDays, handWorkDays, type FinishDay, type FinishRow, type HandWorkDay, type HandWorkRow } from '@/lib/field-work'

/**
 * What a season's field reports all start from: each field's crop areas (a
 * field split on the map counts as its areas), the day it was seeded and the
 * day harvest began, and whether it is under a pivot. Read once here so the
 * season summary, the AFSC acreage report and the nutrient balance cannot
 * disagree about which crop was on which acres.
 */

export type SeasonFieldRow = {
  id: string
  name: string
  legal_land_description: string | null
  active: boolean
}

export type SeasonCrop = { id: string; name: string; yield_unit: string | null; default_yield_per_acre: unknown; renter_only: boolean | null; land_rent_only: boolean | null; counts_for_seeding: boolean | null }

export type PlanLite = { id: string; field_id: string; crop_id: string; crop_year: number; variety: string | null; planned_acres: number | null; yield_per_acre_override: number | null }
export type ZoneLite = { id: string; field_id: string; crop_year: number; crop_id: string; acres: number | string | null }

/** One crop on one field: the whole field's plan, or one area of a split field. */
export type CropArea = {
  fieldId: string
  cropId: string
  crop: string
  variety: string | null
  acres: number | null
  /** Somebody else's crop on our ground (crops.renter_only / land_rent_only). */
  renters: boolean
  /** Fallow and the like: on the plan, never seeded. */
  seeded: boolean
  /** An area of a field split on the map, not the field's one plan. */
  zone: boolean
  /** The plan's expected yield an acre: its own figure, else the variety's or crop's normal. */
  expectedYield: number | null
  /** The variety's own test weight, lb/bu, where it has one (else the crop's applies). */
  testWeight?: number
}

/**
 * The season's crop areas. A split field stands as its areas; the area
 * growing the plan's own crop keeps the plan's variety and yield, the others
 * have only their crop.
 */
export function cropAreas(
  plans: PlanLite[],
  zones: ZoneLite[],
  crops: SeasonCrop[],
  year: number,
  /** Varieties' own figures: a variety's normal yield is its own. */
  varieties?: readonly VarietySettingRow[],
): CropArea[] {
  const cropById = new Map(crops.map((c) => [c.id, c]))
  const varietyRow = varietyLookup(varieties)
  const varietyOf = new Map(plans.map((p) => [p.field_id, { cropId: p.crop_id, variety: p.variety }]))
  return plansWithZones(plans, zones, year).flatMap((p) => {
    const c = cropById.get(p.crop_id)
    if (!c) return []
    const own = varietyOf.get(p.field_id)
    const variety = own?.cropId === p.crop_id ? (own.variety ?? null) : null
    const figures = varietyRow(c.id, variety)
    const normal = applyVarietyToCrop(c, figures).default_yield_per_acre
    const testWeight = num(figures?.test_weight_lb_per_bu)
    return [
      {
        fieldId: p.field_id,
        cropId: p.crop_id,
        crop: c.name,
        variety,
        acres: num(p.planned_acres),
        renters: Boolean(c.renter_only || c.land_rent_only),
        seeded: c.counts_for_seeding !== false && !/fallow/i.test(c.name),
        zone: p.id.startsWith('zone:'),
        expectedYield: num(p.yield_per_acre_override) ?? num(normal),
        ...(testWeight != null ? { testWeight } : {}),
      },
    ]
  })
}

export type SeasonRow = { field_id: string; zone_id: string | null; planting_date: string | null; planting_date_source: string | null; harvest_date: string | null }
export type OpDay = { field_id: string | null; operation_type: string; started_at: string | null }

export type DayFrom = { date: string; from: string }

const earliest = (m: Map<string, DayFrom>, fieldId: string | null, date: string | null | undefined, from: string) => {
  if (!fieldId || !date) return
  const cur = m.get(fieldId)
  if (!cur || date < cur.date) m.set(fieldId, { date, from })
}

/**
 * The day each field was seeded. The irrigation season's planting date wins
 * — it is synced from Deere and corrected by hand where Deere's first pass
 * was not the seeding (field 1's pass on 30 Apr went in before the beans) —
 * and the first Deere seeding pass fills the fields with no season. A seeding
 * entered as field work by hand fills what is still empty after that.
 */
export function seedingDates(seasons: SeasonRow[], ops: OpDay[], hand: HandWorkDay[] = []): Map<string, DayFrom> {
  const out = new Map<string, DayFrom>()
  for (const s of seasons) if (s.zone_id == null && s.planting_date) out.set(s.field_id, { date: s.planting_date, from: s.planting_date_source === 'manual' ? 'entered by hand' : 'John Deere' })
  const deere = new Map<string, DayFrom>()
  for (const o of ops) if (o.operation_type === 'seeding' && o.started_at) earliest(deere, o.field_id, albertaDay(o.started_at), 'John Deere')
  for (const [k, v] of deere) if (!out.has(k)) out.set(k, v)
  const byHand = new Map<string, DayFrom>()
  for (const h of hand) earliest(byHand, h.field_id, h.first, 'field work entered by hand')
  for (const [k, v] of byHand) if (!out.has(k)) out.set(k, v)
  return out
}

/**
 * The day harvest began on each field: the start written on a "Field
 * finished" record (Sam, 17 Oct 2026: the person who finished it saying
 * when it started), else the date written on its season where somebody wrote
 * one, else the first Deere harvest pass, the first harvest entered as field
 * work by hand, or the first load weighed off it, whichever came first.
 */
export function harvestDates(
  seasons: SeasonRow[],
  ops: OpDay[],
  loads: { field_id: string | null; loaded_on: string | null }[],
  hand: HandWorkDay[] = [],
  finishes: ReadonlyMap<string, FinishDay> = new Map(),
): Map<string, DayFrom> {
  const out = new Map<string, DayFrom>()
  const started = new Map<string, DayFrom>()
  for (const [k, f] of finishes) if (f.started) earliest(started, k.slice(0, k.indexOf(':')), f.started, 'Field finished record')
  for (const [k, v] of started) out.set(k, v)
  for (const s of seasons) if (s.zone_id == null && s.harvest_date && !out.has(s.field_id)) out.set(s.field_id, { date: s.harvest_date, from: 'entered by hand' })
  const seen = new Map<string, DayFrom>()
  for (const o of ops) if (o.operation_type === 'harvest' && o.started_at) earliest(seen, o.field_id, albertaDay(o.started_at), 'John Deere')
  for (const h of hand) earliest(seen, h.field_id, h.first, 'field work entered by hand')
  for (const l of loads) earliest(seen, l.field_id, l.loaded_on, 'first load weighed')
  for (const [k, v] of seen) if (!out.has(k)) out.set(k, v)
  return out
}

/**
 * The day each field was finished: its whole-field "Field finished", else
 * the latest of its crop areas' (a split field is done when its last area is).
 */
export function finishedByField(finishes: ReadonlyMap<string, FinishDay>): Map<string, DayFrom> {
  const whole = new Map<string, DayFrom>()
  const areas = new Map<string, DayFrom>()
  for (const [k, f] of finishes) {
    const [fieldId, zone] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]
    const m = zone ? areas : whole
    const cur = m.get(fieldId)
    if (!cur || f.finished > cur.date) m.set(fieldId, { date: f.finished, from: zone ? 'Field finished record (crop area)' : 'Field finished record' })
  }
  for (const [k, v] of areas) if (!whole.has(k)) whole.set(k, v)
  return whole
}

export type HistoryLite = { field_id: string; crop_id: string | null; acres: unknown; yield_per_acre: unknown; yield_unit: string | null; source: string | null }

export type SeasonBasics = {
  year: number
  fields: SeasonFieldRow[]
  crops: SeasonCrop[]
  areas: CropArea[]
  /** Map acres in effect at the end of the year. */
  acresOf: Map<string, number>
  irrigated: Set<string>
  seeded: Map<string, DayFrom>
  harvested: Map<string, DayFrom>
  /** The day each field was marked finished (whole field, else its last crop area). */
  finished?: Map<string, DayFrom>
  history: HistoryLite[]
  /** Fields rented out whole for the year (field_year_tenure): to whom. */
  rentedOut: Map<string, string>
}

export async function loadSeasonBasics(year: number): Promise<SeasonBasics> {
  const [fields, crops, plans, zones, bounds, pivots, seasons, ops, loads, history, tenure, varieties, handRows] = await Promise.all([
    fetchAll<SeasonFieldRow>((a, b) => supabase.from('fields').select('id, name, legal_land_description, active').order('id').range(a, b)),
    fetchAll<SeasonCrop>((a, b) => supabase.from('crops').select('id, name, yield_unit, default_yield_per_acre, renter_only, land_rent_only, counts_for_seeding').order('id').range(a, b)),
    fetchAll<PlanLite>((a, b) => supabase.from('crop_plans').select('id, field_id, crop_id, crop_year, variety, planned_acres, yield_per_acre_override').eq('crop_year', year).order('id').range(a, b)),
    fetchAll<ZoneLite>((a, b) => supabase.from('field_crop_zones').select('id, field_id, crop_year, crop_id, acres').eq('crop_year', year).order('id').range(a, b)),
    fetchAll<BoundaryRow>((a, b) => supabase.from('field_boundaries').select('id, field_id, acres, valid_from, valid_to').order('id').range(a, b)),
    fetchAll<{ field_id: string }>((a, b) => supabase.from('field_pivots').select('field_id').eq('not_used', false).order('id').range(a, b)),
    fetchAll<SeasonRow>((a, b) => supabase.from('field_crop_seasons').select('field_id, zone_id, planting_date, planting_date_source, harvest_date').eq('crop_year', year).order('id').range(a, b)),
    fetchAll<OpDay>((a, b) =>
      supabase
        .from('jd_field_operations')
        .select('field_id, operation_type, started_at')
        .eq('crop_season', year)
        .in('operation_type', ['seeding', 'harvest'])
        .is('duplicate_of', null)
        .is('not_ours', null)
        .or('confirm_status.is.null,confirm_status.eq.confirmed')
        .order('id')
        .range(a, b),
    ),
    fetchAll<{ field_id: string | null; loaded_on: string | null }>((a, b) => supabase.from('bin_loads').select('field_id, loaded_on').eq('crop_year', year).order('id').range(a, b)),
    fetchAll<HistoryLite>((a, b) => supabase.from('crop_yields_v').select('field_id, crop_id, acres, yield_per_acre, yield_unit, source').eq('crop_year', year).order('id').range(a, b)),
    fetchAll<{ field_id: string; rented_to: string | null }>((a, b) => supabase.from('field_year_tenure').select('field_id, rented_to').eq('crop_year', year).order('id').range(a, b)),
    cropVarietySettingsQuery().queryFn(),
    // Seeding and harvest entered by hand. An older database without the table reads as none.
    supabase
      .from('field_work_records')
      .select('field_id, zone_id, crop_year, counts_as, started_at, finished_at, field_finished')
      .eq('crop_year', year)
      .in('counts_as', ['seeding', 'harvest'])
      .then(({ data, error }) => (error ? [] : ((data ?? []) as (HandWorkRow & FinishRow)[]))),
  ])
  const finishes = finishedDays(handRows, year)
  return {
    year,
    fields,
    crops,
    areas: cropAreas(plans, zones, crops, year, varieties),
    acresOf: new Map(boundariesForYear(bounds, year).map((b) => [b.field_id, num(b.acres) ?? 0])),
    irrigated: new Set(pivots.map((p) => p.field_id)),
    seeded: seedingDates(seasons, ops, handWorkDays(handRows, 'seeding', year)),
    harvested: harvestDates(seasons, ops, loads, handWorkDays(handRows, 'harvest', year), finishes),
    finished: finishedByField(finishes),
    history,
    rentedOut: new Map(tenure.map((t) => [t.field_id, t.rented_to ?? 'someone else'])),
  }
}

/** "9.2 in", for the group notes. */
export const inches = (mm: number) => `${(mm / 25.4).toLocaleString('en-CA', { maximumFractionDigits: 1 })} in`

/** A yield with its unit: "40.7 bu/ac", "3,791 lbs/ac". */
export function yieldText(v: number | null, unit: string | null): string | null {
  if (v == null) return null
  return `${v.toLocaleString('en-CA', { maximumFractionDigits: v >= 100 ? 0 : 1 })} ${unit ?? 'bu'}/ac`
}

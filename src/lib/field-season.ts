import { dockagePct } from '@/lib/clean-yield'

/**
 * One field's year, in the handful of figures somebody wants before they go
 * looking for anything (Sam, 17 Nov 2026).
 *
 * The field page is tabbed, and every number on it already has a home — the
 * dates on the harvest estimate, the water under Irrigation, the yields under
 * History. What there was no answer to was "how did this field do this year",
 * which needed four tabs and some arithmetic.
 *
 * So this re-reads nothing: it is given the rows the page already holds and
 * arranges them. It owns no figure of its own, which is why nothing here
 * computes a yield — `crop_history` already carries both the field-run and
 * the cleaned-out one, and the dockage between them is `clean-yield.ts`.
 */

/** A crop grown on the field this year. A split field has one per crop. */
export type FieldSeasonArea = {
  cropId: string
  crop: string
  variety: string | null
  /** 'bu', 'lbs' — whatever the yield was recorded in. */
  unit: string | null
  acres: number | null
  /** The day it went in, from the harvest estimate's own working out. */
  seeded: string | null
  /** The day it came off, and what said so. Null while it is still standing. */
  harvested: string | null
  harvestedFrom: string | null
  /** Field-run, as it came off the field. */
  yieldPerAcre: number | null
  yieldTotal: number | null
  /** What the plant took out, as a percentage of the field-run yield. */
  dockage: number | null
  /** What was left after cleaning; null when the field has no clean-out. */
  cleanPerAcre: number | null
  cleanTotal: number | null
}

export type FieldSeason = {
  year: number
  areas: FieldSeasonArea[]
  /** Gross depth the pivots put on, and how many days they ran. */
  irrigationMm: number | null
  irrigationDays: number
  /** From the water balance, which is the only place rain is kept per field. */
  rainMm: number | null
  /** Days the crop was short of water, as the balance scored them. */
  stressDays: number | null
}

/** A number that was given, rather than Number(null) quietly being 0. */
const n = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

export type SeasonPlan = { crop_id: string; variety: string | null; planned_acres: number | null }

export type SeasonHistory = {
  crop_year: number
  crop_id: string | null
  variety: string | null
  acres: number | null
  yield_unit: string | null
  yield_per_acre: number | null
  actual_yield_total: number | null
  clean_yield_per_acre: number | null
  clean_total: number | null
}

export type SeasonEstimate = { cropId: string; seeded: string | null; harvestedOn: string | null; harvestedFrom: string | null }

export type SeasonWater = {
  events: { date: string; gross_mm: number | null; net_mm: number | null }[]
  balance: { rain_mm: number | null; stress_days: number | null } | null
}

/**
 * The year as one object.
 *
 * Areas come from what was actually grown (the history rows for the year),
 * falling back to the plan while nothing has come off yet — so a field still
 * in crop reads as its planned crop rather than as a blank.
 */
export function buildFieldSeason(inp: {
  year: number
  plans: SeasonPlan[]
  history: SeasonHistory[]
  estimates: SeasonEstimate[]
  cropName: (cropId: string) => string
  water: SeasonWater
  boundaryAcres?: number | null
}): FieldSeason {
  const thisYear = inp.history.filter((h) => h.crop_year === inp.year && h.crop_id)
  const byCrop = new Map<string, FieldSeasonArea>()

  const put = (cropId: string, area: Partial<FieldSeasonArea>) => {
    const had = byCrop.get(cropId)
    byCrop.set(cropId, {
      cropId,
      crop: inp.cropName(cropId),
      variety: null,
      unit: null,
      acres: null,
      seeded: null,
      harvested: null,
      harvestedFrom: null,
      yieldPerAcre: null,
      yieldTotal: null,
      dockage: null,
      cleanPerAcre: null,
      cleanTotal: null,
      ...had,
      // Only what this caller actually knows: a plan must not blank a yield.
      ...Object.fromEntries(Object.entries(area).filter(([, v]) => v != null)),
    })
  }

  // The plan first, so a field with nothing off it yet still names its crop.
  for (const p of inp.plans) {
    put(p.crop_id, {
      variety: p.variety,
      acres: n(p.planned_acres) ?? inp.boundaryAcres ?? null,
    })
  }

  for (const h of thisYear) {
    const pre = n(h.yield_per_acre)
    const clean = n(h.clean_yield_per_acre)
    put(h.crop_id!, {
      variety: h.variety,
      unit: h.yield_unit,
      acres: n(h.acres),
      yieldPerAcre: pre,
      yieldTotal: n(h.actual_yield_total),
      dockage: dockagePct(pre, clean),
      cleanPerAcre: clean,
      cleanTotal: n(h.clean_total),
    })
  }

  for (const e of inp.estimates) {
    if (!byCrop.has(e.cropId) && !e.seeded && !e.harvestedOn) continue
    put(e.cropId, { seeded: e.seeded, harvested: e.harvestedOn, harvestedFrom: e.harvestedFrom })
  }

  // The gross each pass put on, as the wrap-up report and the Water use report
  // total it: gross where it is known, the net only when it is not.
  let mm = 0
  let any = false
  const days = new Set<string>()
  for (const e of inp.water.events) {
    const depth = n(e.gross_mm) ?? n(e.net_mm)
    if (depth == null) continue
    mm += depth
    any = true
    days.add(e.date)
  }

  return {
    year: inp.year,
    areas: [...byCrop.values()].sort((a, b) => a.crop.localeCompare(b.crop)),
    irrigationMm: any ? Math.round(mm) : null,
    irrigationDays: days.size,
    rainMm: n(inp.water.balance?.rain_mm),
    stressDays: n(inp.water.balance?.stress_days),
  }
}

/** Whether there is enough here to be worth a card at all. */
export function hasSeasonFacts(s: FieldSeason): boolean {
  if (s.irrigationMm != null || s.rainMm != null) return true
  return s.areas.some((a) => a.seeded || a.harvested || a.yieldPerAcre != null)
}

export const MM_PER_INCH = 25.4

/** Millimetres as inches, which is what the licence and the allotment are in. */
export const asInches = (mm: number | null): number | null =>
  mm == null ? null : Math.round((mm / MM_PER_INCH) * 10) / 10

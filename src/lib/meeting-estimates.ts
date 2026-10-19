import { useMemo } from 'react'
import { addDays } from './harvest-estimate'
import type { HarvestEstimateRow } from './harvest-estimate-data'
import type { YieldRecord } from './forecast'
import { cutFor, type YieldCut } from './yield-estimate'
import { scoreYield, type YieldScore } from './yield-goal'
import { compareFieldNames, useCropPlans, useCrops, useFields, type CropPlanRow, type CropRow } from './queries'
import { useAllCropZones } from './cropZones'
import { useYieldHistory } from './forecast-data'
import { useYieldCuts } from './yield-cuts'
import { useTypedBeforeHarvest } from './yield-goal-data'

/**
 * The Monday meeting's two estimate lists: fields the harvest estimate puts
 * in the coming two weeks, and how the fields already off did against their
 * estimate and goal (yield-goal.ts, the same score as the field's card).
 */

export const HARVEST_WINDOW_DAYS = 14

/** Not yet harvested, estimated mature from `from` through the next `days` days, soonest first. */
export function upcomingHarvests(rows: readonly HarvestEstimateRow[], from: string, days = HARVEST_WINDOW_DAYS): HarvestEstimateRow[] {
  const to = addDays(from, days - 1)
  return rows
    .filter((r) => !r.harvestedOn && r.estimate && !r.estimate.notReached && r.estimate.mature >= from && r.estimate.mature <= to)
    .sort((a, b) => a.estimate!.mature.localeCompare(b.estimate!.mature) || compareFieldNames(a.fieldName, b.fieldName))
}

export type YieldLine = { key: string; fieldId: string; fieldName: string; cropName: string; unit: string; score: YieldScore }

type ZoneLite = { id: string; field_id: string; crop_id: string; crop_year: number }

/**
 * Every crop with a harvest on record this year, scored against its estimate
 * and goal; furthest below the estimate first. One line per crop on a split
 * field. Land rented out has nothing to expect and is left out.
 */
export function harvestedYields(args: {
  cropYear: number
  fields: readonly { id: string; name: string }[]
  crops: readonly CropRow[]
  plans: readonly CropPlanRow[]
  zones: readonly ZoneLite[]
  history: YieldRecord[]
  cuts: readonly YieldCut[]
  typedBefore: Map<string, number | null>
}): YieldLine[] {
  const { cropYear } = args
  const crop = new Map(args.crops.map((c) => [c.id, c]))
  const plan = new Map(args.plans.filter((p) => p.crop_year === cropYear).map((p) => [p.field_id, p]))
  const zonesBy = new Map<string, ZoneLite[]>()
  for (const z of args.zones) if (z.crop_year === cropYear) zonesBy.set(z.field_id, [...(zonesBy.get(z.field_id) ?? []), z])
  const out: YieldLine[] = []
  for (const f of args.fields) {
    const zones = zonesBy.get(f.id) ?? []
    const p = plan.get(f.id) ?? null
    const cropIds = zones.length ? [...new Set(zones.map((z) => z.crop_id))] : p ? [p.crop_id] : []
    for (const cropId of cropIds) {
      const c = crop.get(cropId)
      if (!c || c.land_rent_only) continue
      const mine = zones.filter((z) => z.crop_id === cropId)
      const score = scoreYield({
        fieldId: f.id,
        year: cropYear,
        crop: c,
        plan: p?.crop_id === cropId ? p : null,
        typedBeforeHarvest: args.typedBefore.get(`${f.id}:${cropId}`) ?? null,
        history: args.history,
        cut: cutFor(args.cuts, { fieldId: f.id, cropYear, cropId, zoneId: mine.length === 1 ? mine[0].id : null }),
        zone: zones.length > 0,
      })
      if (score.actual) out.push({ key: `${f.id}:${cropId}`, fieldId: f.id, fieldName: f.name, cropName: c.name, unit: c.yield_unit, score })
    }
  }
  const pct = (l: YieldLine) => l.score.vsEstimate?.pct ?? l.score.vsGoal?.pct ?? Infinity
  return out.sort((a, b) => pct(a) - pct(b) || compareFieldNames(a.fieldName, b.fieldName))
}

export function useHarvestedYields(cropYear: number) {
  const { data: fields } = useFields()
  const { data: crops } = useCrops()
  const { data: plans } = useCropPlans(cropYear)
  const { data: zones } = useAllCropZones()
  const { data: history } = useYieldHistory()
  const { data: cuts } = useYieldCuts(cropYear)
  const { data: typedBefore } = useTypedBeforeHarvest(cropYear)
  return useMemo(
    () =>
      fields && crops && plans && history
        ? harvestedYields({ cropYear, fields, crops, plans, zones: zones ?? [], history, cuts: cuts ?? [], typedBefore: typedBefore ?? new Map() })
        : [],
    [cropYear, fields, crops, plans, zones, history, cuts, typedBefore],
  )
}

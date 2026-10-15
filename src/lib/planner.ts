/**
 * Planner + budget math, shared by the Plan tab, Budget tab, and exports.
 * Resolution rules (SPEC §5, and Sam's of 1 Oct 2026 — see forecast.ts):
 *   yield: plan override (a harvest, or typed) → this field's own average
 *          once it has five harvested seasons → the farm's harvested average
 *          → the crop's normal (goal) yield; the basis is shown. Then the
 *          range (plan's, else the crop's) and any cut for hail or disease
 *          (yield-estimate.ts) — revenue and margin carry low and high ends.
 *   price: contract → the year's own price (a forecast for a later year) →
 *          today's elevator bid for barley/wheat/oats/durum → the latest
 *          earlier year's price, carried forward and labelled with its year.
 *   cost:  the year's input budget → the latest earlier year's, labelled.
 *   acres: planned_acres → map acres; source is shown.
 *
 *   The imported acreage is deliberately NOT used. It covers the WHOLE field,
 *   and where a field is split — part cropped, part rented out — the drawn
 *   boundary covers only our part while the import does not. Preferring it
 *   budgeted Maple Flat on 46 acres when 22 are farmed, doubling cost,
 *   yield and revenue on land somebody else crops. The drawn shape is what we
 *   farm; fields.rented_out_acres records the rest.
 *   budget: cost = Σ crop_inputs.cost_per_acre × acres
 *           revenue = yield × acres × estimated price (crop_prices)
 */
import type {
  BoundaryRow,
  CropInputRow,
  CropPlanRow,
  CropPriceRow,
  CropRow,
  FieldRow,
} from './queries'
import { basisBadge, expectedYield, marketPrice, resolveCosts, resolvePrice, YIELD_BADGE, type YieldRecord } from './forecast'
import { applyDeal, dealFor, type LandDeal } from './land-deals'
import { cutFor, estimateYield, type YieldCut } from './yield-estimate'
import { cropForVariety, type VarietySettingRow } from './crop-variety-settings'
import type { YieldScore } from './yield-goal'

export type AcresSource = 'plan' | 'map' | 'zone' | null
export type YieldSource = 'override' | 'clean' | 'pre-clean' | 'field avg' | 'farm avg' | 'goal' | null
export type PriceSource = 'contract' | 'estimate' | null

/** What the plan needs besides the rows themselves. */
export type PlanContext = {
  cropYear: number
  /** The calendar year: a price or budget for a later year is a forecast. */
  currentYear: number
  /** Harvested yields, every year (planned ones are ignored). */
  history?: YieldRecord[]
  /** Latest elevator bid per series code, $/tonne. */
  bids?: Map<string, number>
  /** Land deals; only land rented out changes the plan (see buildPlanRows). */
  deals?: LandDeal[]
  /** This year's cuts to estimated yields (hail, disease). */
  cuts?: YieldCut[]
  /** Varieties' own figures: a plan's variety brings its own normal yield. */
  varieties?: VarietySettingRow[]
}

export type PlanRowView = {
  field: FieldRow
  plan: CropPlanRow | null
  crop: CropRow | null
  acres: number | null
  acresSource: AcresSource
  /** The expected yield, after any cut. */
  yieldPerAcre: number | null
  /** Low and high ends of the estimate, after any cut; equal to yieldPerAcre with no range. */
  yieldLow: number | null
  yieldHigh: number | null
  /** The expected yield before the cut. */
  yieldBeforeCut: number | null
  /** The cut found for this crop (applied unless the yield is a harvest), and the % it took off. */
  cut: YieldCut | null
  cutPct: number
  yieldSource: YieldSource
  /** Where the yield came from, in words. */
  yieldNote: string
  pricePerUnit: number | null
  priceSource: PriceSource
  /** Short badge: '2026' for a carried price, 'forecast', 'market', or ''. */
  priceBadge: string
  priceNote: string
  costPerAcre: number
  costBadge: string
  costNote: string
  /** Our side: on a grower's crop on our land, only our share of the gross. */
  revenuePerAcre: number
  marginPerAcre: number
  /** Revenue and margin at the low and high ends of the yield range. */
  revenueLowPerAcre: number
  revenueHighPerAcre: number
  /** Revenue per acre the cut took off (0 with no cut). */
  revenueCutPerAcre: number
  marginLowPerAcre: number
  marginHighPerAcre: number
  /** Land rented out: who grows it and on what terms; null on our own crops. */
  dealNote: string | null
  warnings: string[]
  zoneId?: string | null // set for a split-field crop zone (crop/acres come from the map)
  isZone?: boolean
  /** Goal, estimate from history and actual (yield-goal.ts); set by usePlanRows. */
  score?: YieldScore | null
}

export type ZoneLite = { id: string; crop_id: string; acres: number | null }

export function buildPlanRows(
  fields: FieldRow[],
  boundaries: BoundaryRow[],
  plans: CropPlanRow[],
  crops: CropRow[],
  /** Every year's prices: a year with none carries the latest earlier one. */
  prices: CropPriceRow[],
  /** Every year's input budgets, likewise. */
  inputs: CropInputRow[],
  contractPriceByCrop: Map<string, number> | undefined,
  zonesByField: Map<string, ZoneLite[]> | undefined,
  ctx: PlanContext,
): PlanRowView[] {
  const boundaryByField = new Map(boundaries.map((b) => [b.field_id, b]))
  const planByField = new Map(plans.map((p) => [p.field_id, p]))
  const cropById = new Map(crops.map((c) => [c.id, c]))
  const { cropYear, currentYear } = ctx

  // Yield/price/cost/revenue for a crop on a field (with the plan's own yield
  // figures where there is a plan), its range, and any cut for hail or disease.
  const econ = (
    crop: CropRow | null,
    fieldId: string,
    plan: Pick<CropPlanRow, 'yield_per_acre_override' | 'yield_basis' | 'yield_low' | 'yield_high' | 'variety'> | null,
    zoneId: string | null = null,
  ) => {
    let yieldPerAcre: number | null = null
    let yieldSource: YieldSource = null
    let yieldNote = ''
    const yieldOverride = plan?.yield_per_acre_override ?? null
    const basis = plan?.yield_basis ?? null
    // Land rented out for rent (seed carrots, spinach): nothing to expect.
    const rentOnly = Boolean(crop?.land_rent_only)
    if (yieldOverride != null) {
      yieldPerAcre = yieldOverride
      // A harvest yield says which: after clean-out, or field-run before it.
      yieldSource = basis === 'clean' ? 'clean' : basis === 'pre_clean' ? 'pre-clean' : 'override'
      yieldNote = basis ? 'harvested, off the scale' : 'typed on the plan'
    } else if (crop && !rentOnly) {
      const e = expectedYield({ cropId: crop.id, fieldId, year: cropYear, unit: crop.yield_unit, goal: cropForVariety(crop, plan?.variety, ctx.varieties).default_yield_per_acre, history: ctx.history ?? [] })
      yieldPerAcre = e.value
      yieldSource = e.basis === 'none' ? null : (YIELD_BADGE[e.basis] as YieldSource)
      yieldNote = e.label
    }
    // The range and the cut. Land rented out expects nothing, so has neither.
    const est = rentOnly
      ? estimateYield({ expected: yieldPerAcre })
      : estimateYield({
          expected: yieldPerAcre,
          typed: yieldOverride != null && !basis,
          harvested: Boolean(basis),
          plan: plan ? { low: plan.yield_low, high: plan.yield_high } : null,
          crop: crop ? { low: crop.yield_low_per_acre, high: crop.yield_high_per_acre } : null,
          cut: crop ? cutFor(ctx.cuts, { fieldId, cropYear, cropId: crop.id, zoneId }) : null,
        })
    if (est.rangeFrom === 'plan' && yieldOverride == null) {
      yieldSource = 'override'
      yieldNote = 'range typed on the plan; the midpoint is expected'
    } else if (est.rangeFrom === 'crop') {
      yieldNote += ' · range from the crop'
    }
    const yieldBeforeCut = est.before.expected
    yieldPerAcre = est.expected
    const contractPrice = crop ? contractPriceByCrop?.get(crop.id) : undefined
    let pricePerUnit: number | null = null
    let priceSource: PriceSource = null
    let priceBadge = ''
    let priceNote = ''
    if (contractPrice != null) {
      pricePerUnit = contractPrice
      priceSource = 'contract'
      priceNote = 'from a signed contract'
    } else if (crop && !rentOnly) {
      const r = resolvePrice(crop.id, cropYear, prices, { market: marketPrice(crop.name, crop.yield_unit, ctx.bids ?? new Map()), currentYear })
      if (r.value != null) {
        pricePerUnit = r.value
        priceSource = 'estimate'
        priceBadge = basisBadge(r)
        priceNote = r.basis === 'carried' ? `using the ${r.fromYear} price — type a ${cropYear} price on the crop to forecast it` : r.label
      }
    }
    // Land rented out has one cost line: its land share of the fixed expenses
    // (only readable by the owners and the accountant; nobody else sees a row).
    const c = crop ? resolveCosts(crop.id, cropYear, inputs, currentYear) : null
    const costPerAcre = c?.total ?? 0
    const costBadge = c ? basisBadge(c) : ''
    const costNote = c ? (c.basis === 'carried' ? `using the ${c.fromYear} input budget` : c.label) : ''
    const revenuePerAcre = (yieldPerAcre ?? 0) * (pricePerUnit ?? 0)
    return {
      yieldPerAcre,
      yieldLow: est.low,
      yieldHigh: est.high,
      yieldBeforeCut,
      cut: est.cut,
      cutPct: est.cutPct,
      yieldSource,
      yieldNote,
      pricePerUnit,
      priceSource,
      priceBadge,
      priceNote,
      costPerAcre,
      costBadge,
      costNote,
      revenuePerAcre,
      revenueLowPerAcre: (est.low ?? 0) * (pricePerUnit ?? 0),
      revenueHighPerAcre: (est.high ?? 0) * (pricePerUnit ?? 0),
      revenueCutPerAcre: ((yieldBeforeCut ?? 0) - (est.expected ?? 0)) * (pricePerUnit ?? 0),
    }
  }

  /**
   * A crop somebody else grows on the field. On our land under the potato
   * deal, our share of the gross is ours and the grower pays every input; land
   * rented for cash earns its rent on the deal, not per crop; a renter's crop
   * on land that isn't ours to rent (Whitfield's potatoes) is none of our
   * money. Our own crops are unchanged — the owner's share on land we rent in
   * is the P&L's and the rotation's to apply.
   */
  const renterSide = (crop: CropRow | null, fieldId: string, acres: number | null, e: ReturnType<typeof econ>) => {
    if (!crop?.renter_only && !crop?.land_rent_only) return { ...e, dealNote: null as string | null }
    const deal = dealFor(ctx.deals ?? [], fieldId, cropYear, crop.id)
    if (deal?.direction === 'out' && deal.arrangement === 'profit_share') {
      const gross = e.revenuePerAcre * (acres ?? 0)
      const d = applyDeal(deal, { id: fieldId, acres: acres ?? 0 }, { revenue: gross, cost: 0, hasYield: true }, () => 0)
      return {
        ...e,
        costPerAcre: 0,
        costBadge: '',
        costNote: 'the grower pays the inputs',
        revenuePerAcre: e.revenuePerAcre * d.ourFraction,
        revenueLowPerAcre: e.revenueLowPerAcre * d.ourFraction,
        revenueHighPerAcre: e.revenueHighPerAcre * d.ourFraction,
        revenueCutPerAcre: e.revenueCutPerAcre * d.ourFraction,
        dealNote: d.label,
      }
    }
    if (deal?.direction === 'out') {
      const perAcre = deal.rent_per_acre
      // The land share of the fixed expenses stays on land rented out (CFO, 6 Oct 2026).
      const landShare = crop.land_rent_only ? e.costPerAcre : 0
      return {
        ...e,
        costPerAcre: landShare,
        costBadge: landShare ? e.costBadge : '',
        costNote: landShare ? 'the land share of the fixed expenses' : '',
        revenuePerAcre: perAcre ?? 0,
        revenueLowPerAcre: perAcre ?? 0,
        revenueHighPerAcre: perAcre ?? 0,
        revenueCutPerAcre: 0,
        dealNote: perAcre != null ? `Rented out to ${deal.landlord}, $${perAcre}/ac` : `Rented out to ${deal.landlord} — rent counted once on the deal`,
      }
    }
    return { ...e, costPerAcre: 0, costBadge: '', costNote: '', revenuePerAcre: 0, revenueLowPerAcre: 0, revenueHighPerAcre: 0, revenueCutPerAcre: 0, dealNote: crop.land_rent_only ? 'Land rented out' : 'Grown by a renter — not on our books' }
  }

  const missing = (crop: CropRow | null, e: { yieldPerAcre: number | null; pricePerUnit: number | null }, yieldHint: string) => {
    const w: string[] = []
    // Land rented out for rent expects no yield or price; don't flag them.
    if (!crop || crop.land_rent_only) return w
    if (e.yieldPerAcre == null) w.push(yieldHint)
    if (e.pricePerUnit == null) w.push('no price for this crop year')
    return w
  }

  const margins = (e: { revenuePerAcre: number; revenueLowPerAcre: number; revenueHighPerAcre: number; costPerAcre: number }) => ({
    marginPerAcre: e.revenuePerAcre - e.costPerAcre,
    marginLowPerAcre: e.revenueLowPerAcre - e.costPerAcre,
    marginHighPerAcre: e.revenueHighPerAcre - e.costPerAcre,
  })

  return fields
    .filter((f) => f.active)
    .flatMap((field): PlanRowView[] => {
      const zones = zonesByField?.get(field.id)

      // Split field → one row per crop zone (crop + acres come from the map).
      if (zones && zones.length > 0) {
        return zones.map((z) => {
          const crop = cropById.get(z.crop_id) ?? null
          const e = renterSide(crop, field.id, z.acres, econ(crop, field.id, null, z.id))
          const warnings = missing(crop, e, 'no yield — set the crop’s normal yield')
          if (z.acres == null) warnings.push('zone has no acres')
          return {
            field,
            plan: null,
            crop,
            acres: z.acres,
            acresSource: 'zone' as AcresSource,
            ...e,
            ...margins(e),
            warnings,
            zoneId: z.id,
            isZone: true,
          }
        })
      }

      // Whole field, single crop (unchanged behavior).
      const plan = planByField.get(field.id) ?? null
      const crop = plan ? (cropById.get(plan.crop_id) ?? null) : null
      const boundary = boundaryByField.get(field.id)

      let acres: number | null = null
      let acresSource: AcresSource = null
      if (plan?.planned_acres != null) {
        acres = plan.planned_acres
        acresSource = 'plan'
      } else if (boundary) {
        acres = boundary.acres
        acresSource = 'map'
      }

      const e = renterSide(crop, field.id, acres, econ(crop, field.id, plan))
      const warnings = plan ? missing(crop, e, 'no yield — set the crop’s normal yield or type one') : []
      if (plan && acres == null) warnings.push('no acres — no boundary and no planned acres')

      return [
        {
          field,
          plan,
          crop,
          acres,
          acresSource,
          ...e,
          ...margins(e),
          warnings,
        },
      ]
    })
}

export type BudgetLine = {
  crop: CropRow
  fieldCount: number
  acres: number
  weightedYield: number | null
  pricePerUnit: number | null
  revenue: number
  cost: number
  costPerAcre: number
  margin: number
  marginPerAcre: number
  breakEvenPrice: number | null // cost/ac ÷ yield
  breakEvenYield: number | null // cost/ac ÷ price
  /** At the low and high ends of the yield ranges (after cuts). */
  weightedYieldLow: number | null
  weightedYieldHigh: number | null
  revenueLow: number
  revenueHigh: number
  marginLow: number
  marginHigh: number
  /** Production the cuts took off, in the crop's unit, and the rows they cut. */
  cutQuantity: number
  cutCount: number
}

export function buildBudget(rows: PlanRowView[]): BudgetLine[] {
  const byCrop = new Map<string, PlanRowView[]>()
  for (const r of rows) {
    if (!r.crop || (!r.plan && !r.isZone)) continue // include split-field zone rows
    const list = byCrop.get(r.crop.id) ?? []
    list.push(r)
    byCrop.set(r.crop.id, list)
  }

  const lines: BudgetLine[] = []
  for (const group of byCrop.values()) {
    const crop = group[0].crop!
    const acres = group.reduce((s, r) => s + (r.acres ?? 0), 0)
    const production = group.reduce((s, r) => s + (r.acres ?? 0) * (r.yieldPerAcre ?? 0), 0)
    const revenue = group.reduce((s, r) => s + (r.acres ?? 0) * r.revenuePerAcre, 0)
    const cost = group.reduce((s, r) => s + (r.acres ?? 0) * r.costPerAcre, 0)
    const weightedYield = acres > 0 ? production / acres : null
    const pricePerUnit = group[0].pricePerUnit
    const costPerAcre = acres > 0 ? cost / acres : 0
    const sum = (f: (r: PlanRowView) => number) => group.reduce((s, r) => s + (r.acres ?? 0) * f(r), 0)
    const revenueLow = sum((r) => r.revenueLowPerAcre)
    const revenueHigh = sum((r) => r.revenueHighPerAcre)
    const cutQuantity = sum((r) => (r.cutPct > 0 ? (r.yieldBeforeCut ?? 0) - (r.yieldPerAcre ?? 0) : 0))
    lines.push({
      crop,
      fieldCount: group.length,
      acres,
      weightedYield,
      pricePerUnit,
      revenue,
      cost,
      costPerAcre,
      margin: revenue - cost,
      marginPerAcre: acres > 0 ? (revenue - cost) / acres : 0,
      breakEvenPrice: weightedYield ? costPerAcre / weightedYield : null,
      breakEvenYield: pricePerUnit ? costPerAcre / pricePerUnit : null,
      weightedYieldLow: acres > 0 ? sum((r) => r.yieldLow ?? 0) / acres : null,
      weightedYieldHigh: acres > 0 ? sum((r) => r.yieldHigh ?? 0) / acres : null,
      revenueLow,
      revenueHigh,
      marginLow: revenueLow - cost,
      marginHigh: revenueHigh - cost,
      cutQuantity,
      cutCount: group.filter((r) => r.cutPct > 0).length,
    })
  }
  return lines.sort((a, b) => a.crop.name.localeCompare(b.crop.name))
}

export const money = (n: number): string =>
  n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })

export const money2 = (n: number): string =>
  n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

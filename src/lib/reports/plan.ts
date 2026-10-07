import { useMemo } from 'react'
import type { ExportColumn } from '@/hooks/useExport'
import { boundariesForYear, useAllBoundaries, useCropPlans, useCropVarieties, useCrops, useFields } from '@/lib/queries'
import { useContracts } from '@/lib/sales'
import { useAllCropInputs, useAllCropPrices, useYieldHistory } from '@/lib/forecast-data'
import { useElevatorBids } from '@/components/BreakevenCard'
import { useLandDeals } from '@/lib/land-deals-data'
import { useAllCropZones } from '@/lib/cropZones'
import { buildBudget, buildPlanRows, type BudgetLine, type PlanRowView, type ZoneLite } from '@/lib/planner'
import { companiesFor, companyLookup, cropLabel } from '@/lib/crop-label'

/**
 * The crop plan and budget for a year, as the Financials page shows them.
 *
 * Gathered here rather than in the page so the Reports page can download the
 * same plan and budget without opening Financials. Every input the estimate
 * uses — the year's plans, every year's prices and input budgets (a year with
 * none uses the latest earlier one), yield history, elevator bids, land deals,
 * contracts and crop zones.
 */
export function usePlanRows(cropYear: number) {
  const queries = {
    fields: useFields(),
    boundaries: useAllBoundaries(),
    crops: useCrops(),
    plans: useCropPlans(cropYear),
    prices: useAllCropPrices(),
    inputs: useAllCropInputs(),
    history: useYieldHistory(),
    bids: useElevatorBids(),
    deals: useLandDeals(),
    contracts: useContracts(cropYear),
    varieties: useCropVarieties(),
    zones: useAllCropZones(),
  }
  const { data: fields } = queries.fields
  const { data: allBoundaries } = queries.boundaries
  const { data: crops } = queries.crops
  const { data: plans } = queries.plans
  const { data: prices } = queries.prices
  const { data: inputs } = queries.inputs
  const { data: history } = queries.history
  const { data: bidList } = queries.bids
  const { data: deals } = queries.deals
  const { data: contracts } = queries.contracts
  const { data: varieties } = queries.varieties
  const { data: allZones } = queries.zones
  // Every input answered, one way or the other. The page draws as soon as it is
  // `loaded`, and fills in as the rest arrive; a file made from here waits for
  // all of it, so it is not missing a contract price that came in a second later.
  const settled = Object.values(queries).every((q) => q.status !== 'pending')
  const error = (Object.values(queries).find((q) => q.error)?.error as Error | undefined) ?? null

  // A crop's contracted price (bushel-weighted) overrides its estimate (SPEC §6).
  const contractPriceByCrop = useMemo(() => {
    const acc = new Map<string, { qty: number; val: number }>()
    for (const c of contracts ?? []) {
      if (!c.crop_id || c.price_per_unit == null || c.status === 'cancelled') continue
      const qty = c.bushels ?? 0
      const prev = acc.get(c.crop_id) ?? { qty: 0, val: 0 }
      acc.set(c.crop_id, { qty: prev.qty + qty, val: prev.val + qty * c.price_per_unit })
    }
    const m = new Map<string, number>()
    for (const [cropId, { qty, val }] of acc) if (qty > 0) m.set(cropId, val / qty)
    return m
  }, [contracts])

  const boundaries = useMemo(
    () => (allBoundaries ? boundariesForYear(allBoundaries, cropYear) : undefined),
    [allBoundaries, cropYear],
  )

  const zonesByField = useMemo(() => {
    const m = new Map<string, ZoneLite[]>()
    for (const z of allZones ?? []) {
      if (z.crop_year !== cropYear) continue
      if (!m.has(z.field_id)) m.set(z.field_id, [])
      m.get(z.field_id)!.push({ id: z.id, crop_id: z.crop_id, acres: z.acres })
    }
    return m
  }, [allZones, cropYear])

  const currentYear = new Date().getFullYear()
  const loaded = Boolean(fields && boundaries && crops && plans && prices && inputs)
  const rows = useMemo(
    () =>
      fields && boundaries && crops && plans && prices && inputs
        ? buildPlanRows(
            fields.filter((f) => f.active), // archived fields drop out of the plan
            boundaries,
            plans,
            crops,
            prices,
            inputs,
            contractPriceByCrop,
            zonesByField,
            {
              cropYear,
              currentYear,
              history: history ?? [],
              bids: new Map(bidList ?? []),
              deals: deals ?? [],
            },
          )
        : [],
    [fields, boundaries, plans, crops, prices, inputs, contractPriceByCrop, zonesByField, cropYear, currentYear, history, bidList, deals],
  )

  const budget = useMemo(() => buildBudget(rows), [rows])

  // Which company each field's crop is grown under, for the budget's labels.
  const company = useMemo(() => companyLookup(varieties ?? undefined), [varieties])
  const planPairs = useMemo(
    () => rows.filter((r) => r.plan).map((r) => ({ crop_id: r.plan!.crop_id, variety: r.plan!.variety })),
    [rows],
  )

  return { loaded, settled, error, rows, budget, crops, varieties, deals, company, planPairs }
}

/** The plan's columns as the CSV carries them. */
export function planExportColumns(): ExportColumn<PlanRowView>[] {
  return [
    { key: 'field', label: 'Field', value: (r) => r.field.name },
    { key: 'acres', label: 'Acres', value: (r) => r.acres },
    { key: 'crop', label: 'Crop', value: (r) => r.crop?.name ?? '' },
    { key: 'variety', label: 'Variety', value: (r) => r.plan?.variety ?? '' },
    { key: 'yield', label: 'Yield /ac', value: (r) => r.yieldPerAcre },
    { key: 'price', label: 'Price', value: (r) => r.pricePerUnit },
    { key: 'cost_ac', label: 'Cost /ac', value: (r) => (r.plan || r.isZone ? r.costPerAcre : null) },
    { key: 'margin_ac', label: 'Margin /ac', value: (r) => (r.plan || r.isZone ? r.marginPerAcre : null) },
    { key: 'margin_total', label: 'Margin', value: (r) => ((r.plan || r.isZone) && r.acres != null ? r.marginPerAcre * r.acres : null) },
  ]
}

/** The budget's columns as the CSV carries them. */
export function budgetExportColumns(
  planPairs: { crop_id: string; variety: string | null }[],
  company: ReturnType<typeof companyLookup>,
): ExportColumn<BudgetLine>[] {
  return [
    {
      key: 'crop',
      label: 'Crop',
      // "BASF Canola", not "Canola" — the two contracts are different grain
      // that cannot share a bin. The budget still groups by CROP, because the
      // money is the same money; only the name says which contracts are in it.
      value: (b) => {
        const cos = companiesFor(planPairs, b.crop.id, company)
        return cos.length ? cos.map((c) => cropLabel(b.crop.name, c)).join(' · ') : b.crop.name
      },
    },
    { key: 'fields', label: 'Fields', value: (b) => b.fieldCount },
    { key: 'acres', label: 'Acres', value: (b) => b.acres.toFixed(2) },
    { key: 'yield', label: 'Yield /ac', value: (b) => b.weightedYield?.toFixed(1) },
    { key: 'price', label: 'Price', value: (b) => b.pricePerUnit },
    { key: 'revenue', label: 'Revenue', value: (b) => b.revenue.toFixed(2) },
    { key: 'cost_ac', label: 'Cost /ac', value: (b) => b.costPerAcre.toFixed(2) },
    { key: 'cost', label: 'Cost', value: (b) => b.cost.toFixed(2) },
    { key: 'margin_ac', label: 'Margin /ac', value: (b) => b.marginPerAcre.toFixed(2) },
    { key: 'margin', label: 'Margin', value: (b) => b.margin.toFixed(2) },
    { key: 'be_price', label: 'Break-even Price', value: (b) => b.breakEvenPrice?.toFixed(4) },
    { key: 'be_yield', label: 'Break-even Yield', value: (b) => b.breakEvenYield?.toFixed(2) },
  ]
}

import { useEffect, useState } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import type { AppliedOp, ProductResolver } from '@/lib/applied'
import { useFarmData, type LayerTotal } from '@/lib/profit-loss-farm'
import { autoFixed, autoInputs, autoOutput, FIXED_KEY, lineKey, mergeLines, type AutoLine, type Line, type SavedLine } from '@/lib/profit-loss-lines'
import { applyDeal, dealFor, isOffTheTop, rentedOutIncome, type LandDeal } from '@/lib/land-deals'
import { FUEL_FIELD_LINE, FUEL_ROAD_LINE, TRUCKING_LINE, useOperatingCostLines } from '@/lib/operating-costs'
import { useSeasonFuelOps } from '@/lib/hauling-data'
import { useFixedPerAcre } from '@/lib/farm-costs'
import { useJdProducts, useProductResolver } from '@/lib/products'
import type { PlanRowView } from '@/lib/planner'
import type { CropRow } from '@/lib/queries'
import { usePlanRows } from './plan'

/**
 * The crop books behind the money reports (Crop P&L, cost of production,
 * landlord statements, the AgriStability package): one row per crop on a
 * field, with its revenue, its costs by kind, and what its land deal moves.
 *
 * Nothing in here is new arithmetic. It is the two money screens put side by
 * side:
 *
 *   - the ROWS, acres, yield and price are the Financials plan's
 *     (planner.ts / forecast.ts): a field's crop zones each get a row, the
 *     yield is the harvest off the scale where there is one and otherwise the
 *     expected yield (this field's average, the farm's, or the normal yield),
 *     and the price runs contract → the year's own → elevator bid → carried;
 *   - the COSTS are the Profit/Loss Map's (profit-loss-lines.ts): what the
 *     machines put on the field priced off the price book, the farm's fixed
 *     $/ac, fuel and trucking (operating-costs.ts), with every edit typed on
 *     the field's P&L laid over them;
 *   - the SPLIT is land-deals.ts: cash rent paid, the owner's share of a
 *     50/50, the grower's share on our land, rent received.
 *
 * The plan is used for the rows because the P&L Map books a split field
 * under its biggest crop alone — Whitfield would be 171 acres of corn, when 130
 * of them are the potato grower's. Where one field carries two of our crops,
 * the field's costs are spread over them by acres, the way the P&L Map
 * spreads any dollar no machine placed. Trucking is booked once the scale has
 * the crop, as on the P&L Map; before that the Travel & trucking page holds
 * the estimate.
 */

export type CostKind = 'seed' | 'fertilizer' | 'chemical' | 'fuel' | 'trucking' | 'other' | 'fixed'

export const COST_KINDS: { key: CostKind; label: string }[] = [
  { key: 'seed', label: 'Seed' },
  { key: 'fertilizer', label: 'Fertilizer' },
  { key: 'chemical', label: 'Chemical' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'trucking', label: 'Trucking' },
  { key: 'other', label: 'Other' },
  { key: 'fixed', label: 'Fixed' },
]

export type Costs = Record<CostKind, number>

const noCosts = (): Costs => ({ seed: 0, fertilizer: 0, chemical: 0, fuel: 0, trucking: 0, other: 0, fixed: 0 })

/** Where the yield came from, in a word: the scale, or which expectation. */
export type YieldFrom = 'actual' | 'typed' | 'field avg' | 'farm avg' | 'goal' | 'none'

export type BookRow = {
  fieldId: string
  field: string
  crop: CropRow | null
  unit: string | null
  acres: number
  yieldPerAcre: number | null
  yieldFrom: YieldFrom
  price: number | null
  /** The planner's words for the price: 'contract', '2026', 'forecast', 'market', '2025' (carried). */
  priceFrom: string
  /** Crop revenue before any split: yield × acres × price, or the figure typed on the field's P&L. */
  gross: number | null
  /** Revenue rows added by hand on the field's P&L (a straw sale), this row's share. */
  otherRevenue: number
  costs: Costs
  /** Hail and crop insurance among the costs: it comes off the cheque before a split. */
  insurance: number
  /** Cash rent we pay. */
  rent: number
  /** The land owner's (or grower's) cut. */
  ownerShare: number
  /** Rent received on our land rented out by the acre. */
  rentReceived: number
  /** Our share of the result, 0..1. */
  ourFraction: number
  /** The land deal, in words; null on our own land. */
  deal: string | null
  /** The deal itself, for the landlord statements. */
  landDeal: LandDeal | null
  /** Seed, fertilizer, chemical and other: everything but fixed, fuel and trucking. */
  inputs: number
  /** All our costs, cash rent included. */
  cost: number
  /** What the field leaves us; null when its revenue cannot be put on it (no yield or no price). */
  margin: number | null
  /** Cost lines with no price in the price book. */
  unpriced: number
}

export type CropBooks = {
  year: number
  rows: BookRow[]
  /**
   * Flat rent on land rented out, counted once for the deal (Hytech's carrots
   * and spinach), with the land share of the fixed expenses those acres carry
   * (0 for anyone who can't see the fixed-cost breakdown).
   */
  rentIn: { landlord: string; amount: number; landShare: number }[]
  fixedPerAcre: number | null
  fixedFrom: number | null
  /** The plan's rows left off the books, and why: a renter's crop, land rented out. */
  offBooks: { field: string; crop: string; acres: number | null; why: string }[]
}

type Op = AppliedOp & { id: string; field_id: string | null; operation_type: string; crop_season: number | null }

export type BooksInput = {
  year: number
  rows: PlanRowView[]
  deals: LandDeal[]
  ops: Op[]
  layers: LayerTotal[]
  saved: (SavedLine & { field_id: string })[]
  resolve: ProductResolver
  /** The price book's category for a product name (fertilizer, chemical). */
  categoryOf: (name: string) => string | null
  fixedPerAcre: number | null
  fixedFrom: number | null
  /** Fuel and trucking lines for a field (operating-costs.ts useOperatingCostLines). */
  extraLines: (fieldId: string, season: { cropName: string | null; yieldUnit: string | null; yieldTotal: number | null }) => AutoLine[]
}

/** Which kind of cost a P&L line is. */
export function costKind(line: Pick<Line, 'key' | 'label' | 'source'>, categoryOf: (name: string) => string | null): CostKind {
  if (line.key === FIXED_KEY) return 'fixed'
  if (line.label === FUEL_FIELD_LINE || line.label === FUEL_ROAD_LINE) return 'fuel'
  if (line.label === TRUCKING_LINE) return 'trucking'
  // Seed is only named in the planter's file.
  if (line.source.includes('planter') || /\bseed\b/i.test(line.label)) return 'seed'
  const cat = categoryOf(line.label)
  if (cat === 'fertilizer') return 'fertilizer'
  if (cat === 'chemical') return 'chemical'
  return 'other'
}

/** The plan's yield source as one word. A harvest yield is the scale's. */
export function yieldFrom(r: Pick<PlanRowView, 'yieldSource' | 'yieldPerAcre'>): YieldFrom {
  if (r.yieldPerAcre == null) return 'none'
  switch (r.yieldSource) {
    case 'clean':
    case 'pre-clean':
      return 'actual'
    case 'override':
      return 'typed'
    case 'field avg':
    case 'farm avg':
    case 'goal':
      return r.yieldSource
    default:
      return 'none'
  }
}

/** The plan's price source in a word or a year. */
export function priceFrom(r: Pick<PlanRowView, 'priceSource' | 'priceBadge' | 'pricePerUnit'>, year: number): string {
  if (r.pricePerUnit == null) return 'no price'
  if (r.priceSource === 'contract') return 'contract'
  return r.priceBadge || String(year)
}

/**
 * Why a plan row is not on our books, or null when it is. A renter's crop on
 * land that is not ours to rent out is nobody's money here; land rented out
 * earns its rent on the deal.
 */
export function offBooksReason(crop: CropRow | null, deal: LandDeal | null): string | null {
  if (!crop) return null
  if (crop.land_rent_only) return deal ? `land rented out to ${deal.landlord}` : 'land rented out'
  if (crop.renter_only && deal?.direction !== 'out') return 'grown by a renter, not on our books'
  return null
}

export function buildCropBooks(inp: BooksInput): CropBooks {
  const { year } = inp
  const group = <T extends { field_id: string | null }>(list: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of list) if (r.field_id) m.set(r.field_id, [...(m.get(r.field_id) ?? []), r])
    return m
  }
  const ops = group(inp.ops)
  const layers = group(inp.layers)
  const saved = group(inp.saved)

  const offBooks: CropBooks['offBooks'] = []
  // The land share of the fixed expenses on land rented out for a flat rent, by deal.
  const landShareByDeal = new Map<LandDeal, number>()
  // Plan rows by field, ours only.
  const byField = new Map<string, { field: string; ours: PlanRowView[] }>()
  for (const r of inp.rows) {
    const entry = byField.get(r.field.id) ?? { field: r.field.name, ours: [] }
    byField.set(r.field.id, entry)
    if (!r.crop || (!r.plan && !r.isZone)) continue
    const why = offBooksReason(r.crop, dealFor(inp.deals, r.field.id, year, r.crop.id))
    // Rent by the acre on land rented out is revenue on the field; a flat rent is counted once (rentIn).
    const perAcreRent = r.crop.land_rent_only && dealFor(inp.deals, r.field.id, year, r.crop.id)?.rent_per_acre != null
    if (why && !perAcreRent) {
      const deal = r.crop.land_rent_only ? dealFor(inp.deals, r.field.id, year, r.crop.id) : null
      if (deal && r.costPerAcre && r.acres) landShareByDeal.set(deal, (landShareByDeal.get(deal) ?? 0) + r.costPerAcre * r.acres)
      offBooks.push({ field: r.field.name, crop: r.crop.name, acres: r.acres, why })
      continue
    }
    entry.ours.push(r)
  }

  const out: BookRow[] = []
  for (const [fieldId, { field, ours }] of byField) {
    const fOps = ops.get(fieldId) ?? []
    const fSaved = saved.get(fieldId) ?? []
    // A field with nothing of ours grown, applied or entered is not on the books.
    if (!ours.length && !fOps.length && !fSaved.length) continue
    const acresOf = (r: PlanRowView) => r.acres ?? 0
    const ourAcres = ours.reduce((s, r) => s + acresOf(r), 0)
    const fixedAcres = ours.filter((r) => r.crop?.fixed_costs_apply !== false).reduce((s, r) => s + acresOf(r), 0)
    const main = [...ours].sort((a, b) => acresOf(b) - acresOf(a))[0] ?? null
    const harvested = (r: PlanRowView) => yieldFrom(r) === 'actual'
    const total = (r: PlanRowView) => (r.yieldPerAcre != null ? r.yieldPerAcre * acresOf(r) : null)

    // The field's lines exactly as its P&L builds them, our acres only.
    const auto: AutoLine[] = [
      ...autoInputs(fOps, layers.get(fieldId) ?? [], year, ourAcres, inp.resolve),
      ...[autoFixed(inp.fixedPerAcre, fixedAcres, inp.fixedFrom)].filter((l): l is AutoLine => l != null),
      ...inp.extraLines(fieldId, {
        cropName: main?.crop?.name ?? null,
        yieldUnit: main?.crop?.yield_unit ?? null,
        yieldTotal: main && harvested(main) ? total(main) : null,
      }),
      ...ours
        .filter((r) => r.crop)
        .map((r) => autoOutput({ name: r.crop!.name, unit: r.crop!.yield_unit, total: total(r) }, r.pricePerUnit, 'plan'))
        .filter((l): l is AutoLine => l != null),
    ]
    const lines = mergeLines(auto, fSaved)
    const field$ = noCosts()
    let insurance = 0
    let unpriced = 0
    let manualRevenue = 0
    for (const l of lines) {
      if (l.side === 'output') {
        if (l.isManual && l.total != null) manualRevenue += l.total
        continue
      }
      if (l.total == null) {
        unpriced++
        continue
      }
      field$[costKind(l, inp.categoryOf)] += l.total
      if (isOffTheTop(l.label)) insurance += l.total
    }
    const outputOf = (r: PlanRowView) => (r.crop ? lines.find((l) => l.side === 'output' && !l.isManual && l.key === lineKey(r.crop!.name)) : undefined)

    const rows: PlanRowView[] = ours.length ? ours : []
    // Costs on a field with nothing of ours planned still have to land somewhere.
    if (!rows.length) {
      const costs = { ...field$ }
      const cost = Object.values(costs).reduce((s, v) => s + v, 0)
      out.push({
        fieldId,
        field,
        crop: null,
        unit: null,
        acres: 0,
        yieldPerAcre: null,
        yieldFrom: 'none',
        price: null,
        priceFrom: '',
        gross: null,
        otherRevenue: manualRevenue,
        costs,
        insurance,
        rent: 0,
        ownerShare: 0,
        rentReceived: 0,
        ourFraction: 1,
        deal: null,
        landDeal: null,
        inputs: costs.seed + costs.fertilizer + costs.chemical + costs.other,
        cost,
        margin: null,
        unpriced,
      })
      continue
    }
    for (const r of rows) {
      const acres = acresOf(r)
      const share = ourAcres > 0 ? acres / ourAcres : 1 / rows.length
      const fixedShare = r.crop?.fixed_costs_apply === false ? 0 : fixedAcres > 0 ? acres / fixedAcres : 0
      const costs = noCosts()
      for (const k of COST_KINDS) costs[k.key] = field$[k.key] * (k.key === 'fixed' ? fixedShare : share)
      const out$ = outputOf(r)
      // Fallow is sold by nobody: its revenue is nothing rather than unknown.
      const sellsNothing = r.crop?.yield_unit === 'ac'
      const gross = sellsNothing ? 0 : (out$?.total ?? null)
      const otherRevenue = manualRevenue * share
      const rowInsurance = insurance * share
      const deal = r.crop ? dealFor(inp.deals, fieldId, year, r.crop.id) : null
      const varCost = Object.values(costs).reduce((s, v) => s + v, 0)
      const revenue = (gross ?? 0) + otherRevenue
      const hasYield = gross != null
      const d = applyDeal(deal, { id: fieldId, acres }, { revenue, cost: varCost, hasYield, offTheTop: rowInsurance }, (id) =>
        id === fieldId ? ourAcres : (inp.rows.filter((x) => x.field.id === id).reduce((s, x) => s + (x.acres ?? 0), 0) ?? 0),
      )
      const rentReceived = d.rentReceived ?? 0
      const cost = varCost + d.rent
      out.push({
        fieldId,
        field,
        crop: r.crop,
        unit: r.crop?.yield_unit ?? null,
        acres,
        yieldPerAcre: sellsNothing ? null : out$?.amount != null && acres > 0 ? out$.amount / acres : r.yieldPerAcre,
        yieldFrom: sellsNothing ? 'none' : out$?.edited.amount ? 'typed' : yieldFrom(r),
        price: sellsNothing ? null : (out$?.price ?? r.pricePerUnit),
        priceFrom: sellsNothing ? '' : out$?.edited.price ? 'typed on the P&L' : priceFrom(r, year),
        gross,
        otherRevenue,
        costs,
        insurance: rowInsurance,
        rent: d.rent,
        ownerShare: d.ownerShare,
        rentReceived,
        ourFraction: d.ourFraction,
        deal: deal ? d.label : null,
        landDeal: deal,
        inputs: costs.seed + costs.fertilizer + costs.chemical + costs.other,
        cost,
        margin: hasYield || rentReceived ? revenue + rentReceived - cost - d.ownerShare : null,
        unpriced,
      })
    }
  }

  out.sort((a, b) => (a.crop?.name ?? '~').localeCompare(b.crop?.name ?? '~') || a.field.localeCompare(b.field, undefined, { numeric: true }))
  return { year, rows: out, rentIn: rentedOutIncome(inp.deals, year).map(({ landlord, amount, deal }) => ({ landlord, amount, landShare: landShareByDeal.get(deal) ?? 0 })), fixedPerAcre: inp.fixedPerAcre, fixedFrom: inp.fixedFrom, offBooks }
}

/* ── Rolling rows up ────────────────────────────────────────────────────── */

export type CropTotal = {
  crop: CropRow
  fields: number
  acres: number
  /** Acre-weighted, over the rows with a yield. */
  yieldPerAcre: number | null
  production: number
  /** Revenue ÷ production: the average price the crop is carried at. */
  price: number | null
  gross: number
  /** What the land deals move: rent received less cash rent paid and owners' shares. */
  dealNet: number
  costs: Costs
  inputs: number
  cost: number
  margin: number
  /** Rows whose margin could not be worked out (no yield or price), left out of the margin. */
  unknown: number
  /** Cost an acre ÷ yield an acre, and ÷ price: the budget's break-evens (planner.ts buildBudget). */
  breakEvenPrice: number | null
  breakEvenYield: number | null
}

export const dealNetOf = (r: Pick<BookRow, 'rentReceived' | 'rent' | 'ownerShare'>) => r.rentReceived - r.rent - r.ownerShare

export function byCrop(rows: BookRow[]): CropTotal[] {
  const m = new Map<string, BookRow[]>()
  for (const r of rows) if (r.crop) m.set(r.crop.id, [...(m.get(r.crop.id) ?? []), r])
  const out: CropTotal[] = []
  for (const list of m.values()) {
    const crop = list[0].crop!
    const acres = list.reduce((s, r) => s + r.acres, 0)
    const withYield = list.filter((r) => r.yieldPerAcre != null)
    const yAcres = withYield.reduce((s, r) => s + r.acres, 0)
    const production = withYield.reduce((s, r) => s + r.yieldPerAcre! * r.acres, 0)
    const gross = list.reduce((s, r) => s + (r.gross ?? 0) + r.otherRevenue, 0)
    const costs = noCosts()
    for (const r of list) for (const k of COST_KINDS) costs[k.key] += r.costs[k.key]
    const cost = list.reduce((s, r) => s + r.cost, 0)
    const known = list.filter((r) => r.margin != null)
    const yieldPerAcre = yAcres > 0 ? production / yAcres : null
    const price = production > 0 ? list.reduce((s, r) => s + (r.gross ?? 0), 0) / production : null
    const costPerAcre = acres > 0 ? cost / acres : 0
    out.push({
      crop,
      fields: new Set(list.map((r) => r.fieldId)).size,
      acres,
      yieldPerAcre,
      production,
      price,
      gross,
      dealNet: list.reduce((s, r) => s + dealNetOf(r), 0),
      costs,
      inputs: list.reduce((s, r) => s + r.inputs, 0),
      cost,
      margin: known.reduce((s, r) => s + r.margin!, 0),
      unknown: list.length - known.length,
      breakEvenPrice: yieldPerAcre ? costPerAcre / yieldPerAcre : null,
      breakEvenYield: price ? costPerAcre / price : null,
    })
  }
  return out.sort((a, b) => a.crop.name.localeCompare(b.crop.name))
}

/* ── The hook ───────────────────────────────────────────────────────────── */

/**
 * True once the page's queries have all answered. Each hook below starts
 * its own queries (the Fuel model alone reads half a dozen settings), and
 * several hand back a usable default while they load — a file made then
 * would quietly lack trucking. So: one render to let every query start, then
 * wait for the cache to go quiet.
 */
function useQuiet(): boolean {
  const [started, setStarted] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setStarted(true), 0)
    return () => clearTimeout(t)
  }, [])
  const fetching = useIsFetching()
  return started && fetching === 0
}

/** Everything the crop books read, through the same hooks the Financials page and the P&L Map use. */
export function useCropBooks(year: number) {
  const plan = usePlanRows(year)
  const farm = useFarmData(year)
  const resolve = useProductResolver()
  const products = useJdProducts()
  const fixed = useFixedPerAcre(year)
  const fuelOps = useSeasonFuelOps(year)
  const operating = useOperatingCostLines(year, fuelOps.data)
  const quiet = useQuiet()
  const queries = [farm, products, fixed, fuelOps]
  const error = plan.error ?? ((queries.find((q) => q.error)?.error as Error | undefined) ?? null)
  const ready = quiet && plan.settled && plan.loaded && !!farm.data && !!resolve && !!products.data && fixed.data !== undefined && !!fuelOps.data
  const build = (): CropBooks => {
    const cat = new Map<string, string>()
    for (const p of products.data?.products ?? []) if (p.category) cat.set(p.name.trim().toLowerCase(), p.category)
    return buildCropBooks({
      year,
      rows: plan.rows,
      deals: plan.deals ?? [],
      ops: farm.data!.ops,
      layers: farm.data!.layers,
      saved: farm.data!.saved,
      resolve: resolve!,
      categoryOf: (name) => cat.get(name.trim().toLowerCase()) ?? null,
      fixedPerAcre: fixed.perAcre,
      fixedFrom: fixed.carriedFrom,
      extraLines: operating,
    })
  }
  return { ready, error, build, crops: plan.crops }
}

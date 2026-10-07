/**
 * The Profit/Loss Map across the whole farm: every field's books, side by side.
 *
 * Each field is priced exactly as its own page prices it — the same automatic
 * rows (profit-loss-lines.ts), the same edits laid over them — so the farm
 * total is the sum of numbers a person can open and check one field at a time.
 * Only the per-square detail is left out: the farm view colours a field by its
 * net per acre, and tapping it opens the 5 m map.
 *
 * A field with no yield yet is not given a profit. It has real costs and no
 * revenue, and calling that a loss would paint every unharvested field red in
 * September. It is shown as costs so far.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { AppliedOp, ProductResolver } from './applied'
import { autoInputs, autoOutput, fixedLines, forMap, mergeLines, type AutoLine, type FixedAreas, type SavedLine } from './profit-loss-lines'
import { applyDeal, dealFor, isOffTheTop, type LandDeal } from './land-deals'

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

type Op = AppliedOp & { id: string; field_id: string | null; operation_type: string; crop_season: number | null }

export type LayerTotal = {
  operation_id: string | null
  field_id: string
  operation_type: string
  kind: string
  product_name: string | null
  rate_unit: string | null
  rate_acres: number
  covered_acres: number
}

export type FieldBooks = {
  fieldId: string
  name: string
  cropName: string | null
  acres: number
  revenue: number
  cost: number
  net: number | null
  netPerAcre: number | null
  costPerAcre: number
  /** False until the scale has a yield (or somebody typed an output in). */
  hasYield: boolean
  /** Whether the harvest footprint is gridded, so the 5 m map can draw. */
  mapped: boolean
  unpriced: number
  /** The land deal on this field that year, if rented ("50/50 net profit with Whitfield"). */
  deal: string | null
  /** The owner's cut of the result, dollars (a 50/50 field's other half). */
  ownerShare: number
  /** Cash rent charged to the field, dollars (included in cost). */
  rent: number
}

export type FarmInputs = {
  cropYear: number
  fields: { id: string; name: string }[]
  seasons: Map<
    string,
    {
      cropId?: string | null
      cropName: string | null
      yieldUnit: string | null
      acres: number | null
      yieldTotal: number | null
      price: number | null
      /** Somebody else's crop (crops.renter_only). */
      renterOnly?: boolean
      /** False when the farm's fixed $/ac is not charged on this crop (crops.fixed_costs_apply). */
      fixedApplies?: boolean
    }
  >
  ops: Op[]
  layers: LayerTotal[]
  saved: (SavedLine & { field_id: string })[]
  resolve: ProductResolver
  priceSource: string
  /** Leases: cash rent is charged, a 50/50 field keeps our half. */
  deals?: LandDeal[]
  /** The farm's fixed expenses, $/ac (Financials → Farm costs), charged on every field's acres. */
  fixedPerAcre?: number | null
  /** The year that figure was set for, when it is carried forward from an earlier one. */
  fixedFrom?: number | null
  /** Split fields' acres by what they carry (fixedAreasFrom); a field not here is charged on its season's acres. */
  fixedAreas?: Map<string, FixedAreas>
  /** The land share on land rented out, $/ac; null when not visible to this user. */
  landSharePerAcre?: number | null
  /** More automatic rows per field (fuel and trucking, operating-costs.ts), the same ones the field page adds. */
  extraLines?: (fieldId: string, season: { cropName: string | null; yieldUnit: string | null; yieldTotal: number | null } | undefined) => AutoLine[]
}

export function farmBooks(inp: FarmInputs): FieldBooks[] {
  const byField = <T extends { field_id: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) {
      if (!r.field_id) continue
      const list = m.get(r.field_id) ?? []
      list.push(r)
      m.set(r.field_id, list)
    }
    return m
  }
  const ops = byField(inp.ops)
  const layers = byField(inp.layers)
  const saved = byField(inp.saved)

  const out: FieldBooks[] = []
  for (const f of inp.fields) {
    const season = inp.seasons.get(f.id)
    const fOps = ops.get(f.id) ?? []
    const fSaved = saved.get(f.id) ?? []
    // A field with nothing grown, applied or entered this year is not on the books.
    if (!season?.cropName && !fOps.length && !fSaved.length) continue
    const deal = dealFor(inp.deals ?? [], f.id, inp.cropYear, season?.cropId)
    // Nor is somebody else's crop on land we don't rent out to them — the
    // stand-in potatoes on Lindgren Sr. Away are there so the rotation knows,
    // not ours and not split (Sam, 2 Oct 2026). Our land under the potato
    // grower's deal ('out') still counts: half the gross is ours.
    if (season?.renterOnly && deal?.direction !== 'out' && !fOps.length && !fSaved.length) continue
    const acres = season?.acres ?? 0
    const fLayers = layers.get(f.id) ?? []
    const auto = [
      ...autoInputs(fOps, fLayers, inp.cropYear, acres, inp.resolve),
      ...fixedLines({
        perAcre: inp.fixedPerAcre ?? null,
        carriedFrom: inp.fixedFrom ?? null,
        landSharePerAcre: inp.landSharePerAcre ?? null,
        acres,
        fixedApplies: season?.fixedApplies !== false,
        areas: inp.fixedAreas?.get(f.id),
      }),
      ...(inp.extraLines?.(f.id, season) ?? []),
      autoOutput({ name: season?.cropName ?? null, unit: season?.yieldUnit ?? null, total: season?.yieldTotal ?? null }, season?.price ?? null, inp.priceSource),
    ].filter((l): l is NonNullable<typeof l> => l != null)
    const lines = mergeLines(auto, fSaved)
    const m = forMap(lines, acres, new Set(), null)
    const hasYield = lines.some((l) => l.side === 'output' && (l.amount ?? 0) > 0 && l.total != null)
    const offTheTop = lines.filter((l) => l.side === 'input' && isOffTheTop(l.label) && l.total != null).reduce((s, l) => s + Number(l.total), 0)
    const d = applyDeal(deal, { id: f.id, acres }, { revenue: m.revenue, cost: m.cost, hasYield, offTheTop }, (id) => inp.seasons.get(id)?.acres ?? 0)
    const cost = m.cost + d.rent
    const net = hasYield ? d.ourNet : null
    out.push({
      fieldId: f.id,
      name: f.name,
      cropName: season?.cropName ?? null,
      acres,
      // Rent received on land rented out by the acre is revenue like a crop.
      revenue: m.revenue + (d.rentReceived ?? 0),
      cost,
      net,
      netPerAcre: net != null && acres > 0 ? net / acres : null,
      costPerAcre: acres > 0 ? cost / acres : 0,
      deal: deal ? d.label : null,
      ownerShare: d.ownerShare,
      rent: d.rent,
      hasYield,
      mapped: fLayers.some((l) => l.kind === 'coverage' || l.kind === 'yield'),
      unpriced: m.unpriced,
    })
  }
  // Best to worst; fields with no yield after, most spent first.
  return out.sort((a, b) =>
    a.netPerAcre != null && b.netPerAcre != null
      ? b.netPerAcre - a.netPerAcre
      : a.netPerAcre != null
        ? -1
        : b.netPerAcre != null
          ? 1
          : b.cost - a.cost,
  )
}

export function farmTotals(books: FieldBooks[]) {
  const harvested = books.filter((b) => b.hasYield)
  const acres = harvested.reduce((s, b) => s + b.acres, 0)
  const revenue = harvested.reduce((s, b) => s + b.revenue, 0)
  const cost = harvested.reduce((s, b) => s + b.cost, 0)
  const ownerShare = harvested.reduce((s, b) => s + b.ownerShare, 0)
  return {
    harvestedFields: harvested.length,
    harvestedAcres: acres,
    revenue,
    cost,
    /** Land owners' cuts on shared fields, dollars. */
    ownerShare,
    net: revenue - cost - ownerShare,
    netPerAcre: acres > 0 ? (revenue - cost - ownerShare) / acres : null,
    unharvestedFields: books.length - harvested.length,
    unharvestedCost: books.filter((b) => !b.hasYield).reduce((s, b) => s + b.cost, 0),
  }
}

/** Everything the farm view reads, in parallel, for one season. */
export function useFarmData(cropYear: number) {
  return useQuery({
    queryKey: ['pl-farm', cropYear],
    queryFn: async () => {
      const [history, plans, targets, contracts, saved, ops, layers] = await Promise.all([
        supabase
          .from('crop_history')
          .select('field_id, crop_id, acres, actual_yield_total, yield_unit, crops(name, yield_unit, renter_only, fixed_costs_apply)')
          .eq('crop_year', cropYear),
        supabase.from('crop_plans').select('field_id, crop_id, planned_acres, crops(name, yield_unit, renter_only, fixed_costs_apply)').eq('crop_year', cropYear),
        supabase.from('crop_prices').select('crop_id, price_per_unit').eq('crop_year', cropYear),
        // A cancelled contract sold nothing; the planner skips it too.
        supabase.from('contracts').select('crop_id, bushels, price_per_unit').eq('crop_year', cropYear).neq('status', 'cancelled'),
        supabase
          .from('pl_field_lines')
          .select('field_id, side, line_key, label, unit, price_per_unit, amount, is_manual, removed')
          .eq('crop_year', cropYear),
        // Not `raw`: it is the heaviest column and only names machines.
        supabase
          .from('jd_field_operations')
          .select('id, jd_id, field_id, operation_type, crop_season, started_at, ended_at, products, as_applied, applied_area_ha, sessions, cost_acres_override, not_ours')
          .eq('crop_season', cropYear)
          .in('operation_type', ['seeding', 'application', 'harvest']),
        supabase.rpc('pl_layer_totals', { p_year: cropYear }),
      ])
      for (const r of [history, plans, targets, contracts, saved, ops, layers]) if (r.error) throw r.error

      const target = new Map((targets.data ?? []).map((t) => [t.crop_id, num(t.price_per_unit)]))
      const sold = new Map<string, { q: number; d: number }>()
      for (const c of contracts.data ?? []) {
        const q = num(c.bushels)
        const p = num(c.price_per_unit)
        if (!c.crop_id || !q || p == null) continue
        const s = sold.get(c.crop_id) ?? { q: 0, d: 0 }
        s.q += q
        s.d += q * p
        sold.set(c.crop_id, s)
      }

      // One crop per field: the largest, as the field page does.
      type C = { name: string; yield_unit: string | null; renter_only: boolean; fixed_costs_apply: boolean }
      type H = { field_id: string; crop_id: string | null; acres: unknown; actual_yield_total: unknown; yield_unit: string | null; crops: C | null }
      const main = new Map<string, H>()
      for (const h of (history.data ?? []) as unknown as H[]) {
        const cur = main.get(h.field_id)
        if (!cur || (num(h.acres) ?? 0) > (num(cur.acres) ?? 0)) main.set(h.field_id, h)
      }
      // A standing crop is only in the plan until its scale loads are in. The
      // plan fills in the crop and acres for fields with no harvest record,
      // with no yield — so the field shows its crop, and still no profit.
      type P = { field_id: string; crop_id: string | null; planned_acres: unknown; crops: C | null }
      const planned = new Map<string, P>()
      for (const p of (plans.data ?? []) as unknown as P[]) {
        const cur = planned.get(p.field_id)
        if (!cur || (num(p.planned_acres) ?? 0) > (num(cur.planned_acres) ?? 0)) planned.set(p.field_id, p)
      }
      for (const [fieldId, p] of planned) {
        if (main.has(fieldId)) continue
        main.set(fieldId, {
          field_id: fieldId,
          crop_id: p.crop_id,
          acres: p.planned_acres,
          actual_yield_total: null,
          yield_unit: p.crops?.yield_unit ?? null,
          crops: p.crops,
        })
      }

      return {
        main,
        target,
        actual: new Map([...sold].map(([k, v]) => [k, v.q > 0 ? v.d / v.q : null])),
        saved: (saved.data ?? []).map((r) => ({ ...r, price_per_unit: num(r.price_per_unit), amount: num(r.amount) })),
        ops: (ops.data ?? []) as unknown as Op[],
        layers: ((layers.data ?? []) as LayerTotal[]).map((l) => ({ ...l, rate_acres: Number(l.rate_acres), covered_acres: Number(l.covered_acres) })),
      }
    },
  })
}

export function seasonsFrom(
  data: NonNullable<ReturnType<typeof useFarmData>['data']>,
  priceMode: 'target' | 'actual',
): FarmInputs['seasons'] {
  const out: FarmInputs['seasons'] = new Map()
  for (const [fieldId, h] of data.main) {
    const price = h.crop_id ? ((priceMode === 'actual' ? data.actual : data.target).get(h.crop_id) ?? null) : null
    out.set(fieldId, {
      cropId: h.crop_id,
      cropName: h.crops?.name ?? null,
      yieldUnit: h.yield_unit ?? h.crops?.yield_unit ?? null,
      acres: num(h.acres),
      yieldTotal: num(h.actual_yield_total),
      price,
      renterOnly: Boolean(h.crops?.renter_only),
      fixedApplies: h.crops?.fixed_costs_apply ?? true,
    })
  }
  return out
}

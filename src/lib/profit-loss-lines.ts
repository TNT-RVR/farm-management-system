/**
 * The Profit/Loss Map's input and output tables.
 *
 * Each field-year is shown as two lists, the way a person reads a budget:
 *
 *   Inputs   product · $/unit · total amount · total $
 *   Outputs  crop    · $/unit · total amount · total $
 *
 * Every automatic row is built from the data — the products summed across
 * every pass, the seed off the planter's file, the crop off the scale — and
 * any cell can be typed over. Rows can be added by hand (labour, land rent, a
 * straw sale) and automatic ones taken off. Only the edits are saved
 * (pl_field_lines), so an unedited row keeps following the data.
 *
 * WHERE THE DOLLARS GO ON THE MAP. A row that came off the machines keeps its
 * passes: its dollars are split between them by how much each pass applied,
 * and each pass's share lands where that pass's grid says the product went.
 * A row added by hand, or one no machine logged, is spread evenly per acre.
 * Typing over an automatic row's price or amount changes its dollars but not
 * where they land.
 */
import { appliedByProduct, toCanonicalRate, type AppliedOp, type ProductResolver } from './applied'
import { CELL_ACRES, type PackedCell } from './pl-grid'

export type Side = 'input' | 'output'

export type LineShare = { operationId: string; share: number }

export type AutoLine = {
  key: string
  side: Side
  label: string
  unit: string | null
  price: number | null
  amount: number | null
  /** Plain words for where the automatic figures came from. */
  source: string
  /** The passes that applied it, and each one's share of the amount. */
  passes: LineShare[]
  /** Why a figure is missing, when one is. */
  problem: string | null
}

export type SavedLine = {
  side: Side
  line_key: string
  label: string
  unit: string | null
  price_per_unit: number | null
  amount: number | null
  is_manual: boolean
  removed: boolean
}

export type Line = AutoLine & {
  isManual: boolean
  /** Which figures a person typed over the automatic ones. */
  edited: { price: boolean; amount: boolean }
  auto: { price: number | null; amount: number | null } | null
  total: number | null
}

/** Dollars as the tables show them. */
export const money = (v: number | null | undefined, dp = 0) =>
  v == null
    ? '—'
    : v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: dp, minimumFractionDigits: dp })

export const lineKey = (name: string) => name.trim().toLowerCase()

type Op = AppliedOp & { id: string; operation_type: string; crop_season: number | null }
/**
 * A gridded layer, as either its cells (one field's page) or its sum already
 * taken on the server (the farm view, via pl_layer_totals).
 */
type Grid = {
  operation_id: string | null
  kind: string
  product_name: string | null
  rate_unit: string | null
  cells?: PackedCell[]
  /** Σ rate × acres, when the server summed it. */
  rate_acres?: number | null
}

/**
 * One row per product put on the field that year.
 *
 * Sprays and fertilizer go through appliedByProduct, one pass at a time, so
 * each pass's share of a product is known. The machine's measured total wins
 * over rate × acres where the pass reported one — the urea on #5 carries only
 * a measured 2,464 kg and no per-acre rate at all, and reading only the rate
 * left it unpriced.
 *
 * Seed is named only inside the planter's export, so it comes off the seeding
 * grid: applied rate × area, summed.
 */
export function autoInputs(
  ops: Op[],
  grids: Grid[],
  cropYear: number,
  acres: number,
  resolve: ProductResolver,
): AutoLine[] {
  const rows = new Map<string, { label: string; unit: string | null; qty: number; dollars: number; priced: boolean; perOp: Map<string, number>; source: Set<string>; problem: string | null }>()
  const row = (label: string, unit: string | null) => {
    const k = lineKey(label)
    let r = rows.get(k)
    if (!r) {
      r = { label, unit, qty: 0, dollars: 0, priced: true, perOp: new Map(), source: new Set(), problem: null }
      rows.set(k, r)
    }
    return r
  }

  for (const o of ops) {
    if (o.crop_season !== cropYear) continue
    if (o.operation_type === 'application') {
      const { lines } = appliedByProduct([o], acres, resolve)
      for (const l of lines) {
        const qty = l.measuredTotal ?? l.total
        if (!(qty != null && qty > 0)) continue
        const cost = l.measuredTotal != null ? l.measuredCost : l.cost
        const r = row(l.product, l.unit)
        r.qty += qty
        r.perOp.set(o.id, (r.perOp.get(o.id) ?? 0) + qty)
        r.source.add('Deere')
        if (cost == null) {
          r.priced = false
          r.problem = 'no price in the price book'
        } else r.dollars += cost
      }
    } else if (o.operation_type === 'seeding') {
      for (const g of grids) {
        if (g.operation_id !== o.id || g.kind !== 'input') continue
        const name = g.product_name ?? 'Seed'
        const perAcreSum = g.rate_acres ?? (g.cells ?? []).reduce((s, c) => s + c[2] * c[3] * CELL_ACRES, 0)
        const conv = toCanonicalRate(perAcreSum, g.rate_unit ?? undefined)
        if (!conv) continue
        const r = row(name, conv.unit)
        r.qty += conv.rate
        r.perOp.set(o.id, (r.perOp.get(o.id) ?? 0) + conv.rate)
        r.source.add('planter')
        const price = resolve(name)?.pricePerUnit ?? null
        if (price == null) {
          r.priced = false
          r.problem = 'no price in the price book'
        } else r.dollars += conv.rate * price
      }
    }
  }

  return [...rows.entries()].map(([key, r]) => ({
    key,
    side: 'input' as const,
    label: r.label,
    unit: r.unit,
    amount: r.qty,
    price: r.priced && r.qty > 0 ? r.dollars / r.qty : null,
    source: `${[...r.source].join(' + ')}, ${r.perOp.size} pass${r.perOp.size === 1 ? '' : 'es'}`,
    passes: [...r.perOp.entries()].map(([operationId, q]) => ({ operationId, share: q / r.qty })),
    problem: r.priced ? null : r.problem,
  }))
}

/** The crop, from the scale, at the chosen price. */
export function autoOutput(crop: { name: string | null; unit: string | null; total: number | null }, price: number | null, priceSource: string): AutoLine | null {
  if (!crop.name) return null
  return {
    key: lineKey(crop.name),
    side: 'output',
    label: crop.name,
    unit: crop.unit,
    price,
    amount: crop.total,
    source: `scale, ${priceSource} price`,
    passes: [],
    problem: crop.total == null ? 'no scale loads yet' : price == null ? `no ${priceSource} price` : null,
  }
}

/** The key the fixed-expense row is saved under. Prefixed so no product name can collide with it. */
export const FIXED_KEY = 'auto:fixed-expenses'

/**
 * The farm's fixed expenses (Financials → Farm costs) on this field's acres.
 *
 * One row at the same $/ac on every field: land, machinery, labour and
 * overhead together, the farm totals already divided by the acres they are
 * spread over. The parts stay with the owners, so the row never shows them.
 * No machine put it anywhere in particular, so it is spread evenly, and like
 * any automatic row it can be typed over or taken off a field.
 */
export function autoFixed(perAcre: number | null, acres: number, carriedFrom: number | null = null): AutoLine | null {
  if (perAcre == null || !(acres > 0)) return null
  return {
    key: FIXED_KEY,
    side: 'input',
    label: 'Fixed expenses',
    unit: 'ac',
    price: perAcre,
    amount: acres,
    source: carriedFrom != null ? `farm costs, ${carriedFrom} figure` : 'farm costs',
    passes: [],
    problem: null,
  }
}

export const LAND_SHARE_KEY = 'auto:fixed-land-share'

/** A split field's acres by what they carry: the whole fixed figure, or only the land share. */
export type FixedAreas = { full: number; landShare: number }

/**
 * Split fields' acres by what they carry, from their crop areas: our crops
 * and the potato grower's carry the whole figure, land rented out (Hytech)
 * only the land share, a crop that carries none (somebody else's) nothing,
 * and ground in no crop area nothing — the same acres the database spreads
 * the figure over (farm_plan_acres, farm_rented_out_acres).
 */
export function fixedAreasFrom(
  zones: { field_id: string; crop_id: string; crop_year: number; acres: unknown }[] | undefined,
  crops: { id: string; fixed_costs_apply?: boolean | null; land_rent_only?: boolean | null }[] | undefined,
  year: number,
): Map<string, FixedAreas> {
  const byId = new Map((crops ?? []).map((c) => [c.id, c]))
  const out = new Map<string, FixedAreas>()
  for (const z of zones ?? []) {
    if (z.crop_year !== year) continue
    const acres = Number(z.acres)
    const crop = byId.get(z.crop_id)
    const a = out.get(z.field_id) ?? { full: 0, landShare: 0 }
    if (Number.isFinite(acres) && acres > 0 && crop && crop.fixed_costs_apply !== false) {
      if (crop.land_rent_only) a.landShare += acres
      else a.full += acres
    }
    out.set(z.field_id, a)
  }
  return out
}

/**
 * A field's fixed-expense rows. A field split into crop areas is charged by
 * area — before, the whole field was charged at the full figure as its
 * largest crop, so Hytech's carrots on 9 and spinach on 10 and the unplanted
 * part of 10 paid the full $/ac. Land rented out takes only its land share, a
 * row only the owners and the accountant are given the figure for.
 */
export function fixedLines(o: {
  perAcre: number | null
  carriedFrom: number | null
  landSharePerAcre: number | null
  acres: number
  fixedApplies: boolean
  areas: FixedAreas | null | undefined
}): AutoLine[] {
  if (!o.areas) {
    const l = autoFixed(o.fixedApplies ? o.perAcre : null, o.acres, o.carriedFrom)
    return l ? [l] : []
  }
  const out: AutoLine[] = []
  const full = autoFixed(o.perAcre, o.areas.full, o.carriedFrom)
  if (full) out.push(full)
  if (o.landSharePerAcre != null && o.areas.landShare > 0)
    out.push({
      key: LAND_SHARE_KEY,
      side: 'input',
      label: 'Fixed expenses: land share (land rented out)',
      unit: 'ac',
      price: o.landSharePerAcre,
      amount: o.areas.landShare,
      source: 'farm costs: the land and long-term debt part, on land rented out',
      passes: [],
      problem: null,
    })
  return out
}

/** The automatic rows with a person's edits laid over them, then the rows added by hand. */
export function mergeLines(auto: AutoLine[], saved: SavedLine[]): Line[] {
  const bySide = new Map(saved.map((s) => [`${s.side}:${s.line_key}`, s]))
  const out: Line[] = []
  for (const a of auto) {
    const s = bySide.get(`${a.side}:${a.key}`)
    if (s?.removed) continue
    const price = s?.price_per_unit ?? a.price
    const amount = s?.amount ?? a.amount
    out.push({
      ...a,
      price,
      amount,
      isManual: false,
      edited: { price: s?.price_per_unit != null, amount: s?.amount != null },
      auto: { price: a.price, amount: a.amount },
      total: price != null && amount != null ? price * amount : null,
    })
  }
  for (const s of saved) {
    if (!s.is_manual || s.removed) continue
    out.push({
      key: s.line_key,
      side: s.side,
      label: s.label,
      unit: s.unit,
      price: s.price_per_unit,
      amount: s.amount,
      source: 'added',
      passes: [],
      problem: null,
      isManual: true,
      edited: { price: false, amount: false },
      auto: null,
      total: s.price_per_unit != null && s.amount != null ? s.price_per_unit * s.amount : null,
    })
  }
  return out
}

/**
 * What the map needs from the tables.
 *
 * `placed` is dollars per pass, to be laid where that pass's grid says; a pass
 * with no grid yet cannot be placed, so its dollars go flat instead of
 * vanishing. `flatPerAcre` is everything else spread over the field.
 */
export function forMap(lines: Line[], acres: number, gridded: Set<string>, mainOutputKey: string | null) {
  const placed = new Map<string, number>()
  let flatCost = 0
  let otherRevenue = 0
  let cost = 0
  let revenue = 0
  let unpriced = 0
  for (const l of lines) {
    if (l.total == null) {
      unpriced++
      continue
    }
    if (l.side === 'output') {
      revenue += l.total
      if (l.key !== mainOutputKey || l.isManual) otherRevenue += l.total
      continue
    }
    cost += l.total
    const onMap = l.passes.filter((p) => gridded.has(p.operationId))
    const mappedShare = onMap.reduce((s, p) => s + p.share, 0)
    for (const p of onMap) placed.set(p.operationId, (placed.get(p.operationId) ?? 0) + l.total * p.share)
    flatCost += l.total * (1 - mappedShare)
  }
  const per = (v: number) => (acres > 0 ? v / acres : 0)
  return { placed, flatPerAcre: per(flatCost), otherRevenuePerAcre: per(otherRevenue), cost, revenue, unpriced }
}

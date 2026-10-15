/**
 * Turning per-acre recommendations into an order.
 *
 * A recommendation is written in lb/ac of actual nutrient with a product beside
 * it. Buying is done in tonnes of product across the whole farm, so the two
 * ends of this need connecting: rate x acres, summed by product, converted.
 */

export type RecItem = {
  nutrient?: string
  product?: string
  lb_per_ac?: number
  product_lb_per_ac?: number
  timing?: string
  note?: string
}

export type FieldRequirement = {
  fieldId: string
  fieldName: string
  cropLabel: string | null
  acres: number | null
  /** Null when the field has no assessment yet — NOT zero. */
  lines: RequirementLine[] | null
}

export type RequirementLine = {
  nutrient: string
  product: string
  timing: string | null
  lbPerAc: number
  /** lb of PRODUCT per acre, where the recommendation gave it. */
  productLbPerAc: number | null
  /** Total lb of product for this field, once acres are known. */
  productLbTotal: number | null
  note: string | null
}

/** 2,204.62 lb to the tonne. Fertiliser is ordered in metric tonnes here. */
const LB_PER_TONNE = 2204.62

export const toTonnes = (lb: number) => lb / LB_PER_TONNE

/**
 * The product rate a line implies.
 *
 * Prefer what the recommendation stated; fall back to deriving it from the
 * analysis in the product name when it did not. "11-52-0 MAP" supplying P2O5
 * means 52% of the product is P2O5, so 70 lb/ac of P2O5 is 135 lb/ac of MAP.
 * Returns null rather than guessing when the name carries no analysis — an
 * invented tonnage is worse than a blank on an order sheet.
 */
export function productRate(item: RecItem): number | null {
  if (item.product_lb_per_ac != null && item.product_lb_per_ac > 0) return item.product_lb_per_ac
  const lb = item.lb_per_ac
  const name = item.product ?? ''
  if (lb == null || !lb) return null

  const analysis = name.match(/(\d{1,2})-(\d{1,2})-(\d{1,2})(?:-(\d{1,2}))?/)
  if (!analysis) return null
  const [n, p, k, s] = [1, 2, 3, 4].map((i) => Number(analysis[i] ?? 0))

  const nutrient = (item.nutrient ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const pct =
    nutrient === 'N' ? n
    : nutrient === 'P2O5' || nutrient === 'P' ? p
    : nutrient === 'K2O' || nutrient === 'K' ? k
    : nutrient === 'S' ? s
    : 0
  if (!pct) return null
  return Math.round((lb / (pct / 100)) * 10) / 10
}

/**
 * Things the model writes into the product field that are not products.
 *
 * "none", "included in MAP", "Incidental from other sources", "rely on
 * inoculant". Real answers to "what product", but nothing to order, and they
 * appear on the order sheet as a line with no quantity if left in.
 */
const NOT_A_PRODUCT = /^(none|n\/a|nil|zero|included\b|incidental\b|rely\b|no\s|not\b)/i

/** Trade names for the analyses this farm buys, so a row reads as both. */
const COMMON: Record<string, string> = {
  '46-0-0': 'urea',
  '82-0-0': 'anhydrous ammonia',
  '32-0-0': 'UAN',
  '28-0-0': 'UAN',
  '11-52-0': 'MAP',
  '10-34-0': 'liquid APP',
  '0-0-60': 'potash',
  '21-0-0-24': 'ammonium sulphate',
}

/**
 * One key per product a supplier would recognise.
 *
 * Grouped by the ANALYSIS, not the words around it. The generator writes the
 * same product a dozen ways — "0-0-60 potash", "0-0-60 KCl", "0-0-60 potash
 * (Zone 4 only)", "11-52-0 MAP seed-placed" — and totalling on the raw string
 * split potash across four rows on the first real run. The analysis is the part
 * a supplier quotes against and the only part that is stable.
 *
 * Returns null for anything with no analysis in the name. Micronutrients land
 * there by design: "10% Zn-EDTA" and "36% zinc sulphate" are not the same
 * product and their weights are not interchangeable, so they are totalled as
 * actual nutrient instead of pretending to be one order line.
 */
export function canonicalProduct(name: string): { key: string; label: string } | null {
  const trimmed = (name ?? '').trim()
  if (!trimmed || NOT_A_PRODUCT.test(trimmed)) return null
  const analysis = trimmed.match(/(\d{1,2})-(\d{1,2})-(\d{1,2})(?:-(\d{1,2}))?/)
  if (!analysis) return null
  const key = analysis[0]
  const common = COMMON[key]
  return { key, label: common ? `${key} ${common}` : key }
}


export function buildRequirement(
  fieldId: string,
  fieldName: string,
  cropLabel: string | null,
  acres: number | null,
  recs: RecItem[] | null,
): FieldRequirement {
  if (!recs) return { fieldId, fieldName, cropLabel, acres, lines: null }
  const lines: RequirementLine[] = []
  for (const r of recs) {
    if (!r.product || r.lb_per_ac == null) continue
    const productLbPerAc = productRate(r)
    lines.push({
      nutrient: r.nutrient ?? '—',
      product: r.product,
      timing: r.timing ?? null,
      lbPerAc: r.lb_per_ac,
      productLbPerAc,
      productLbTotal:
        productLbPerAc != null && acres != null ? Math.round(productLbPerAc * acres) : null,
    note: r.note ?? null,
    })
  }
  return { fieldId, fieldName, cropLabel, acres, lines }
}

export type ProductTotal = {
  product: string
  fields: number
  /** Null when no field in the group had both a rate and an acreage. */
  totalLb: number | null
  totalTonnes: number | null
  /** Fields counted in, and fields that had to be left out and why. */
  missingAcres: string[]
  missingRate: string[]
}

/**
 * Farm-wide totals per product.
 *
 * A field missing its acreage, or a line whose product rate could not be
 * derived, is named rather than skipped silently. A total that quietly omits
 * two fields is the one that gets ordered against.
 */
export function totalsByProduct(reqs: FieldRequirement[]): ProductTotal[] {
  const byProduct = new Map<string, ProductTotal>()
  for (const req of reqs) {
    if (!req.lines) continue
    for (const line of req.lines) {
      const canon = canonicalProduct(line.product)
      // No analysis in the name means it is a micronutrient or not a product at
      // all; both are handled elsewhere rather than fragmenting the order sheet.
      if (!canon) continue
      const key = canon.key
      if (!byProduct.has(key)) {
        byProduct.set(key, {
          product: canon.label,
          fields: 0,
          totalLb: null,
          totalTonnes: null,
          missingAcres: [],
          missingRate: [],
        })
      }
      const t = byProduct.get(key)!
      t.fields++
      if (line.productLbPerAc == null) {
        t.missingRate.push(req.fieldName)
      } else if (req.acres == null) {
        t.missingAcres.push(req.fieldName)
      } else {
        t.totalLb = (t.totalLb ?? 0) + line.productLbPerAc * req.acres
      }
    }
  }
  for (const t of byProduct.values()) {
    if (t.totalLb != null) {
      t.totalLb = Math.round(t.totalLb)
      t.totalTonnes = Math.round(toTonnes(t.totalLb) * 100) / 100
    }
  }
  return [...byProduct.values()].sort((a, b) => (b.totalLb ?? 0) - (a.totalLb ?? 0))
}

/**
 * Micronutrients and anything else with no analysis, totalled as actual
 * nutrient rather than product weight.
 *
 * Zinc arrives as a chelate at 10% and a sulphate at 36%; adding their product
 * weights together would produce a tonnage that corresponds to nothing you
 * could buy. Pounds of zinc is the figure that survives the difference.
 */
export function microTotals(reqs: FieldRequirement[]) {
  const byNutrient = new Map<string, { nutrient: string; totalLb: number; products: Set<string> }>()
  for (const req of reqs) {
    if (!req.lines || req.acres == null) continue
    for (const line of req.lines) {
      if (canonicalProduct(line.product)) continue
      if (!line.product || NOT_A_PRODUCT.test(line.product.trim())) continue
      const key = line.nutrient.toUpperCase()
      if (!byNutrient.has(key)) {
        byNutrient.set(key, { nutrient: line.nutrient, totalLb: 0, products: new Set() })
      }
      const t = byNutrient.get(key)!
      t.totalLb += line.lbPerAc * req.acres
      t.products.add(line.product)
    }
  }
  return [...byNutrient.values()]
    .map((t) => ({ nutrient: t.nutrient, totalLb: Math.round(t.totalLb), products: [...t.products] }))
    .sort((a, b) => b.totalLb - a.totalLb)
}

/** Farm-wide totals per NUTRIENT, which is how agronomy is discussed. */
export function totalsByNutrient(reqs: FieldRequirement[]) {
  const byNutrient = new Map<string, { nutrient: string; totalLb: number; fields: number }>()
  for (const req of reqs) {
    if (!req.lines || req.acres == null) continue
    for (const line of req.lines) {
      const key = line.nutrient.toUpperCase()
      if (!byNutrient.has(key)) byNutrient.set(key, { nutrient: line.nutrient, totalLb: 0, fields: 0 })
      const t = byNutrient.get(key)!
      t.totalLb += line.lbPerAc * req.acres
      t.fields++
    }
  }
  return [...byNutrient.values()]
    .map((t) => ({ ...t, totalLb: Math.round(t.totalLb) }))
    .sort((a, b) => b.totalLb - a.totalLb)
}

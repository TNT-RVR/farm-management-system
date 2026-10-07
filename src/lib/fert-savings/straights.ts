/**
 * The straight fertilizers, and what a pound of nutrient costs in each.
 *
 * Keyed by analysis ('46-0-0', '11-52-0', ...) — the same key
 * fertilizer-plan.ts canonicalProduct uses — so a requirement, a booking, a
 * quote and an inventory count all name a product the same way.
 *
 * Prices here are always Canadian dollars per metric tonne of product. A
 * liquid priced per litre is turned into a tonne through its density; a DTN
 * price (US dollars per short ton) through the short ton and the exchange
 * rate. What comes out is comparable across all three sources.
 */

export const LB_PER_TONNE = 2204.62262
export const KG_PER_SHORT_TON = 907.18474

export type NutrientKey = 'n' | 'p2o5' | 'k2o' | 's'

export type Straight = {
  key: string
  label: string
  n: number
  p2o5: number
  k2o: number
  s: number
  /** kg per litre, for the liquids bought and priced by volume. */
  densityKgL?: number
  /** The nutrient it is bought for; the others are a by-product credited at market. */
  primary: NutrientKey
  /** The DTN weekly series that tracks it, where there is one. */
  dtn?: string
  /** A premium product whose value depends on where it goes on. */
  enhanced?: boolean
  /** Needs equipment this farm does not run — costed, never offered as the cheapest. */
  ownEquipment?: boolean
}

export const STRAIGHTS: Straight[] = [
  { key: '46-0-0', label: 'Urea 46-0-0', n: 46, p2o5: 0, k2o: 0, s: 0, primary: 'n', dtn: 'dtn.urea' },
  { key: '44-0-0', label: 'ESN 44-0-0', n: 44, p2o5: 0, k2o: 0, s: 0, primary: 'n', enhanced: true },
  { key: '28-0-0', label: 'UAN 28-0-0', n: 28, p2o5: 0, k2o: 0, s: 0, densityKgL: 1.28, primary: 'n', dtn: 'dtn.uan28' },
  { key: '32-0-0', label: 'UAN 32-0-0', n: 32, p2o5: 0, k2o: 0, s: 0, densityKgL: 1.32, primary: 'n', dtn: 'dtn.uan32' },
  { key: '82-0-0', label: 'Anhydrous 82-0-0', n: 82, p2o5: 0, k2o: 0, s: 0, primary: 'n', dtn: 'dtn.anhydrous', ownEquipment: true },
  { key: '11-52-0', label: 'MAP 11-52-0', n: 11, p2o5: 52, k2o: 0, s: 0, primary: 'p2o5', dtn: 'dtn.map' },
  { key: '18-46-0', label: 'DAP 18-46-0', n: 18, p2o5: 46, k2o: 0, s: 0, primary: 'p2o5', dtn: 'dtn.dap' },
  { key: '10-34-0', label: 'APP 10-34-0', n: 10, p2o5: 34, k2o: 0, s: 0, densityKgL: 1.39, primary: 'p2o5', dtn: 'dtn.10-34-0' },
  { key: '0-0-60', label: 'Potash 0-0-60', n: 0, p2o5: 0, k2o: 60, s: 0, primary: 'k2o', dtn: 'dtn.potash' },
  { key: '21-0-0-24', label: 'Ammonium sulphate 21-0-0-24', n: 21, p2o5: 0, k2o: 0, s: 24, primary: 's' },
]

export const straightByKey = (key: string) => STRAIGHTS.find((s) => s.key === key) ?? null

/** Which straight a product name is, by the analysis in it. */
export function straightKeyOf(name: string | null | undefined): string | null {
  const n = (name ?? '').toLowerCase()
  if (/\besn\b/.test(n)) return '44-0-0'
  const m = n.match(/(\d{1,2}(?:\.0)?)-(\d{1,2}(?:\.0)?)-(\d{1,2}(?:\.0)?)(?:-(\d{1,2}(?:\.0)?))?/)
  if (!m) return null
  const parts = m.slice(1).filter((x) => x != null).map((x) => String(Number(x)))
  const key = parts.join('-')
  if (straightByKey(key)) return key
  // "28-0-0-0 UAN" and "46.0-0.0-0.0-0.0" carry a trailing zero S.
  if (parts.length === 4 && parts[3] === '0') {
    const three = parts.slice(0, 3).join('-')
    if (straightByKey(three)) return three
  }
  return null
}

/** US dollars a short ton into Canadian dollars a metric tonne. */
export function usdShortTonToCadTonne(usd: number, usdCad: number): number {
  return usd * (1000 / KG_PER_SHORT_TON) * usdCad
}

/** A liquid's $/L into $/tonne of product. */
export function perLitreToPerTonne(perLitre: number, densityKgL: number): number {
  return (perLitre / densityKgL) * 1000
}

export type PricedStraight = {
  key: string
  /** CAD per metric tonne of product. */
  perTonne: number
  source: 'ICI invoice' | 'Quote' | 'DTN US retail'
  on: string | null
  /** For DTN prices: the adder applied for getting it to Alberta. */
  adder?: number
}

/**
 * Pounds of a nutrient in a tonne of product.
 */
export const lbInTonne = (pct: number) => (LB_PER_TONNE * pct) / 100

/**
 * What a pound of the product's primary nutrient costs.
 *
 * A two-nutrient product is not charged wholly to one of them: MAP's 11% N is
 * worth what nitrogen costs, so it is taken off the price before the rest is
 * divided by the phosphate. Without that, MAP looks dearer per pound of P than
 * it is, and ammonium sulphate looks absurdly dear per pound of S.
 */
export function costPerLbPrimary(
  straight: Straight,
  perTonne: number,
  creditPerLbN: number | null,
): number | null {
  const primaryLb = lbInTonne(straight[straight.primary])
  if (!(primaryLb > 0) || !(perTonne > 0)) return null
  let price = perTonne
  if (straight.primary !== 'n' && straight.n > 0) {
    if (creditPerLbN == null) return null
    price -= lbInTonne(straight.n) * creditPerLbN
  }
  return Math.max(0, price) / primaryLb
}

export type NutrientCostRow = {
  key: string
  label: string
  primary: NutrientKey
  perTonne: number
  perLb: number
  source: PricedStraight['source']
  on: string | null
  enhanced: boolean
  ownEquipment: boolean
}

/**
 * Every priced straight, costed per pound of what it is bought for.
 *
 * Nitrogen first, since its cheapest source sets the credit every other
 * product's N is valued at.
 */
export function nutrientCosts(priced: PricedStraight[]): NutrientCostRow[] {
  const rows: NutrientCostRow[] = []
  const nRows = priced
    .map((p) => ({ p, s: straightByKey(p.key) }))
    .filter((x): x is { p: PricedStraight; s: Straight } => !!x.s && x.s.primary === 'n')
  for (const { p, s } of nRows) {
    const perLb = costPerLbPrimary(s, p.perTonne, null)
    if (perLb != null)
      rows.push({ key: s.key, label: s.label, primary: 'n', perTonne: p.perTonne, perLb, source: p.source, on: p.on, enhanced: !!s.enhanced, ownEquipment: !!s.ownEquipment })
  }
  const cheapestN = rows.filter((r) => !r.enhanced && !r.ownEquipment).reduce<number | null>((m, r) => (m == null || r.perLb < m ? r.perLb : m), null)
  for (const p of priced) {
    const s = straightByKey(p.key)
    if (!s || s.primary === 'n') continue
    const perLb = costPerLbPrimary(s, p.perTonne, cheapestN)
    if (perLb != null)
      rows.push({ key: s.key, label: s.label, primary: s.primary, perTonne: p.perTonne, perLb, source: p.source, on: p.on, enhanced: !!s.enhanced, ownEquipment: !!s.ownEquipment })
  }
  return rows.sort((a, b) => a.primary.localeCompare(b.primary) || a.perLb - b.perLb)
}

/**
 * The cheapest pound of each nutrient this farm can actually use: not the
 * enhanced products (a premium for a reason), and not anhydrous (no toolbar).
 */
export function cheapestPerLb(rows: NutrientCostRow[]): Partial<Record<NutrientKey, NutrientCostRow>> {
  const out: Partial<Record<NutrientKey, NutrientCostRow>> = {}
  for (const r of rows) {
    if (r.enhanced || r.ownEquipment) continue
    const cur = out[r.primary]
    if (!cur || r.perLb < cur.perLb) out[r.primary] = r
  }
  return out
}

/**
 * Tonnes of each straight in one tonne of a blend of the given analysis.
 *
 * The least-cost way to make that analysis out of the four straights a
 * blender uses: potash for K, ammonium sulphate for S (bringing N), MAP for
 * P (bringing N), urea for whatever N is left. What remains of the tonne is
 * filler and micronutrient carrier, which costs next to nothing and is left
 * out. Null when the analysis cannot be made from them — more N from the
 * P and S sources than the blend holds, or over a tonne of product.
 */
export function straightsForBlend(a: { n: number; p2o5: number; k2o: number; s: number }): Record<string, number> | null {
  const map = a.p2o5 / 52
  const potash = a.k2o / 60
  const ams = a.s / 24
  const nLeft = a.n - map * 11 - ams * 21
  if (nLeft < -0.5) return null
  const urea = Math.max(0, nLeft) / 46
  const total = map + potash + ams + urea
  if (total > 1.02) return null
  const out: Record<string, number> = {}
  if (urea > 0) out['46-0-0'] = urea
  if (map > 0) out['11-52-0'] = map
  if (potash > 0) out['0-0-60'] = potash
  if (ams > 0) out['21-0-0-24'] = ams
  return out
}

/**
 * What a tonne of the blend would have cost bought as straights.
 *
 * Null when any straight it needs has no price — a total missing its potash
 * would make the blend look like robbery.
 */
export function straightsCost(
  a: { n: number; p2o5: number; k2o: number; s: number },
  priceOf: (key: string) => number | null,
): { cost: number; parts: { key: string; tonnes: number; perTonne: number }[] } | { missing: string[] } | null {
  const recipe = straightsForBlend(a)
  if (!recipe) return null
  const parts: { key: string; tonnes: number; perTonne: number }[] = []
  const missing: string[] = []
  for (const [key, tonnes] of Object.entries(recipe)) {
    const p = priceOf(key)
    if (p == null) missing.push(key)
    else parts.push({ key, tonnes, perTonne: p })
  }
  if (missing.length) return { missing }
  return { cost: parts.reduce((s, p) => s + p.tonnes * p.perTonne, 0), parts }
}

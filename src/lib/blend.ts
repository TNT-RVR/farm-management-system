/**
 * Fertilizer blends: what to put in the cart to hit a field's N-P-K-S.
 *
 * Two ways, side by side:
 *
 *  - The spreadsheet's way (Fertilizer blend calculator, public): any products
 *    locked at a rate first, then MAP makes up the P2O5, potash the K2O,
 *    ammonium sulphate the S, and urea whatever N is still short.
 *  - Least cost: every combination of up to one product per nutrient is
 *    tried, and the cheapest that meets every target wins. Several cheapest
 *    distinct mixes are kept, because the second-cheapest is often the one
 *    with the better density match or the slow-release N.
 *
 * P is P2O5 and K is K2O, as fertilizer is sold. Analyses are fractions
 * (0.46 for 46%). Rates are lb of product per acre.
 */

export type BlendNutrient = 'n' | 'p' | 'k' | 's' | 'zn'
export const NUTRIENT_KEYS: BlendNutrient[] = ['n', 'p', 'k', 's', 'zn']
export const NUTRIENT_LABEL: Record<BlendNutrient, string> = { n: 'N', p: 'P₂O₅', k: 'K₂O', s: 'S', zn: 'Zn' }

export type BlendProduct = {
  id: string
  name: string
  n: number
  p: number
  k: number
  s: number
  zn: number
  /** $ per metric tonne. */
  pricePerTonne: number | null
  /** lb per cubic foot, for the blend's density. */
  density: number | null
}

export type Targets = Record<BlendNutrient, number>

export type BlendLine = { product: BlendProduct; lbPerAc: number }

export type BlendResult = {
  lines: BlendLine[]
  /** Nutrient supplied, lb/ac. */
  supplied: Targets
  rate: number
  density: number | null
  costPerAc: number | null
  costPerTonne: number | null
  /** Spread between the lightest and heaviest product in lb/ft³ — over 8 and the blend may separate in the cart. */
  densitySpread: number
  /** Nutrient supplied over target by more than 5%, lb/ac. */
  over: Partial<Targets>
  /** Nutrient short of target, lb/ac. */
  short: Partial<Targets>
}

export const LB_PER_TONNE = 2204.62

const zero = (): Targets => ({ n: 0, p: 0, k: 0, s: 0, zn: 0 })

/** Totals, cost and density of a set of product rates. */
export function summarise(lines: BlendLine[], targets: Targets): BlendResult {
  const kept = lines.filter((l) => l.lbPerAc > 1e-6)
  const supplied = zero()
  let rate = 0
  let cost = 0
  let priced = true
  let dens = 0
  let densKnown = 0
  for (const { product: p, lbPerAc: x } of kept) {
    for (const k of NUTRIENT_KEYS) supplied[k] += x * p[k]
    rate += x
    if (p.pricePerTonne == null) priced = false
    else cost += (x / LB_PER_TONNE) * p.pricePerTonne
    if (p.density != null) {
      dens += x * p.density
      densKnown += x
    }
  }
  const ds = kept.map((l) => l.product.density).filter((d): d is number => d != null)
  const over: Partial<Targets> = {}
  const short: Partial<Targets> = {}
  for (const k of NUTRIENT_KEYS) {
    const t = targets[k] ?? 0
    const got = supplied[k]
    if (t > 0 && got < t - 0.5) short[k] = t - got
    if (got > t * 1.05 + 0.5) over[k] = got - t
  }
  return {
    lines: kept,
    supplied,
    rate,
    density: densKnown > 0 ? dens / densKnown : null,
    costPerAc: priced && kept.length ? cost : null,
    costPerTonne: priced && rate > 0 ? cost / (rate / LB_PER_TONNE) : null,
    densitySpread: ds.length ? Math.max(...ds) - Math.min(...ds) : 0,
    over,
    short,
  }
}

/**
 * The spreadsheet's method. `locked` products go in first at their rates;
 * then MAP fills P2O5, potash K2O, AS sulphur, and urea the N still missing.
 * The four fillers are found by analysis, so a renamed product still works.
 */
export function sheetBlend(targets: Targets, products: BlendProduct[], locked: BlendLine[] = []): BlendResult {
  const find = (pred: (p: BlendProduct) => boolean) => products.find(pred)
  const map = find((p) => Math.abs(p.p - 0.52) < 0.02 && p.n > 0.09 && p.n < 0.13 && p.k === 0)
  const potash = find((p) => p.k >= 0.58 && p.n === 0 && p.p === 0)
  const as = find((p) => Math.abs(p.s - 0.24) < 0.01 && Math.abs(p.n - 0.21) < 0.01)
  const urea = find((p) => Math.abs(p.n - 0.46) < 0.005 && p.p === 0 && p.k === 0 && p.s === 0 && !/esn|polymer|coated|agrotain/i.test(p.name))

  const have = zero()
  for (const l of locked) for (const k of NUTRIENT_KEYS) have[k] += l.lbPerAc * l.product[k]
  const lines: BlendLine[] = [...locked]
  const add = (p: BlendProduct | undefined, lb: number) => {
    if (!p || !(lb > 0)) return
    lines.push({ product: p, lbPerAc: lb })
    for (const k of NUTRIENT_KEYS) have[k] += lb * p[k]
  }
  if (map) add(map, (targets.p - have.p) / map.p)
  if (potash) add(potash, (targets.k - have.k) / potash.k)
  if (as) add(as, (targets.s - have.s) / as.s)
  if (urea) add(urea, (targets.n - have.n) / urea.n)
  return summarise(lines, targets)
}

/** Solve a small square system by Gaussian elimination; null when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r
    if (Math.abs(m[piv][c]) < 1e-9) return null
    ;[m[c], m[piv]] = [m[piv], m[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = m[r][c] / m[c][c]
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k]
    }
  }
  return m.map((row, i) => row[n] / row[i])
}

function* combinations<T>(items: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield acc
    return
  }
  for (let i = start; i < items.length; i++) yield* combinations(items, k, i + 1, [...acc, items[i]])
}

export type CostOption = BlendResult & { key: string }

/**
 * The cheapest mixes that meet every target (at least the target of each
 * nutrient asked for), cheapest first, one per distinct set of products.
 *
 * A linear programme's best answer sits where as many constraints are tight
 * as there are products in it, so every set of k products (k up to the
 * number of nutrients asked for) is solved against every k of the targets
 * held exactly, and the answer kept if nothing is negative and every other
 * target is still met. Twelve products and four nutrients is a few thousand
 * tiny solves — instant.
 */
export function leastCostBlends(
  targets: Targets,
  products: BlendProduct[],
  opts: { locked?: BlendLine[]; top?: number; maxRate?: number } = {},
): CostOption[] {
  const locked = opts.locked ?? []
  const have = zero()
  for (const l of locked) for (const k of NUTRIENT_KEYS) have[k] += l.lbPerAc * l.product[k]
  const need = NUTRIENT_KEYS.filter((k) => targets[k] - have[k] > 0.01)
  const rem = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, Math.max(0, targets[k] - have[k])])) as Targets
  const lockedIds = new Set(locked.map((l) => l.product.id))
  const pool = products.filter((p) => p.pricePerTonne != null && !lockedIds.has(p.id) && need.some((k) => p[k] > 0))
  const price = (p: BlendProduct) => p.pricePerTonne! / LB_PER_TONNE

  const best = new Map<string, { x: number[]; set: BlendProduct[]; cost: number }>()
  if (!need.length) {
    const r = summarise(locked, targets)
    return [{ ...r, key: 'locked' }]
  }
  for (let k = 1; k <= need.length; k++) {
    for (const set of combinations(pool, k)) {
      for (const tight of combinations(need, k)) {
        const a = tight.map((nut) => set.map((p) => p[nut]))
        const x = solve(a, tight.map((nut) => rem[nut]))
        if (!x || x.some((v) => v < -1e-6)) continue
        const ok = need.every((nut) => set.reduce((s, p, i) => s + p[nut] * x[i], 0) >= rem[nut] - 1e-6)
        if (!ok) continue
        const rate = x.reduce((s, v) => s + v, 0)
        if (opts.maxRate && rate > opts.maxRate) continue
        const cost = set.reduce((s, p, i) => s + price(p) * Math.max(0, x[i]), 0)
        // A product at zero in this vertex belongs to a smaller set, found on its own.
        const used = set.filter((_, i) => x[i] > 1e-6)
        const key = used.map((p) => p.id).sort().join('+')
        const prev = best.get(key)
        if (!prev || cost < prev.cost - 1e-9) best.set(key, { x: x.filter((v) => v > 1e-6), set: used, cost })
      }
    }
  }
  return [...best.values()]
    .sort((a, b) => a.cost - b.cost)
    .slice(0, opts.top ?? 5)
    .map((o) => {
      const lines = [...locked, ...o.set.map((p, i) => ({ product: p, lbPerAc: o.x[i] }))]
      return { ...summarise(lines, targets), key: o.set.map((p) => p.id).sort().join('+') }
    })
}

/** The spreadsheet's eight products, at its prices and densities. */
export const SHEET_PRODUCTS: Omit<BlendProduct, 'id'>[] = [
  { name: '46-0-0 (urea)', n: 0.46, p: 0, k: 0, s: 0, zn: 0, pricePerTonne: 680, density: 48 },
  { name: '11-52-0 (MAP)', n: 0.11, p: 0.52, k: 0, s: 0, zn: 0, pricePerTonne: 1068, density: 59 },
  { name: '0-0-60 (potash)', n: 0, p: 0, k: 0.6, s: 0, zn: 0, pricePerTonne: 1000, density: 62 },
  { name: '21-0-0-24 (AS)', n: 0.21, p: 0, k: 0, s: 0.24, zn: 0, pricePerTonne: 490, density: 60 },
  { name: 'ESN 44-0-0', n: 0.44, p: 0, k: 0, s: 0, zn: 0, pricePerTonne: 960, density: 45 },
  { name: '40 Rock 12-40-0-6.5S-1Zn', n: 0.12, p: 0.4, k: 0, s: 0.065, zn: 0.01, pricePerTonne: 1145, density: 61 },
  { name: '16-20-0-13', n: 0.16, p: 0.2, k: 0, s: 0.13, zn: 0, pricePerTonne: 800, density: 63 },
  { name: 'NPS 12-40-0-10', n: 0.12, p: 0.4, k: 0, s: 0.1, zn: 0, pricePerTonne: 1250, density: 55 },
]

/**
 * The saved blends that use a product, by its id or (for blends saved before
 * ids were kept) its name, so deleting it can say which (Sam, 7 Oct 2026).
 */
export function blendsUsing(blends: { name: string; lines: unknown }[], product: { id: string; name: string }): string[] {
  return blends
    .filter((b) =>
      (Array.isArray(b.lines) ? (b.lines as { product_id?: string; name?: string }[]) : []).some(
        (l) => l?.product_id === product.id || (!l?.product_id && l?.name === product.name),
      ),
    )
    .map((b) => b.name)
}

/**
 * Two crops on one field, side by side: what each leaves per acre, the yield
 * each needs to break even, and the yield at which one overtakes the other.
 *
 * A side is linear in its yield, so every answer here is closed-form:
 *
 *   margin(y) = revShare × y × price − costShare × (cost + extra/ac + y × extra/unit)
 *
 * `revShare` / `costShare` are our side of a land deal (a 50/50 field earns
 * half the cheque); on our own land both are 1. The per-unit extra is for
 * costs that grow with the crop — drying, storage, hauling — and the per-acre
 * extra for custom work like combining and trucking.
 */

export type CompareSide = {
  /** Expected yield, in the crop's own unit per acre. */
  yield: number
  /** $ per unit. */
  price: number
  /** The input budget, $/ac (fixed expenses included). */
  cost: number
  /** Custom work and the like, $/ac. */
  extraPerAcre: number
  /** Drying, storage, hauling and the like, $ per unit. */
  extraPerUnit: number
  revShare: number
  costShare: number
}

/** $/ac this side leaves at a yield (its expected one by default). */
export function marginPerAcre(s: CompareSide, y = s.yield): number {
  return s.revShare * y * s.price - s.costShare * (s.cost + s.extraPerAcre + y * s.extraPerUnit)
}

/**
 * The yield at which this side leaves `target` $/ac. Null when another unit
 * earns nothing (price at or under the per-unit cost), so no yield gets there.
 */
export function yieldFor(s: CompareSide, target: number): number | null {
  const perUnit = s.revShare * s.price - s.costShare * s.extraPerUnit
  if (!(perUnit > 0)) return null
  return (target + s.costShare * (s.cost + s.extraPerAcre)) / perUnit
}

/** The yield that pays this side's costs. */
export const breakevenYield = (s: CompareSide) => yieldFor(s, 0)

/** The yield this side needs to match what `other` leaves at its expected yield. */
export const tieYield = (s: CompareSide, other: CompareSide) => yieldFor(s, marginPerAcre(other))

/** Yields either side of the expected one, as shares of it. */
export const STEPS = [0.7, 0.85, 1, 1.15, 1.3]

/** A yield rounded the way the crop's unit is read: whole bushels, tenths of a tonne. */
export function roundYield(y: number, unit: string): number {
  if (unit === 'bu' || unit === 'lbs' || unit === 'cwt') return Math.round(y)
  return Math.round(y * 10) / 10
}

/**
 * Who wins at each pair of yields: rows are A's yields, columns B's. `diff`
 * is A's margin less B's, $/ac.
 */
export function payoffGrid(a: CompareSide, b: CompareSide, unitA: string, unitB: string, steps = STEPS) {
  const ya = steps.map((k) => roundYield(a.yield * k, unitA))
  const yb = steps.map((k) => roundYield(b.yield * k, unitB))
  return {
    yieldsA: ya,
    yieldsB: yb,
    cells: ya.map((y1) => yb.map((y2) => marginPerAcre(a, y1) - marginPerAcre(b, y2))),
  }
}

/** A bushel of corn is 56 lb (25.4 kg) at 15.5% moisture. */
const CORN_KG_PER_BU = 25.401
const CORN_DRY_MOISTURE = 15.5

/**
 * Wet tonnes one dry bushel of corn weighs at a harvest moisture (%). Water
 * comes out of the weight, the dry matter stays: 150 bu at 28% ≈ 4.47 t.
 */
export function cornWetTonnesPerBu(moisturePct: number): number {
  return (CORN_KG_PER_BU / 1000) * ((100 - CORN_DRY_MOISTURE) / (100 - moisturePct))
}

/**
 * Grain marketing arithmetic.
 *
 * Everything here is pure and unit-aware. The unit part is not decoration: this
 * farm measures canola in bushels, alfalfa seed and beans in pounds and
 * potatoes in hundredweight, and a function that quietly adds a bushel to a
 * pound produces a number that looks fine and is wrong by a factor of sixty.
 * Nothing in this file converts between units — it refuses instead.
 */

export type Unit = 'bu' | 'lbs' | 'cwt' | 'ton' | 'MT' | 'ac'

/** A crop's position for one year, as the crop_position view reports it. */
export type Position = {
  cropId: string
  cropName: string
  cropYear: number
  unit: Unit
  category: 'seed' | 'commercial' | 'own_use' | null
  acres: number
  expected: number
  contracted: number
  contractedValue: number
  delivered: number
  onhand: number
  /** Acres whose plan yield is a harvest yield, after clean-out or field-run (pre-clean). */
  cleanAcres: number
  preCleanAcres: number
}

export type PositionSummary = {
  /** Expected production not yet sold. Never negative. */
  open: number
  /** Sold beyond what the plan expects, if any. */
  oversold: number | null
  /** 0-1. Null when there is nothing expected to take a fraction of. */
  pricedFraction: number | null
  avgContractPrice: number | null
  /** What the open quantity is worth at a given price, if one is known. */
  openValueAt: (pricePerUnit: number | null) => number | null
}

export function summarise(p: Position): PositionSummary {
  const open = Math.max(p.expected - p.contracted, 0)
  const oversold = p.contracted > p.expected ? p.contracted - p.expected : null
  return {
    open,
    oversold,
    pricedFraction: p.expected > 0 ? Math.min(p.contracted / p.expected, 1) : null,
    avgContractPrice: p.contracted > 0 ? p.contractedValue / p.contracted : null,
    openValueAt: (price) => (price == null ? null : open * price),
  }
}

/**
 * Crops worth showing on a marketing screen.
 *
 * Summer fallow is measured in acres and alfalfa here is grown for the cows.
 * Neither gets sold, and listing them as "100% unpriced" would be noise sitting
 * on top of the number that matters.
 */
export function isMarketable(p: Pick<Position, 'category' | 'unit'>): boolean {
  return p.category !== 'own_use' && p.unit !== 'ac'
}

// ---------------------------------------------------------------------------
// Cost of production

export type CostLine = { category: string; costPerAcre: number }

/**
 * What a unit of crop cost to grow.
 *
 * Cost per acre divided by yield per acre. Returns null rather than Infinity
 * when the yield is zero or unknown — a breakeven of infinity renders as a
 * number and gets read as one.
 */
export function breakeven(costPerAcre: number, yieldPerAcre: number): number | null {
  if (!Number.isFinite(costPerAcre) || !Number.isFinite(yieldPerAcre)) return null
  if (yieldPerAcre <= 0) return null
  return costPerAcre / yieldPerAcre
}

export function totalCostPerAcre(lines: CostLine[]): number {
  return lines.reduce((sum, l) => sum + (Number.isFinite(l.costPerAcre) ? l.costPerAcre : 0), 0)
}

/** Margin per unit at a price, or null if either half is unknown. */
export function marginPerUnit(price: number | null, breakevenPerUnit: number | null): number | null {
  if (price == null || breakevenPerUnit == null) return null
  return price - breakevenPerUnit
}

// ---------------------------------------------------------------------------
// Basis

/**
 * Basis: the local bid minus the board.
 *
 * Deliberately not absolute — a negative basis (a bid under the future) is the
 * normal state of affairs inland, and the sign is the information.
 */
export function basis(bid: number | null, futures: number | null): number | null {
  if (bid == null || futures == null) return null
  if (!Number.isFinite(bid) || !Number.isFinite(futures)) return null
  return bid - futures
}

export type BasisPoint = { on: string; basis: number | null }

/**
 * Where today's basis sits against its own history.
 *
 * The useful question is not "what is basis" but "is this a good one", and the
 * only honest answer available from one farm's records is where it falls in the
 * range you have seen. Needs at least three points to say anything.
 */
export function basisPercentile(history: BasisPoint[], current: number | null): number | null {
  if (current == null) return null
  const values = history.map((h) => h.basis).filter((v): v is number => v != null)
  if (values.length < 3) return null
  const below = values.filter((v) => v < current).length
  return below / values.length
}

// ---------------------------------------------------------------------------
// Cash flow

export type ContractForFlow = {
  id: string
  cropName: string
  bushels: number | null
  pricePerUnit: number | null
  deliveryStart: string | null
  deliveryEnd: string | null
  deliveredBu: number
}

export type FlowMonth = { month: string; revenue: number; contracts: string[] }

/** "2026-11-14" → "2026-11". */
function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

/** Every month from a to b inclusive, as "YYYY-MM". */
export function monthsBetween(a: string, b: string): string[] {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  if (!ay || !am || !by || !bm) return []
  const out: string[] = []
  let y = ay
  let m = am
  // Guarded rather than while(true): a reversed or absurd range should give
  // back nothing, not spin.
  for (let i = 0; i < 600; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    if (y === by && m === bm) return out
    if (y > by || (y === by && m > bm)) return [a]
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

/**
 * Contract revenue laid out by month.
 *
 * A delivery window spanning several months is spread evenly across them. That
 * is a model, not a fact — grain moves when the buyer calls — but a window
 * dumped entirely into its first month makes a cash-flow chart that spikes
 * where nothing happens. Contracts with no window at all are returned
 * separately rather than guessed at.
 */
export function cashFlow(contracts: ContractForFlow[]): {
  months: FlowMonth[]
  undated: ContractForFlow[]
} {
  const byMonth = new Map<string, FlowMonth>()
  const undated: ContractForFlow[] = []

  for (const c of contracts) {
    const value = (c.bushels ?? 0) * (c.pricePerUnit ?? 0)
    const start = c.deliveryStart
    const end = c.deliveryEnd ?? c.deliveryStart
    if (!start || !end || value === 0) {
      if (value !== 0) undated.push(c)
      continue
    }
    const months = monthsBetween(monthOf(start), monthOf(end))
    if (!months.length) {
      undated.push(c)
      continue
    }
    const each = value / months.length
    for (const m of months) {
      const row = byMonth.get(m) ?? { month: m, revenue: 0, contracts: [] }
      row.revenue += each
      if (!row.contracts.includes(c.cropName)) row.contracts.push(c.cropName)
      byMonth.set(m, row)
    }
  }

  return {
    months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    undated,
  }
}

// ---------------------------------------------------------------------------
// Targets

export type Target = {
  id: string
  cropId: string
  cropYear: number
  mode: 'absolute' | 'over_breakeven'
  value: number
  quantity: number | null
  note: string | null
  active: boolean
}

export type TargetState = {
  /** The price this target actually resolves to today. */
  threshold: number | null
  hit: boolean
  /** How far the market is from it, signed. Negative means short of it. */
  distance: number | null
}

/**
 * What a target means right now.
 *
 * An over_breakeven target has no fixed price — it moves as input costs do,
 * which is the point of it. With no breakeven known it resolves to nothing at
 * all rather than to its raw value, because "$2" is not a price to sell at.
 */
export function evaluateTarget(
  target: Target,
  breakevenPerUnit: number | null,
  currentPrice: number | null,
): TargetState {
  const threshold =
    target.mode === 'absolute'
      ? target.value
      : breakevenPerUnit == null
        ? null
        : breakevenPerUnit + target.value

  if (threshold == null || currentPrice == null) return { threshold, hit: false, distance: null }
  return {
    threshold,
    hit: currentPrice >= threshold,
    distance: currentPrice - threshold,
  }
}

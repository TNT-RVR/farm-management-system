/**
 * How many heifer calves to keep, and when to sell the rest.
 *
 * Three questions, one model:
 *
 *  1. When is the best time to sell the heifers not kept — at weaning, after
 *     wintering to a heavier weight, or as yearlings off grass? Each option
 *     is priced off today's Alberta auction quotes for its weight (lighter
 *     cattle fetch more per pound, so the extra pounds are worth less than
 *     today's price), less what the gain costs.
 *  2. Is a kept heifer worth more than a sold one? She costs her sale value
 *     now plus what it takes to get her bred; she returns a cow's margin for
 *     her working life and a cull cheque at the end. Not every heifer kept
 *     gets bred — the open ones are sold as yearlings.
 *  3. How many does the land carry? Enough to replace this year's culls and
 *     deaths, plus growth toward what the pastures carry, spread over a few
 *     years — or fewer, if the herd is already over what the grass supports.
 *
 * All money per head in dollars; weights in lb; rates in percent.
 */

export type SaleOption = {
  key: 'weaning' | 'wintered' | 'yearling'
  label: string
  when: string
  weightLb: number
  pricePerLb: number | null
  /** Cost of the gain from weaning to this weight, per head. */
  costPerHead: number
  /** Net per head after the gain cost and death loss while holding. */
  netPerHead: number | null
}

export type HeiferInputs = {
  /** Cows in the herd now. */
  cows: number
  /** Heifer calves weaned this fall — the ones to keep or sell. */
  heiferCalves: number
  cullPct: number
  /** Cows that die a year, % of the herd (cow_death_pct) — not calf loss. */
  deathPct: number
  /** Of heifers kept, the share that end up bred and calving. */
  pregPct: number
  weaningPct: number
  /** Cows the ranch's own grass carries; null when unknown. */
  capacityCows: number | null
  /** Years to grow into spare grass, rather than all at once. */
  growthYears: number
  /** Everything a cow costs in a year. */
  annualCowCost: number
  /** Getting a heifer from weaning to her first calf: feed, grass, breeding, vet. */
  devCostPerHeifer: number
  /** The average weaned calf's value (steers and heifers), per calf. */
  calfValue: number
  /** A cull cow's cheque at the end of her life; 0 when unknown. */
  cullCowValue: number
  productiveYears: number
  discountPct: number
  /** What a cow over the grass costs to carry — rented pasture, extra hay. Null when unknown. */
  overstockCostPerCow: number | null
  sale: SaleOption[]
}

export type HeiferPlan = {
  best: SaleOption | null
  marginPerCow: number
  /** A bred heifer's working life, in today's dollars. */
  pvCow: number
  valueKept: number
  valueSold: number
  /** Each heifer kept instead of sold: positive means keeping pays. */
  gainPerHeiferKept: number
  /** Heifers to keep just to hold the herd where it is. */
  maintain: number
  recommended: number
  reason: string
  rows: KeepRow[]
}

export type KeepRow = {
  keep: number
  cowsNextYear: number
  overCapacity: number
  /** Cash from the heifers sold, at the best time to sell them. */
  saleCash: number
  /** Total against selling every heifer calf: the kept heifers' net worth less any over-the-grass cost. */
  netVsSellAll: number | null
}

/**
 * Months each option holds a calf past weaning (weaning Nov–Dec): wintered to
 * Mar–Apr is about four months, a yearling off grass in Aug–Sep about nine.
 */
export const HOLD_MONTHS: Record<SaleOption['key'], number> = { weaning: 0, wintered: 4, yearling: 9 }

/**
 * Net per head for each sale option, less gain cost and death loss while holding.
 *
 * `lossPctPerYear` is the post-weaning death loss, % a year held, and it is
 * charged for the months each option actually holds the calf (HOLD_MONTHS).
 * It used to compound once per position in the list — a yearling paid two
 * full years of loss for nine months — so reordering the options changed
 * their prices.
 */
export function priceSaleOptions(options: (Omit<SaleOption, 'netPerHead'> & { monthsHeld?: number })[], lossPctPerYear: number): SaleOption[] {
  return options.map((o) => {
    if (o.pricePerLb == null) return { ...o, netPerHead: null }
    const months = o.monthsHeld ?? HOLD_MONTHS[o.key] ?? 0
    const survive = Math.pow(1 - Math.min(100, Math.max(0, lossPctPerYear)) / 100, months / 12)
    return { ...o, netPerHead: o.weightLb * o.pricePerLb * survive - o.costPerHead }
  })
}

/**
 * Bull calves bring less than steers of the same weight: a buyer has to cut
 * them, and they gain and grade worse. 5% under the steer price when no market
 * quoted bull calves at that weight — a planning figure, in the range Alberta
 * auction reports show (bull calves typically $5–15/cwt under steers).
 */
export const BULL_CALF_DISCOUNT = 0.05

/** A bull calf's $/lb: the market's bull-calf quote at its weight, else the steer price less BULL_CALF_DISCOUNT. */
export function bullCalfPricePerLb(bullQuote: number | null, steerPrice: number | null): number | null {
  if (bullQuote != null) return bullQuote
  return steerPrice == null ? null : steerPrice * (1 - BULL_CALF_DISCOUNT)
}

export function planHeifers(inp: HeiferInputs): HeiferPlan {
  const best = inp.sale.filter((s) => s.netPerHead != null).sort((a, b) => b.netPerHead! - a.netPerHead!)[0] ?? null
  const yearling = inp.sale.find((s) => s.key === 'yearling' && s.netPerHead != null) ?? best
  const r = inp.discountPct / 100
  const marginPerCow = (inp.weaningPct / 100) * inp.calfValue - inp.annualCowCost
  let pvCow = 0
  for (let t = 1; t <= inp.productiveYears; t++) pvCow += marginPerCow / Math.pow(1 + r, t)
  pvCow += inp.cullCowValue / Math.pow(1 + r, inp.productiveYears)
  const preg = inp.pregPct / 100
  // Kept: most calve and join the herd; the open ones go as yearlings.
  const valueKept = preg * pvCow + (1 - preg) * (yearling?.netPerHead ?? 0) - inp.devCostPerHeifer
  const valueSold = best?.netPerHead ?? 0
  const gain = valueKept - valueSold

  const leaving = (inp.cows * (inp.cullPct + inp.deathPct)) / 100
  const maintain = Math.ceil(leaving / Math.max(0.01, preg))
  let target = maintain
  let reason: string
  if (inp.capacityCows == null) {
    reason = `Enough to replace ${Math.round(leaving)} culls and deaths. Add pastures on the Grazing tab and this also weighs what the land carries.`
  } else {
    const room = inp.capacityCows - inp.cows
    if (room < 0) {
      target = Math.max(0, Math.ceil((leaving + room / inp.growthYears) / Math.max(0.01, preg)))
      reason = `The herd is ${Math.round(-room)} cows over what the grass carries, so keep fewer than it takes to replace culls and let it shrink over ${inp.growthYears} years.`
    } else if (gain > 0 && room > 0) {
      target = Math.ceil((leaving + room / inp.growthYears) / Math.max(0.01, preg))
      reason = `The grass carries ${Math.round(room)} more cows and a kept heifer is worth more than a sold one, so grow into it over ${inp.growthYears} years.`
    } else if (gain <= 0 && room > 0) {
      reason = `There is grass for ${Math.round(room)} more cows, but at these prices a heifer sold is worth more than one kept — hold the herd steady rather than grow.`
    } else {
      reason = `The herd is at what the grass carries; keep enough to replace ${Math.round(leaving)} culls and deaths.`
    }
  }
  const recommended = Math.max(0, Math.min(inp.heiferCalves, target))

  const step = inp.heiferCalves > 60 ? 5 : inp.heiferCalves > 20 ? 2 : 1
  const keeps = new Set<number>([0, maintain, recommended, inp.heiferCalves])
  for (let k = 0; k <= inp.heiferCalves; k += step) keeps.add(k)
  const rows = [...keeps]
    .filter((k) => k >= 0 && k <= inp.heiferCalves)
    .sort((a, b) => a - b)
    .map((keep) => {
      const cowsNextYear = inp.cows - leaving + keep * preg
      const overCapacity = inp.capacityCows == null ? 0 : Math.max(0, cowsNextYear - inp.capacityCows)
      const overCost = overCapacity > 0 ? (inp.overstockCostPerCow == null ? null : overCapacity * inp.overstockCostPerCow) : 0
      return {
        keep,
        cowsNextYear,
        overCapacity,
        saleCash: (inp.heiferCalves - keep) * valueSold,
        netVsSellAll: overCost == null ? null : keep * gain - overCost,
      }
    })
  return { best, marginPerCow, pvCow, valueKept, valueSold, gainPerHeiferKept: gain, maintain, recommended, reason, rows }
}

// ── The assumptions someone typed ───────────────────────────────────────────
//
// Kept per ranch in this browser, so a cull-cow cheque set once is still set
// next week. Local rather than in the database on purpose: these are what-if
// figures for one screen, not farm records. A null is kept — it is a field
// somebody cleared, which is different from one they never touched.

export type HeiferOverrides = Record<string, number | null>

export const heiferOverridesKey = (ranchId: string) => `rvr.replacementHeifers.${ranchId}`

/** Whatever was stored, keeping only number-or-null entries. Junk reads as nothing. */
export function parseHeiferOverrides(raw: string | null): HeiferOverrides {
  if (!raw) return {}
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: HeiferOverrides = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === null || (typeof x === 'number' && Number.isFinite(x))) out[k] = x
    }
    return out
  } catch {
    return {}
  }
}

/** Storage can be missing or refuse (private mode, quota); both read as empty. */
export function loadHeiferOverrides(ranchId: string): HeiferOverrides {
  try {
    return parseHeiferOverrides(localStorage.getItem(heiferOverridesKey(ranchId)))
  } catch {
    return {}
  }
}

/** Saves, or clears the entry when there is nothing left to keep. Never throws. */
export function saveHeiferOverrides(ranchId: string, o: HeiferOverrides): void {
  try {
    if (Object.keys(o).length === 0) localStorage.removeItem(heiferOverridesKey(ranchId))
    else localStorage.setItem(heiferOverridesKey(ranchId), JSON.stringify(o))
  } catch {
    // Not saved is a lost convenience, not an error worth showing.
  }
}

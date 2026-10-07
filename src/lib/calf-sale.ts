/**
 * What each ranch's calves sell at, and when (Sam, 5 Oct 2026).
 *
 * The two ranches calve months apart (East Ranch in March, Home Ranch in May)
 * and sell at different times and weights, so this is per ranch:
 *   East Ranch — typed: steers 750 lb, heifers 650 lb, sold in November.
 *   Home Ranch — "use the numbers from the history": the head-weighted
 *   average of its own sales over the last five crop years, sold in December.
 * A weight typed on the ranch wins; a blank one is worked out from the ranch's
 * sales; with no sales, Farm setup's one figure stands in.
 */

export type SaleLot = { ranch: string; crop_year: number; animal_class: string; head: number | null; avg_weight_lb: number | null }

export type SaleWeight = {
  lb: number
  /** 'typed' on the ranch; 'history' from its sales; 'farm' from Farm setup. */
  from: 'typed' | 'history' | 'farm'
  /** For 'history': how many lots and which years. */
  lots?: number
  years?: [number, number]
}

/** How many crop years back the average reaches. */
export const HISTORY_YEARS = 5

/** Bull calves are sold uncut, so they sell with the steers; runts are left out. */
const SEX_CLASSES = { steers: ['steers', 'bulls'], heifers: ['heifers'] } as const

/** The ranch's own head-weighted average sale weight for a sex, over its last five crop years with sales. */
export function historyWeight(sales: SaleLot[], ranchName: string, sex: 'steers' | 'heifers'): SaleWeight | null {
  const lots = sales.filter(
    (s) => s.ranch === ranchName && (SEX_CLASSES[sex] as readonly string[]).includes(s.animal_class) && s.avg_weight_lb != null && s.avg_weight_lb > 0,
  )
  if (!lots.length) return null
  const newest = Math.max(...lots.map((s) => s.crop_year))
  const recent = lots.filter((s) => s.crop_year > newest - HISTORY_YEARS)
  let lb = 0
  let head = 0
  for (const s of recent) {
    // A lot with no head count still counts, once.
    const h = s.head && s.head > 0 ? s.head : 1
    lb += s.avg_weight_lb! * h
    head += h
  }
  return {
    lb: Math.round(lb / head),
    from: 'history',
    lots: recent.length,
    years: [Math.min(...recent.map((s) => s.crop_year)), newest],
  }
}

export type RanchSale = {
  steers: SaleWeight
  heifers: SaleWeight
  /** 1–12. */
  month: number
  monthFrom: 'typed' | 'farm'
}

export function ranchSale(
  ranch: { name: string; steer_sale_weight_lb: number | null; heifer_sale_weight_lb: number | null; calf_sale_month: number | null } | null | undefined,
  sales: SaleLot[],
  farm: { calfSaleWeightLb: number; calfSaleMonth: number },
): RanchSale {
  const pick = (typed: number | null | undefined, sex: 'steers' | 'heifers'): SaleWeight =>
    typed != null && typed > 0
      ? { lb: typed, from: 'typed' }
      : (ranch ? historyWeight(sales, ranch.name, sex) : null) ?? { lb: farm.calfSaleWeightLb, from: 'farm' }
  return {
    steers: pick(ranch?.steer_sale_weight_lb, 'steers'),
    heifers: pick(ranch?.heifer_sale_weight_lb, 'heifers'),
    month: ranch?.calf_sale_month ?? farm.calfSaleMonth,
    monthFrom: ranch?.calf_sale_month != null ? 'typed' : 'farm',
  }
}

/** "typed on the ranch", "average of 9 lots, 2021–2025", "Farm setup". */
export function saleWeightSource(w: SaleWeight): string {
  if (w.from === 'typed') return 'typed for this ranch'
  if (w.from === 'history') return `average of ${w.lots} lot${w.lots === 1 ? '' : 's'}, ${w.years![0] === w.years![1] ? w.years![0] : `${w.years![0]}–${w.years![1]}`}`
  return 'Farm setup'
}

export const monthName = (m: number) => new Date(2000, m - 1, 1).toLocaleString('en-CA', { month: 'long' })

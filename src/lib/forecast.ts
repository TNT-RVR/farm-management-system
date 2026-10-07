/**
 * The price, cost and yield an estimate uses for a crop in a year, and where
 * each came from.
 *
 * Sam's rules (1 Oct 2026):
 *
 *   PRICE  "Unless updated by the user, just use the 2026 pricing when
 *          forecasting the 2027 pricing … and make it clear when it's using
 *          current-year pricing versus a forecast." A price typed for the year
 *          wins. Barley, wheat, oats and durum are "auto filled with current
 *          market pricing unless edited", so a crop with a public elevator bid
 *          takes the bid next. Otherwise the most recent earlier year's price
 *          carries forward, and keeps following that year as it is changed.
 *   COST   The same: a year's own input budget, else the most recent earlier
 *          year's, live. Copying it into the later year makes it a forecast
 *          that can be edited on its own.
 *   YIELD  "Based off of what we actually grow each year, not the hopeful
 *          yield … after 5 years or so … the average yield for that crop on
 *          that specific field." This field's own average once it has five
 *          harvested seasons of the crop; else the farm's average of what was
 *          actually harvested; else the crop's normal (goal) yield.
 */

import { bidPerBu } from './breakeven'

/**
 * Today's market price for a crop, in its own unit: the Alberta elevator bid
 * for the crops that have one (barley, wheat, oats, durum), null for the rest.
 */
export function marketPrice(cropName: string | null | undefined, unit: string | null | undefined, bids: Map<string, number>): { value: number; label: string } | null {
  if (unit !== 'bu') return null
  const b = bidPerBu(cropName ?? null, bids)
  return b ? { value: b.perBu, label: `elevator bid, ${b.label}` } : null
}

export type PriceRow = { crop_id: string; crop_year: number; price_per_unit: number | null }

export type PriceBasis = 'set' | 'forecast' | 'market' | 'carried' | 'none'

export type ResolvedPrice = {
  value: number | null
  basis: PriceBasis
  /** The year a carried or typed price belongs to. */
  fromYear: number | null
  /** Plain words for the screen: "2026 price", "2027 forecast", "elevator bid, feed barley". */
  label: string
}

/**
 * The price for a crop in a year.
 *
 * `currentYear` decides the words only: a price typed for a later year than
 * this one is a forecast, one typed for this year or earlier is that year's
 * price.
 */
export function resolvePrice(
  cropId: string,
  year: number,
  prices: PriceRow[],
  opts: { market?: { value: number; label: string } | null; currentYear: number },
): ResolvedPrice {
  const mine = prices
    .filter((p) => p.crop_id === cropId && p.price_per_unit != null && Number.isFinite(Number(p.price_per_unit)))
    .sort((a, b) => b.crop_year - a.crop_year)
  const own = mine.find((p) => p.crop_year === year)
  if (own) {
    const forecast = year > opts.currentYear
    return {
      value: Number(own.price_per_unit),
      basis: forecast ? 'forecast' : 'set',
      fromYear: year,
      label: forecast ? `${year} forecast` : `${year} price`,
    }
  }
  if (opts.market && opts.market.value > 0) {
    return { value: opts.market.value, basis: 'market', fromYear: null, label: opts.market.label }
  }
  const earlier = mine.find((p) => p.crop_year < year)
  if (earlier) {
    return { value: Number(earlier.price_per_unit), basis: 'carried', fromYear: earlier.crop_year, label: `${earlier.crop_year} price` }
  }
  return { value: null, basis: 'none', fromYear: null, label: 'no price' }
}

export type InputRow = { crop_id: string; crop_year: number; cost_per_acre: number | null; name?: string | null; id?: string; category?: string | null }

export type ResolvedCost<R extends InputRow = InputRow> = {
  /** $/ac, 0 when there is no budget at all. */
  total: number
  /** The budget lines used. */
  lines: R[]
  /** 'set' = the year's own budget (a forecast when the year is ahead); 'carried' = an earlier year's. */
  basis: 'set' | 'forecast' | 'carried' | 'none'
  fromYear: number | null
  label: string
}

/** A crop's input budget for a year: its own lines, else the latest earlier year's. */
export function resolveCosts<R extends InputRow>(cropId: string, year: number, inputs: R[], currentYear: number): ResolvedCost<R> {
  const mine = inputs.filter((i) => i.crop_id === cropId)
  const sum = (rows: R[]) => rows.reduce((s, i) => s + (Number(i.cost_per_acre) || 0), 0)
  const own = mine.filter((i) => i.crop_year === year)
  if (own.length) {
    const forecast = year > currentYear
    return { total: sum(own), lines: own, basis: forecast ? 'forecast' : 'set', fromYear: year, label: forecast ? `${year} forecast` : `${year} costs` }
  }
  const earlierYear = Math.max(-Infinity, ...mine.filter((i) => i.crop_year < year).map((i) => i.crop_year))
  if (Number.isFinite(earlierYear)) {
    const lines = mine.filter((i) => i.crop_year === earlierYear)
    return { total: sum(lines), lines, basis: 'carried', fromYear: earlierYear, label: `${earlierYear} costs` }
  }
  return { total: 0, lines: [], basis: 'none', fromYear: null, label: 'no input budget' }
}

export type YieldRecord = {
  field_id: string
  crop_id: string | null
  crop_year: number
  acres: number | null
  yield_per_acre: number | null
  clean_yield_per_acre?: number | null
  yield_unit: string | null
  source: string | null
}

export type YieldBasis = 'field' | 'farm' | 'goal' | 'none'

export type ExpectedYield = {
  value: number | null
  basis: YieldBasis
  /** Harvested seasons behind an average. */
  seasons: number
  label: string
}

/** A field needs this many harvested seasons of a crop before its own average is used. */
export const FIELD_SEASONS = 5
/**
 * The farm average is used once the crop has two harvested seasons, or one
 * season grown on enough fields to average over (Sam, 2 Oct 2026: "wait for
 * two seasons … the other option is 3 or more fields of it grown"). One field
 * in one year is a single result, not an average.
 */
export const FARM_SEASONS = 2
/** …or this many fields harvested, in any number of seasons. */
export const FARM_FIELDS = 3
/** How far back an average looks. */
export const YIELD_WINDOW = 10

/**
 * Records that are a planned figure rather than a harvest. Farm at Hand's
 * 2024–25 yields are its plan's "agronomic yield" (3,000 lb beans, 13,228 lb
 * green feed — the goal, typed), and the rotation workbook carries no yields.
 */
const PLANNED_SOURCES = new Set(['fah_import', 'rotation_xlsx'])

/** Whether a history row is a harvested yield that can go into an average. */
export function isActualYield(r: YieldRecord, unit: string, goal: number | null): boolean {
  if (r.source && PLANNED_SOURCES.has(r.source)) return false
  const v = Number(r.clean_yield_per_acre ?? r.yield_per_acre)
  if (!(v > 0)) return false
  if ((r.yield_unit ?? unit) !== unit) return false
  // Far from the goal (under a fifth, over five times) was typed in another
  // unit — alfalfa at "12 lbs" is 12 tons — and is left out.
  if (goal && goal > 0 && (v < goal * 0.2 || v > goal * 5)) return false
  return true
}

const effective = (r: YieldRecord) => Number(r.clean_yield_per_acre ?? r.yield_per_acre)

/** The mean of each season's (acre-weighted) yield, so every year counts once. */
function seasonAverage(rows: YieldRecord[]): { value: number; seasons: number[] } {
  const byYear = new Map<number, { w: number; s: number }>()
  for (const r of rows) {
    const w = r.acres && r.acres > 0 ? Number(r.acres) : 1
    const y = byYear.get(r.crop_year) ?? { w: 0, s: 0 }
    y.w += w
    y.s += w * effective(r)
    byYear.set(r.crop_year, y)
  }
  const years = [...byYear.keys()].sort((a, b) => a - b)
  const value = years.reduce((s, y) => s + byYear.get(y)!.s / byYear.get(y)!.w, 0) / years.length
  return { value, seasons: years }
}

const span = (years: number[]) => (years.length === 1 ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`)

/**
 * The yield to expect from a crop in a year, on one field or across the farm.
 *
 * Only seasons up to and including `year` count, so looking back at a past
 * year doesn't use harvests that came after it.
 */
export function expectedYield(opts: {
  cropId: string
  year: number
  unit: string
  /** The crop's normal (goal) yield. */
  goal: number | null
  history: YieldRecord[]
  fieldId?: string | null
}): ExpectedYield {
  const { cropId, year, unit, goal, history, fieldId } = opts
  const actual = history.filter(
    (r) => r.crop_id === cropId && r.crop_year <= year && r.crop_year > year - YIELD_WINDOW && isActualYield(r, unit, goal),
  )
  if (fieldId) {
    const own = actual.filter((r) => r.field_id === fieldId)
    const seasons = new Set(own.map((r) => r.crop_year)).size
    if (seasons >= FIELD_SEASONS) {
      const a = seasonAverage(own)
      return { value: a.value, basis: 'field', seasons, label: `this field's ${seasons}-season average (${span(a.seasons)})` }
    }
  }
  const farmSeasons = new Set(actual.map((r) => r.crop_year)).size
  const farmFields = new Set(actual.map((r) => r.field_id)).size
  if ((farmSeasons >= FARM_SEASONS || farmFields >= FARM_FIELDS) && actual.length) {
    const a = seasonAverage(actual)
    return {
      value: a.value,
      basis: 'farm',
      seasons: farmSeasons,
      label: `farm average of what we harvested, ${farmSeasons} season${farmSeasons === 1 ? '' : 's'} (${span(a.seasons)})`,
    }
  }
  if (goal != null && goal > 0) return { value: goal, basis: 'goal', seasons: 0, label: 'normal yield (no harvest on record yet)' }
  return { value: null, basis: 'none', seasons: 0, label: 'no yield on record' }
}

/** Short badge text for a yield basis. */
export const YIELD_BADGE: Record<YieldBasis, string> = { field: 'field avg', farm: 'farm avg', goal: 'goal', none: '' }

/** Short badge text for a price or cost basis. */
export function basisBadge(b: { basis: PriceBasis | ResolvedCost['basis']; fromYear: number | null }): string {
  if (b.basis === 'carried') return `${b.fromYear}`
  if (b.basis === 'forecast') return 'forecast'
  if (b.basis === 'market') return 'market'
  return ''
}

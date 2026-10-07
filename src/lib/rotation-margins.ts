import { perBushel } from './markets'
import { expectedYield, marketPrice, resolveCosts, resolvePrice, type YieldRecord } from './forecast'

/**
 * A crop's margin per acre on one field in one year, built up from the farm's
 * own numbers: yield × price − cost.
 *
 * Every piece takes the best source there is and says which it took, because
 * a plan that moves 300 acres on a margin has to be able to show where the
 * margin came from. The rules are forecast.ts's, shared with the Financials
 * plan and budget:
 *
 *   yield  this field's own average once it has five harvested seasons of the
 *          crop → the farm's average of what was harvested → the normal yield
 *   price  a contract for that year → a price typed for that year → today's
 *          elevator bid (barley, wheat, oats, durum) → the Alberta farm-gate
 *          price under 18 months old → the latest earlier year's price
 *   cost   the year's input budget → the latest earlier year's
 *
 * When a piece is missing there is no margin. The Alberta Cropping
 * Alternatives 2024 figures that used to stand in are gone (Sam, 1 Oct 2026:
 * "Replace with all our new numbers"); only a margin a person typed on the
 * crop stands in.
 *
 * The input budget carries the farm's fixed expenses (land, machinery, labour,
 * overhead: Financials → Farm costs) as one row at the same $/ac on every
 * crop, so they lower every built margin alike and change no ranking between
 * two built margins.
 */

export type MarginCrop = {
  id: string
  name: string
  yield_unit: string | null
  default_yield_per_acre: number | null
  /** A margin typed by hand on the crop: the stand-in when one can't be built. */
  margin_per_acre: number | null
  /** Own feed, not sold: the price is what the same feed would cost to buy. */
  own_use?: boolean
}
export type MarginInputs = {
  crops: MarginCrop[]
  /** Harvest records; planned (Farm at Hand) yields are ignored. */
  history: (Omit<YieldRecord, 'acres' | 'source'> & { acres?: number | null; source?: string | null })[]
  prices: { crop_id: string; crop_year: number; price_per_unit: number | null }[]
  contracts: { crop_id: string | null; crop_year: number; bushels: number | null; price_per_unit: number | null }[]
  inputs: { crop_id: string; crop_year: number; cost_per_acre: number | null; name?: string | null }[]
  /** The latest observation of each crop-linked market series. */
  market: { crop_id: string; commodity: string | null; unit: string | null; value: number; observed_on: string }[]
  /** Latest elevator bid per series code, $/tonne. */
  bids?: Map<string, number>
  /** Today, ISO — for judging how stale a market price is. */
  today: string
}

export type MarginBasis = {
  unit: string
  yield: number | null
  yieldFrom: string
  price: number | null
  priceFrom: string
  cost: number | null
  costFrom: string
  /** The insurance part of the cost ($/ac): off the cheque before a land-owner split. */
  insurance: number
  margin: number | null
  /** 'built' = yield × price − cost; 'budget' = a margin typed on the crop. */
  from: 'built' | 'budget' | 'none'
  /** Own feed: the price is a feed value, not a sale. */
  ownUse: boolean
}

const num = (v: unknown) => (v == null || v === '' ? null : Number(v))

/** A $/tonne market price in the crop's own unit. */
export function tonnePriceIn(unit: string, perTonne: number, commodity: string | null): number | null {
  if (unit === 'bu') return commodity ? perBushel(perTonne, commodity) : null
  if (unit === 'lbs') return perTonne / 2204.62
  if (unit === 'cwt') return perTonne / 22.0462
  if (unit === 'MT' || unit === 'ton') return perTonne
  return null
}

const monthsOld = (iso: string, today: string) => (Date.parse(today) - Date.parse(iso)) / (30.44 * 86_400_000)
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function cropMargin(inp: MarginInputs, cropId: string, year: number, fieldId?: string): MarginBasis {
  const crop = inp.crops.find((c) => c.id === cropId)
  const unit = crop?.yield_unit ?? 'bu'
  const typed = num(crop?.margin_per_acre)
  const currentYear = Number(inp.today.slice(0, 4))

  const y = expectedYield({
    cropId,
    year,
    unit,
    goal: num(crop?.default_yield_per_acre),
    fieldId,
    history: inp.history.map((h) => ({ ...h, acres: h.acres ?? null, source: h.source ?? null })),
  })
  const yieldPer = y.value
  const yieldFrom = y.label

  // Price.
  let price: number | null
  let priceFrom: string
  const ks = inp.contracts.filter((k) => k.crop_id === cropId && k.crop_year === year && num(k.price_per_unit) != null)
  const kBu = ks.reduce((s, k) => s + (num(k.bushels) ?? 0), 0)
  if (ks.length && kBu > 0) {
    price = ks.reduce((s, k) => s + num(k.price_per_unit)! * (num(k.bushels) ?? 0), 0) / kBu
    priceFrom = `contracted (${ks.length} contract${ks.length === 1 ? '' : 's'})`
  } else if (ks.length) {
    price = ks.reduce((s, k) => s + num(k.price_per_unit)!, 0) / ks.length
    priceFrom = 'contracted'
  } else {
    // Today's elevator bid first, else the latest Alberta farm-gate price.
    let market = marketPrice(crop?.name, unit, inp.bids ?? new Map())
    if (!market) {
      const m = inp.market
        .filter((x) => x.crop_id === cropId && monthsOld(x.observed_on, inp.today) <= 18)
        .map((x) => ({ x, p: x.unit === '$/tonne' ? tonnePriceIn(unit, x.value, x.commodity) : null }))
        .filter((x) => x.p != null)
        .sort((a, b) => b.x.observed_on.localeCompare(a.x.observed_on))[0]
      if (m) {
        const d = new Date(m.x.observed_on)
        market = { value: m.p!, label: `Alberta market, ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
      }
    }
    const r = resolvePrice(cropId, year, inp.prices, { market, currentYear })
    price = r.value
    priceFrom =
      r.basis === 'set' ? `your ${year} price` : r.basis === 'forecast' ? `your ${year} forecast` : r.basis === 'carried' ? `your ${r.fromYear} price` : r.label
  }

  // Cost: the year's input budget, else the latest earlier one's.
  const c = resolveCosts(cropId, year, inp.inputs, currentYear)
  const cost = c.basis === 'none' ? null : c.total
  const costFrom = c.basis === 'none' ? 'no input budget' : `${c.fromYear} input budget`
  const insurance = c.lines.filter((i) => /insur|hail|afsc/i.test(i.name ?? '')).reduce((s, i) => s + (num(i.cost_per_acre) ?? 0), 0)

  const ownUse = Boolean(crop?.own_use)
  // Own feed is valued at what it would cost to buy — the same market price
  // or the farm's own figure, named as a feed value.
  if (ownUse && price != null) priceFrom = `feed value: ${priceFrom}`
  if (yieldPer != null && price != null && cost != null) {
    return { ownUse, unit, yield: yieldPer, yieldFrom, price, priceFrom, cost, costFrom, insurance, margin: yieldPer * price - cost, from: 'built' }
  }
  return { ownUse, unit, yield: yieldPer, yieldFrom, price, priceFrom, cost, costFrom, insurance, margin: typed, from: typed != null ? 'budget' : 'none' }
}

/**
 * Acres each crop must have in a year to fill its contracts, at the farm's
 * expected yield. A contract with no bushels, or a crop with no yield to
 * divide by, sets no minimum.
 */
export function contractMinimums(inp: MarginInputs, year: number): Map<string, { acres: number; bushels: number }> {
  const out = new Map<string, { acres: number; bushels: number }>()
  const byCrop = new Map<string, number>()
  for (const k of inp.contracts) {
    if (!k.crop_id || k.crop_year !== year || !(num(k.bushels)! > 0)) continue
    byCrop.set(k.crop_id, (byCrop.get(k.crop_id) ?? 0) + num(k.bushels)!)
  }
  for (const [cropId, bushels] of byCrop) {
    const y = cropMargin(inp, cropId, year).yield
    if (y && y > 0) out.set(cropId, { acres: bushels / y, bushels })
  }
  return out
}

/**
 * Tools 21–28: checking the invoice, money on offer, the spreading window,
 * manure in dollars, prepay against interest, buying to store, and whether
 * denser soil sampling pays.
 */

/* ---------------------------------------------------------------- 21 */

export type PriceCheck = {
  product: string
  invoice: string | null
  on: string
  tonnes: number | null
  charged: number
  agreed: number
  agreedFrom: string
  over: number
  overTotal: number | null
}

/**
 * Every invoice line for a product checked against the price agreed for it.
 *
 * The agreed price is the latest booking or quote for that product made on
 * or before the invoice date; a line with nothing agreed ahead of it is not
 * checked, because there is nothing to hold it to. Over by less than 1% is
 * rounding, not an over-charge.
 */
export function priceChecks(
  lines: { product: string; perTonne: number; on: string; invoice: string | null; tonnes: number | null }[],
  agreed: { product: string; perTonne: number; on: string; label: string }[],
): PriceCheck[] {
  const out: PriceCheck[] = []
  for (const l of lines) {
    const deal = agreed
      .filter((a) => a.product === l.product && a.on <= l.on)
      .sort((a, b) => b.on.localeCompare(a.on))[0]
    if (!deal) continue
    const over = l.perTonne - deal.perTonne
    out.push({
      product: l.product,
      invoice: l.invoice,
      on: l.on,
      tonnes: l.tonnes,
      charged: l.perTonne,
      agreed: deal.perTonne,
      agreedFrom: deal.label,
      over,
      overTotal: l.tonnes != null ? over * l.tonnes : null,
    })
  }
  return out.sort((a, b) => b.on.localeCompare(a.on))
}

export const isOvercharge = (c: PriceCheck) => c.over > Math.max(1, c.agreed * 0.01)

/* ---------------------------------------------------------------- 22 */

/**
 * What the On-Farm Climate Action Fund (RDAR, Alberta) cost-shares for
 * in-field nitrogen management, from the programme's 2026 guide: 85% of the
 * cost, up to $100 a field for lab fees where the farm samples, $300 a
 * field where a third party does, and $8 an acre for zone mapping and
 * sampling for a variable-rate N prescription.
 */
export const OFCAF = { share: 0.85, labPerField: 100, thirdPartyPerField: 300, zonePerAcre: 8 }

export function ofcafEstimate(fields: { acres: number | null; zoneMapped: boolean; thirdParty: boolean }[], costPerField: number) {
  let eligible = 0
  for (const f of fields) {
    const cap = f.zoneMapped && f.acres ? OFCAF.zonePerAcre * f.acres : f.thirdParty ? OFCAF.thirdPartyPerField : OFCAF.labPerField
    eligible += Math.min(costPerField, cap / OFCAF.share)
  }
  return { eligibleCost: eligible, grant: eligible * OFCAF.share }
}

/** Grants in the tracker that pay for fertilizer practice. */
export function isNutrientGrant(g: { title: string | null; summary?: string | null; categories?: string[] | null }): boolean {
  const text = `${g.title ?? ''} ${g.summary ?? ''} ${(g.categories ?? []).join(' ')}`.toLowerCase()
  return /nitrogen|4r|fertili[sz]|nutrient|variable[- ]rate|soil (test|sampl)|precision/.test(text)
}

/* ---------------------------------------------------------------- 23 */

export type NerpLevel = 'none' | 'basic' | 'intermediate' | 'advanced'

/**
 * The 4R level a field's nitrogen plan reaches under Alberta's Nitrous
 * Oxide Emission Reduction Protocol.
 *
 * Basic is site-specific management with the field as the unit: a soil
 * test and a rate made from it. Intermediate and Advanced manage by zone
 * within the field; Advanced adds the in-season or protected-source
 * practices on top. A simplification of the protocol's tables, to say which
 * fields are worth documenting, not to file a claim.
 */
export function nerpLevel(f: { soilTest: boolean; rateFromTest: boolean; zoneRx: boolean; split: boolean; enhanced: boolean }): { level: NerpLevel; missing: string[] } {
  const missing: string[] = []
  if (!f.soilTest) missing.push('a soil test')
  if (!f.rateFromTest) missing.push('a rate set from the test')
  if (!f.soilTest || !f.rateFromTest) return { level: 'none', missing }
  if (!f.zoneRx) return { level: 'basic', missing: ['zone management (a variable-rate N prescription)'] }
  if (!(f.split || f.enhanced)) return { level: 'intermediate', missing: ['split or in-season N, or a protected source'] }
  return { level: 'advanced', missing: [] }
}

/* ---------------------------------------------------------------- 24 */

export type SpreadVerdict = 'good' | 'fair' | 'poor'

/**
 * Whether today is a day to broadcast urea on the surface.
 *
 * Urea left on the surface loses ammonia until about half an inch (12 mm)
 * of rain in one event moves it in, and the loss is fastest on warm, windy,
 * damp days. A sprinkle is worse than nothing: enough to dissolve the
 * granule and start the loss, not enough to carry it down. So a day is
 * good when the next two days bring 12 mm, poor when they bring only a
 * sprinkle or when it is warm and dry, fair otherwise. An irrigated field
 * can make its own half inch, which the caller says.
 *
 * Cool weather buys time: Alberta's advice is to broadcast when the air is
 * under 10 °C, and loss is slow enough then that rain within about a week
 * still catches most of it (two weeks with an NBPT-treated urea such as
 * Agrotain or SuperU, which holds the urea about 7–14 days). A frosty night
 * is the exception to "cool is safe": frost melt wets the surface, which is
 * the moist-surface condition Montana measured the biggest fall and winter
 * losses on.
 */
export function spreadVerdict(
  days: { date: string; precip: number | null; hi: number | null; lo?: number | null; windMax: number | null }[],
  i: number,
  canIrrigate = false,
  opts: { nbpt?: boolean } = {},
): { verdict: SpreadVerdict; why: string } {
  const rain = (days[i]?.precip ?? 0) + (days[i + 1]?.precip ?? 0)
  const hi = days[i]?.hi ?? null
  const lo = days[i]?.lo ?? null
  const wind = days[i]?.windMax ?? null
  const reach = opts.nbpt ? 14 : 7
  // The first day within reach whose running total gets to 12 mm.
  let total = 0
  let soaked: string | null = null
  for (let k = i; k < Math.min(days.length, i + reach); k++) {
    total += days[k]?.precip ?? 0
    if (total >= 12) {
      soaked = days[k].date
      break
    }
  }
  const frost = lo != null && lo <= 0
  if (rain >= 12) return { verdict: 'good', why: `${rain.toFixed(0)} mm over this day and the next carries it in` }
  if (canIrrigate) return { verdict: 'good', why: 'irrigate half an inch within a day of spreading' }
  if (rain >= 1 && rain < 6) return { verdict: 'poor', why: `only ${rain.toFixed(0)} mm over this day and the next — a sprinkle starts the loss without stopping it` }
  if ((hi != null && hi >= 20) || (wind != null && wind >= 30)) {
    const what = `dry${hi != null ? `, ${Math.round(hi)}°` : ''}${wind != null && wind >= 30 ? `, wind ${Math.round(wind)} km/h` : ''}`
    if (opts.nbpt && soaked) return { verdict: 'fair', why: `${what}, but treated urea holds until the rain on ${soaked}` }
    return { verdict: 'poor', why: `${what} — fast loss on the surface` }
  }
  if (hi != null && hi < 10 && soaked && !frost) {
    return { verdict: 'good', why: `cool, so slow loss — and 12 mm has fallen by ${soaked}` }
  }
  if (rain >= 6) return { verdict: 'fair', why: `${rain.toFixed(0)} mm over this day and the next — some of it moves in` }
  if (frost) return { verdict: 'fair', why: `frost overnight (${Math.round(lo!)}°): the melt wets the surface and starts the loss${soaked ? `; rain by ${soaked}` : ''}` }
  if (opts.nbpt && soaked) return { verdict: 'good', why: `treated urea holds until the rain on ${soaked}` }
  return { verdict: 'fair', why: soaked ? `slow loss until the rain on ${soaked}` : 'cool and dry: slow loss, but no rain to stop it' }
}

/* ---------------------------------------------------------------- 25 */

/**
 * What a ton of manure is worth on a field, and what it costs to get there.
 *
 * Only the nutrients the field actually needs are counted — phosphate on a
 * high-P field is worth nothing to it — at the first-year available share,
 * at today's cheapest pound of each. The haul is round trip at the road
 * distance.
 */
export function manureValue(args: {
  perTon: { n: number; p2o5: number; k2o: number }
  firstYearN: number
  firstYearP: number
  firstYearK: number
  needs: { n: boolean; p: boolean; k: boolean }
  price: { n: number | null; p2o5: number | null; k2o: number | null }
  roadKm: number | null
  haulPerTonKm: number
  loadPerTon: number
  buyPerTon: number
}) {
  const n = args.needs.n ? args.perTon.n * args.firstYearN * (args.price.n ?? 0) : 0
  const p = args.needs.p ? args.perTon.p2o5 * args.firstYearP * (args.price.p2o5 ?? 0) : 0
  const k = args.needs.k ? args.perTon.k2o * args.firstYearK * (args.price.k2o ?? 0) : 0
  const gross = n + p + k
  const haul = args.roadKm != null ? args.roadKm * 2 * args.haulPerTonKm : 0
  const cost = haul + args.loadPerTon + args.buyPerTon
  return { gross, parts: { n, p, k }, haul, cost, net: gross - cost }
}

/* ---------------------------------------------------------------- 26 */

/**
 * An early-order discount against what paying early costs on the
 * operating line: the discount is only worth taking if it beats the
 * interest on the money for the months between paying and when it would
 * otherwise have been paid.
 */
export function prepayVsInterest(args: { spend: number; tonnes: number; discountPct: number | null; discountPerTonne: number | null; payBy: string; wouldPayOn: string; ratePct: number }) {
  const discount = (args.discountPct ? (args.spend * args.discountPct) / 100 : 0) + (args.discountPerTonne ? args.tonnes * args.discountPerTonne : 0)
  const days = Math.max(0, (Date.parse(args.wouldPayOn) - Date.parse(args.payBy)) / 86_400_000)
  const interest = ((args.spend - discount) * (args.ratePct / 100) * days) / 365
  return { discount, interest, days, net: discount - interest }
}

/* ---------------------------------------------------------------- 27 */

/** Bulk density, tonnes a cubic metre, for turning a bin's bushels into tonnes of product. */
export const BULK_DENSITY: Record<string, number> = { '46-0-0': 0.74, '11-52-0': 0.96, '0-0-60': 1.12, '21-0-0-24': 1.0 }
export const M3_PER_BU = 0.0352391

export const binTonnes = (bushels: number, product: string) => bushels * M3_PER_BU * (BULK_DENSITY[product] ?? 0.9)

/**
 * The typical move from summer to the next spring, from a quarterly index:
 * the average percentage change from each July quarter to the April
 * quarter after it, over the years held.
 */
export function seasonalGap(points: { on: string; value: number }[], years = 10): { pct: number; years: number } | null {
  const byQ = new Map(points.map((p) => [p.on.slice(0, 7), p.value]))
  const latest = points.map((p) => Number(p.on.slice(0, 4))).reduce((a, b) => Math.max(a, b), 0)
  const moves: number[] = []
  for (let y = latest - years; y < latest; y++) {
    const jul = byQ.get(`${y}-07`)
    const apr = byQ.get(`${y + 1}-04`)
    if (jul && apr) moves.push((apr / jul - 1) * 100)
  }
  if (!moves.length) return null
  return { pct: moves.reduce((a, b) => a + b, 0) / moves.length, years: moves.length }
}

export function storeValue(args: { tonnes: number; pricePerTonne: number; springPremiumPct: number; ratePct: number; months: number; shrinkPct: number }) {
  const spend = args.tonnes * args.pricePerTonne
  const gain = spend * (args.springPremiumPct / 100)
  const interest = (spend * (args.ratePct / 100) * args.months) / 12
  const shrink = spend * (args.shrinkPct / 100)
  return { spend, gain, interest, shrink, net: gain - interest - shrink }
}

/* ---------------------------------------------------------------- 28 */

/** Whether what a soil test found on a field paid for sampling it more densely. */
export function samplingPayback(found: number, acres: number | null, costPerField: number, zoneCostPerAcre: number) {
  const zoneCost = acres ? acres * zoneCostPerAcre : null
  return {
    found,
    fieldCost: costPerField,
    zoneCost,
    paysField: found >= costPerField,
    paysZone: zoneCost != null ? found >= zoneCost : null,
    ratio: zoneCost ? found / zoneCost : null,
  }
}

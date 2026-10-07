/**
 * Market fuel prices: what diesel and gasoline cost at the pump in southern
 * Alberta this week, and what that makes marked farm fuel.
 *
 * The source is Natural Resources Canada's retail price survey (Kalibrate
 * collects it for them): a daily pump price per city, published as a weekly
 * average running Wednesday to Tuesday. Its RSS "webfeed" gives the last 100
 * weekly averages for whatever product and cities are asked for, as dollars a
 * litre WITH every tax in — so one request per product per city is two years
 * of history and the newest week, which is the whole job.
 *
 *   https://www2.nrcan.gc.ca/eneene/sources/pripri/webfeed_e.cfm?productID=5&locationID=11
 *
 * productID 1 is regular gasoline and 5 is diesel; locationID 11 is
 * Lethbridge (the farm's town) and 8 is Calgary (a bigger, steadier sample).
 * The newest item is the week still in progress, dated by the Tuesday it ends
 * on, so it moves until that Tuesday; an upsert on the date absorbs that.
 *
 * Nobody publishes a marked-fuel price, so it is worked out from the pump
 * price and the taxes marked fuel does not pay. See farmFromRetail.
 */

export type FuelKind = 'diesel' | 'gasoline'

export const NRCAN_FEED = 'https://www2.nrcan.gc.ca/eneene/sources/pripri/webfeed_e.cfm'

export const NRCAN_PRODUCTS: Record<FuelKind, number> = { gasoline: 1, diesel: 5 }
export const NRCAN_CITIES = [
  { key: 'lethbridge', name: 'Lethbridge', id: 11 },
  { key: 'calgary', name: 'Calgary', id: 8 },
] as const

/** The pump series, by fuel and city. */
export const retailCode = (fuel: FuelKind, city: string) => `nrcan.${fuel}.${city}`
/** The worked-out marked-farm series, Lethbridge only: the town the farm buys in. */
export const farmCode = (fuel: FuelKind) => `farm.${fuel}.lethbridge`

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

export type FeedItem = { city: string; on: string; perL: number }

/**
 * The items out of the feed: city, week-ending date, $/L.
 *
 * Read with a regex rather than an XML parser because the function runs where
 * there is no DOM, and the feed is five fixed tags per item. A malformed item
 * is skipped rather than guessed at.
 */
export function parseNrcanFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = []
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []
  for (const it of items) {
    const city = /<title>\s*([^<]+?)\s*<\/title>/.exec(it)?.[1]
    const price = /<description>\s*\$?\s*([\d.]+)\s*<\/description>/.exec(it)?.[1]
    // "Tue, 06 Oct 2026"
    const d = /<pubDate>\s*\w+,\s*(\d{1,2})\s+(\w{3})\w*\s+(\d{4})/.exec(it)
    const mm = d ? MONTHS[d[2].toLowerCase()] : undefined
    const perL = price ? Number(price) : NaN
    if (!city || !d || !mm || !Number.isFinite(perL) || perL <= 0 || perL > 10) continue
    out.push({ city, on: `${d[3]}-${mm}-${d[1].padStart(2, '0')}`, perL })
  }
  return out
}

/* ------------------------------------------------------------------ taxes */

/**
 * Alberta fuel tax, cents a litre, on clear and on marked fuel, from a date.
 *
 * - From 1 Apr 2024: 13¢ clear, 4¢ marked (alberta.ca/about-fuel-tax; Fuel Tax
 *   Act Special Notice Vol. 1 No. 50). The 9¢ between them is the Alberta Farm
 *   Fuel Benefit, which is the whole of the provincial difference.
 * - Jul–Sep 2026: the Alberta Energy Rebate replaced that quarter's fuel-tax
 *   relief, so the full rate stood.
 * - From 1 Oct 2026: the fuel tax relief program suspends it outright, "through
 *   at least December 31, 2026", and marked fuel's 4¢ goes with it (Alberta
 *   announcement, 22 Sep 2026). Both nil: no provincial gap at all.
 *
 * The relief program sets the rate each quarter from the price of WTI, so this
 * needs a new row when a quarter changes it. A wrong row here shows as the farm
 * line on the Fuel page drifting from the invoices, which is the check.
 */
export const AB_FUEL_TAX: { from: string; clear: number; marked: number }[] = [
  { from: '2024-04-01', clear: 13, marked: 4 },
  { from: '2026-10-01', clear: 0, marked: 0 },
]

/**
 * The federal fuel charge ("carbon tax"), cents a litre, from a date.
 *
 * Qualifying farm fuel never paid it (a farmer's exemption certificate at the
 * pump), so before April 2025 it is part of what marked fuel saves. Rates from
 * the Greenhouse Gas Pollution Pricing Act schedule: 2023-24 diesel 17.38¢,
 * gasoline 14.31¢; 2024-25 diesel 21.39¢, gasoline 17.61¢. Set to zero for
 * everyone from 1 Apr 2025.
 */
export const FUEL_CHARGE: { from: string; diesel: number; gasoline: number }[] = [
  { from: '2023-04-01', diesel: 17.38, gasoline: 14.31 },
  { from: '2024-04-01', diesel: 21.39, gasoline: 17.61 },
  { from: '2025-04-01', diesel: 0, gasoline: 0 },
]

/*
 * Left out on purpose:
 * - Federal excise (diesel 4¢, gasoline 10¢). Treated as paid on clear and
 *   marked alike, so it does not move the gap. It has been suspended for
 *   everyone since 20 Apr 2026 (to 31 Jan 2027), which changes both prices the
 *   same. Some farm groups say coloured diesel in unplated machinery is exempt;
 *   if Fuel supplier's invoices show no excise line, the gap is 4¢ wider than this.
 * - GST. Taken off rather than subtracted as a rate difference: the farm
 *   claims it back, so an invoice's $/L is compared before GST.
 */
const GST = 0.05

function rowOn<T extends { from: string }>(table: T[], on: string): T | null {
  let hit: T | null = null
  for (const r of table) if (r.from <= on) hit = r
  return hit
}

/**
 * Marked farm fuel's $/L, before GST, worked out from a pump price that week.
 *
 *   pump ÷ 1.05  −  (Alberta clear − Alberta marked)  −  federal fuel charge
 *
 * Everything else in the pump price — the product, the margins, federal
 * excise — marked fuel pays too. It is a market figure to compare an invoice
 * against, not a quote: a bulk delivery is usually a little under it.
 */
export function farmFromRetail(retailPerL: number, on: string, fuel: FuelKind): number {
  const ab = rowOn(AB_FUEL_TAX, on)
  const fc = rowOn(FUEL_CHARGE, on)
  const abGap = ab ? ab.clear - ab.marked : 9
  const charge = fc ? fc[fuel] : 0
  return Math.round((retailPerL / (1 + GST) - abGap / 100 - charge / 100) * 10000) / 10000
}

/** The tax picture on a date, for showing beside the farm line. */
export function taxesOn(on: string, fuel: FuelKind) {
  const ab = rowOn(AB_FUEL_TAX, on)
  const fc = rowOn(FUEL_CHARGE, on)
  return { abClear: ab?.clear ?? 13, abMarked: ab?.marked ?? 4, fuelCharge: fc ? fc[fuel] : 0 }
}

/* ------------------------------------------------------------------ costing */

export type CostingSource = 'override' | 'invoice' | 'market' | 'typed' | 'survey' | 'fallback'

export type CostingPrice = { perL: number; source: CostingSource; label: string; on: string | null }

/**
 * The diesel $/L every fuel cost in the app uses, and where it came from.
 *
 * In order: a number somebody set on the trucking screen (an explicit
 * override wins over everything, so a manager can pin a price for a what-if);
 * the newest Fuel supplier farm-diesel invoice; the market farm-diesel figure;
 * the typed default on the Fuel page; Alberta's monthly input survey; and a
 * round $1.40 if every one of those is missing.
 */
export function costingDiesel(args: {
  override?: number | null
  invoice?: { perL: number; on: string; invoiceNo: string | null } | null
  market?: { perL: number; on: string } | null
  typed?: { perL: number; on: string | null; by: string | null } | null
  survey?: { perL: number; on: string } | null
}): CostingPrice {
  const ok = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0
  if (ok(args.override)) return { perL: args.override, source: 'override', label: 'set by the farm', on: null }
  if (args.invoice && ok(args.invoice.perL))
    return {
      perL: args.invoice.perL,
      source: 'invoice',
      label: `Fuel supplier invoice${args.invoice.invoiceNo ? ` ${args.invoice.invoiceNo}` : ''}, farm diesel, ${args.invoice.on}`,
      on: args.invoice.on,
    }
  if (args.market && ok(args.market.perL))
    return {
      perL: args.market.perL,
      source: 'market',
      label: `market: Lethbridge pump diesel less the taxes farm fuel does not pay, week to ${args.market.on}`,
      on: args.market.on,
    }
  if (args.typed && ok(args.typed.perL)) {
    const bits = [args.typed.by, args.typed.on].filter(Boolean).join(', ')
    return { perL: args.typed.perL, source: 'typed', label: `typed default${bits ? ` (${bits})` : ''}`, on: args.typed.on }
  }
  if (args.survey && ok(args.survey.perL))
    return { perL: args.survey.perL, source: 'survey', label: `Alberta farm input survey, marked diesel, ${args.survey.on}`, on: args.survey.on }
  return { perL: 1.4, source: 'fallback', label: 'a round $1.40/L', on: null }
}

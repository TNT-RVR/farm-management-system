/**
 * Breakeven per field: what each field has cost per acre, the price it needs
 * to cover that at its own yield, and the yield it needs at today's bid.
 *
 * Today's bid is the Alberta elevator bid in $/tonne, turned into $/bu by the
 * crop's bushel weight. Crops with no public bid (beans, potatoes, seed crops)
 * fall back to the price the P&L is using — the target or the contract price.
 */

/**
 * Elevator bid series and bushel weight (lb/bu) for crops that have one, and
 * the name the screen gives the bid.
 *
 * Wheat here is red spring, but the review's elevator-bid block — the only
 * block the parser reads (`ab.elevator.*`) — carries CPS and SWS wheat, not
 * CWRS. CWRS appears only as a weekly high/low/average line, which is not
 * stored as a series. So wheat keeps the CPS bid, and the label says so
 * rather than passing it off as a red-spring price. (Sam, 5 Oct 2026: wheat
 * is no longer grown, so the CPS bid stands as a planning price.)
 */
const BIDS: { match: RegExp; code: string; lbPerBu: number; label: string }[] = [
  // Seed canola is grown on contract by company; the commodity bid isn't its price.
  // "Unknown Canola" is the stand-in for a company not chosen yet.
  { match: /^(seed|basf|corteva|nutrien|unknown) canola/i, code: '', lbPerBu: 0, label: '' },
  { match: /canola/i, code: 'ab.elevator.canola.central', lbPerBu: 50, label: 'canola, Central' },
  { match: /durum/i, code: 'ab.elevator.durum.south', lbPerBu: 60, label: 'durum, South' },
  { match: /barley/i, code: 'ab.elevator.feed-barley.central', lbPerBu: 48, label: 'feed barley, Central' },
  { match: /oats/i, code: 'ab.elevator.feed-oats.central', lbPerBu: 34, label: 'feed oats, Central' },
  { match: /^wheat$/i, code: 'ab.elevator.cps.central', lbPerBu: 60, label: 'CPS (no CWRS bid available)' },
]

export const BID_CODES = [...new Set(BIDS.map((b) => b.code).filter(Boolean))]

const LB_PER_TONNE = 2204.62262

/** Today's bid for a crop in $/bu, or null when there is no public bid for it. */
export function bidPerBu(
  cropName: string | null,
  bidsByCode: Map<string, number>,
): { perBu: number; code: string; label: string } | null {
  if (!cropName) return null
  const hit = BIDS.find((b) => b.match.test(cropName.trim()))
  if (!hit || !hit.code) return null
  const perTonne = bidsByCode.get(hit.code)
  if (perTonne == null || !(perTonne > 0)) return null
  return { perBu: (perTonne * hit.lbPerBu) / LB_PER_TONNE, code: hit.code, label: hit.label }
}

export type Breakeven = {
  costPerAcre: number
  yieldPerAcre: number | null
  unit: string | null
  price: number | null
  priceSource: 'bid' | 'plan' | null
  /** Which elevator bid priced it, when priceSource is 'bid'. */
  bidLabel: string | null
  /** $/unit this field needs, at its own yield, to cover its costs. */
  breakevenPrice: number | null
  /** Units/ac this field needs, at the price, to cover its costs. */
  breakevenYield: number | null
  /** Net $/ac at the price and the field's own yield. */
  netAtPrice: number | null
}

export function breakeven(inp: {
  costPerAcre: number
  acres: number | null
  yieldTotal: number | null
  unit: string | null
  cropName: string | null
  planPrice: number | null
  bids: Map<string, number>
}): Breakeven {
  const yieldPerAcre = inp.yieldTotal != null && inp.acres && inp.acres > 0 && inp.yieldTotal > 0 ? inp.yieldTotal / inp.acres : null
  const bid = inp.unit === 'bu' ? bidPerBu(inp.cropName, inp.bids) : null
  const price = bid?.perBu ?? (inp.planPrice != null && inp.planPrice > 0 ? inp.planPrice : null)
  const priceSource = bid ? 'bid' : price != null ? 'plan' : null
  const cost = inp.costPerAcre
  return {
    costPerAcre: cost,
    yieldPerAcre,
    unit: inp.unit,
    price,
    priceSource,
    bidLabel: bid?.label ?? null,
    breakevenPrice: yieldPerAcre ? cost / yieldPerAcre : null,
    breakevenYield: price && cost > 0 ? cost / price : null,
    netAtPrice: price != null && yieldPerAcre != null ? yieldPerAcre * price - cost : null,
  }
}

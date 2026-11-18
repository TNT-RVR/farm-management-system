/**
 * What an acre earns under each use, so limited land can be allocated.
 *
 * Gross margin is revenue less the DIRECT (variable) costs of the enterprise —
 * not profit. Overheads, depreciation, land and the operator's own labour are
 * deliberately left out: they do not change when an acre moves from barley to
 * pasture, so including them only blurs the comparison this page exists to
 * make. The ranking is per acre because land is the thing in short supply.
 *
 * Nothing here talks to Supabase, so the page and the tests use the same
 * numbers.
 *
 * ---------------------------------------------------------------------------
 * Modelled on the BCRC's Gross Margins Calculator, whose spreadsheet was read
 * on 13 Nov 2026. Its good idea, kept here: the cow-calf and pasture
 * enterprises are two halves of one thing, so pasture "sells" its grass to the
 * cow herd at what the grazing is worth, and the two are added back together
 * to see what a pasture acre really returns. Charge the grass to the cows and
 * the pasture looks profitable while the cows look poor; add them up and the
 * transfer cancels.
 *
 * Two things are done differently:
 *
 *   1. THEIR CASH-CROP REVENUE IS OUT BY A FACTOR OF TWO. Cell F46 is
 *      `price × (yield / 1000)` with the yield entered in lb/acre and the
 *      price given as $/ton. A ton is 2,000 lb, not 1,000. Here a crop is
 *      priced in whatever unit the farm already measures it in — bushels for
 *      cereals, tonnes for silage — and the price is per that same unit, so
 *      there is no conversion to get wrong.
 *
 *   2. THEIR HOME-GROWN HAY IS COUNTED TWICE. They charge the cow herd for
 *      its grazing but not for its hay, while still crediting the hay
 *      enterprise with the market value of every tonne. The same tonne is then
 *      revenue to the hay enterprise and absent from the herd's costs. Here
 *      hay grown for the herd is an internal transfer exactly as grazing is:
 *      credited to the hay enterprise, charged to the cows, and cancelling
 *      when the two are added. What the herd buys from outside is separate.
 * ---------------------------------------------------------------------------
 */

const n = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** A block of land under one use. */
export type LandEnterprise = {
  key: string
  label: string
  acres: number
  /** Seed, fertilizer, chemical, fuel, contract work — $/acre. */
  directPerAcre: number
  /** Yield in the crop's own unit; 1 for pasture, which is priced by the acre. */
  yieldPerAcre: number
  /** $ per unit of yield. For pasture, the grazing's worth as $/acre with yield 1. */
  pricePerUnit: number
  /** The unit the yield is in, for the screen. */
  unit: string
  /**
   * True when the revenue is the herd's money moving between two of the
   * farm's own enterprises rather than a sale: pasture and hay for the herd.
   * It is charged to the cow-calf enterprise and cancels in the combined view.
   */
  internal: boolean
}

export type CowCalf = {
  cows: number
  /** Feed BOUGHT in — what is grown here comes through the internal transfer. */
  purchasedFeedPerCow: number
  hiredLabourPerCow: number
  otherPerCow: number
  weaningWeightLb: number
  /** Calves weaned per cow exposed, as a fraction. */
  weaningRate: number
  calfPricePerLb: number
  cullCows: number
  cullWeightLb: number
  cullPricePerLb: number
}

export type EnterpriseResult = {
  key: string
  label: string
  acres: number
  revenue: number
  directCost: number
  grossMargin: number
  grossMarginPerAcre: number | null
  /** Gross margin as a share of revenue; null when there is no revenue. */
  ratio: number | null
  internal: boolean
  unit: string
}

export type CowCalfResult = {
  revenuePerCow: number
  revenue: number
  /** Bought feed, labour and other — before the farm's own grass and hay. */
  ownDirectPerCow: number
  /** Pasture and home-grown hay, charged at what they are worth, $/cow. */
  transferPerCow: number
  directPerCow: number
  directCost: number
  grossMargin: number
  grossMarginPerCow: number
  ratio: number | null
}

export type GrossMarginResult = {
  cowCalf: CowCalfResult
  land: EnterpriseResult[]
  /**
   * The cow-calf enterprise and the land that feeds it, added back together.
   * The internal transfers cancel, so this is what a forage acre actually
   * returns — the number to set against a cash crop acre.
   */
  forage: { acres: number; grossMargin: number; perAcre: number | null; enterprises: string[] }
  /** Every acre's use ranked by gross margin an acre, best first. */
  ranked: { key: string; label: string; perAcre: number; acres: number }[]
}

/** Revenue an acre of this enterprise brings: price x yield (pasture: price). */
export const revenuePerAcre = (e: Pick<LandEnterprise, 'yieldPerAcre' | 'pricePerUnit'>) =>
  n(e.yieldPerAcre) * n(e.pricePerUnit)

/**
 * Cow-calf revenue a cow: the calf crop plus the cull cows spread over the
 * herd. The weaning rate is applied to the calf, never to the culls — a cow
 * that loses her calf is still sold.
 */
export function cowCalfRevenuePerCow(c: CowCalf): number {
  const calf = n(c.weaningWeightLb) * n(c.calfPricePerLb) * n(c.weaningRate)
  const cows = n(c.cows)
  const cull = cows > 0 ? (n(c.cullWeightLb) * n(c.cullCows) * n(c.cullPricePerLb)) / cows : 0
  return calf + cull
}

/**
 * Every enterprise costed, the forage side added back together, and the uses
 * ranked by what they leave an acre.
 */
export function grossMargins(cowCalf: CowCalf, land: LandEnterprise[]): GrossMarginResult {
  const enterprises: EnterpriseResult[] = land.map((e) => {
    const acres = Math.max(0, n(e.acres))
    const revenue = revenuePerAcre(e) * acres
    const directCost = n(e.directPerAcre) * acres
    const grossMargin = revenue - directCost
    return {
      key: e.key,
      label: e.label,
      acres,
      revenue,
      directCost,
      grossMargin,
      grossMarginPerAcre: acres > 0 ? grossMargin / acres : null,
      ratio: revenue !== 0 ? grossMargin / revenue : null,
      internal: e.internal,
      unit: e.unit,
    }
  })

  // What the herd owes its own land: the whole value of the grass and the hay
  // grown for it, spread over the cows.
  const cows = Math.max(0, n(cowCalf.cows))
  const internal = enterprises.filter((e) => e.internal)
  const transferPerCow = cows > 0 ? internal.reduce((a, e) => a + e.revenue, 0) / cows : 0

  const revenuePerCow = cowCalfRevenuePerCow(cowCalf)
  const ownDirectPerCow = n(cowCalf.purchasedFeedPerCow) + n(cowCalf.hiredLabourPerCow) + n(cowCalf.otherPerCow)
  const directPerCow = ownDirectPerCow + transferPerCow
  const revenue = revenuePerCow * cows
  const directCost = directPerCow * cows
  const cc: CowCalfResult = {
    revenuePerCow,
    revenue,
    ownDirectPerCow,
    transferPerCow,
    directPerCow,
    directCost,
    grossMargin: revenue - directCost,
    grossMarginPerCow: revenuePerCow - directPerCow,
    ratio: revenue !== 0 ? (revenue - directCost) / revenue : null,
  }

  // Adding the herd to the land that feeds it cancels the transfer, which is
  // the whole point: what is left is the calf cheque less every direct cost of
  // producing it, over the acres it took.
  const forageAcres = internal.reduce((a, e) => a + e.acres, 0)
  const forageGm = cc.grossMargin + internal.reduce((a, e) => a + e.grossMargin, 0)
  const forage = {
    acres: forageAcres,
    grossMargin: forageGm,
    perAcre: forageAcres > 0 ? forageGm / forageAcres : null,
    enterprises: ['Cow-calf', ...internal.map((e) => e.label)],
  }

  const ranked: GrossMarginResult['ranked'] = []
  if (forage.perAcre != null) ranked.push({ key: 'forage', label: forage.enterprises.join(' + '), perAcre: forage.perAcre, acres: forageAcres })
  for (const e of enterprises) {
    if (e.internal || e.grossMarginPerAcre == null) continue
    ranked.push({ key: e.key, label: e.label, perAcre: e.grossMarginPerAcre, acres: e.acres })
  }
  ranked.sort((a, b) => b.perAcre - a.perAcre)

  return { cowCalf: cc, land: enterprises, forage, ranked }
}

/**
 * What moving `acres` from one use to another would change the gross margin
 * by, at today's margins. Positive means the move pays.
 *
 * Only as good as its assumption, which is that the margins hold at the new
 * acreage — true for a few hundred acres on this farm and not true for all of
 * it, because the herd cannot eat an extra section of hay and the rotation
 * will not take another year of the same cash crop.
 */
export function switchGain(
  r: GrossMarginResult,
  fromKey: string,
  toKey: string,
  acres: number,
): { gain: number; from: number; to: number; acres: number; capped: boolean } | null {
  const find = (k: string) => r.ranked.find((x) => x.key === k)
  const from = find(fromKey)
  const to = find(toKey)
  if (!from || !to) return null
  // No more than the use has; `acres` and `capped` say what was really moved,
  // so the sentence never prints the typed figure beside a capped gain.
  const a = Math.max(0, Math.min(n(acres), from.acres))
  return { gain: (to.perAcre - from.perAcre) * a, from: from.perAcre, to: to.perAcre, acres: a, capped: n(acres) > from.acres }
}

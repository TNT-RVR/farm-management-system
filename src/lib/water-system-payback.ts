/**
 * What a trough and a pump are worth against letting the cattle walk into the
 * dugout, and how long they take to pay for themselves.
 *
 * The benefit is weight: cattle drinking clean pumped water gain better than
 * cattle standing in their own water. Lardner et al. (2005) measured it over
 * two stretches of one summer and those figures are the whole basis of this
 * page — see LARDNER below for what they do and do not cover.
 *
 * Nothing here talks to Supabase, so the page and the tests use the same
 * numbers.
 *
 * ---------------------------------------------------------------------------
 * Modelled on the BCRC's Economics of Water Systems Calculator, whose
 * spreadsheet was read on 13 Nov 2026. Three things are done differently:
 *
 *   1. THEIR PAYBACK IGNORES RUNNING COSTS. Cell F78 is
 *      `(capital - funding) / benefit`, labelled "excl. Maintenance" — while
 *      the net-benefit columns two cells to the right DO subtract maintenance
 *      and power. The same table answers the same question two ways. Worse,
 *      a system whose upkeep costs more than it earns still gets a tidy
 *      finite payback out of that formula. Here payback is net of power and
 *      maintenance, and it is NULL when the thing never pays for itself.
 *      Theirs is kept beside it, so the gap is visible rather than argued.
 *
 *   2. THEIR COW GAIN IS COMPUTED AND THROWN AWAY. Rows 68 and 69 work out
 *      the extra gain on the COWS — 0.33 and 0.44 lb a day, about 50 lb over
 *      the summer — and no later cell ever reads them. Only the calf gain
 *      reaches the results. Fifty pounds on a cow is real, but it is condition
 *      rather than a cheque: you do not sell her. So it is banked here only on
 *      the cows actually sold that year, at the cull price, and the rest is
 *      reported as condition with no dollar figure against it.
 *
 *   3. NOTHING STOPS A PAYBACK LONGER THAN THE EQUIPMENT. A pump that pays
 *      back in 19 years has not paid back; it has worn out. Each system
 *      carries a working life and says whether it gets there.
 * ---------------------------------------------------------------------------
 */

const n = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/**
 * Lardner, H. A., et al., "The effect of water quality on cattle performance
 * on pasture", Australian Journal of Agricultural Research 56(1), 2005.
 *
 * Two stretches of one grazing season on one site. Everything this page says
 * rests on them, so: they are a single year's measurement, the herd was
 * yearlings or cow-calf pairs on dugout water in Saskatchewan, and the second
 * period's calf response is about half the first's. Treat the total as the
 * right order of magnitude, not a number to plan a budget around to the
 * dollar.
 */
export const LARDNER = {
  periods: [
    { label: 'May 23 – Jul 31', days: 69 },
    { label: 'Aug 1 – Sep 30', days: 61 },
  ],
  /** Extra lb a day over cattle with direct dugout access. */
  gain: {
    /** Calves at side, pumped untreated water. */
    calf: [0.154322, 0.088184],
    /** Their dams. Condition, not a cheque — see the header. */
    cow: [0.33, 0.44],
    /** Yearling steers, pumped but untreated. */
    yearling: [0.07, 0.09],
    /** Yearling steers, pumped AND aerated. */
    yearlingAerated: [0.26, 0.07],
  },
} as const

/** Pounds over the whole season for a pair of per-period daily gains. */
export function seasonGainLb(adgByPeriod: readonly number[]): number {
  return LARDNER.periods.reduce((a, p, i) => a + p.days * n(adgByPeriod[i]), 0)
}

export type HerdKind = 'cow_calf' | 'yearling'

export type WaterHerd = {
  kind: HerdKind
  /** Pairs, or yearlings. */
  head: number
  /** $/lb the calves or yearlings will fetch. */
  salePricePerLb: number
  /** Cow-calf only: cows sold out of the herd each year, as a share. */
  cullShare?: number
  /** Cow-calf only: $/lb for those cull cows. */
  cullPricePerLb?: number
  /** Yearlings only: the water is aerated as well as pumped. */
  aerated?: boolean
}

export type WaterSystem = {
  key: string
  label: string
  /** Everything it costs to put in, $. */
  capital: number
  /** Grant money against it, $. */
  funding: number
  powerPerYear: number
  maintenancePerYear: number
  /** Working life before it has to be replaced, years. */
  lifeYears: number
}

export type HerdBenefit = {
  /** Extra lb a calf, or a yearling, over the season. */
  salableGainLb: number
  /** Extra lb a cow. Zero for yearlings. */
  cowGainLb: number
  /** The calf or yearling gain, in dollars a head a year. */
  salableValue: number
  /** The cow gain, banked only on the cows sold this year. */
  cullValue: number
  perHeadPerYear: number
}

/** What the water is worth a head a year, and where that number comes from. */
export function herdBenefit(h: WaterHerd): HerdBenefit {
  if (h.kind === 'yearling') {
    const gain = seasonGainLb(h.aerated ? LARDNER.gain.yearlingAerated : LARDNER.gain.yearling)
    const value = gain * n(h.salePricePerLb)
    return { salableGainLb: gain, cowGainLb: 0, salableValue: value, cullValue: 0, perHeadPerYear: value }
  }
  const calfGain = seasonGainLb(LARDNER.gain.calf)
  const cowGain = seasonGainLb(LARDNER.gain.cow)
  const salableValue = calfGain * n(h.salePricePerLb)
  // A cow's extra condition is money only on the ones that leave this year.
  const cullValue = cowGain * Math.max(0, Math.min(1, n(h.cullShare))) * n(h.cullPricePerLb)
  return {
    salableGainLb: calfGain,
    cowGainLb: cowGain,
    salableValue,
    cullValue,
    perHeadPerYear: salableValue + cullValue,
  }
}

export type SystemResult = {
  key: string
  label: string
  capitalPerHead: number
  fundingPerHead: number
  /** What it costs after the grant, $/head. */
  netCapitalPerHead: number
  /** Power plus maintenance, $/head/year. */
  runningPerHead: number
  benefitPerHead: number
  /** Benefit less running costs — what actually pays the capital back. */
  netPerHeadPerYear: number
  /**
   * Years for the net annual return to cover the capital, or null when it
   * never does because the upkeep costs more than the water earns.
   */
  paybackYears: number | null
  /** The BCRC's own figure, which leaves running costs out. Always finite. */
  paybackYearsTheirWay: number | null
  /** True when it pays for itself inside its own working life. */
  paysWithinLife: boolean
  lifeYears: number
}

/** Net cash a head after `years`, capital and running costs counted. */
export function netAfter(r: SystemResult, years: number): number {
  return r.netPerHeadPerYear * Math.max(0, n(years)) - r.netCapitalPerHead
}

/**
 * Each system costed per head, soonest payback first. A system that never
 * pays sorts last however cheap it was to put in.
 */
export function waterSystemPayback(
  herd: WaterHerd,
  systems: WaterSystem[],
): { benefit: HerdBenefit; systems: SystemResult[] } {
  const benefit = herdBenefit(herd)
  const head = Math.max(0, n(herd.head))
  const per = (v: number) => (head > 0 ? v / head : 0)

  const results = systems.map((s): SystemResult => {
    const capitalPerHead = per(n(s.capital))
    const fundingPerHead = per(n(s.funding))
    const netCapitalPerHead = capitalPerHead - fundingPerHead
    const runningPerHead = per(n(s.powerPerYear) + n(s.maintenancePerYear))
    const netPerHeadPerYear = benefit.perHeadPerYear - runningPerHead
    const paybackYears = netPerHeadPerYear > 0 ? netCapitalPerHead / netPerHeadPerYear : null
    const lifeYears = n(s.lifeYears)
    return {
      key: s.key,
      label: s.label,
      capitalPerHead,
      fundingPerHead,
      netCapitalPerHead,
      runningPerHead,
      benefitPerHead: benefit.perHeadPerYear,
      netPerHeadPerYear,
      paybackYears,
      paybackYearsTheirWay: benefit.perHeadPerYear > 0 ? netCapitalPerHead / benefit.perHeadPerYear : null,
      paysWithinLife: paybackYears != null && lifeYears > 0 && paybackYears <= lifeYears,
      lifeYears,
    }
  })

  results.sort((a, b) => {
    if (a.paybackYears == null && b.paybackYears == null) return a.netCapitalPerHead - b.netCapitalPerHead
    if (a.paybackYears == null) return 1
    if (b.paybackYears == null) return -1
    return a.paybackYears - b.paybackYears
  })
  return { benefit, systems: results }
}

/** A trough at the end of whatever is pumping, BCRC's default price. */
export const TROUGH_COST = 5295
/** A 2,500 gallon storage tank, so there is a day's water at the trough. */
export const TANK_COST = 2100
/** A new well, where the site has none. NOT in the defaults below. */
export const WELL_COST = 10000

/**
 * The four systems the BCRC prices, as starting points to be typed over.
 *
 * Each is the PUMP plus a trough and a storage tank, because a pump on its
 * own waters nothing — their sheet adds the same three lines up and these are
 * their prices. A new well is another ~$10,000 (WELL_COST) and is deliberately
 * left out: this farm has wells, and a default that quietly assumes one makes
 * every payback look worse than it is. Add it to the capital where the site
 * really needs one.
 */
export const DEFAULT_SYSTEMS: WaterSystem[] = [
  { key: 'solar', label: 'Solar pump', capital: 4000 + TROUGH_COST + TANK_COST, funding: 0, powerPerYear: 0, maintenancePerYear: 150, lifeYears: 15 },
  { key: 'windmill', label: 'Windmill pump', capital: 5880 + TROUGH_COST + TANK_COST, funding: 0, powerPerYear: 0, maintenancePerYear: 200, lifeYears: 20 },
  { key: 'pipe_under', label: 'Buried pipeline', capital: 10000 + TROUGH_COST + TANK_COST, funding: 0, powerPerYear: 200, maintenancePerYear: 150, lifeYears: 25 },
  { key: 'pipe_over', label: 'Surface pipeline', capital: 8000 + TROUGH_COST + TANK_COST, funding: 0, powerPerYear: 200, maintenancePerYear: 200, lifeYears: 10 },
]

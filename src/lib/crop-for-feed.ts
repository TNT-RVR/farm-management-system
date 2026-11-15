/**
 * What an annual crop is worth fed to the cattle instead of combined.
 *
 * Four ways to take the same field — combine it for grain, swath graze it,
 * bale it as greenfeed, or put it up as silage — costed per acre against each
 * other and against the hay those cattle would otherwise eat. Built for the
 * two cases that come up here: a crop hailed or droughted out of grain, and a
 * standing crop on a mixed farm where the cows are short of winter feed.
 *
 * Nothing in here talks to Supabase, so the page and the tests use the same
 * numbers.
 *
 * ---------------------------------------------------------------------------
 * Modelled on the BCRC's Value of Crops for Livestock Feeds Calculator, whose
 * spreadsheet was read cell by cell on 12 Nov 2026. The feed composition table
 * is theirs and is worth having: CowBytes Feed Table ver 5.41, Alberta
 * Agriculture and Rural Development. The arithmetic around it is NOT theirs,
 * in three places where their sheet is wrong:
 *
 *   1. THEIR GRAIN REMOVAL USES THE STRAW TONNAGE. Every nutrient column in
 *      their sheet multiplies by cell B20, the straw yield, including the
 *      grain column. Grain nutrients leave the field in the GRAIN, so that is
 *      the tonnage to multiply by. On their own default (80.7 bu/ac barley,
 *      1.4 t/ac straw) the grain tonnage is 1.76 t/ac, so they understate what
 *      combining takes away by a quarter.
 *
 *   2. THEIR BALING COST IS $/BALE ADDED TO $/ACRE. Cell D51 adds B45, a
 *      dollars-a-bale figure, straight into a dollars-an-acre total. It only
 *      comes out right at one bale to the acre. Here it is bales an acre times
 *      the cost of a bale.
 *
 *   3. THEIR MANURE CREDIT COUNTS THE SAME NUTRIENTS TWICE, and is enormous.
 *      Swath grazing removes nothing from the field — their own sheet sets the
 *      removal line to zero for it — and then they ADD a credit for the manure
 *      dropped on it. But that manure IS the crop's own nutrients, cycled
 *      through a cow; it is not fertility arriving from somewhere else. On
 *      their defaults (160 pairs, 97 days, 160 acres) the credit works out at
 *      about $290 an acre, which is more than the crop. It is large because
 *      they apply dry-matter nutrient concentrations (N 6 g/kg, P 7.89, K
 *      38.45) to WET manure weight at 37 kg a cow a day.
 *
 *      So there is no manure credit here. The nutrient line is what LEAVES the
 *      field: the grain when you combine, the whole plant when you bale or
 *      ensile, and nothing when the cattle eat it where it grew. That is the
 *      honest ledger, and it still favours grazing — by the right amount.
 * ---------------------------------------------------------------------------
 */

/** lb in a tonne, as the BCRC sheet and the CowBytes table use it. */
export const LB_PER_TONNE = 2204.6
/** Crude protein to nitrogen: CP / 6.25. */
export const CP_TO_N = 0.16
/** Elemental phosphorus to P2O5. */
export const P_TO_P2O5 = 2.29
/** Elemental potassium to K2O. */
export const K_TO_K2O = 1.2

export const CROP_FEED_FORMS = ['grain', 'straw', 'hay', 'silage'] as const
export type CropFeedForm = (typeof CROP_FEED_FORMS)[number]

/** Pounds of each nutrient in a tonne of dry matter. */
export type NutrientLb = { n: number; p2o5: number; k2o: number; s: number }

/** What a nutrient is worth, $/lb — from the farm's own fertilizer quotes. */
export type NutrientPrice = { n: number; p2o5: number; k2o: number; s: number }

/** Composition as the CowBytes table gives it: % of dry matter. */
type Composition = { cpPct: number; pPct: number; kPct: number; sPct: number }

const fromComposition = (c: Composition): NutrientLb => ({
  n: LB_PER_TONNE * (c.cpPct / 100) * CP_TO_N,
  p2o5: LB_PER_TONNE * P_TO_P2O5 * (c.pPct / 100),
  k2o: LB_PER_TONNE * K_TO_K2O * (c.kPct / 100),
  s: LB_PER_TONNE * (c.sPct / 100),
})

/**
 * Nutrients in a tonne of dry matter, by crop and the form it is taken off in.
 *
 * The grain rows are given directly in lb a tonne, as the source table gives
 * them; everything else is a composition the source states as a percentage of
 * dry matter. A crop with no row for a form cannot be taken off that way —
 * corn has silage only, bromegrass and timothy hay only.
 */
export const FEED_NUTRIENTS: Record<string, Partial<Record<CropFeedForm, NutrientLb>>> = {
  alfalfa: {
    hay: fromComposition({ cpPct: 18.2, pPct: 0.24, kPct: 1.72, sPct: 0.24 }),
    silage: fromComposition({ cpPct: 18.2, pPct: 0.25, kPct: 1.82, sPct: 0.27 }),
  },
  'alfalfa-grass': {
    hay: fromComposition({ cpPct: 14.0, pPct: 0.19, kPct: 1.65, sPct: 0.17 }),
    silage: fromComposition({ cpPct: 14.6, pPct: 0.23, kPct: 1.62, sPct: 0.12 }),
  },
  barley: {
    grain: { n: 44.1, p2o5: 19.19, k2o: 14.29, s: 3.09 },
    straw: fromComposition({ cpPct: 4.2, pPct: 0.08, kPct: 1.4, sPct: 0.12 }),
    hay: fromComposition({ cpPct: 11.8, pPct: 0.22, kPct: 1.83, sPct: 0.27 }),
    silage: fromComposition({ cpPct: 11.1, pPct: 0.27, kPct: 1.6, sPct: 0.22 }),
  },
  bromegrass: { hay: fromComposition({ cpPct: 10.6, pPct: 0.17, kPct: 1.5, sPct: 0.14 }) },
  canola: {
    grain: { n: 82.19, p2o5: 32.31, k2o: 22.49, s: 12.57 },
    hay: fromComposition({ cpPct: 15.1, pPct: 0.27, kPct: 1.64, sPct: 0.55 }),
    silage: fromComposition({ cpPct: 16.2, pPct: 0.33, kPct: 2.16, sPct: 0.55 }),
  },
  corn: { silage: fromComposition({ cpPct: 10.0, pPct: 0.26, kPct: 1.42, sPct: 0.07 }) },
  lentil: {
    grain: { n: 82.89, p2o5: 20.19, k2o: 24.6, s: 5.07 },
    straw: fromComposition({ cpPct: 6.5, pPct: 0.13, kPct: 0.65, sPct: 0.13 }),
    hay: fromComposition({ cpPct: 14.2, pPct: 0.23, kPct: 1.28, sPct: 0.14 }),
  },
  oat: {
    grain: { n: 39.86, p2o5: 17.17, k2o: 12.43, s: 3.09 },
    straw: fromComposition({ cpPct: 4.5, pPct: 0.1, kPct: 1.55, sPct: 0.12 }),
    hay: fromComposition({ cpPct: 9.9, pPct: 0.2, kPct: 1.96, sPct: 0.19 }),
    silage: fromComposition({ cpPct: 10.6, pPct: 0.24, kPct: 1.74, sPct: 0.18 }),
  },
  pea: {
    grain: { n: 84.3, p2o5: 20.19, k2o: 27.51, s: 4.85 },
    straw: fromComposition({ cpPct: 6.5, pPct: 0.08, kPct: 1.3, sPct: 0.15 }),
    hay: fromComposition({ cpPct: 14.0, pPct: 0.21, kPct: 1.28, sPct: 0.14 }),
    silage: fromComposition({ cpPct: 12.3, pPct: 0.32, kPct: 2.1, sPct: 0.27 }),
  },
  timothy: { hay: fromComposition({ cpPct: 8.8, pPct: 0.16, kPct: 1.41, sPct: 0.14 }) },
  wheat: {
    grain: { n: 55.03, p2o5: 20.19, k2o: 11.11, s: 3.75 },
    straw: fromComposition({ cpPct: 3.9, pPct: 0.08, kPct: 1.4, sPct: 0.12 }),
    silage: fromComposition({ cpPct: 11.2, pPct: 0.23, kPct: 1.58, sPct: 0.16 }),
  },
}

/** The crops the table covers, for a dropdown. */
export const CROP_FEED_CROPS = Object.keys(FEED_NUTRIENTS).sort()

/**
 * The table's key for one of our crop names ("Barley-Feed", "Grain Corn",
 * "Beans-Pinto"), or null where the table has nothing for it. Matched on the
 * first word that is a key, so a variety suffix does not matter.
 */
export function feedNutrientKey(cropName: string | null | undefined): string | null {
  const name = (cropName ?? '').toLowerCase()
  if (!name) return null
  if (/alfalfa.*grass|grass.*alfalfa/.test(name)) return 'alfalfa-grass'
  for (const key of CROP_FEED_CROPS) {
    if (key === 'alfalfa-grass') continue
    if (new RegExp(`\\b${key}s?\\b`).test(name)) return key
  }
  if (/\boats\b/.test(name)) return 'oat'
  if (/\bpeas\b/.test(name)) return 'pea'
  return null
}

/** What a tonne of dry matter in this form is worth as fertility, $. */
export function nutrientValuePerTonne(lb: NutrientLb | undefined, price: NutrientPrice): number {
  if (!lb) return 0
  return lb.n * price.n + lb.p2o5 * price.p2o5 + lb.k2o * price.k2o + lb.s * price.s
}

/**
 * How much of the standing dry matter the cattle actually get, by option.
 *
 * Swath grazing loses the most — snow, wind, and what gets bedded on — and the
 * published range is wide (65-85%). Baling and ensiling lose less but are not
 * free either. These are starting points to be tuned against what the Feed tab
 * measures, not measurements; the page lets them be typed.
 */
export type Recovery = { swath_graze: number; greenfeed: number; silage: number }
export const DEFAULT_RECOVERY: Recovery = { swath_graze: 0.75, greenfeed: 0.85, silage: 0.85 }

export type FeedOption = 'combine' | 'swath_graze' | 'greenfeed' | 'silage'

export const FEED_OPTION_LABEL: Record<FeedOption, string> = {
  combine: 'Combine for grain',
  swath_graze: 'Swath graze',
  greenfeed: 'Bale as greenfeed',
  silage: 'Put up as silage',
}

export type CropForFeedInput = {
  /** A key of FEED_NUTRIENTS; feedNutrientKey() maps our crop names onto it. */
  crop: string
  acres: number
  /** Grain the field would make if combined. */
  grainYieldBuPerAc: number
  buPerTonne: number
  /** $/tonne the grain would fetch — already discounted if the crop is damaged. */
  grainPricePerTonne: number
  /** Standing dry matter, whole plant, tonnes an acre. */
  wholePlantTonneDmPerAc: number
  /** Dry matter left on the field as straw when the field is combined, t/ac. */
  strawTonneDmPerAc: number
  /** What the feed replaces: $/tonne of DRY MATTER of bought or home-grown hay. */
  hayValuePerTonneDm: number
  /**
   * Dry matter the farm still has to find this winter, tonnes over the WHOLE
   * field's worth of acres. Feed beyond it is not replacing bought hay, so it
   * is valued at `surplusValuePerTonneDm` instead.
   *
   * This is the correction that matters most. Value every tonne a crop grows
   * at what hay costs and feeding ALWAYS beats combining, because a cereal
   * crop's whole plant outweighs its grain — which is why the BCRC's own
   * worked example says to graze a sound 80 bu barley crop. It is only true
   * while the cows are actually short. Left out, there is no cap, and the
   * ranking reverts to that optimism.
   */
  feedNeededTonneDm?: number | null
  /** What a tonne of feed past the need is worth — 0 unless it can be sold. */
  surplusValuePerTonneDm?: number | null
  costs: {
    combinePerAc: number
    swathPerAc: number
    silagePerAc: number
    balePerBale: number
    balesPerAc: number
  }
  nutrientPrice: NutrientPrice
  recovery?: Partial<Recovery>
}

export type OptionResult = {
  option: FeedOption
  label: string
  /** Dry matter the cattle actually get, tonnes an acre. */
  feedTonneDmPerAc: number
  /** That feed valued at what hay costs, $/ac — capped at what the herd needs. */
  feedValuePerAc: number
  /** Grain sold, $/ac. Only the combine option has any. */
  grainRevenuePerAc: number
  /** Swathing, combining, baling, ensiling — $/ac. */
  operatingPerAc: number
  /** Fertility that leaves the field in what is hauled off, $/ac. */
  nutrientRemovedPerAc: number
  /** feed + grain − operating − nutrients removed, $/ac. */
  netPerAc: number
  /** What the feed ends up costing, $/tonne of dry matter; null when there is none. */
  costPerTonneDm: number | null
  /** Why this option is not on the table, when it isn't. */
  unavailable: string | null
}

const n = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/**
 * The four options for one field, best net return first.
 *
 * Net is what the farm is left with an acre: the feed valued at what hay would
 * have cost, plus any grain sold, less the operations and less the fertility
 * hauled away. Combining is one of the four rather than the baseline, so a
 * damaged crop and a sound one are read the same way.
 */
export function cropForFeed(inp: CropForFeedInput): { options: OptionResult[]; best: OptionResult | null } {
  const table = FEED_NUTRIENTS[inp.crop] ?? {}
  const rec = { ...DEFAULT_RECOVERY, ...(inp.recovery ?? {}) }
  const whole = Math.max(0, n(inp.wholePlantTonneDmPerAc))
  const hay = n(inp.hayValuePerTonneDm)
  const acres = Math.max(0, n(inp.acres))
  const needPerAc =
    inp.feedNeededTonneDm == null || !(acres > 0) ? null : Math.max(0, n(inp.feedNeededTonneDm)) / acres
  const surplus = n(inp.surplusValuePerTonneDm)
  /** Feed worth what hay costs up to the need, and the surplus rate past it. */
  const valueOfFeed = (tonnes: number) => {
    if (needPerAc == null) return tonnes * hay
    const wanted = Math.min(tonnes, needPerAc)
    return wanted * hay + (tonnes - wanted) * surplus
  }
  const grainTonnePerAc = n(inp.buPerTonne) > 0 ? Math.max(0, n(inp.grainYieldBuPerAc)) / n(inp.buPerTonne) : 0

  const value = (form: CropFeedForm) => nutrientValuePerTonne(table[form], inp.nutrientPrice)

  const build = (
    option: FeedOption,
    o: { feed: number; grain: number; operating: number; removedPerTonne: number; removedTonnes: number; unavailable?: string | null },
  ): OptionResult => {
    const nutrientRemovedPerAc = o.removedPerTonne * o.removedTonnes
    const feedValuePerAc = valueOfFeed(o.feed)
    return {
      option,
      label: FEED_OPTION_LABEL[option],
      feedTonneDmPerAc: o.feed,
      feedValuePerAc,
      grainRevenuePerAc: o.grain,
      operatingPerAc: o.operating,
      nutrientRemovedPerAc,
      netPerAc: feedValuePerAc + o.grain - o.operating - nutrientRemovedPerAc,
      costPerTonneDm: o.feed > 0 ? (o.operating + nutrientRemovedPerAc - o.grain) / o.feed : null,
      unavailable: o.unavailable ?? null,
    }
  }

  const options: OptionResult[] = [
    // Combining takes the grain away and leaves the straw standing, so the
    // straw's fertility never leaves and is not charged.
    build('combine', {
      feed: 0,
      grain: grainTonnePerAc * n(inp.grainPricePerTonne),
      operating: n(inp.costs.combinePerAc),
      removedPerTonne: value('grain'),
      removedTonnes: grainTonnePerAc,
      unavailable: table.grain ? null : `No grain figures for ${inp.crop}`,
    }),
    // Eaten where it grew: nothing is hauled off, so nothing is charged — and
    // nothing is credited either, because the manure is the crop's own.
    build('swath_graze', {
      feed: whole * rec.swath_graze,
      grain: 0,
      operating: n(inp.costs.swathPerAc),
      removedPerTonne: 0,
      removedTonnes: 0,
    }),
    build('greenfeed', {
      feed: whole * rec.greenfeed,
      grain: 0,
      operating: n(inp.costs.swathPerAc) + n(inp.costs.balePerBale) * n(inp.costs.balesPerAc),
      removedPerTonne: value('hay'),
      removedTonnes: whole * rec.greenfeed,
      unavailable: table.hay ? null : `No hay figures for ${inp.crop}`,
    }),
    build('silage', {
      feed: whole * rec.silage,
      grain: 0,
      operating: n(inp.costs.silagePerAc),
      removedPerTonne: value('silage'),
      removedTonnes: whole * rec.silage,
      unavailable: table.silage ? null : `No silage figures for ${inp.crop}`,
    }),
  ]

  const usable = options.filter((o) => !o.unavailable)
  usable.sort((a, b) => b.netPerAc - a.netPerAc)
  const rest = options.filter((o) => o.unavailable)
  return { options: [...usable, ...rest], best: usable[0] ?? null }
}

/** The whole field rather than an acre. */
export const forField = (perAc: number, acres: number) => perAc * Math.max(0, n(acres))

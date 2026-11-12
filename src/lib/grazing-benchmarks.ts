/**
 * What wintering a cow costs, ours beside Alberta's published benchmarks.
 *
 * The winter feed plan already knows what this herd needs and what our own feed
 * is priced at. What it has never had is anything to judge that against. These
 * are the published numbers, parsed out of the four AgriProfit$ publications
 * the research library holds, each for the soil or grass-type zone this farm
 * actually sits in wherever one exists for it.
 *
 * Three cost and returns profiles, all Southern Alberta (Fescue Grassland,
 * Mixed Grassland and Moist Mixed Grassland), all published 30 July 2012 from
 * field observations over 2008 to 2010 — a three-year average, which the
 * publications say is on purpose, to smooth out extremes in prices, yields and
 * expenses. Each reports a regional average and a "top third" grouping drawn
 * from the lowest-cost third by total production cost per unit of output.
 *
 * And one technical bulletin, "Swath Grazing: Interesting Concept, But Does It
 * Pay?" (2 December 2002), which is the only one of the four that does the
 * comparison this screen is about: swath grazing against drylot feeding, on a
 * common denominator. It is Central Alberta and the 2000 season, which matters
 * and is said out loud — no snow to speak of, mild temperatures, waste held
 * under 10 per cent, and crops that averaged 3.19 tons an acre in the swath.
 * The bulletin itself ends by telling the reader to work out their own costs,
 * which is the whole point of putting them side by side.
 *
 * Every figure here was read out of the publications' own tables. Nothing is
 * interpolated between zones and nothing is adjusted for inflation: a 2012
 * dollar is left as a 2012 dollar and the screen says the year, because
 * quietly indexing someone else's cost of production turns their measurement
 * into our estimate.
 */

/** The unit the grazing profiles are priced in: a 1,000 lb cow for a month. */
export const AUM = 'AUM'

/**
 * Animal unit days in an animal unit month, as the 2002 bulletin's own table
 * works it out: 240.38 AUD an acre over 7.63 AUM an acre.
 *
 * Taken from the publication rather than from the length of a month, so the
 * $/AUM profiles and the $/AUD bulletin can be put on one scale using the
 * same arithmetic the publications used between themselves.
 */
export const AUD_PER_AUM = 240.38 / 7.63

/** A standard animal unit: a 1,000 lb cow, with or without a calf. */
export const AU_LB = 1000

export type GrazingProfile = {
  key: string
  /** How it is named on this screen. */
  label: string
  /** What the publication calls the crop. */
  crop: string
  zone: string
  published: number
  /** The field years behind it. */
  observedOver: string
  paperId: string
  paper: string
  /** Fields in the group, and the average field size. */
  observations: number
  avgFieldAcres: number
  /** AUM an acre: the regional average, and the lowest-cost third. */
  yieldAumPerAcre: number
  yieldAumPerAcreTop: number
  /** $/acre. */
  totalCostPerAcre: number
  totalCostPerAcreTop: number
  cashCostPerAcre: number
  variableCostPerAcre: number
  capitalCostPerAcre: number
  /** $/AUM. */
  totalCostPerAum: number
  totalCostPerAumTop: number
  cashCostPerAum: number
  /** The price the publication expected the grazing to be worth, $/AUM. */
  expectedPricePerAum: number
  /** $/acre, the cost lines a feed plan can recognise. */
  lines: { seed: number; fertilizer: number; chemicals: number; fuel: number; customWork: number; cropInsurance: number }
  /** The quartile spread of yield, AUM/acre, so the average is not read as a promise. */
  yieldLowQuartile: number
  yieldHighQuartile: number
  /** Coefficient of variation on yield, per cent, as published. */
  yieldCvPct: number
}

/**
 * The three Southern Alberta profiles, in the order a winter feed plan meets
 * them: the annual crop you swath and graze, then the two perennial pastures
 * it is an alternative to.
 */
export const SOUTHERN_PROFILES: GrazingProfile[] = [
  {
    key: 'swath',
    label: 'Dryland swath grazing',
    crop: 'Dryland Swath Grazing',
    zone: 'Southern Alberta (Fescue Grassland, Mixed Grassland & Moist Mixed Grassland)',
    published: 2012,
    observedOver: '2008 to 2010',
    paperId: '07fbfd04-2b82-4f8f-ab28-ea9ca6c04068',
    paper: 'Dryland swath grazing : southern Alberta (Fescue Grassland, Mixed Grassland & MoistMixed Grassland)',
    observations: 22,
    avgFieldAcres: 123.0,
    yieldAumPerAcre: 4.77,
    yieldAumPerAcreTop: 5.48,
    totalCostPerAcre: 85.32,
    totalCostPerAcreTop: 65.79,
    cashCostPerAcre: 82.69,
    variableCostPerAcre: 74.60,
    capitalCostPerAcre: 10.72,
    totalCostPerAum: 17.87,
    totalCostPerAumTop: 12.01,
    cashCostPerAum: 17.32,
    expectedPricePerAum: 22.41,
    lines: { seed: 10.94, fertilizer: 24.05, chemicals: 9.97, fuel: 4.57, customWork: 14.49, cropInsurance: 6.25 },
    yieldLowQuartile: 3.18,
    yieldHighQuartile: 7.35,
    yieldCvPct: 48.6,
  },
  {
    key: 'tame_grass',
    label: 'Dryland tame grass pasture',
    crop: 'Tame Grass Pasture',
    zone: 'Southern Alberta (Fescue Grassland, Mixed Grassland & Moist Mixed Grassland)',
    published: 2012,
    observedOver: '2008 to 2010',
    paperId: '3fad4129-1ca1-4eb5-b563-df4a08e2d584',
    paper: 'AgriProfit$ cost & returns profiles. Dryland tame grass pasture : Southern Alberta (Fescue Grassland, Mixed Grassland & MoistMixed Grassland)',
    observations: 52,
    avgFieldAcres: 386.9,
    yieldAumPerAcre: 0.75,
    yieldAumPerAcreTop: 0.60,
    totalCostPerAcre: 11.57,
    totalCostPerAcreTop: 5.49,
    cashCostPerAcre: 9.95,
    variableCostPerAcre: 5.46,
    capitalCostPerAcre: 6.10,
    totalCostPerAum: 15.39,
    totalCostPerAumTop: 9.12,
    cashCostPerAum: 13.24,
    expectedPricePerAum: 21.75,
    lines: { seed: 0, fertilizer: 1.07, chemicals: 0.42, fuel: 0.53, customWork: 0.19, cropInsurance: 0.69 },
    yieldLowQuartile: 0.58,
    yieldHighQuartile: 1.61,
    yieldCvPct: 114.7,
  },
  {
    key: 'legume_grass',
    label: 'Dryland legume/grass pasture',
    crop: 'Legume/Grass Pasture',
    zone: 'Southern Alberta (Fescue Grassland, Mixed Grassland & Moist Mixed Grassland)',
    published: 2012,
    observedOver: '2008 to 2010',
    paperId: '4f8bb151-e06a-4e8c-913d-4e610571f22a',
    paper: 'AgriProfit$ cost & returns profiles. Dryland legume/grass pasture : Southern Alberta (Fescue Grassland, Mixed Grassland & MoistMixed Grassland)',
    observations: 14,
    avgFieldAcres: 1133.3,
    yieldAumPerAcre: 0.49,
    yieldAumPerAcreTop: 0.33,
    totalCostPerAcre: 6.82,
    totalCostPerAcreTop: 2.21,
    cashCostPerAcre: 5.69,
    variableCostPerAcre: 2.53,
    capitalCostPerAcre: 4.29,
    totalCostPerAum: 13.91,
    totalCostPerAumTop: 6.61,
    cashCostPerAum: 11.60,
    expectedPricePerAum: 23.16,
    lines: { seed: 0, fertilizer: 0, chemicals: 0, fuel: 0.37, customWork: 0.09, cropInsurance: 0.38 },
    yieldLowQuartile: 0.41,
    yieldHighQuartile: 1.86,
    yieldCvPct: 256.1,
  },
]

/**
 * The Central Alberta swath grazing profile, from the same 2012 series.
 *
 * Not our zone, and here for one reason: it is the only other swath grazing
 * profile published, and the gap between it and ours is the clearest statement
 * in these publications of what southern Alberta costs a swath grazer — the
 * same crop yielded 5.48 AUM an acre up there against our 4.77.
 */
export const CENTRAL_SWATH = {
  key: 'swath_central',
  label: 'Dryland swath grazing, Central Alberta',
  zone: 'Central Alberta (Aspen Parkland & portions of Boreal Transition)',
  paperId: 'f8d309e1-9b0a-4024-b6e6-81898e854571',
  paper: 'AgriProfit$ cost & returns profiles. Dryland swath grazing : Central Alberta (Aspen Parkland & portions of Boreal Transition)',
  observations: 47,
  yieldAumPerAcre: 5.48,
  totalCostPerAcre: 93.26,
  totalCostPerAum: 17.02,
  totalCostPerAumTop: 10.42,
  expectedPricePerAum: 25.92,
} as const

/**
 * The 2002 bulletin's own swath-grazing-against-drylot comparison, $/AUD.
 *
 * Three cost bases because the bulletin reports three, and which one our number
 * belongs beside depends on how our own figure was built. The saving column is
 * the bulletin's Table 3, not a subtraction done here — it agrees, and is
 * carried as published so a transcription slip would show up.
 */
export const DRYLOT_2002 = {
  paperId: '83d9d3af-132c-469f-a66c-6c01eb753b8c',
  paper: 'Swath grazing interesting concept, but does it pay?',
  published: 2002,
  season: 2000,
  zone: 'Central Alberta, along Highway 2 between Calgary and Edmonton',
  /** Swath grazing fields in the group, and cow-calf operations in the control. */
  swathFields: 11,
  drylotHerds: 16,
  bases: [
    { key: 'variable', label: 'Variable costs', swath: 0.47, drylot: 1.11, saving: 0.64, perAcre: 153.84 },
    { key: 'cash', label: 'Cash costs', swath: 0.43, drylot: 1.05, saving: 0.62, perAcre: 149.04 },
    { key: 'total', label: 'Total production costs', swath: 0.68, drylot: 1.26, saving: 0.58, perAcre: 139.42 },
  ],
  /** What the swath grazing yielded that year. */
  audPerAcre: 240.38,
  aumPerAcre: 7.63,
  tonsPerAcreInSwath: 3.19,
  wastePct: 8,
  /** The drylot control's own management figures. */
  drylot: {
    costPerCowWintered: 361.80,
    cashCostPerCowWintered: 300.95,
    feedAndBeddingPerCow: 221.55,
    daysOnFeed: 210.5,
    avgCowLb: 1363,
    audPerCowWintered: 286.49,
    costPerDayOnFeed: 1.72,
    labourHoursPerDay: 2.47,
  },
  /** The bulletin's own caveats, in its words. */
  caveats: [
    'The 2000 season was kind: virtually no snow to limit access to the swaths, mild temperatures, and wastage held under 10 per cent.',
    'The crops swath grazed averaged 3.19 tons an acre, hay equivalent, in the swath — "by no means poor crops to begin with".',
    'The benefit depends entirely on how high drylot feeding costs are. Feed a cow in the pen for less than the control group did and the saving shrinks.',
    'If the land is paid cost for the swath grazing, the best the crop can do is break even — the cow herd’s costing is artificially lower by paying less than market for feed. The farm is only better off while the reduced costs outweigh the revenue given up on a harvested crop.',
  ],
} as const

// ── Putting ours beside theirs ────────────────────────────────────────────

export type OurWinter = {
  /** What one cow costs us to winter, feed plus yardage, over the whole winter. */
  costPerCowWintered: number | null
  /** Days in that winter. */
  days: number
  /** Head of cows the figure covers. */
  cows: number
  /** Average cow weight, for turning a cow-day into an animal unit day. */
  cowLb: number | null
  /** Feeds in the ration with no price set, which make the figure incomplete. */
  unpriced: string[]
}

export type OurRates = {
  /** Dollars per cow per day. */
  perCowDay: number
  /** Animal units a cow is, at her weight. */
  auPerCow: number
  /** Dollars per animal unit day, which is the publications' denominator. */
  perAud: number
  /** Dollars per animal unit month, on the bulletin's own AUD-per-AUM figure. */
  perAum: number
}

/**
 * Our own cost on the publications' scale.
 *
 * A cow-day is not an animal unit day: an animal unit is a 1,000 lb cow, and
 * this herd's cows are heavier than that, so a heavier cow eats more than one
 * AUD in a day. The 2002 bulletin did the same conversion on its own control
 * group — 286.49 AUD per cow wintered over 210.5 days on 1,363 lb cows works
 * out at 1.36 AUD a cow-day, against 1.363 from the weight alone — so weight
 * over 1,000 lb is the factor it used, and the factor used here.
 */
export function ourRates(w: OurWinter): OurRates | null {
  if (w.costPerCowWintered == null || !(w.days > 0) || !(w.cowLb && w.cowLb > 0)) return null
  const perCowDay = w.costPerCowWintered / w.days
  const auPerCow = w.cowLb / AU_LB
  const perAud = perCowDay / auPerCow
  return { perCowDay, auPerCow, perAud, perAum: perAud * AUD_PER_AUM }
}

export type BenchmarkRow = {
  key: string
  label: string
  /** $/AUM as published. */
  theirPerAum: number
  theirPerAumTop: number
  /** $/AUD, on the bulletin's own AUD-per-AUM figure. */
  theirPerAud: number
  /** $/acre, and what an acre yields, which is how the land side reads. */
  theirPerAcre: number
  aumPerAcre: number
  /** Animal unit days an acre carries. */
  audPerAcre: number
  /** Ours less theirs, per AUD. Null when we have no figure. */
  gapPerAud: number | null
  /**
   * Ours divided by theirs.
   *
   * Carried beside the difference because the difference alone misleads: these
   * are 2002 and 2012 dollars and ours is today's, and nothing here is indexed
   * for inflation. A multiple at least reads as a multiple, where "+$2.40 an
   * animal unit day" reads as an overspend.
   */
  timesTheirs: number | null
  /** The year the benchmark's dollars are in, for the column that shows it. */
  year: number
  paperId: string
  paper: string
  ourZone: boolean
}

/** Each profile on one scale, with our own figure set against it. */
export function benchmarkRows(ours: OurRates | null): BenchmarkRow[] {
  const row = (p: GrazingProfile | typeof CENTRAL_SWATH, ourZone: boolean, extras?: Partial<BenchmarkRow>): BenchmarkRow => {
    const theirPerAud = p.totalCostPerAum / AUD_PER_AUM
    return {
      key: p.key,
      label: p.label,
      theirPerAum: p.totalCostPerAum,
      theirPerAumTop: p.totalCostPerAumTop,
      theirPerAud,
      theirPerAcre: p.totalCostPerAcre,
      aumPerAcre: p.yieldAumPerAcre,
      audPerAcre: p.yieldAumPerAcre * AUD_PER_AUM,
      gapPerAud: ours ? ours.perAud - theirPerAud : null,
      timesTheirs: ours && theirPerAud > 0 ? ours.perAud / theirPerAud : null,
      year: 'published' in p ? p.published : SOUTHERN_PROFILES[0].published,
      paperId: p.paperId,
      paper: p.paper,
      ourZone,
      ...extras,
    }
  }
  return [...SOUTHERN_PROFILES.map((p) => row(p, true)), row(CENTRAL_SWATH, false)]
}

export type DrylotRow = {
  key: string
  label: string
  swath: number
  drylot: number
  /** The bulletin's own saving, $/AUD. */
  saving: number
  /** What that saving came to an acre of swath, at 240.38 AUD an acre. */
  perAcre: number
  /** Ours on the same basis, when we have it. */
  ours: number | null
}

/**
 * The bulletin's swath-against-drylot table with our own figure dropped in.
 *
 * Ours goes in one column only — the total-production-cost row — because that
 * is what the winter plan builds: priced feed plus yardage, with nothing taken
 * out for unpaid labour or depreciation. Putting the same number in the cash
 * and variable rows would claim it was built three ways.
 */
export function drylotRows(ours: OurRates | null): DrylotRow[] {
  return DRYLOT_2002.bases.map((b) => ({
    key: b.key,
    label: b.label,
    swath: b.swath,
    drylot: b.drylot,
    saving: b.saving,
    perAcre: b.perAcre,
    ours: b.key === 'total' && ours ? ours.perAud : null,
  }))
}

/**
 * Acres of swath grazing that would carry a herd for a stretch of winter, at
 * the published southern Alberta yield.
 *
 * Both ends of the quartile spread, never the average alone: the publication's
 * own coefficient of variation on that yield is 48.6 per cent, so an acre
 * figure quoted off the mean would be a number with a 50 per cent error bar
 * and no error bar shown.
 */
export function acresForDays(o: { cows: number; cowLb: number; days: number }): {
  acresAverage: number
  acresLowYield: number
  acresHighYield: number
  audNeeded: number
} | null {
  if (!(o.cows > 0) || !(o.cowLb > 0) || !(o.days > 0)) return null
  const audNeeded = o.cows * (o.cowLb / AU_LB) * o.days
  const p = SOUTHERN_PROFILES[0]
  const perAcre = (aum: number) => aum * AUD_PER_AUM
  return {
    audNeeded,
    acresAverage: audNeeded / perAcre(p.yieldAumPerAcre),
    acresLowYield: audNeeded / perAcre(p.yieldLowQuartile),
    acresHighYield: audNeeded / perAcre(p.yieldHighQuartile),
  }
}

/**
 * What the agronomy publications say about making swath grazing work, as
 * against what it costs. Read out of the two the library holds in full.
 */
export const SWATH_AGRONOMY = {
  paperId: '1a34b575-4563-41b9-a61e-caf80aa90b6e',
  paper: 'Agronomic management of swath grazed pastures',
  year: 2008,
  intro: {
    paperId: 'fefa0499-7a80-4cc8-b7b2-d331f054de31',
    paper: 'Swath grazing in western Canada : an introduction',
    year: 2004,
  },
} as const

export const BENCHMARK_SOURCES = {
  swathSouth: SOUTHERN_PROFILES[0],
  tameGrass: SOUTHERN_PROFILES[1],
  legumeGrass: SOUTHERN_PROFILES[2],
  central: CENTRAL_SWATH,
  drylot: DRYLOT_2002,
  /** The triticale and corn comparison, held as a citation only. */
  triticale: {
    paper: 'Swath grazing triticale and corn compared to barley and a traditional winter feeding method in central Alberta',
    year: 2014,
    what: 'The crop comparison. The library holds it as a citation with no extracted text, so no yield or cost from it is quoted here.',
  },
} as const

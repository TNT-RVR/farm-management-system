/**
 * What the product in the tank shares with everything already sprayed on the
 * field — and with the ground it is going onto.
 *
 * The spray check used to answer one question: does the label let us grow what
 * is planned here next year. These are the four it could not answer, each of
 * them a thing the research library has a measurement for and the farm has the
 * history for:
 *
 *   1. The same mode of action, season after season. Four trade names can be
 *      one group: 10-Aspen Flat had Cotegra, Proline Gold, Prosaro Pro and
 *      Delaro Complete in three years, which reads as four fungicides and
 *      is three seasons of Group 7.
 *   2. The same mode of action, twice in one season, in two products a grower
 *      is buying as different fungicides.
 *   3. A re-crop interval printed as one flat number, on ground that is not
 *      the average the number assumes. The field's own soil test says which
 *      end of the range we are on.
 *   4. Time of day, for the one active where the library can say what it is
 *      worth in percentage points.
 *
 * Pure: the data comes from product_moa_v, field_moa_history_v and
 * field_soil_ph_v (migration 20261104110000), the hooks live in
 * spray-groups-hooks.ts, and every rule below is a function over plain rows so
 * it can be tested against the farm's real history rather than clicked.
 *
 * All four stay silent unless they have something to say. A spray check that
 * prints four paragraphs every time is a spray check nobody reads.
 */

/** A paper the library holds, and how to find it there. */
export type SprayPaper = {
  id: string
  /** As cited on the screen. */
  cite: string
  /** The words that open the library on it: `/research?tab=search&q=…`. */
  find: string
}

/**
 * The work behind each warning. Each `find` was checked against the library's
 * own search — one hit, the right paper — so a link cannot land on a shelf of
 * near-misses.
 */
export const SPRAY_PAPERS = {
  /** Group 9, and the nearest case of it there is: southern Alberta, 2021. */
  downyBrome: {
    id: '296280af-f936-4f3a-b358-e0144c0d2e71',
    cite: 'First report of glyphosate-resistant downy brome in Canada (2022)',
    find: 'glyphosate-resistant downy brome',
  },
  /**
   * Why a new group is not a fresh start: Alberta wild oat already resistant
   * to Group 1 and 2 turned out to be cross-resistant to pyroxasulfone and
   * sulfentrazone, both of which we spray.
   */
  triallateWildOat: {
    id: 'ae138942-cce5-43aa-b452-631ff666733b',
    cite: 'Triallate-resistant wild oat: unexpected resistance to pyroxasulfone and sulfentrazone (2016)',
    find: 'Triallate-resistant wild oat',
  },
  /** Boscalid, fluopyram and fluxapyroxad failing together. We buy all three. */
  sdhiCrossResistance: {
    id: '0628862a-837d-4e8e-99aa-5e25dd5dd257',
    cite: 'Resistance to boscalid, fluopyram and fluxapyroxad in Blumeriella jaapii (2021)',
    find: 'Blumeriella jaapii boscalid fluopyram fluxapyroxad',
  },
  /** The general case, for a group with no nearer paper on the shelf. */
  resistanceManagement: {
    id: '2c723c10-d657-4cf4-a5a2-39a43a7586c4',
    cite: 'Herbicide Resistance Management: Recent Developments and Trends (2019)',
    find: 'Herbicide Resistance Management: Recent Developments and Trends',
  },
  /** Where the pH 7.5 line on metribuzin comes from. */
  metribuzinPlantBack: {
    id: '8b5feaab-8271-471b-84b0-ff6f956b7f91',
    cite: 'Soybean plant-back following an amicarbazone and metribuzin application for corn (2026)',
    find: 'Soybean plant-back amicarbazone metribuzin',
  },
  /** Sulfonylurea carryover, nine rotational crops, alkaline soils. */
  chlorsulfuronInjury: {
    id: '7057c95d-27a4-417b-9fbd-ee360f8748b0',
    cite: 'Factors Affecting Chlorsulfuron Injury to Rotational Crops (1985)',
    find: 'Factors Affecting Chlorsulfuron Injury to Rotational Crops',
  },
  /** How the prairie work measures what is actually left in the soil. */
  sugarBeetBioassay: {
    id: 'c682b474-a617-47e4-ad8c-c117ca8d8c13',
    cite: 'Use of sugar beet as a bioindicator plant for flucarbazone and sulfentrazone in soil (2012)',
    find: 'Sugar Beet Bioindicator Flucarbazone Sulfentrazone',
  },
  /** 82 % at midday, 65 % at dusk, same rate. */
  glufosinateTimeOfDay: {
    id: '47c6934c-c99b-4458-9fa2-ee81a86c3f22',
    cite: 'Biochemical basis for the time-of-day effect on glufosinate efficacy (2021)',
    find: 'Time-of-Day Effect on Glufosinate Efficacy',
  },
} as const satisfies Record<string, SprayPaper>

/** Where the research library opens on a paper. */
export const paperLink = (paper: SprayPaper) =>
  `/research?tab=search&q=${encodeURIComponent(paper.find)}`

export type Scheme = 'herbicide' | 'fungicide' | 'insecticide'

/** One (product, active) row out of product_moa_v. */
export type ProductMoa = {
  product_id: string
  product_name: string
  active: string
  scheme: Scheme
  group_code: string
  group_name: string
  ph_sensitive: boolean
  time_of_day: string | null
  group_note: string | null
}

/** One past application, resolved to a group (field_moa_history_v). */
export type MoaPass = {
  field_id: string
  crop_season: number | null
  applied_on: string
  operation_id: string
  product_id: string
  product_name: string
  active: string
  scheme: Scheme
  group_code: string
  group_name: string
}

/** The field's topsoil, from the latest test that measured pH (field_soil_ph_v). */
export type FieldSoil = {
  field_id: string
  crop_year: number
  ph: number | null
  ph_max: number | null
  om_pct: number | null
  samples: number
}

/**
 * A group, as counted. Group 2 covers sulfonylureas and imidazolinones under
 * one number and the view names each chemistry separately, so the identity of
 * a group is the scheme and the number — never the name.
 */
export const groupKey = (scheme: Scheme, code: string) => `${scheme}:${code}`

export const SCHEME_WORD: Record<Scheme, string> = {
  herbicide: 'herbicide',
  fungicide: 'fungicide',
  insecticide: 'insecticide',
}

/** The groups one product puts in the tank, one row per group. */
export function productGroups(rows: ProductMoa[], productId: string | null | undefined): ProductMoa[] {
  if (!productId) return []
  const byGroup = new Map<string, ProductMoa>()
  for (const r of rows) {
    if (r.product_id !== productId) continue
    const key = groupKey(r.scheme, r.group_code)
    const seen = byGroup.get(key)
    // Keep the actives together where one product carries two of a group.
    if (seen) byGroup.set(key, { ...seen, active: `${seen.active} and ${r.active.toLowerCase()}` })
    else byGroup.set(key, r)
  }
  return [...byGroup.values()]
}

/** How many of this product's own actives share one group (Group 7 twice in one jug). */
export function selfOverlap(rows: ProductMoa[], productId: string | null | undefined): ProductMoa[] {
  if (!productId) return []
  const byGroup = new Map<string, ProductMoa[]>()
  for (const r of rows) {
    if (r.product_id !== productId) continue
    const key = groupKey(r.scheme, r.group_code)
    byGroup.set(key, [...(byGroup.get(key) ?? []), r])
  }
  return [...byGroup.values()].filter((g) => g.length > 1).map((g) => ({ ...g[0], active: g.map((x) => x.active).join(' and ') }))
}

/** How many seasons of a group a field has had, and in what. */
export type GroupRepeat = {
  scheme: Scheme
  groupCode: string
  groupName: string
  /** The product about to go on. */
  active: string
  /** Seasons that already had this group, oldest first. */
  seasons: number[]
  /** Counting the season being sprayed. */
  wouldBeSeason: number
  /**
   * The season being sprayed has already had this group. The count then does
   * not go up, so the line has to say "still the 3rd season" rather than
   * promising a 3rd that has in fact already happened.
   */
  alreadyThisSeason: boolean
  passes: number
  /** Trade names, so four names reading as one group is visible. */
  products: string[]
}

/**
 * The seasons of each of this product's groups already on this field.
 *
 * Counted in SEASONS, not passes: a pre-seed burn-off and an in-crop pass of
 * the same group in one year is one year of that group in the rotation, and
 * counting passes would make a field sprayed twice last June look worse than
 * one sprayed every year for three. The pass count comes along for the reading.
 *
 * `threshold` is the repeat that gets flagged — the third season of a group by
 * default, which is the point at which a rotation has stopped rotating.
 */
export function groupRepeats(
  passes: MoaPass[],
  opts: { fieldId: string; groups: ProductMoa[]; season: number },
): GroupRepeat[] {
  const out: GroupRepeat[] = []
  for (const g of opts.groups) {
    const mine = passes.filter(
      (p) => p.field_id === opts.fieldId && p.scheme === g.scheme && p.group_code === g.group_code,
    )
    const seasons = [...new Set(mine.map((p) => p.crop_season).filter((y): y is number => y != null))].sort(
      (a, b) => a - b,
    )
    const withThis = new Set(seasons)
    withThis.add(opts.season)
    out.push({
      scheme: g.scheme,
      groupCode: g.group_code,
      groupName: g.group_name,
      active: g.active,
      seasons,
      wouldBeSeason: withThis.size,
      alreadyThisSeason: seasons.includes(opts.season),
      passes: new Set(mine.map((p) => p.operation_id)).size,
      products: [...new Set(mine.map((p) => p.product_name))].sort(),
    })
  }
  return out.sort((a, b) => b.wouldBeSeason - a.wouldBeSeason)
}

/** The threshold: the third season of one group is the one worth saying out loud. */
export const REPEAT_SEASONS = 3

export const flaggedRepeats = (repeats: GroupRepeat[]) =>
  repeats.filter((r) => r.wouldBeSeason >= REPEAT_SEASONS && r.seasons.length > 0)

/** Which paper to put behind a repeat warning: the nearest one the library holds. */
export function repeatPaper(scheme: Scheme, groupCode: string): SprayPaper {
  if (scheme === 'fungicide' && groupCode === '7') return SPRAY_PAPERS.sdhiCrossResistance
  if (scheme === 'herbicide' && groupCode === '9') return SPRAY_PAPERS.downyBrome
  // Group 1, 2, 14 and 15 are the ones the Alberta wild oat work covers, and it
  // is the paper that says a new group is not a clean slate.
  if (scheme === 'herbicide' && ['1', '2', '8', '14', '15'].includes(groupCode)) {
    return SPRAY_PAPERS.triallateWildOat
  }
  return SPRAY_PAPERS.resistanceManagement
}

/** Two products, one group, one season. */
export type GroupOverlap = {
  scheme: Scheme
  groupCode: string
  groupName: string
  /** The active in the product about to go on. */
  active: string
  season: number
  /** What is already on the field this season in the same group. */
  already: { product: string; active: string; appliedOn: string }[]
}

/**
 * Another product of the same group already on this field this season.
 *
 * The warning the Michigan cherry work earns: boscalid, fluopyram and
 * fluxapyroxad are three actives a grower buys as Cotegra, Proline Gold and
 * Priaxor, and 26 per cent of the isolates surveyed were resistant to all
 * three at once. Two of them in one season is one group twice, whatever the
 * jugs say.
 *
 * Matched on the product, not the active: Proline Gold after Proline Gold is
 * the same product twice and the grower knows it. Delaro Complete after
 * Cotegra is the one worth a sentence.
 */
export function sameSeasonOverlap(
  passes: MoaPass[],
  opts: { fieldId: string; groups: ProductMoa[]; season: number; productId: string },
): GroupOverlap[] {
  const out: GroupOverlap[] = []
  for (const g of opts.groups) {
    const already = passes.filter(
      (p) =>
        p.field_id === opts.fieldId &&
        p.crop_season === opts.season &&
        p.scheme === g.scheme &&
        p.group_code === g.group_code &&
        p.product_id !== opts.productId,
    )
    if (!already.length) continue
    const byProduct = new Map<string, { product: string; active: string; appliedOn: string }>()
    for (const p of already) {
      const seen = byProduct.get(p.product_name)
      // The most recent pass of that product, and every active of it in this group.
      const active = seen && !seen.active.includes(p.active.toLowerCase()) ? `${seen.active} and ${p.active.toLowerCase()}` : (seen?.active ?? p.active.toLowerCase())
      const appliedOn = seen && seen.appliedOn > p.applied_on ? seen.appliedOn : p.applied_on
      byProduct.set(p.product_name, { product: p.product_name, active, appliedOn })
    }
    out.push({
      scheme: g.scheme,
      groupCode: g.group_code,
      groupName: g.group_name,
      active: g.active.toLowerCase(),
      season: opts.season,
      already: [...byProduct.values()].sort((a, b) => a.appliedOn.localeCompare(b.appliedOn)),
    })
  }
  return out
}

/** What the field's own soil does to a label's flat re-crop interval. */
export type PhWeighting = {
  /** The actives whose carryover the pH moves. */
  actives: string[]
  ph: number
  phMax: number | null
  omPct: number | null
  soilYear: number
  /** 'raised' from pH 7.5, 'high' from 8.0 — where the published concern sits. */
  level: 'raised' | 'high'
  /** Low organic matter leaves more of a weak acid in the soil solution. */
  lowOm: boolean
  paper: SprayPaper
}

/** pH at and above which the published metribuzin concern starts. */
export const PH_RAISED = 7.5
/** Where this farm's own ground mostly sits, and where the wording hardens. */
export const PH_HIGH = 8.0
/** Below this there is little organic matter holding a weak acid off the soil solution. */
export const LOW_OM_PCT = 2

/**
 * The re-crop interval, weighted by the field's own test.
 *
 * The label prints one number for every soil in Canada. For the weak acids —
 * metribuzin and the triazinones, the Group 2 ALS inhibitors, Group 14
 * sulfentrazone — that number is the average, and this farm is not on the
 * average: the topsoil reads 7.3 to 8.4 with 1.2 to 3.6 per cent organic
 * matter. Alkaline ground leaves more of a weak acid dissolved in the soil
 * solution instead of adsorbed, which is where a following crop's roots meet
 * it; low organic matter leaves less of it held.
 *
 * Silent below pH 7.5. A reassuring paragraph on a field that is fine is still
 * a paragraph.
 */
export function phWeighting(groups: ProductMoa[], soil: FieldSoil | undefined): PhWeighting | null {
  const sensitive = groups.filter((g) => g.ph_sensitive)
  if (!sensitive.length || !soil || soil.ph == null) return null
  const ph = Number(soil.ph)
  if (!Number.isFinite(ph) || ph < PH_RAISED) return null
  const codes = new Set(sensitive.map((g) => `${g.scheme}:${g.group_code}`))
  const paper = codes.has('herbicide:5')
    ? SPRAY_PAPERS.metribuzinPlantBack
    : codes.has('herbicide:2')
      ? SPRAY_PAPERS.chlorsulfuronInjury
      : SPRAY_PAPERS.sugarBeetBioassay
  const om = soil.om_pct == null ? null : Number(soil.om_pct)
  return {
    actives: sensitive.map((g) => g.active.toLowerCase()),
    ph,
    phMax: soil.ph_max == null ? null : Number(soil.ph_max),
    omPct: om,
    soilYear: soil.crop_year,
    level: ph >= PH_HIGH ? 'high' : 'raised',
    lowOm: om != null && om < LOW_OM_PCT,
    paper,
  }
}

/** The note for an active where the hour of the day changes the outcome. */
export type TimeOfDayNote = { active: string; text: string; paper: SprayPaper }

/**
 * Time of day, for the products where it is measured rather than believed.
 *
 * Only glufosinate, and only because the library holds the numbers. Plenty of
 * products are said to work better in the heat; a sentence here would read as
 * the same kind of fact as the glufosinate one, and it would not be.
 */
export function timeOfDayNotes(groups: ProductMoa[]): TimeOfDayNote[] {
  const out = new Map<string, TimeOfDayNote>()
  for (const g of groups) {
    if (!g.time_of_day) continue
    out.set(g.active, { active: g.active.toLowerCase(), text: g.time_of_day, paper: SPRAY_PAPERS.glufosinateTimeOfDay })
  }
  return [...out.values()]
}

/** "2024 and 2025", "2024, 2025 and 2026" — years as a sentence reads them. */
export function listYears(years: number[]): string {
  if (!years.length) return ''
  if (years.length === 1) return String(years[0])
  return `${years.slice(0, -1).join(', ')} and ${years[years.length - 1]}`
}

/** The same, for product names. */
export function listNames(names: string[]): string {
  if (!names.length) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The group name for a sentence that already has brackets round it.
 *
 * chemical_moa.group_name carries the chemical family in brackets — "SDHI
 * (succinate dehydrogenase inhibitor)", "ALS inhibitor (sulfonylurea)" —
 * which is the right thing to store and the wrong thing to drop inside
 * another pair of brackets: "Group 7 (SDHI (succinate dehydrogenase
 * inhibitor))". On the one visible line the acronym is enough; the family
 * belongs in the detail behind it.
 */
export function shortGroupName(name: string): string {
  return name.split(' (')[0]
}

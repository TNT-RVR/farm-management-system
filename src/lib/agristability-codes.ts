/**
 * The farm's crops and cattle mapped to the codes on AgriStability's forms,
 * in one place, so the prefilled form (lib/reports/agristability-form.ts)
 * never guesses a code inline.
 *
 * Sources (read October 2026):
 *   - Commodity codes: CRA guide RC4060, "Commodity list" (2025 program year,
 *     page updated 16 April 2026) — the guide for Alberta, Saskatchewan,
 *     Ontario and PEI, and the codes T1163 Statement A asks for:
 *     https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4060/rc4060-10.html
 *   - Program payment codes (401 AgriInsurance, 407 private hail):
 *     https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4060/rc4060-11.html
 *   - Code 586, pasture-related feed costs, allowable from the 2026 program
 *     year: AFSC 2026 AgriStability Supplementary Forms, page 2
 *     https://afsc.ca/wp-content/uploads/2026/03/2026-AgriStability-Supplementary-Forms.pdf
 *   - Schedule 2 and 3 lines and the feed-eligible list: AFSC 2026
 *     AgriStability Supplementary Forms Guide, pages 7–10
 *     https://afsc.ca/wp-content/uploads/2026/03/2026-AgriStability-Supplementary-Forms-Guide.pdf
 *
 * Crops are matched by name (crop names are the farm's to edit), most
 * particular first: "Silage Corn" before "Corn", "Alfalfa Seed" before
 * "Alfalfa". A crop that matches nothing has no code and the form says
 * "code needed". `confirm` marks a mapping the accountant should check.
 */

export const COMMODITY_LIST_URL = 'https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4060/rc4060-10.html'

/** Where a crop goes on AFSC's crop inventory worksheet (Schedule 2). */
export type Schedule2Kind = 'grain' | 'hay' | 'straw' | 'greenfeed' | 'silage' | 'other'

export type CropCode = {
  code: string
  /** The commodity as the list names it. */
  commodity: string
  kind: Schedule2Kind
  /** On AFSC's list of feed-eligible commodities (the "expected end use is feed" box). */
  feedEligible: boolean
  /** Why the accountant should check this one. */
  confirm?: string
}

type Rule = { match: RegExp } & CropCode

const c = (match: RegExp, code: string, commodity: string, kind: Schedule2Kind, feedEligible: boolean, confirm?: string): Rule => ({ match, code, commodity, kind, feedEligible, confirm })

const RULES: Rule[] = [
  // Silage and greenfeed first: "Silage Corn" and "Durum Silage" are not grain.
  c(/silage/i, '039', 'Grain (pellets, screenings, silage)', 'silage', true, 'Cereal and corn silage under 039; forage (alfalfa) silage is 264.'),
  c(/green\s*feed/i, '264', 'Forage (including pellets, silage)', 'greenfeed', true, 'Greenfeed is not named on the list: 264 forage, or 039 if Kyle treats it as cereal.'),
  c(/straw/i, '267', 'Straw', 'straw', true),
  // Seed crops before the crop they are named for.
  c(/alfalfa\s*seed|rye\s*grass\s*seed|grass\s*seed|fescue|timothy\s*seed/i, '015', 'Forage seed', 'other', false, 'Seed production: AFSC wants a fair market value for specialty seed.'),
  c(/canola/i, '010', 'Canola', 'grain', false),
  c(/durum|wheat/i, '056', 'Wheat', 'grain', true),
  c(/barley/i, '003', 'Barley', 'grain', true),
  c(/oats?\b/i, '045', 'Oats', 'grain', true),
  c(/triticale/i, '055', 'Triticale', 'grain', true),
  c(/\brye\b/i, '049', 'Rye', 'grain', true),
  c(/mixed\s*grain/i, '024', 'Mixed grain', 'grain', true),
  c(/sweet\s*corn/i, '203', 'Sweet corn', 'other', false),
  c(/corn/i, '011', 'Corn', 'grain', true),
  c(/faba/i, '012', 'Faba beans', 'grain', true),
  c(/pea/i, '013', 'Field peas', 'grain', true),
  c(/soy/i, '053', 'Soybeans', 'grain', true),
  c(/bean/i, '004', 'Beans (dry edible)', 'grain', false),
  c(/lentil/i, '041', 'Lentils', 'grain', false),
  c(/flax/i, '014', 'Flaxseed', 'grain', false),
  c(/mustard/i, '044', 'Mustard seed', 'grain', false),
  c(/sunflower/i, '054', 'Sunflowers', 'grain', false),
  c(/quinoa/i, '047', 'Quinoa', 'grain', false),
  c(/hemp/i, '030', 'Hemp', 'grain', false),
  c(/sugar\s*beet/i, '268', 'Sugar beets (including molasses)', 'other', false),
  c(/potato/i, '147', 'Potatoes and by-products', 'other', false),
  c(/carrot/i, '169', 'Carrots', 'other', false),
  c(/spinach/i, '201', 'Spinach', 'other', false, 'Spinach seed is grown for a seed company: check the code with AFSC.'),
  c(/alfalfa|grass|hay|sainfoin|clover/i, '264', 'Forage (including pellets, silage)', 'hay', true),
]

/** The code for a crop by its name; null when the list has nothing that fits. */
export function cropCode(name: string | null | undefined): CropCode | null {
  if (!name) return null
  const r = RULES.find((x) => x.match.test(name))
  if (!r) return null
  return { code: r.code, commodity: r.commodity, kind: r.kind, feedEligible: r.feedEligible, ...(r.confirm ? { confirm: r.confirm } : {}) }
}

/** Summerfallow is its own line on Schedule 2, not a commodity. */
export const isFallow = (crop: { name: string; yield_unit?: string | null }) => crop.yield_unit === 'ac' || /fallow/i.test(crop.name)

/* ── Cattle ─────────────────────────────────────────────────────────────── */

/** Statement A codes for cattle (RC4060 commodity list). */
export const CATTLE_CODES = {
  cowsBulls: { code: '706', commodity: 'Cattle, cows and bulls' },
  calves: { code: '719', commodity: 'Cattle, calves' },
  fat: { code: '720', commodity: 'Cattle, fat/slaughter' },
  feeder: { code: '721', commodity: 'Cattle, feeder' },
  purebred: { code: '722', commodity: 'Cattle, purebred breeding' },
} as const

/**
 * What a cattle sale is on Statement A. The farm sells its own calves —
 * heifers, steers, bull calves sold uncut, runts — weaned or backgrounded,
 * so all are calves (719); a calf backgrounded well past weaning weights
 * may be feeder cattle (721).
 */
export function cattleSaleCode(animalClass: string | null | undefined): { code: string; commodity: string; confirm?: string } {
  const k = (animalClass ?? '').toLowerCase()
  if (/cow|cull/.test(k)) return CATTLE_CODES.cowsBulls
  if (/fat|slaughter/.test(k)) return CATTLE_CODES.fat
  if (/feeder/.test(k)) return CATTLE_CODES.feeder
  return { ...CATTLE_CODES.calves, confirm: 'Calves (719); backgrounded cattle sold heavy may be feeders (721).' }
}

/** The cattle lines on AFSC's livestock inventory worksheet (Schedule 3), in its order, with the Statement A code. */
export const SCHEDULE3_CATTLE = [
  { key: 'bulls', line: 'Breeding bulls', code: '706' },
  { key: 'cows', line: 'Bred cows', code: '706' },
  { key: 'bredHeifers', line: 'Bred heifers', code: '706' },
  { key: 'openCows', line: 'Open cows / culls', code: '706' },
  { key: 'calves', line: 'Calves homeraised', code: '719' },
  { key: 'purchasedCalves', line: 'Purchased calves', code: '719' },
  { key: 'feeders', line: 'Feeder cattle', code: '721' },
  { key: 'fats', line: 'Fat cattle', code: '720' },
] as const

export type Schedule3Key = (typeof SCHEDULE3_CATTLE)[number]['key']

/**
 * The Schedule 3 line a herd class goes on, by the feed class the winter
 * feeding model gives it (herd_counts.feed_class), else by its name.
 */
export function schedule3Line(h: { class_name: string; feed_class?: string | null }): { key: Schedule3Key; confirm?: string } {
  const f = h.feed_class ?? ''
  const n = h.class_name.toLowerCase()
  if (f === 'bull' || /bull/.test(n)) return { key: 'bulls' }
  if (f === 'bred_heifer' || /heifer/.test(n))
    return /replacement/.test(n)
      ? { key: 'bredHeifers', confirm: 'Replacement heifers not yet bred go on their own line.' }
      : { key: 'bredHeifers' }
  // Yearlings are growing cattle on the feed model's backgrounder class, but a year past being calves.
  if (/yearling|feeder/.test(n)) return { key: 'feeders', confirm: 'Yearlings kept a season past weaning go on Feeder cattle.' }
  if (f === 'heifer_calf' || f === 'backgrounder' || /calf|calves|steer/.test(n)) return { key: 'calves', confirm: 'Home-raised calves; on feed past weaning weights they may be feeder cattle.' }
  if (/open|cull/.test(n)) return { key: 'openCows' }
  return { key: 'cows', confirm: 'Open cows from the preg check go on "Open cows / culls".' }
}

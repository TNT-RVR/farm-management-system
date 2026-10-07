/**
 * Matching the crop in the field to the crop on a pesticide LABEL.
 *
 * Deliberately separate from cropMatch.ts, which compares Deere's crop against
 * the crop we planned. That one shares a token and calls it a match, and it is
 * right to: a false mismatch there sends somebody to look at a field that was
 * fine. Here a false match puts one crop's safety interval on another, so the
 * two jobs cannot share a matcher. cropMatch would call "Sweet Corn" a match
 * for CORN_WET, which is exactly the answer this file must never give.
 *
 * John Deere records a crop as `CORN_WET` or `POTATOES_FOR_RETAIL`. PMRA labels
 * say "Corn", "Potatoes", "Sweet Corn", "durum wheat". Deciding whether those
 * are the same crop is what lets a per-crop re-entry interval be used at all.
 *
 * The whole file is built around one asymmetry. A MISSED match costs a longer
 * warning than necessary, because the caller falls back to the whole-label
 * interval. A WRONG match puts one crop's interval on another, which is how a
 * field gets cleared early. So this matches only what it can name, and returns
 * false for everything else — an explicit list, not a similarity score.
 *
 * The trap worth stating outright: SWEET CORN IS NOT FIELD CORN. Labels
 * routinely give sweet corn a twenty-day hand-harvest interval and field corn
 * twenty-four hours. `CORN_WET` is silage corn. A fuzzy matcher that saw "corn"
 * in both would reintroduce exactly the false alarm this was built to remove —
 * or worse, the reverse.
 */

/** Punctuation, case, and Deere's underscores gone. */
export function normaliseCrop(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * What each crop this farm actually grows is called on a label.
 *
 * Keyed by the Deere crop code. The values are normalised label crop names, and
 * a label row matches only if its name normalises to one of them, or begins
 * with one followed by a qualifier ("potatoes seed" matches "potatoes").
 *
 * Adding a crop here is how the per-crop interval starts being used for it.
 * Leaving one out is safe — it simply keeps using the whole-label figure.
 */
const ALIASES: Record<string, string[]> = {
  CANOLA: ['canola', 'canola rapeseed', 'rapeseed'],
  BARLEY: ['barley', 'spring barley'],
  WHEAT_DURUM: ['durum wheat', 'wheat durum', 'durum', 'wheat'],
  WHEAT_SPRING: ['spring wheat', 'wheat spring', 'wheat'],
  // Deere's EDIBLE_BEANS is dry beans. Labels name them several ways, all of
  // which mean the same pulse — and none of which is soybeans.
  EDIBLE_BEANS: [
    'dry common beans',
    'dry beans',
    'common beans',
    'edible beans',
    'field beans',
    'beans',
  ],
  // Silage corn. Deliberately NOT 'sweet corn' or 'seed corn' — those carry
  // hand-labour intervals many times longer and are different crops.
  CORN_WET: ['corn', 'field corn', 'grain corn', 'silage corn', 'corn field'],
  POTATOES_FOR_RETAIL: ['potatoes', 'potato'],
  CARROTS: ['carrots', 'carrot'],
  ALFALFA: ['alfalfa', 'seedling alfalfa'],
  GRASS_SEEDS: ['grass grown for seed', 'grass seed'],
  SUGAR_BEETS: ['sugar beets', 'sugarbeets', 'sugar beet'],
}

/**
 * Names that must never be reached by a loose match, whatever the crop code.
 *
 * Each of these is a distinct crop whose label interval is typically far longer
 * than its field-crop namesake, so matching one by accident is the expensive
 * kind of mistake. They match only when a crop code lists them explicitly.
 */
const NEVER_LOOSE = ['sweet corn', 'seed corn', 'popcorn', 'corn sweet', 'corn seed']

/**
 * Is this label row about the crop growing in the field?
 *
 * False whenever it cannot be established — an unknown crop code, an
 * unrecognised label name, or anything on the never-loose list that was not
 * asked for by name.
 */
export function cropMatches(deereCrop: string | null | undefined, labelCrop: string): boolean {
  if (!deereCrop) return false
  const code = deereCrop.trim().toUpperCase()
  const aliases = ALIASES[code]
  if (!aliases) return false

  const label = normaliseCrop(labelCrop)
  if (!label) return false

  // Explicitly asked for wins, even over the never-loose list.
  if (aliases.includes(label)) return true
  if (NEVER_LOOSE.includes(label)) return false

  // A qualifier after a full alias is still that crop: "potatoes seed potato
  // production" is potatoes. The alias must end on a word boundary so that
  // "corn" never matches "cornflower".
  return aliases.some((a) => label === a || label.startsWith(a + ' '))
}

/**
 * The label rows that are about this field's crop, in the order given.
 *
 * Empty means no row could be matched, which the caller must treat as "use the
 * whole-label interval", never as "no restriction".
 */
export function rowsForCrop<T extends { crop: string }>(
  deereCrop: string | null | undefined,
  rows: T[],
): T[] {
  return rows.filter((r) => cropMatches(deereCrop, r.crop))
}

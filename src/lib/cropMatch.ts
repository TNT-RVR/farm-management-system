// Reconciling Deere's crop names against ours.
//
// Deere records CORN_WET, WHEAT_DURUM, EDIBLE_BEANS, POTATOES_FOR_RETAIL. We
// call those Corn (or Vandermeer Corn), Durum Wheat, Beans-Pinto / Beans-Yellow /
// Beans-Great Northern, and Potato. Nothing matches on a string compare.
//
// The point of this comparison is to flag a field that got planted to something
// other than the plan. A FALSE mismatch is worse than no flag at all — it sends
// you out to check a field that was fine — so anything ambiguous resolves in
// favour of the plan rather than against it.

/** Deere qualifiers that say how a crop was handled, not what it was. */
const QUALIFIERS = new Set([
  'wet',
  'dry',
  'for',
  'retail',
  'seeds',
  'seed',
  'edible',
  'irrigated',
  'processing',
])

/** Crude singularisation — enough for potatoes/potato, beans/bean, carrots/carrot. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('oes')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/** The meaningful words in a crop name, stemmed and lowercased. */
export function cropTokens(name: string): Set<string> {
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stem)
    .filter((w) => w.length > 1 && !QUALIFIERS.has(w))
  return new Set(words)
}

export type CropVerdict = 'match' | 'mismatch' | 'unknown'

/**
 * Does the crop Deere reports agree with the crop we planned?
 *
 * `candidates` is every crop name we know, so an ambiguous Deere name can be
 * recognised as ambiguous instead of being forced onto one answer.
 */
export function compareCrop(
  deereCrop: string | null | undefined,
  plannedCrop: string | null | undefined,
  candidates: string[],
): CropVerdict {
  if (!deereCrop || !plannedCrop) return 'unknown'

  const deere = cropTokens(deereCrop)
  const planned = cropTokens(plannedCrop)
  if (deere.size === 0 || planned.size === 0) return 'unknown'

  // The plan's own name shares a meaningful word with Deere's — good enough.
  for (const t of planned) if (deere.has(t)) return 'match'

  // No shared word. Before calling it a mismatch, check that Deere's name maps
  // onto anything we grow at all: if it matches nothing, our crop list is just
  // missing a name and that is not evidence the field was planted wrong.
  const matchesSomething = candidates.some((c) => {
    const tokens = cropTokens(c)
    for (const t of tokens) if (deere.has(t)) return true
    return false
  })
  return matchesSomething ? 'mismatch' : 'unknown'
}

/** A readable version of Deere's SHOUTING_SNAKE_CASE. */
export const prettyCrop = (v: string) =>
  v
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())

/**
 * What the farm already knows about a line on a manifest.
 *
 * A manifest line asks for the class, the sex, the colour, an average weight
 * and the brand. Four of those five are the same every time for a given ranch
 * and class, and were being typed out by hand on every load (Sam,
 * 6 Nov 2026). The class is the one real choice; the rest follow from it and
 * from settings, and anything typed over the top of them is left alone.
 */

/** A herd class as the Cattle settings keep it. */
export type HerdClass = { class_name: string; avg_weight_lb?: number | string | null }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/** The classes a manifest line can be. */
export const MANIFEST_CLASSES = ['steers', 'heifers', 'cows', 'bulls', 'calves', 'yearlings'] as const

/**
 * The manifest's word for what the herd list calls a class.
 *
 * "Replacement heifers" is heifers on a manifest. Filling the lines from the
 * herd counts used the ranch's own name as the class, which left the dropdown
 * showing nothing and the sex unfilled, because neither matched the six
 * choices. An unrecognised name is passed through rather than dropped — a
 * ranch may keep something this list has never heard of.
 */
export function classForHerdName(name: string | null | undefined): string {
  const n = norm(name)
  if (!n) return ''
  return (
    MANIFEST_CLASSES.find((c) => n === c) ??
    MANIFEST_CLASSES.find((c) => n.split(/\s+/).includes(c)) ??
    MANIFEST_CLASSES.find((c) => n.includes(c)) ??
    n
  )
}

/**
 * The sex a class states outright.
 *
 * Calves and yearlings are deliberately absent: a load of either is usually
 * mixed, and guessing "Steer" on paperwork a brand inspector reads would be
 * worse than leaving the box for someone who knows what went on the truck.
 */
export const CLASS_SEX: Record<string, string> = {
  steers: 'Steer',
  heifers: 'Heifer',
  cows: 'Cow',
  bulls: 'Bull',
}

export function sexForClass(animalClass: string | null | undefined): string {
  return CLASS_SEX[norm(animalClass)] ?? ''
}

/**
 * The average weight the Cattle settings hold for this class on this ranch.
 *
 * The settings call a class what the ranch calls it — "Replacement heifers",
 * not "heifers" — so an exact match is tried first and a containing one after,
 * which is what ties the manifest's six choices to whatever the herd list is
 * actually called. No match is no answer, not a guess: Home Ranch keeps no
 * steers, so a steer line gets an empty box.
 */
export function weightForClass(
  herd: HerdClass[] | null | undefined,
  animalClass: string | null | undefined,
): string {
  const want = norm(animalClass)
  if (!want || !herd?.length) return ''
  const rows = herd.filter((h) => h.avg_weight_lb != null && Number(h.avg_weight_lb) > 0)
  const hit =
    rows.find((h) => norm(h.class_name) === want) ??
    rows.find((h) => norm(h.class_name).split(/\s+/).includes(want)) ??
    rows.find((h) => norm(h.class_name).includes(want))
  return hit ? String(Math.round(Number(hit.avg_weight_lb))) : ''
}

/** What a line should hold once a class is chosen, before anything typed. */
export type LineFill = { sex: string; colour: string; avg_weight_lb: string; brand: string }

export function fillForClass(
  animalClass: string | null | undefined,
  { herd, colour, brand }: { herd?: HerdClass[] | null; colour?: string | null; brand?: string | null },
): LineFill {
  return {
    sex: sexForClass(animalClass),
    colour: (colour ?? '').trim(),
    avg_weight_lb: weightForClass(herd, animalClass),
    brand: (brand ?? '').trim(),
  }
}

/**
 * Keep what was typed, replace what was filled.
 *
 * Changing a line from cows to bulls has to move the sex with it, or the
 * manifest says "Bull" head of sex "Cow". But a weight somebody corrected at
 * the scale must survive the same change. The test is whether the box still
 * holds exactly what the previous class put there: if it does it was ours to
 * replace, and if it does not it was theirs to keep.
 */
export function refill(current: string | undefined, was: string, next: string): string {
  const now = (current ?? '').trim()
  return now === '' || now === was ? next : now
}

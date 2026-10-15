/**
 * Which herbicide a canola is bred to survive, and what that means for the
 * canola that follows it on the same field.
 *
 * Seed canola is grown here under contract for BASF, Corteva and Nutrien, and
 * Sam (2 Oct 2026): "Liberty versus Roundup resistance plays a role in what
 * fields can be used by which companies." A canola is either LibertyLink
 * (survives glufosinate — Liberty) or Roundup Ready (survives glyphosate —
 * Roundup). The trait is set on the crop (Crops → the crop → Crop details);
 * a company whose trait nobody has confirmed is left unset rather than guessed.
 *
 * THE RULE. Canola sheds seed that comes back as volunteers for years. In a
 * seed crop a volunteer is an off-type, and the grower's tool for taking
 * volunteers out is the crop's own herbicide. A volunteer of the OTHER trait
 * dies to that spray; a volunteer of the SAME trait shrugs it off and stays in
 * the seed crop. So a canola planned on a field that grew a canola of the same
 * trait within VOLUNTEER_WINDOW_YEARS is flagged. It is a warning, never a
 * block: the contract decides, and the field may well be clean.
 */

export type HerbicideTrait = 'liberty' | 'roundup'

export const TRAITS: HerbicideTrait[] = ['liberty', 'roundup']

/** Short name, for badges and messages. */
export const TRAIT_SHORT: Record<HerbicideTrait, string> = { liberty: 'Liberty', roundup: 'Roundup' }

/** The full name, for the crop's settings. */
export const TRAIT_LABEL: Record<HerbicideTrait, string> = {
  liberty: 'Liberty — LibertyLink, survives glufosinate',
  roundup: 'Roundup — Roundup Ready, survives glyphosate',
}

/**
 * How many years back a canola's volunteers are counted against the canola
 * planned now. The seed canola crops already need four clear years between
 * canola crops (their return interval), so inside four years the field is
 * blocked anyway; canola seed can lie in the soil longer than that, and this
 * covers the tail. Six is a cautious working figure, not a contract's number —
 * change it here when the companies' field rules say otherwise.
 */
export const VOLUNTEER_WINDOW_YEARS = 6

/**
 * A company that contracts both trait families (Corteva; Nutrien likely too —
 * Sam, 3 Oct 2026; BASF is Liberty only) has its trait set to 'both': the
 * trait is the year's hybrid's. asTrait reads it as no trait, so a volunteer
 * warning is never guessed for it.
 */
export const BOTH_TRAITS = 'both'
export type TraitSetting = HerbicideTrait | typeof BOTH_TRAITS

export const isBothTraits = (v: unknown) => v === BOTH_TRAITS

export function asTrait(v: unknown): HerbicideTrait | null {
  return v === 'liberty' || v === 'roundup' ? v : null
}

export const isCanola = (name: string | null | undefined) => /canola/i.test(name ?? '')

export type TraitCrop = { id: string; name: string; herbicide_trait?: string | null }

/**
 * The trait of a canola that was grown: the crop's own, else — for the
 * retired plain "Canola", whose history says the company only in its variety
 * ("Specialty - BASF") — the trait of that company's canola crop. Null when
 * neither says, so an unknown past canola is never given a trait it may not
 * have had.
 */
export function grownTrait(
  crop: TraitCrop | undefined,
  company: string | null | undefined,
  crops: TraitCrop[],
): { trait: HerbicideTrait; from: string } | null {
  if (!crop || !isCanola(crop.name)) return null
  const own = asTrait(crop.herbicide_trait)
  if (own) return { trait: own, from: crop.name }
  const c = company?.trim().toLowerCase()
  if (!c) return null
  const same = crops.find((x) => x.id !== crop.id && isCanola(x.name) && x.name.toLowerCase().startsWith(c) && asTrait(x.herbicide_trait))
  return same ? { trait: asTrait(same.herbicide_trait)!, from: same.name } : null
}

/** One canola crop on the field's record, with the trait it carried. */
export type CanolaYear = { year: number; crop: string; trait: HerbicideTrait }

/**
 * Warnings for planting `planned` in `year` on a field whose canola record is
 * `past`: one per earlier year inside the window that grew a canola of the
 * same trait. A planned canola with no trait (company not chosen, or not set)
 * raises nothing.
 */
export function volunteerConflicts(
  planned: { name: string; trait: HerbicideTrait | null },
  year: number,
  past: CanolaYear[],
): string[] {
  if (!planned.trait) return []
  const seen = new Set<number>()
  const out: string[] = []
  const hits = past
    .filter((p) => p.year < year && p.year >= year - VOLUNTEER_WINDOW_YEARS && p.trait === planned.trait)
    .sort((a, b) => b.year - a.year)
  for (const p of hits) {
    if (seen.has(p.year)) continue
    seen.add(p.year)
    const t = TRAIT_SHORT[p.trait]
    out.push(
      `${p.crop} (${t}) was here in ${p.year}: its volunteers survive ${t}, the spray ${planned.name} relies on to clear them — check the company will take this field`,
    )
  }
  return out
}

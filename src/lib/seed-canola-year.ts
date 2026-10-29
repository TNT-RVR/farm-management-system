import { asTrait, isCanola, type HerbicideTrait } from './canola-trait'

/**
 * A year's seed canola in the words a seed company uses (Sam, 8 Oct 2026:
 * "what company/variety for example Corteva Round Up or Corteva Liberty
 * Link"): the contract company and the herbicide system — "Corteva Roundup
 * Ready", "BASF LibertyLink".
 *
 * Every canola on this farm is grown for seed (its crops are in the seed
 * category). The company is the variety's (crop_varieties: "Specialty -
 * Corteva" → Corteva) or the crop's own name ("BASF Canola"); the trait is
 * the year's record where one was set (Corteva and Nutrien contract both, so
 * only the year knows), else the crop's, else the trait of that company's
 * own canola crop when it has one (BASF is always Liberty).
 */

export const TRAIT_SYSTEM: Record<HerbicideTrait, string> = { liberty: 'LibertyLink', roundup: 'Roundup Ready', clearfield: 'Clearfield', conventional: 'Conventional' }

export type CanolaCropLike = { id: string; name: string; herbicide_trait: string | null; category?: string | null }

export type SeedCanola = { company: string | null; trait: HerbicideTrait | null; label: string }

/** The company in a crop's own name: "Corteva Canola" → Corteva; plain "Canola" and "Seed Canola" have none. */
function companyInName(name: string): string | null {
  const prefix = name.replace(/\(.*\)/g, '').replace(/canola/i, '').replace(/\bseed\b/i, '').trim()
  return prefix && !/^unknown$/i.test(prefix) ? prefix : null
}

/** The company in a variety written as "Specialty - BASF". */
function companyInVariety(variety: string | null | undefined): string | null {
  const m = /specialty\s*[-–—:]\s*(.+)$/i.exec(variety?.trim() ?? '')
  return m ? m[1].trim() : null
}

export function seedCanolaYear(o: {
  crop: CanolaCropLike | undefined
  variety: string | null | undefined
  /** The year's own trait (crop_history / crop_plans.herbicide_trait). */
  yearTrait: string | null | undefined
  crops: CanolaCropLike[]
  companyOf: (cropId: string, variety: string | null) => string | null
}): SeedCanola | null {
  const c = o.crop
  if (!c || !isCanola(c.name)) return null
  const company = o.companyOf(c.id, o.variety ?? null) ?? companyInName(c.name) ?? companyInVariety(o.variety)
  const sameCompany = company ? o.crops.find((x) => isCanola(x.name) && companyInName(x.name)?.toLowerCase() === company.toLowerCase()) : undefined
  const trait = asTrait(o.yearTrait) ?? asTrait(c.herbicide_trait) ?? asTrait(sameCompany?.herbicide_trait)
  const system = trait ? TRAIT_SYSTEM[trait] : null
  const label = company ? `${company} ${system ?? '(trait not recorded)'}` : system ? `Seed canola ${system} (company not recorded)` : 'Seed canola (company and trait not recorded)'
  return { company, trait, label }
}

/** The newest canola year in a field's record. */
export function lastSeedCanola<T extends { year: number; canola: SeedCanola | null }>(years: T[]): T | null {
  return years.filter((y) => y.canola).sort((a, b) => b.year - a.year)[0] ?? null
}

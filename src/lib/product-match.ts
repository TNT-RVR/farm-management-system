/**
 * Finding the product a price already exists for.
 *
 * The price book fills itself from two directions — names typed into Operations
 * Center by whoever was spraying, and lines off supplier invoices — so the same
 * jug arrives as several products and only some of them ever get a price. The
 * unpriced copies are not harmless: a field costed against one of them shows
 * that spray as free.
 *
 * WHAT THIS WILL AND WILL NOT CLAIM. A wrong match writes a real price onto the
 * wrong chemical, and every field that product touched is then costed off it —
 * so a guess is worse than a blank, and this only proposes a match it can give
 * a reason for. Two reasons qualify:
 *
 *   The SAME HEALTH CANADA REGISTRATION. Two products carrying the same
 *   registration number are the same registered product; that is what the
 *   number is. This is not a heuristic and it is not scored.
 *
 *   The SAME NAME once packaging is stripped. "Authority 480 3.79L Jug" and
 *   "Authority 480" are one product written twice. Reusing the invoice
 *   normaliser rather than writing a second one, because a name the two
 *   disagree about is a bug that only shows up as a wrong price.
 *
 * Nothing fuzzier. Edit distance would pair Assure with Assert, and Titan with
 * Triton, which are different chemicals.
 *
 * NOTHING HERE WRITES. It proposes; a person applies. The units have to agree
 * as well as the names, because $/L copied onto a product sold by the kilogram
 * is a wrong number that looks entirely reasonable.
 */

import { normaliseProductName } from './ici-invoice'

/**
 * Trailing words that say what a product IS rather than which one it is.
 *
 * "Viper ADV Herbicide" and "Viper ADV 8.1L" are one product; the first was
 * typed off an invoice line and the second by whoever was spraying. Stripped
 * only from the END, and only as whole words — "Merge Adjuvant" is Merge, but
 * nothing here may touch a name that uses one of these words to distinguish
 * itself.
 *
 * Done here rather than in the shared invoice normaliser on purpose: that one
 * also decides which product an INVOICE LINE pays for, and loosening it would
 * change what gets priced, not just what gets suggested.
 */
const TYPE_WORDS =
  /\s+(herbicide|fungicide|insecticide|adjuvant|surfactant|desiccant|defoliant|miticide)$/

function matchKey(name: string): string {
  let key = normaliseProductName(name)
  let previous: string
  do {
    previous = key
    key = key.replace(TYPE_WORDS, '').trim()
  } while (key !== previous)
  return key
}

export type MatchableProduct = {
  id: string
  name: string
  unit: string
  price_per_unit: number | null
  price_updated_on?: string | null
  price_source?: string | null
  pmra_registration?: string | null
  category?: string | null
}

export type MatchReason = 'registration' | 'name'

export type ProductMatch<T extends MatchableProduct = MatchableProduct> = {
  /** The product with no price. */
  unpriced: T
  /** The product whose price it should share. */
  priced: T
  reason: MatchReason
  /**
   * True when the two are sold in different units, so the price cannot simply
   * be copied across. Still reported — they are the same product and somebody
   * should look — but it must not be one-click applied.
   */
  unitMismatch: boolean
}

/** Same registration means same registered product. Nothing to score. */
function byRegistration<T extends MatchableProduct>(unpriced: T, priced: T[]): T | undefined {
  const reg = unpriced.pmra_registration?.trim()
  if (!reg) return undefined
  return priced.find((p) => p.pmra_registration?.trim() === reg)
}

function byName<T extends MatchableProduct>(unpriced: T, priced: T[]): T | undefined {
  const key = matchKey(unpriced.name)
  // A name that normalises to nothing — a row that was only ever a pack size —
  // must not match every other empty name in the book.
  if (!key) return undefined
  return priced.find((p) => matchKey(p.name) === key)
}

/**
 * Every unpriced product that a priced one can account for.
 *
 * Within a category only: fertiliser and chemical share this table and a name
 * collision across them would be a different kind of product entirely.
 */
export function findPriceMatches<T extends MatchableProduct>(products: T[]): ProductMatch<T>[] {
  const out: ProductMatch<T>[] = []

  const categoryOf = (p: T) => p.category ?? 'chemical'
  const categories = new Set(products.map(categoryOf))

  for (const category of categories) {
    const inCategory = products.filter((p) => categoryOf(p) === category)
    const priced = inCategory.filter((p) => p.price_per_unit != null)
    const unpriced = inCategory.filter((p) => p.price_per_unit == null)
    if (!priced.length || !unpriced.length) continue

    for (const u of unpriced) {
      // Registration first: it is a fact about the product, where the name is
      // an observation about how somebody typed it.
      const reg = byRegistration(u, priced)
      const match = reg ?? byName(u, priced)
      if (!match) continue
      out.push({
        unpriced: u,
        priced: match,
        reason: reg ? 'registration' : 'name',
        unitMismatch: u.unit !== match.unit,
      })
    }
  }

  // Registration matches first — they are certain — then alphabetically, so the
  // list reads the same way twice running.
  return out.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === 'registration' ? -1 : 1
    return a.unpriced.name.localeCompare(b.unpriced.name)
  })
}

export const MATCH_REASON_LABEL: Record<MatchReason, string> = {
  registration: 'same registration',
  name: 'same name, different packaging',
}

/**
 * Folding the price book down to a list a person can read.
 *
 * Fertiliser is the problem this solves. ICI mixes a fresh blend for almost
 * every field every spring and names it after its analysis, so three years of
 * invoices leave thirty-odd products called "Tonne 28.2-10.8-4.3-4.3-0.4B-0.1Zn
 * Blend" — each genuinely a different product, and together an unreadable wall.
 *
 * A blend is a one-off recipe for one season. What anybody actually asks is
 * "what did blend cost that spring", so blends collapse by year and the
 * straights — urea, UAN, MAP, potash — stay as themselves, because those you do
 * compare year to year.
 */

/**
 * Is this a custom blend rather than a product bought under its own name?
 *
 * ICI's own suffix, which is as reliable a marker as exists here: they write
 * "Blend" on the mixed ones and not on the straights. A couple of blends turn
 * out to be a single nutrient once you read the analysis ("Tonne
 * 46.0-0.0-0.0-0.0 Blend" is urea), but they were still ordered as a blend and
 * priced as one, so they belong with their year.
 */
export function isBlend(name: string): boolean {
  return /\bblends?\b/i.test(name)
}

/** The year a price was set, for grouping blends by the season they were mixed for. */
export function priceYear(product: { price_updated_on?: string | null }): string | null {
  const iso = product.price_updated_on
  if (!iso) return null
  const year = iso.slice(0, 4)
  return /^\d{4}$/.test(year) ? year : null
}

export type Grouped<T> =
  | { kind: 'row'; key: string; item: T }
  | { kind: 'group'; key: string; label: string; items: T[] }

/**
 * Group the blends, leave everything else alone.
 *
 * Chemicals pass through untouched — "Liberty" is not one of a family and
 * hiding it inside a group would only add a click. Only the blends fold.
 */
export function groupProducts<T extends { name: string; price_updated_on?: string | null }>(
  items: T[],
  enabled: boolean,
): Grouped<T>[] {
  if (!enabled) return items.map((item) => ({ kind: 'row' as const, key: item.name, item }))

  const out: Grouped<T>[] = []
  const groups = new Map<string, T[]>()
  for (const item of items) {
    if (!isBlend(item.name)) {
      out.push({ kind: 'row', key: item.name, item })
      continue
    }
    const year = priceYear(item) ?? 'undated'
    const list = groups.get(year) ?? []
    list.push(item)
    groups.set(year, list)
  }
  // Newest season first. Group order would otherwise follow whichever blend
  // the sort happened to reach first, which is not an order at all.
  const years = [...groups.keys()].sort((a, b) => b.localeCompare(a))
  // A single blend in a year is not worth a group — it would be one row behind
  // a disclosure triangle, which is strictly worse than the row.
  for (const year of years) {
    const list = groups.get(year) as T[]
    if (list.length === 1) out.push({ kind: 'row', key: list[0].name, item: list[0] })
    else
      out.push({
        kind: 'group',
        key: `blend-${year}`,
        label: year === 'undated' ? 'Custom blends — no price yet' : `${year} custom blends`,
        items: list,
      })
  }
  return out
}

export type SortKey = 'name' | 'unit' | 'price' | 'priced_on' | 'applied' | 'fields'
export type SortDir = 'asc' | 'desc'

/** What one row of the pricing table sorts on. */
export type SortableRow = {
  name: string
  unit: string
  price: number | null
  pricedOn: string | null
  /** Most recent application, ISO. */
  lastApplied: string | null
  fieldCount: number
}

/**
 * Compare two rows on one column.
 *
 * Missing values sort last in BOTH directions rather than flipping to the top
 * on a descending sort. A screen of blanks above the data is never what anybody
 * meant by "sort by price".
 */
export function compareRows(a: SortableRow, b: SortableRow, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1
  const missing = (v: unknown) => v == null || v === ''

  const [av, bv] = ((): [string | number | null, string | number | null] => {
    switch (key) {
      case 'unit':
        return [a.unit, b.unit]
      case 'price':
        return [a.price, b.price]
      case 'priced_on':
        return [a.pricedOn, b.pricedOn]
      case 'applied':
        return [a.lastApplied, b.lastApplied]
      case 'fields':
        return [a.fieldCount || null, b.fieldCount || null]
      default:
        return [a.name.toLowerCase(), b.name.toLowerCase()]
    }
  })()

  if (missing(av) && missing(bv)) return a.name.localeCompare(b.name)
  if (missing(av)) return 1
  if (missing(bv)) return -1
  if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign || a.name.localeCompare(b.name)
  return String(av).localeCompare(String(bv)) * sign || a.name.localeCompare(b.name)
}

/**
 * The order the list opens in: priced first, then by name.
 *
 * The opposite of what it used to do. Unpriced first was built for the job of
 * filling the price book in; now that the invoices fill it, the list is read to
 * look a price up, and the rows worth reading are the ones that have one.
 */
export function defaultSort<T extends SortableRow>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      (a.price == null ? 1 : 0) - (b.price == null ? 1 : 0) || a.name.localeCompare(b.name),
  )
}

import { groupOf, type CropInfo } from './rotation-engine'

/**
 * Reading crop_acre_limits: the most of a crop to grow, and where it comes in
 * the recommender's running order.
 *
 * Pure and tested, because the rows have two shapes and a row of one shape
 * read as the other is silent. A row may now carry a rank and NO cap ("corn
 * last, however much of it"), and the first version of the running order read
 * that null cap as `Number(null)` — zero acres — which took corn out of every
 * plan without a word (13 Nov 2026). A null cap is "no limit", never "none".
 *
 * Precedence, the same for both settings: a crop's own row beats its group's,
 * and a year's own row beats the every-year one.
 */

export type LimitRow = {
  crop_id: string | null
  crop_group: string | null
  crop_year: number | null
  max_acres: number | string | null
  priority?: number | null
}

/** The row that applies, the year's own first. Null when none does. */
function applies(rows: LimitRow[], match: (l: LimitRow) => boolean, year: number): LimitRow | null {
  return rows.find((l) => match(l) && l.crop_year === year) ?? rows.find((l) => match(l) && l.crop_year == null) ?? null
}

/**
 * A crop's own acre cap for a year, or null for no cap.
 *
 * Only rows that actually set one count: a row carrying a rank alone must not
 * shadow the cap on the every-year row below it, and must never read as zero.
 */
export function maxAcresFor(rows: LimitRow[], cropId: string, year: number): number | null {
  const withCap = rows.filter((l) => l.max_acres != null)
  const row = applies(withCap, (l) => l.crop_id === cropId, year)
  return row ? Number(row.max_acres) : null
}

/** Combined caps by group (all beans together) for a year; groups with no cap are left out. */
export function groupMaxFor(rows: LimitRow[], year: number): Map<string, number> {
  const withCap = rows.filter((l) => l.crop_group && l.max_acres != null)
  const out = new Map<string, number>()
  for (const l of withCap.filter((x) => x.crop_year == null)) out.set(l.crop_group!, Number(l.max_acres))
  for (const l of withCap.filter((x) => x.crop_year === year)) out.set(l.crop_group!, Number(l.max_acres))
  return out
}

/**
 * Crop ids in the order they get the fields, first-ranked first.
 *
 * A crop's own rank wins over the rank on its group. Crops sharing a rank
 * (every potato kind under one group row) keep the order they are given, so
 * the list is stable between renders.
 */
export function priorityFor(rows: LimitRow[], crops: CropInfo[], year: number): string[] {
  const ranked = rows.filter((l) => l.priority != null)
  const out: { id: string; rank: number }[] = []
  for (const c of crops) {
    const own = applies(ranked, (l) => l.crop_id === c.id, year)
    const group = applies(ranked, (l) => l.crop_group === groupOf(c.key), year)
    const rank = own?.priority ?? group?.priority
    if (rank != null) out.push({ id: c.id, rank: Number(rank) })
  }
  return out.sort((a, b) => a.rank - b.rank).map((x) => x.id)
}

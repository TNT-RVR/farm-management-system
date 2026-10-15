/**
 * Baling into the feed supply: the pure parts, tested.
 *
 * A Baling record with a bale count puts those bales up in the feed supply
 * (migration 20261014030000: a trigger writes one feed_inventory entry per
 * record and keeps it in step). The form decides what the bales are and where
 * they go; these are the rules it uses.
 */

export type BaleType = 'round' | 'big_square'

export const BALE_TYPES: { value: BaleType; label: string }[] = [
  { value: 'round', label: 'Round' },
  { value: 'big_square', label: 'Big square' },
]

export const baleTypeLabel = (t: string | null | undefined) =>
  t === 'big_square' ? 'big square' : t === 'round' ? 'round' : 'bale'

/** The work type key that feeds the feed supply. */
export const BALING = 'baling'

/** The amount unit a bale count is saved in. */
export const BALES_UNIT = 'bales'

/** "1st", "2nd", "3rd", "4th". */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${s}`
}

/** The cut a feed name is for: "2nd Cut Alfalfa" → 2. Null when it names none. */
export function cutInName(name: string): number | null {
  const m = name.toLowerCase().match(/(\d)\s*(st|nd|rd|th)\s*cut/)
  if (m) return Number(m[1])
  const words: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 }
  const w = name.toLowerCase().match(/(first|second|third|fourth)\s+cut/)
  return w ? words[w[1]] : null
}

export type FeedTypeLite = {
  id: string
  name: string
  category: string
  default_unit: string
  default_lb_per_bale: number | null
  is_bedding: boolean
  archived?: boolean
}

/** Feeds that come in bales: hay, green feed, straw, baled silage, bedding. */
export function baleFeeds<T extends FeedTypeLite>(types: readonly T[]): T[] {
  return types.filter((t) => !t.archived && (t.is_bedding || ['hay', 'greenfeed', 'straw', 'silage'].includes(t.category)))
}

const has = (s: string, ...words: string[]) => words.some((w) => s.includes(w))

/** Crops whose bales are hay: the cut matters for these. */
export function isHayCrop(cropName: string | null | undefined): boolean {
  const c = (cropName ?? '').toLowerCase()
  if (!c || has(c, 'seed')) return false
  return has(c, 'alfalfa', 'sainfoin', 'grass', 'fescue', 'timothy', 'brome', 'clover', 'hay')
}

export type FeedGuess = {
  /** The feed to put in the box; null when it should be asked. */
  id: string | null
  /** True when the crop says it plainly; false asks the person to pick. */
  sure: boolean
  /** The feeds it could be, likeliest first, for the picker to lead with. */
  likely: string[]
  /** Why it is asking, in a few words. */
  ask?: string
}

/**
 * What a baled crop goes into the feed supply as, from the farm's own feed
 * list. Hay crops are plain: alfalfa (by cut, else by bale size), sainfoin,
 * grass. Green feed is plain. A cereal is not: baled after the combine it is
 * straw, baled green it is green feed, wrapped it is silage, so it asks.
 */
export function suggestFeedType(
  cropName: string | null | undefined,
  cut: number | null | undefined,
  baleType: BaleType | null | undefined,
  types: readonly FeedTypeLite[],
): FeedGuess {
  const feeds = baleFeeds(types)
  const c = (cropName ?? '').toLowerCase().trim()
  const named = (pred: (n: string, t: FeedTypeLite) => boolean) => feeds.filter((t) => pred(t.name.toLowerCase(), t))
  const plain = (list: FeedTypeLite[], ask: string): FeedGuess =>
    list.length === 1 ? { id: list[0].id, sure: true, likely: [list[0].id] } : { id: null, sure: false, likely: list.map((t) => t.id), ask }

  if (!c) return { id: null, sure: false, likely: [], ask: 'No crop on this field for the year' }

  if (has(c, 'alfalfa') && !has(c, 'seed')) {
    const alf = named((n, t) => t.category === 'hay' && n.includes('alfalfa') && !n.includes('grass'))
    if (cut) {
      const byCut = alf.filter((t) => cutInName(t.name) === cut)
      if (byCut.length === 1) return { id: byCut[0].id, sure: true, likely: [byCut[0].id] }
    }
    // No cut in the name: one feed for this bale size ("Alfalfa big squares").
    const bySize = alf.filter((t) => cutInName(t.name) == null && t.default_unit === (baleType ?? 'round'))
    if (bySize.length === 1 && !cut) return { id: bySize[0].id, sure: true, likely: [bySize[0].id] }
    const order = [...alf].sort((a, b) => Number(cutInName(b.name) === cut) - Number(cutInName(a.name) === cut))
    return { id: null, sure: false, likely: order.map((t) => t.id), ask: cut ? 'Which alfalfa feed is this?' : 'Which cut is it?' }
  }

  if (has(c, 'sainfoin')) return plain(named((n, t) => t.category === 'hay' && n.includes('sainfoin')), 'Which sainfoin feed is this?')

  if (has(c, 'grass', 'fescue', 'timothy', 'brome')) {
    const grass = named((n, t) => t.category === 'hay' && n.includes('grass'))
    const pure = grass.filter((t) => !t.name.toLowerCase().includes('alfalfa'))
    if (pure.length === 1) return { id: pure[0].id, sure: true, likely: [pure[0].id] }
    return { id: null, sure: false, likely: grass.map((t) => t.id), ask: 'Grass or a grass mix?' }
  }

  if (has(c, 'green feed', 'greenfeed')) return plain(named((_, t) => t.category === 'greenfeed'), 'Which green feed is this?')

  // A cereal or anything else: straw after the combine, green feed if cut
  // green, silage if wrapped. Straw that names the crop first, then the rest.
  const word = c.split(/[\s-]+/)[0]
  const straw = named((_, t) => t.category === 'straw')
  const strawOfCrop = straw.filter((t) => t.name.toLowerCase().includes(word) && !t.is_bedding)
  const otherStraw = straw.filter((t) => !strawOfCrop.includes(t))
  const green = named((_, t) => t.category === 'greenfeed')
  const silage = named((_, t) => t.category === 'silage')
  return {
    id: null,
    sure: false,
    likely: [...strawOfCrop, ...otherStraw, ...green, ...silage].map((t) => t.id),
    ask: `Baled ${c}: straw, green feed or silage?`,
  }
}

/** The bale size to start with: the feed's own when it is counted in bales, else round. */
export function defaultBaleType(feed: Pick<FeedTypeLite, 'default_unit'> | null | undefined): BaleType {
  return feed?.default_unit === 'big_square' ? 'big_square' : 'round'
}

export type BaleWeightDefault = { bale_type: string; lb_per_bale: number | null }

/**
 * The weight of one bale of a put-up entry, and where it came from: its own
 * (weighed), the feed's bale weight when the bales are the size it is for,
 * else the farm's default for the size. The same order the feed_on_hand view
 * uses. Null when nobody has a figure: the bales stay "unweighed".
 */
export function lotLbPerBale(
  lot: { unit: string; lb_per_bale: number | null },
  feed: Pick<FeedTypeLite, 'default_unit' | 'default_lb_per_bale'> | null | undefined,
  defaults: readonly BaleWeightDefault[],
): { lb: number | null; from: 'own' | 'feed' | 'size' | null } {
  if (lot.unit === 'lb') return { lb: null, from: null }
  if (lot.lb_per_bale != null && Number(lot.lb_per_bale) > 0) return { lb: Number(lot.lb_per_bale), from: 'own' }
  if (feed && feed.default_unit === lot.unit && feed.default_lb_per_bale != null && Number(feed.default_lb_per_bale) > 0) {
    return { lb: Number(feed.default_lb_per_bale), from: 'feed' }
  }
  const d = defaults.find((x) => x.bale_type === lot.unit)
  if (d?.lb_per_bale != null && Number(d.lb_per_bale) > 0) return { lb: Number(d.lb_per_bale), from: 'size' }
  return { lb: null, from: null }
}

/**
 * Is an entry's weight still a guess? Until somebody weighs the bales, a
 * baling entry's is. A feed test measures quality, not weight, so it does not
 * clear the mark (Sam, 14 Oct 2026: "only a real weight clears it").
 */
export function isWeightEstimate(lot: { weight_basis: string | null; feed_test_id?: string | null; lb_per_bale?: number | null }): boolean {
  return lot.weight_basis === 'estimate'
}

type LatLon = { lat: number | null; lon: number | null }

/** Kilometres between two points, near enough for "which ranch is closer". */
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r)
  const y = (b.lat - a.lat) * r
  return Math.sqrt(x * x + y * y) * 6371
}

/**
 * Whose feed supply a field's bales go into by default: the nearest ranch
 * that has a location, else the main ranch, else the first. The person can
 * change it in the form.
 */
export function defaultRanch<R extends { id: string; latitude: unknown; longitude: unknown }>(
  ranches: readonly R[],
  field: LatLon | null | undefined,
  mainRanchId?: string | null,
): string | null {
  if (!ranches.length) return null
  if (ranches.length === 1) return ranches[0].id
  const placed = ranches
    .map((r) => ({ id: r.id, lat: r.latitude == null ? NaN : Number(r.latitude), lon: r.longitude == null ? NaN : Number(r.longitude) }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
  if (field?.lat != null && field.lon != null && placed.length) {
    const f = { lat: Number(field.lat), lon: Number(field.lon) }
    return [...placed].sort((a, b) => km(f, a) - km(f, b))[0].id
  }
  return ranches.find((r) => r.id === mainRanchId)?.id ?? ranches[0].id
}

/** A record's bale count: its amount when that is in bales. */
export function baleCount(rec: { work_type: string; amount: number | null; amount_unit: string | null }): number | null {
  if (rec.work_type !== BALING) return null
  const unit = (rec.amount_unit ?? '').trim().toLowerCase()
  if (unit !== 'bales' && unit !== 'bale') return null
  const n = rec.amount == null ? NaN : Number(rec.amount)
  return Number.isFinite(n) && n > 0 ? n : null
}

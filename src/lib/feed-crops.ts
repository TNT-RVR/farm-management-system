import { feedDays, LB_PER_TONNE, type FeedPlan } from './feed'
import type { Coat, FeedCategory, FeedClass, FeedValue, RationLine } from './cattle-nutrition'
import { TONNE_PER_BU } from './markets'
import { seasonPlan, type PlanGroup } from './winter-feeding'
import { weightFor } from './animal-units'

/**
 * The winter feed plan, turned into crops to grow.
 *
 * Each ranch's need is worked out by the Feed tab's own season walk
 * (winter-feeding.ts seasonPlan), so the crop plan and the Feed tab can't
 * disagree: every class at its stage day by day, the cold from the ranch's own
 * last five winters by month where the screen has them (a typical southern
 * Alberta winter, WINTER_COLD, where it doesn't), the calves kept to
 * background fed from the weaning day, and waste at feeding. The ration here
 * is the ranch's home-grown feeds at their shares of the dry matter, with the
 * rest bought; each crop is given its feed type's book energy, so the ration
 * is fed to the energy need the way the Feed tab feeds it.
 *
 * On top of what is fed, what rots in the stack before it is fed (storage
 * loss, by feed type) has to be grown too. A crop's dry matter % turns tonnes
 * of dry matter into tonnes as fed, and its expected yield turns those into
 * acres. The acres, summed over the ranches, are the least the rotation should
 * grow — the same way a contract sets a minimum.
 *
 * The crop harvested in year Y is fed the winter that starts in year Y, so a
 * plan for 2027 grows the feed for the 2027–28 winter. Head counts are taken
 * as they stand today.
 */

export type RationRow = { id?: string; ranch_id: string; crop_id: string; dm_share_pct: number | string }
export type HerdRow = {
  id: string
  ranch_id: string | null
  head_count: number
  avg_weight_lb: number | string | null
  class_name?: string | null
  feed_class?: FeedClass | null
  bcs?: number | string | null
  target_bcs?: number | string | null
  target_gain_lb?: number | string | null
  /** Calves: how many are kept after weaning — the ones on winter feed. */
  background_head?: number | null
  /** Free-choice bales (eaten to appetite) or a measured amount; absent = free choice. */
  feeding_method?: 'free_choice' | 'measured' | null
}
export type FeedCrop = {
  id: string
  name: string
  yield_unit: string | null
  feed_dm_pct: number | string | null
  test_weight_lb_per_bu?: number | string | null
  /** Storage loss, %; when absent, the book figure for the crop's feed type. */
  storage_loss_pct?: number | string | null
}
export type RanchFeed = {
  ranchId: string
  plan: Pick<FeedPlan, 'waste_pct' | 'start_month' | 'start_day' | 'end_month' | 'end_day' | 'excluded_group_ids'> &
    Partial<Pick<FeedPlan, 'calving_month' | 'calving_day' | 'coat' | 'sheltered'>>
  herds: HerdRow[]
  ration: RationRow[]
  /** Extra energy for cold by month (winter-feeding.ts monthlyCold), where the ranch's weather history is loaded. */
  coldByMonth?: Map<number, number> | null
  /** The ranch's weaning day (ranches.weaning_date): the calves kept to background are fed from it. */
  weaningDate?: string | null
}

const num = (v: unknown) => (v == null || v === '' ? null : Number(v))

/** Tonnes as fed in one unit of the crop's yield (a bushel, a pound, a tonne). */
export function tonnesPerUnit(unit: string | null, crop: Pick<FeedCrop, 'name' | 'test_weight_lb_per_bu'>): number | null {
  switch (unit ?? 'bu') {
    case 'MT':
      return 1
    case 'ton':
      return 0.907185
    case 'lbs':
      return 1 / LB_PER_TONNE
    case 'cwt':
      return 100 / LB_PER_TONNE
    case 'bu': {
      const tw = num(crop.test_weight_lb_per_bu)
      if (tw && tw > 0) return tw / LB_PER_TONNE
      const buPerT = TONNE_PER_BU[crop.name.toLowerCase()]
      return buPerT ? 1 / buPerT : null
    }
    default:
      return null
  }
}

/**
 * The extra a southern Alberta winter adds to maintenance energy, for when the
 * ranch's own weather history isn't loaded: about 15% averaged over
 * December–March (the Feed tab works it out from the last five winters; this
 * is its typical size).
 */
export const WINTER_COLD = 0.15

/** Book values for a home-grown feed by type — the same figures the farm's feed types carry. */
const BOOK: Record<FeedCategory, { tdn: number; cp: number; storageLoss: number }> = {
  silage: { tdn: 65, cp: 9, storageLoss: 12 },
  greenfeed: { tdn: 58, cp: 10, storageLoss: 8 },
  hay: { tdn: 58, cp: 15, storageLoss: 8 },
  straw: { tdn: 44, cp: 4, storageLoss: 8 },
  grain: { tdn: 84, cp: 12.8, storageLoss: 1 },
  supplement: { tdn: 75, cp: 32, storageLoss: 1 },
  other: { tdn: 57, cp: 10, storageLoss: 8 },
}

/** What kind of feed a crop makes, from its name. */
export function cropFeedCategory(name: string): FeedCategory {
  const n = name.toLowerCase()
  if (n.includes('silage')) return 'silage'
  if (/green ?feed|oat hay|cereal hay/.test(n)) return 'greenfeed'
  if (n.includes('straw')) return 'straw'
  if (/alfalfa|hay|sainfoin|timothy|grass|clover/.test(n)) return 'hay'
  if (/barley|oat|wheat|corn|triticale|rye|durum|pea/.test(n)) return 'grain'
  return 'other'
}

/** Feed bought in to make up the share the home-grown feeds don't: hay at book value. */
const BOUGHT: FeedValue = { id: 'bought', name: 'Bought feed', category: 'hay', dmPct: 88, tdnPct: 57, cpPct: 12, source: 'book' }

/** The weaning day of the winter that runs `start` → `end`, if it falls inside it. */
function weaningIn(weaning: string | null | undefined, start: Date, end: Date): string | null {
  if (!weaning || !/^\d{4}-\d{2}-\d{2}/.test(weaning)) return null
  const m = Number(weaning.slice(5, 7))
  const d = Number(weaning.slice(8, 10))
  for (const y of [start.getFullYear(), start.getFullYear() + 1]) {
    const w = new Date(y, m - 1, d)
    if (w >= start && w < end) return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}

export type RanchNeed = {
  ranchId: string
  days: number
  head: number
  /** Dry matter put out over the winter, waste included (storage loss not), tonnes. */
  dmTonnes: number
  /** Share of the dry matter the ration leaves to bought feed (or straw, stalks), %. */
  boughtPct: number
  /** Per crop: dry matter and as fed to GROW, storage loss included. */
  byCrop: Map<string, { sharePct: number; dmTonnes: number; asFedTonnes: number | null }>
}

/** One ranch's winter need, feed by feed. */
export function ranchNeed(r: RanchFeed, crops: FeedCrop[], today = new Date()): RanchNeed {
  const excluded = new Set((r.plan.excluded_group_ids as string[] | null) ?? [])
  // Calves on winter feed are the ones kept after weaning, not the calves at side.
  const fedHead = (h: HerdRow) => h.background_head ?? h.head_count
  const herds = r.herds.filter((h) => !excluded.has(h.id) && fedHead(h) > 0)
  const days = feedDays(r.plan.start_month, r.plan.start_day, r.plan.end_month, r.plan.end_day)
  const y = today.getFullYear()
  const start = r.plan.start_month && r.plan.start_day ? new Date(y, r.plan.start_month - 1, r.plan.start_day) : new Date(y, 11, 1)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days)
  const waste = Number(r.plan.waste_pct) || 0

  // The ration: each home-grown feed at its share, the rest bought.
  const lines: RationLine[] = []
  const meta = new Map<string, { dmPct: number | null; storageLoss: number; sharePct: number }>()
  let shared = 0
  for (const row of r.ration) {
    const pct = num(row.dm_share_pct) ?? 0
    if (pct <= 0) continue
    shared += pct
    const crop = crops.find((c) => c.id === row.crop_id)
    const cat = cropFeedCategory(crop?.name ?? '')
    const dmPct = num(crop?.feed_dm_pct)
    meta.set(row.crop_id, { dmPct: dmPct && dmPct > 0 ? dmPct : null, storageLoss: num(crop?.storage_loss_pct) ?? BOOK[cat].storageLoss, sharePct: pct })
    lines.push({
      // An unknown dry matter % is worked at 100% — dry matter in, dry matter out — and the as-fed figure left open.
      feed: { id: row.crop_id, name: crop?.name ?? 'Feed', category: cat, dmPct: dmPct && dmPct > 0 ? dmPct : 100, tdnPct: BOOK[cat].tdn, cpPct: BOOK[cat].cp, source: 'book' },
      sharePct: pct,
      wastePct: waste,
    })
  }
  const boughtPct = Math.max(0, 100 - shared)
  if (boughtPct > 0) lines.push({ feed: BOUGHT, sharePct: boughtPct, wastePct: waste })

  const weaning = weaningIn(r.weaningDate, start, end)
  const groups: PlanGroup[] = herds.map((h) => {
    const w = weightFor(h)
    return {
      id: h.id,
      name: h.class_name ?? h.id,
      group: {
        feedClass: h.feed_class ?? 'cow',
        head: fedHead(h),
        weightLb: w.lb,
        weightMissing: w.missing,
        bcs: num(h.bcs) ?? 3,
        targetBcs: num(h.target_bcs) ?? 3,
        targetGainLb: num(h.target_gain_lb),
        feeding: h.feeding_method === 'measured' ? 'measured' : 'free_choice',
      },
      lines,
      from: h.background_head != null ? weaning : null,
    }
  })
  const cold = r.coldByMonth?.size ? r.coldByMonth : new Map(Array.from({ length: 12 }, (_, i) => [i + 1, WINTER_COLD] as [number, number]))
  const season = seasonPlan({
    groups,
    settings: {
      calvingMonth: r.plan.calving_month ?? 4,
      calvingDay: r.plan.calving_day ?? 1,
      coat: (r.plan.coat as Coat | undefined) ?? 'winter',
      sheltered: r.plan.sheltered ?? false,
      muddy: false,
      reservePct: 0,
    },
    from: start,
    to: end,
    coldByMonth: cold,
    stubble: [],
    onHand: new Map(),
  })

  // Dry matter put out: every line's as fed × its dry matter, plus grain the
  // ration needed that it had no grain line for (bought barley).
  let dmLb = season.extraGrainLb * 0.88
  for (const l of lines) dmLb += (season.needLb.get(l.feed.id) ?? 0) * (l.feed.dmPct / 100)
  const byCrop = new Map<string, { sharePct: number; dmTonnes: number; asFedTonnes: number | null }>()
  for (const l of lines) {
    const m = meta.get(l.feed.id)
    if (!m) continue
    // What has to be grown: what is put out, plus what rots in the stack first.
    const grownLb = (season.needLb.get(l.feed.id) ?? 0) / (1 - Math.min(0.9, m.storageLoss / 100))
    byCrop.set(l.feed.id, {
      sharePct: m.sharePct,
      dmTonnes: (grownLb * (l.feed.dmPct / 100)) / LB_PER_TONNE,
      asFedTonnes: m.dmPct != null ? grownLb / LB_PER_TONNE : null,
    })
  }
  return { ranchId: r.ranchId, days, head: herds.reduce((s, h) => s + fedHead(h), 0), dmTonnes: dmLb / LB_PER_TONNE, boughtPct, byCrop }
}

export type FeedMinimum = {
  /** Tonnes as fed, all ranches. */
  tonnes: number
  /** Acres at the expected yield; null when the crop has no yield or unit to size it by. */
  acres: number | null
  /** Expected yield per acre, tonnes as fed. */
  tonnesPerAcre: number | null
  byRanch: Map<string, number>
}

/**
 * Least acres of each feed crop to grow, summed over the ranches.
 * `yieldFor` gives the crop's expected yield in its own unit (the margin's).
 */
export function feedMinimums(
  ranches: RanchFeed[],
  crops: FeedCrop[],
  yieldFor: (cropId: string) => number | null,
): Map<string, FeedMinimum> {
  const out = new Map<string, FeedMinimum>()
  for (const r of ranches) {
    const need = ranchNeed(r, crops)
    for (const [cropId, n] of need.byCrop) {
      if (n.asFedTonnes == null || n.asFedTonnes <= 0) continue
      const m = out.get(cropId) ?? { tonnes: 0, acres: null, tonnesPerAcre: null, byRanch: new Map() }
      m.tonnes += n.asFedTonnes
      m.byRanch.set(r.ranchId, (m.byRanch.get(r.ranchId) ?? 0) + n.asFedTonnes)
      out.set(cropId, m)
    }
  }
  for (const [cropId, m] of out) {
    const crop = crops.find((c) => c.id === cropId)
    const y = yieldFor(cropId)
    const per = crop && y && y > 0 ? tonnesPerUnit(crop.yield_unit, crop) : null
    if (per && y) {
      m.tonnesPerAcre = y * per
      m.acres = m.tonnes / m.tonnesPerAcre
    }
  }
  return out
}

import { DEFAULT_AVG_WEIGHT_LB, feedDays, LB_PER_TONNE, type FeedPlan } from './feed'
import { groupNeed, type FeedClass } from './cattle-nutrition'
import { TONNE_PER_BU } from './markets'

/**
 * The winter feed plan, turned into crops to grow.
 *
 * Each ranch's herd needs so many tonnes of dry matter over its feeding days
 * (the Feed tab's model, waste included). Its ration says what share of that
 * each home-grown feed supplies. A feed's dry matter % turns its share into
 * tonnes as fed, and the crop's expected yield turns tonnes into acres. The
 * acres, summed over the ranches, are the least the rotation should grow —
 * the same way a contract sets a minimum.
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
  feed_class?: FeedClass | null
  bcs?: number | string | null
  target_bcs?: number | string | null
  target_gain_lb?: number | string | null
  /** Calves: how many are kept after weaning — the ones on winter feed. */
  background_head?: number | null
}
export type FeedCrop = {
  id: string
  name: string
  yield_unit: string | null
  feed_dm_pct: number | string | null
  test_weight_lb_per_bu?: number | string | null
}
export type RanchFeed = {
  ranchId: string
  plan: Pick<FeedPlan, 'waste_pct' | 'start_month' | 'start_day' | 'end_month' | 'end_day' | 'excluded_group_ids'> &
    Partial<Pick<FeedPlan, 'calving_month' | 'calving_day'>>
  herds: HerdRow[]
  ration: RationRow[]
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
 * The extra a southern Alberta winter adds, for crop planning years ahead:
 * about 15% averaged over December–March (the Feed tab works it out from the
 * ranch's own last five winters; this is its typical size).
 */
export const WINTER_COLD = 0.15

export type RanchNeed = {
  ranchId: string
  days: number
  head: number
  /** Dry matter the herd eats over the winter, waste included, tonnes. */
  dmTonnes: number
  /** Share of the dry matter the ration leaves to bought feed (or straw, stalks), %. */
  boughtPct: number
  byCrop: Map<string, { sharePct: number; dmTonnes: number; asFedTonnes: number | null }>
}

/** One ranch's winter need, feed by feed. */
export function ranchNeed(r: RanchFeed, crops: FeedCrop[]): RanchNeed {
  const excluded = new Set((r.plan.excluded_group_ids as string[] | null) ?? [])
  // Calves on winter feed are the ones kept after weaning, not the calves at side.
  const fedHead = (h: HerdRow) => h.background_head ?? h.head_count
  const herds = r.herds.filter((h) => !excluded.has(h.id) && fedHead(h) > 0)
  const days = feedDays(r.plan.start_month, r.plan.start_day, r.plan.end_month, r.plan.end_day)
  // Each class at its stage, day by day through a winter (NASEM intake for
  // its class — cows rise into late pregnancy, calves eat by their weight),
  // plus a typical southern Alberta winter's cold (WINTER_COLD) and waste.
  let dmLb = 0
  const y = new Date().getFullYear()
  const start = r.plan.start_month && r.plan.start_day ? new Date(y, r.plan.start_month - 1, r.plan.start_day) : new Date(y, 11, 1)
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    for (const h of herds) {
      const need = groupNeed(
        {
          feedClass: h.feed_class ?? 'cow',
          head: fedHead(h),
          weightLb: num(h.avg_weight_lb) || DEFAULT_AVG_WEIGHT_LB,
          bcs: num(h.bcs) ?? 3,
          targetBcs: num(h.target_bcs) ?? 3,
          targetGainLb: num(h.target_gain_lb),
        },
        { onDate: d, calvingMonth: r.plan.calving_month ?? 4, calvingDay: r.plan.calving_day ?? 1, daysToTurnout: days - i, cold: 0, muddy: false },
      )
      dmLb += (need.base.dmi * (1 + WINTER_COLD) + need.calfDmLb) * fedHead(h)
    }
  }
  const dmTonnes = (dmLb * (1 + Number(r.plan.waste_pct) / 100)) / LB_PER_TONNE
  const byCrop = new Map<string, { sharePct: number; dmTonnes: number; asFedTonnes: number | null }>()
  let shared = 0
  for (const row of r.ration) {
    const pct = num(row.dm_share_pct) ?? 0
    if (pct <= 0) continue
    shared += pct
    const dm = (dmTonnes * pct) / 100
    const dmPct = num(crops.find((c) => c.id === row.crop_id)?.feed_dm_pct)
    byCrop.set(row.crop_id, { sharePct: pct, dmTonnes: dm, asFedTonnes: dmPct ? dm / (dmPct / 100) : null })
  }
  return { ranchId: r.ranchId, days, head: herds.reduce((s, h) => s + fedHead(h), 0), dmTonnes, boughtPct: Math.max(0, 100 - shared), byCrop }
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

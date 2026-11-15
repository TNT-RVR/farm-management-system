/**
 * How much water a herd drinks in a day, and whether its pasture has any.
 *
 * The figures are the NRC's own table (Nutrient Requirements of Beef Cattle,
 * 7th revised edition), as the BCRC reproduces it: litres a head a day by
 * CLASS and air temperature. Nothing here talks to Supabase, so the panel and
 * the tests use the same numbers.
 *
 * It was a rule of thumb until 12 Nov 2026 -- one US gallon per 100 lb of body
 * weight in cool weather, two at 30 C, a nursing cow +30% -- and that rule is
 * wrong by a factor of two on mature cattle. It read a 1,350 lb nursing cow as
 * 100 L at 21 C where the table says 64, and a dry cow on a cool day as 51 L
 * where the table says 23. The reason is that mature animals do not drink by
 * the pound: what they are DOING (carrying a calf, milking) moves intake far
 * more than what they weigh, and only growing cattle scale with weight at all.
 * Every trough size, haul volume and "no water" warning on the Water tab came
 * off that rule, so all of them were about twice what they needed to be.
 */

/** The table's temperature columns, C. */
const NRC_TEMPS = [4.4, 10.0, 14.4, 21.1, 26.6, 32.2]

/**
 * What a class drinks at each of NRC_TEMPS, litres a head a day.
 *
 * Note the lactating row PEAKS at 26.6 C and falls back at 32.2: a cow in
 * extreme heat eats less and milks less, and drinks accordingly. That shape is
 * the table's, not a typo, and no rule-of-thumb curve can produce it.
 *
 * The NRC leaves bred heifers and pregnant cows blank above 21.1 C. They are
 * filled here by the rise the 900 lb growing row makes over the same two steps
 * (x1.15 and x1.63), which is the nearest mature-weight row the table carries
 * all the way across. Marked so, because it is our extrapolation and not the
 * NRC's measurement.
 */
const NRC_LITRES = {
  growing400: [15.1, 16.3, 18.9, 22.0, 25.4, 36.0],
  growing600: [20.1, 22.0, 25.0, 29.5, 33.7, 48.1],
  growing900: [23.0, 25.7, 29.9, 34.8, 40.1, 56.8],
  bred_heifer: [22.7, 24.6, 28.0, 32.9, 37.9, 53.7],
  pregnant_cow: [22.7, 24.6, 28.0, 32.9, 37.9, 53.7],
  lactating_cow: [43.1, 47.7, 54.9, 64.0, 67.8, 61.3],
  bull: [32.9, 35.6, 40.9, 47.7, 54.9, 78.0],
} as const

/** The classes the table knows. Growing cattle also take a weight. */
export type WaterClass = 'growing' | 'bred_heifer' | 'pregnant_cow' | 'lactating_cow' | 'bull'

/** Below this the herd drinks the cool-weather rate. */
export const COOL_C = NRC_TEMPS[0]
/** The day the Water tab sizes for when no forecast can be reached. */
export const HOT_C = 30
/** Lactating cows drink most near here, not at the hottest hour of the year. */
export const PEAK_LACTATING_C = 26.6

export const LITRES_PER_US_GALLON = 3.785

/** A value off one row of the table at `tempC`, straight lines between columns, flat past both ends. */
function atTemp(row: readonly number[], tempC: number): number {
  const t = Number.isFinite(tempC) ? tempC : NRC_TEMPS[0]
  if (t <= NRC_TEMPS[0]) return row[0]
  for (let i = 1; i < NRC_TEMPS.length; i++) {
    if (t <= NRC_TEMPS[i]) {
      const f = (t - NRC_TEMPS[i - 1]) / (NRC_TEMPS[i] - NRC_TEMPS[i - 1])
      return row[i - 1] + f * (row[i] - row[i - 1])
    }
  }
  return row[row.length - 1]
}

/**
 * Growing cattle at a weight: between the table's 400, 600 and 900 lb rows,
 * and below 400 lb in proportion to the weight, so a young calf at side is not
 * charged a yearling's water. Above 900 lb it holds -- past that an animal is
 * one of the mature classes, which have rows of their own.
 */
function growingRow(weightLb: number): number[] {
  const pts: [number, readonly number[]][] = [
    [400, NRC_LITRES.growing400],
    [600, NRC_LITRES.growing600],
    [900, NRC_LITRES.growing900],
  ]
  const w = Math.max(0, Number.isFinite(weightLb) ? weightLb : 0)
  if (w <= pts[0][0]) return pts[0][1].map((v) => (v * w) / pts[0][0])
  for (let i = 1; i < pts.length; i++) {
    if (w <= pts[i][0]) {
      const f = (w - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0])
      return pts[i][1].map((v, j) => pts[i - 1][1][j] + f * (v - pts[i - 1][1][j]))
    }
  }
  return [...pts[pts.length - 1][1]]
}

/** Litres one animal drinks in a day. */
export function litresPerHead(o: { waterClass: WaterClass; weightLb?: number; tempC: number }): number {
  if (o.waterClass === 'growing') {
    const w = o.weightLb ?? 0
    if (!(w > 0)) return 0
    return atTemp(growingRow(w), o.tempC)
  }
  return atTemp(NRC_LITRES[o.waterClass], o.tempC)
}

/**
 * The water class for a herd row's feed_class. `lactating` only matters for a
 * cow: she is on the big row from calving to weaning and the pregnant row the
 * rest of the year.
 */
export function waterClassFor(feedClass: string | null | undefined, lactating = false): WaterClass {
  switch (feedClass) {
    case 'bull':
      return 'bull'
    case 'bred_heifer':
      return 'bred_heifer'
    case 'cow':
      return lactating ? 'lactating_cow' : 'pregnant_cow'
    default:
      return 'growing'
  }
}

export type DrinkingGroup = {
  label: string
  head: number
  /** Only read for growing cattle; the mature rows do not scale with weight. */
  weightLb: number
  waterClass: WaterClass
}

/** Litres a day for a set of groups, and each group's share. */
export function herdLitresPerDay(groups: DrinkingGroup[], tempC: number): { total: number; byGroup: { label: string; head: number; litres: number }[] } {
  const byGroup = groups
    .filter((g) => g.head > 0)
    .map((g) => ({ label: g.label, head: g.head, litres: g.head * litresPerHead({ waterClass: g.waterClass, weightLb: g.weightLb, tempC }) }))
  return { total: byGroup.reduce((s, g) => s + g.litres, 0), byGroup }
}

// ---------------------------------------------------------------------------
// Per pasture
// ---------------------------------------------------------------------------

export type HerdClassRow = {
  ranch: string
  class_name: string
  head_count: number
  avg_weight_lb: number | string | null
  feed_class: string | null
  background_head: number | null
}

export type MobOnPasture = {
  mob: string
  pasture_id: string | null
  no_fence: boolean
  head_count: number | null
}

export type WaterPin = {
  id: string
  name: string | null
  drinkable: boolean
  pasture_id: string | null
  serves: string[]
}

export type PastureForWater = {
  id: string
  name: string
  ranch: string | null
  /** 'none' | 'all' | 'north_of' — the river counts as water where the pasture fronts it. */
  river_access: string | null
}

export type PastureWaterRow = {
  pasture: PastureForWater
  head: number
  litres: number
  groups: { label: string; head: number; litres: number }[]
  pins: { id: string; name: string }[]
  river: boolean
  /** Nothing drinkable recorded: no pin, no river. Urgent when `head` > 0. */
  noWater: boolean
}

const isCalfRow = (r: HerdClassRow) => r.background_head != null || /calf|calves/i.test(r.class_name)

/**
 * The drinking groups a collar mob stands for. Mobs are named for their ranch
 * and kind ("Home Ranch Herd", "East Ranch Bulls"); the weight comes from that
 * ranch's head count. A cow mob before weaning carries its calves at side —
 * calves per cow, at most one — and the cows count as nursing.
 */
export function mobGroups(
  mob: { mob: string; head_count: number | null },
  herd: HerdClassRow[],
  opts: { weaningDate: (ranch: string) => string | null; today: string },
): DrinkingGroup[] {
  const head = mob.head_count ?? 0
  if (head <= 0) return []
  const name = mob.mob.toLowerCase()
  const ranch = [...new Set(herd.map((h) => h.ranch))].find((r) => name.startsWith(r.toLowerCase())) ?? null
  const rows = herd.filter((h) => h.ranch === ranch)
  const kind = /bull/i.test(mob.mob) ? 'bull' : /heifer/i.test(mob.mob) ? 'heifer' : 'cow'
  const pick =
    kind === 'bull'
      ? rows.find((r) => r.feed_class === 'bull' || /bull/i.test(r.class_name))
      : kind === 'heifer'
        ? rows.find((r) => r.feed_class === 'bred_heifer' || /heifer/i.test(r.class_name))
        : rows.find((r) => r.feed_class === 'cow' || /^cows?$/i.test(r.class_name))
  // No ranch match: a cow's weight is the safer guess than none.
  const weightLb = Number(pick?.avg_weight_lb) || (kind === 'bull' ? 1800 : kind === 'heifer' ? 1100 : 1350)
  const label = pick?.class_name ?? (kind === 'bull' ? 'Bulls' : kind === 'heifer' ? 'Heifers' : 'Cows')
  const mature = waterClassFor(kind === 'bull' ? 'bull' : kind === 'heifer' ? 'bred_heifer' : 'cow')
  if (kind !== 'cow') return [{ label, head, weightLb, waterClass: mature }]

  const weaning = ranch ? opts.weaningDate(ranch) : null
  const atSide = !weaning || opts.today < weaning
  const cows = rows.filter((r) => r.feed_class === 'cow').reduce((s, r) => s + r.head_count, 0)
  const calfRow = rows.find(isCalfRow)
  const calves = calfRow?.head_count ?? 0
  // Out of the cows' calving-to-weaning window they are on the pregnant row,
  // which is less than half the lactating one -- the single biggest swing in
  // the table, and the reason the class matters more than the weight.
  if (!atSide || cows <= 0 || calves <= 0 || !calfRow) return [{ label, head, weightLb, waterClass: mature }]
  return [
    { label, head, weightLb, waterClass: 'lactating_cow' },
    { label: 'Calves at side', head: Math.round(head * Math.min(1, calves / cows)), weightLb: Number(calfRow.avg_weight_lb) || 500, waterClass: 'growing' },
  ]
}

/**
 * Each pasture: the herd on it now, what it drinks a day at `tempC`, and the
 * drinkable water that serves it — a pin inside it, a pin that names it in
 * `serves` (a corral trough the cattle walk out to), or the river.
 */
export function pastureWaterRows(o: {
  pastures: PastureForWater[]
  mobs: MobOnPasture[]
  herd: HerdClassRow[]
  pins: WaterPin[]
  tempC: number
  weaningDate: (ranch: string) => string | null
  today: string
}): PastureWaterRow[] {
  return o.pastures
    .map((p) => {
      const groups = o.mobs
        .filter((m) => m.pasture_id === p.id && !m.no_fence)
        .flatMap((m) => mobGroups(m, o.herd, { weaningDate: o.weaningDate, today: o.today }))
      const { total, byGroup } = herdLitresPerDay(groups, o.tempC)
      const pins = o.pins
        .filter((w) => w.drinkable && (w.pasture_id === p.id || w.serves.includes(p.id)))
        .map((w) => ({ id: w.id, name: w.name?.trim() || 'Unnamed water' }))
      const river = p.river_access != null && p.river_access !== 'none'
      const head = groups.reduce((s, g) => s + g.head, 0)
      return { pasture: p, head, litres: total, groups: byGroup, pins, river, noWater: pins.length === 0 && !river }
    })
    .sort((a, b) => b.litres - a.litres || a.pasture.name.localeCompare(b.pasture.name, 'en-CA', { numeric: true }))
}

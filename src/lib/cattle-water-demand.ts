/**
 * How much water a herd drinks in a day, and whether its pasture has any.
 *
 * The rule of thumb Alberta and the US extension services both give: about one
 * US gallon per 100 lb of body weight a day in cool weather, rising to about two
 * at 30 °C and above. A cow nursing a calf drinks roughly 30% more. A calf at
 * side drinks by its own weight. Nothing here talks to Supabase, so the panel
 * and the tests use the same numbers.
 */

export const LITRES_PER_US_GALLON = 3.785

/** Below this the herd drinks the cool-weather rate. */
export const COOL_C = 10
/** At and above this, the hot-weather rate. */
export const HOT_C = 30
export const COOL_GAL_PER_100LB = 1
export const HOT_GAL_PER_100LB = 2
/** A cow with a calf at side drinks about this much more. */
export const LACTATING_UPLIFT = 0.3

/** Gallons per 100 lb a day at a temperature: 1 when cool, 2 when hot, a straight line between. */
export function gallonsPer100Lb(tempC: number): number {
  if (!Number.isFinite(tempC) || tempC <= COOL_C) return COOL_GAL_PER_100LB
  if (tempC >= HOT_C) return HOT_GAL_PER_100LB
  const f = (tempC - COOL_C) / (HOT_C - COOL_C)
  return COOL_GAL_PER_100LB + f * (HOT_GAL_PER_100LB - COOL_GAL_PER_100LB)
}

/** Litres one animal drinks in a day. */
export function litresPerHead(o: { weightLb: number; tempC: number; lactating?: boolean }): number {
  if (!(o.weightLb > 0)) return 0
  const gal = (o.weightLb / 100) * gallonsPer100Lb(o.tempC) * (o.lactating ? 1 + LACTATING_UPLIFT : 1)
  return gal * LITRES_PER_US_GALLON
}

export type DrinkingGroup = {
  label: string
  head: number
  weightLb: number
  lactating?: boolean
}

/** Litres a day for a set of groups, and each group's share. */
export function herdLitresPerDay(groups: DrinkingGroup[], tempC: number): { total: number; byGroup: { label: string; head: number; litres: number }[] } {
  const byGroup = groups
    .filter((g) => g.head > 0)
    .map((g) => ({ label: g.label, head: g.head, litres: g.head * litresPerHead({ weightLb: g.weightLb, tempC, lactating: g.lactating }) }))
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
  if (kind !== 'cow') return [{ label, head, weightLb }]

  const weaning = ranch ? opts.weaningDate(ranch) : null
  const atSide = !weaning || opts.today < weaning
  const cows = rows.filter((r) => r.feed_class === 'cow').reduce((s, r) => s + r.head_count, 0)
  const calfRow = rows.find(isCalfRow)
  const calves = calfRow?.head_count ?? 0
  if (!atSide || cows <= 0 || calves <= 0 || !calfRow) return [{ label, head, weightLb }]
  return [
    { label, head, weightLb, lactating: true },
    { label: 'Calves at side', head: Math.round(head * Math.min(1, calves / cows)), weightLb: Number(calfRow.avg_weight_lb) || 500 },
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

/**
 * Animal units and typical weights, in one place.
 *
 * An animal unit (AU) is a 1,000 lb cow: it eats 26 lb of forage dry matter a
 * day (AU_LBS_PER_DAY in forage-yield.ts). So a class's AU per head is its
 * weight ÷ 1,000 — derived, never typed separately, because a typed AU and a
 * typed weight drift apart (Home Ranch's cows read 1,350 lb and 1.4 AU).
 * A stored AU is used only when the class says it was set on purpose
 * (herd_counts.au_override).
 *
 * Calves at side are counted with their cows by `pairAU`, the calf's share
 * growing with its age, so every screen that puts pairs on grass — the
 * Grazing tab's demand, the replacement-heifer capacity, the move-out check —
 * counts a calf the same way.
 */

import type { FeedClass } from './cattle-nutrition'

export const AU_LB = 1000
/** One AU's forage a day, lb DM (Alberta's AUM: 26 lb × 30 days). */
const AU_FORAGE_LB = 26

const n = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

// ── Typical weights when none is entered ────────────────────────────────────

/**
 * A class's typical weight, lb, for when no weight is entered. Before this
 * every class fell back to 1,300 lb — a calf fed like a cow.
 *
 *   cow 1,300 · bull 1,900 · bred heifer 1,100 · yearling 850 ·
 *   replacement heifer calf 650 (weaned ~550, ~800 by spring) ·
 *   calf / backgrounder 550
 */
export function defaultWeightLb(feedClass: FeedClass | string | null | undefined, className?: string | null): number {
  const name = (className ?? '').toLowerCase()
  if (name.includes('yearling')) return 850
  switch (feedClass) {
    case 'bull':
      return 1900
    case 'bred_heifer':
      return 1100
    case 'heifer_calf':
      return 650
    case 'backgrounder':
      return 550
    case 'cow':
      return 1300
  }
  if (name.includes('bull')) return 1900
  if (name.includes('heifer')) return 1100
  if (name.includes('calf') || name.includes('calves')) return 550
  return 1300
}

export type WeightRow = { avg_weight_lb?: number | string | null; feed_class?: FeedClass | string | null; class_name?: string | null }

/** The class's weight, or its typical one with `missing` set so a screen can say so. */
export function weightFor(row: WeightRow): { lb: number; missing: boolean } {
  const w = n(row.avg_weight_lb)
  if (w != null && w > 0) return { lb: w, missing: false }
  return { lb: defaultWeightLb(row.feed_class ?? null, row.class_name ?? null), missing: true }
}

// ── AU per head ─────────────────────────────────────────────────────────────

export const auFromWeight = (lb: number) => Math.max(0, lb) / AU_LB

export type AuRow = WeightRow & { au_equivalent?: number | string | null; au_override?: boolean | null }

/** Where a class's AU came from: its weight, a typed override, or the class's typical weight. */
export function auSource(row: AuRow): 'weight' | 'override' | 'default' {
  const typed = n(row.au_equivalent)
  if (row.au_override && typed != null && typed > 0) return 'override'
  return weightFor(row).missing ? 'default' : 'weight'
}

/**
 * AU per head for a class: weight ÷ 1,000, or the stored AU when it was typed
 * on purpose (au_override). With no weight entered, a stored AU is better than
 * a typical weight, so it is used then too.
 */
export function auFor(row: AuRow): number {
  const typed = n(row.au_equivalent)
  if (row.au_override && typed != null && typed > 0) return typed
  const w = weightFor(row)
  if (w.missing && typed != null && typed > 0) return typed
  return auFromWeight(w.lb)
}

/** True when a typed AU differs from what the weight gives — worth flagging on screen. */
export function auDiffersFromWeight(row: AuRow): boolean {
  const typed = n(row.au_equivalent)
  const w = weightFor(row)
  return typed != null && !w.missing && Math.abs(typed - auFromWeight(w.lb)) > 0.005
}

// ── A cow and her calf ──────────────────────────────────────────────────────

/** A recurring day of the year (calving, weaning). */
export type MonthDay = { month: number; day: number }

/**
 * A nursing calf's own forage, lb DM a day, by month of age: nothing in its
 * first month, 2 lb in the second and 4 in the third (the ramp
 * cattle-nutrition.ts uses for a calf at side), then rising 2 lb a month to
 * about 12 lb by weaning at 6–7 months — about 0.45 AU, where the BCRC's
 * carrying-capacity calculator puts a calf near weaning (0.4–0.5).
 *
 * Alberta's AUM is "a 1,000 lb cow with a calf up to six months", so a young
 * calf barely adds to its mother; this ramp agrees — it is under 0.25 AU for
 * the first four months — and only counts the calf in earnest as it nears
 * weaning, which is when a pair really eats more than a dry cow.
 */
const CALF_FORAGE_LB = [0, 2, 4, 6, 8, 10, 12]

const DAY = 86_400_000
const utc = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const at = (year: number, md: MonthDay) => Date.UTC(year, md.month - 1, md.day)

/** Calf AU on a day: 0 before it is born or after it is weaned. */
export function calfAU(onIso: string, calving: MonthDay, weaning: MonthDay | null): number {
  const t = utc(onIso)
  const y = new Date(t).getUTCFullYear()
  const born = at(y, calving)
  if (t < born) return 0
  if (weaning) {
    let weaned = at(y, weaning)
    if (weaned <= born) weaned = at(y + 1, weaning)
    if (t >= weaned) return 0
  }
  const month = Math.floor((t - born) / DAY / 30.4)
  const lb = CALF_FORAGE_LB[Math.min(month, CALF_FORAGE_LB.length - 1)]
  return lb / AU_FORAGE_LB
}

/** A cow and her calf on a day, in AU: the cow by her weight, the calf by its age. */
export function pairAU(cowLb: number, onIso: string, calving: MonthDay, weaning: MonthDay | null): { cow: number; calf: number; total: number } {
  const cow = auFromWeight(cowLb)
  const calf = calfAU(onIso, calving, weaning)
  return { cow, calf, total: cow + calf }
}

/**
 * Animal-unit days a cow and her calf eat between two dates (end inclusive,
 * as daysGrazing counts them). `calvesPerCow` scales the calf's share — a 90%
 * weaning rate means nine calves at side for every ten cows.
 */
export function pairAUDays(o: {
  cowLb: number
  from: string
  to: string
  calving: MonthDay
  weaning: MonthDay | null
  calvesPerCow?: number
}): { cowAud: number; calfAud: number; days: number } {
  const a = utc(o.from)
  const b = utc(o.to)
  if (!(b >= a)) return { cowAud: 0, calfAud: 0, days: 0 }
  const days = Math.round((b - a) / DAY) + 1
  const per = Math.max(0, Math.min(1, o.calvesPerCow ?? 1))
  let calfAud = 0
  for (let i = 0; i < days; i++) calfAud += calfAU(isoOf(a + i * DAY), o.calving, o.weaning)
  return { cowAud: auFromWeight(o.cowLb) * days, calfAud: calfAud * per, days }
}

/** A weaning date ('2026-12-01') as a recurring day of the year. */
export function monthDayOf(iso: string | null | undefined): MonthDay | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  return { month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) }
}

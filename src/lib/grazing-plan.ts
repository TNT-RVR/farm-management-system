/**
 * The grazing planner's arithmetic, with no Supabase client attached.
 *
 * A plan is a list of stays for one herd group: a pasture from a date to a
 * date. Each stay starts on the day the one before it ends — the move day is
 * the last day in the old pasture and the first in the new — so a stay's
 * length is end − start, the same count the Grazing tab's herd table uses.
 *
 * Dates are ISO 'YYYY-MM-DD' strings throughout and the arithmetic is done in
 * UTC, so a daylight-saving change in the middle of a stay never makes it a
 * day short.
 */

import { AU_LBS_PER_DAY, AUM_LBS } from './forage-yield'

/** Days in the Crown's animal-unit month, which is how lease AUMs are counted. */
export const AUM_DAYS = 30.4

const DAY_MS = 86_400_000

const toUtc = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** `iso` moved by `n` days. */
export function addDays(iso: string, n: number): string {
  return new Date(toUtc(iso) + n * DAY_MS).toISOString().slice(0, 10)
}

/** b − a in whole days; negative when b is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS)
}

export type Dated = { start_date: string; end_date: string }

/** A stay's length in days; never negative. */
export function stayDays(s: Dated): number {
  return Math.max(0, daysBetween(s.start_date, s.end_date))
}

/** Animal-unit days: head × AU per head × days. */
export function auDays(head: number, auPerHead: number, days: number): number {
  return Math.max(0, head) * Math.max(0, auPerHead) * Math.max(0, days)
}

/** AUMs from animal-unit days, the Crown's way (30.4 days to the month). */
export function aumsFromAuDays(aud: number): number {
  return aud / AUM_DAYS
}

/**
 * AUMs of grass from animal-unit days, the Grazing tab's way: 780 lb of
 * forage, 30 days at 26 lb (forage-yield AUM_LBS). A pasture's grass is read
 * in these so the Plan's "of N AUM" is the Grazing tab's land capacity; the
 * Crown's 30.4-day month stays for lease AUMs (3 Nov 2026: the Plan read
 * 2,994 AUM for 2026 where the Grazing tab read 3,034 from the same 91,030 AUDs).
 */
export function grassAumsFromAuDays(aud: number): number {
  return (aud * AU_LBS_PER_DAY) / AUM_LBS
}

/**
 * Days a pasture's grass lasts a group: the AUDs it has left ÷ the group's AUs.
 *
 * Whole days, rounded down — planning a day past the grass is the error worth
 * avoiding — and at least one, so a click always makes a stay that can be
 * stretched by hand. Null when there is nothing to divide by.
 */
export function estimateDays(audsAvailable: number, auPerDay: number): number | null {
  if (!(auPerDay > 0) || !Number.isFinite(audsAvailable)) return null
  return Math.max(1, Math.floor(Math.max(0, audsAvailable) / auPerDay))
}

/** Where the next stay starts: the last stay's end, or the turnout date. */
export function nextStart(steps: Dated[], turnout: string): string {
  return steps.length ? steps[steps.length - 1].end_date : turnout
}

/** True when some stay does not start on the day the one before it ends. */
export function hasGaps(steps: Dated[]): boolean {
  return steps.some((s, i) => i > 0 && s.start_date !== steps[i - 1].end_date)
}

/**
 * Close the plan up after stay `from`: every later stay starts on the end of
 * the one before it and keeps its own length. Stays up to `from` are left as
 * they are. Returns new objects; the input is not changed.
 */
export function cascadeFrom<T extends Dated>(steps: T[], from: number): T[] {
  const out = steps.map((s) => ({ ...s }))
  for (let i = Math.max(1, from + 1); i < out.length; i++) {
    const len = stayDays(steps[i])
    const start = out[i - 1].end_date
    out[i] = { ...out[i], start_date: start, end_date: addDays(start, len) }
  }
  return out
}

/* ------------------------------------------------------------------ rest */

export type Visit = Dated & { pasture_id: string }

export type RestIssue = {
  pasture_id: string
  /** When the cattle came off before. */
  left_on: string
  /** When they are planned back on. */
  back_on: string
  rest_days: number
  min_rest_days: number
}

/** Visits of one pasture merged where they overlap or touch: one occupancy each. */
function occupancies(visits: Dated[]): Dated[] {
  const sorted = [...visits].sort((a, b) => a.start_date.localeCompare(b.start_date))
  const out: Dated[] = []
  for (const v of sorted) {
    const last = out[out.length - 1]
    if (last && v.start_date <= last.end_date) {
      if (v.end_date > last.end_date) last.end_date = v.end_date
    } else out.push({ start_date: v.start_date, end_date: v.end_date })
  }
  return out
}

/**
 * Pastures grazed again before their rest is up.
 *
 * Two groups in one pasture at once, or one following straight on from the
 * other, is one occupancy, not a re-entry: only a gap between occupancies
 * that is shorter than the pasture's minimum rest is reported.
 */
export function restIssues(visits: Visit[], minRest: (pastureId: string) => number | null | undefined): RestIssue[] {
  const by = new Map<string, Visit[]>()
  for (const v of visits) by.set(v.pasture_id, [...(by.get(v.pasture_id) ?? []), v])
  const issues: RestIssue[] = []
  for (const [pid, vs] of by) {
    const need = minRest(pid) ?? 0
    if (!(need > 0)) continue
    const occ = occupancies(vs)
    for (let i = 1; i < occ.length; i++) {
      const rest = daysBetween(occ[i - 1].end_date, occ[i].start_date)
      if (rest < need)
        issues.push({ pasture_id: pid, left_on: occ[i - 1].end_date, back_on: occ[i].start_date, rest_days: rest, min_rest_days: need })
    }
  }
  return issues.sort((a, b) => a.back_on.localeCompare(b.back_on))
}

/* ---------------------------------------------------------------- leases */

export type LeaseLimit = {
  id: string
  disposition_no: string
  pasture_ids: string[]
  max_grazing_days: number | null
  capacity_aum: number | null
  billable_aum: number | null
  /** MM-DD */
  season_start_md: string | null
  season_end_md: string | null
}

/** A stay with the figures the lease sums need. */
export type CountedStay = Visit & { head: number; au_per_head: number; label?: string }

export type LeaseUse = {
  lease: LeaseLimit
  /** Days with cattle on the lease: two groups on it the same day count once. */
  days: number
  aums: number
  /** Days left under the limit; negative when over; null with no limit set. */
  remaining_days: number | null
  over_days: boolean
  over_aums: boolean
  /** Stays that start before the season opens or end after it closes. */
  outside_season: CountedStay[]
  stays: CountedStay[]
}

/** Total days covered by a set of stays, overlaps counted once. */
export function unionDays(stays: Dated[]): number {
  return occupancies(stays).reduce((s, o) => s + stayDays(o), 0)
}

/** 'YYYY-MM-DD' of a month-day in a year; null when unset or malformed. */
export function seasonDate(md: string | null | undefined, year: number): string | null {
  if (!md || !/^[01][0-9]-[0-3][0-9]$/.test(md)) return null
  return `${year}-${md}`
}

/** One lease's planned use for a year, against its limits. */
export function leaseUse(lease: LeaseLimit, stays: CountedStay[], year: number): LeaseUse {
  const on = new Set(lease.pasture_ids)
  const mine = stays.filter((s) => on.has(s.pasture_id))
  const days = unionDays(mine)
  const aums = aumsFromAuDays(mine.reduce((s, x) => s + auDays(x.head, x.au_per_head, stayDays(x)), 0))
  const open = seasonDate(lease.season_start_md, year)
  const close = seasonDate(lease.season_end_md, year)
  const outside = mine.filter((s) => (open != null && s.start_date < open) || (close != null && s.end_date > close))
  const max = lease.max_grazing_days
  const cap = lease.capacity_aum ?? lease.billable_aum
  return {
    lease,
    days,
    aums,
    remaining_days: max == null ? null : max - days,
    over_days: max != null && days > max,
    over_aums: cap != null && cap > 0 && aums > cap + 1e-9,
    outside_season: outside,
    stays: mine,
  }
}

/* ----------------------------------------------------------------- gates */

/** One key for a pair whichever way round it is named. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export type GateNote = {
  /** 'no-gate': they share a fence with no gate on it. 'not-touching': they do not share a fence. */
  kind: 'no-gate' | 'not-touching'
  from: string
  to: string
  /** Index of the stay being moved INTO. */
  index: number
}

/**
 * Moves with no recorded gate. Heads-up only: a move across a couple of
 * pastures is normal, so this never blocks anything.
 */
export function gateNotes(
  pastureIds: string[],
  gates: Set<string>,
  neighbours: Set<string>,
): GateNote[] {
  const out: GateNote[] = []
  for (let i = 1; i < pastureIds.length; i++) {
    const from = pastureIds[i - 1]
    const to = pastureIds[i]
    if (from === to) continue
    const k = pairKey(from, to)
    if (gates.has(k)) continue
    out.push({ kind: neighbours.has(k) ? 'no-gate' : 'not-touching', from, to, index: i })
  }
  return out
}

/* ------------------------------------------------------------- grass use */

/** AUDs eaten per pasture by a set of stays. */
export function auDaysByPasture(stays: CountedStay[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of stays) m.set(s.pasture_id, (m.get(s.pasture_id) ?? 0) + auDays(s.head, s.au_per_head, stayDays(s)))
  return m
}

/* --------------------------------------------------------- actual moves */

export type ActualEvent = {
  pasture_id: string
  turned_in_on: string
  moved_out_on: string | null
  head_count: number | null
}

/**
 * This year's recorded moves as plan stays: the collar import writes a stay
 * as several week-long rows, so back-to-back rows in one pasture are joined
 * into one, and a pasture change starts a new stay. Head is the most seen.
 */
export function eventsToStays(events: ActualEvent[]): (Visit & { head_count: number | null })[] {
  const sorted = [...events].sort(
    (a, b) => a.turned_in_on.localeCompare(b.turned_in_on) || (a.moved_out_on ?? '').localeCompare(b.moved_out_on ?? ''),
  )
  const out: (Visit & { head_count: number | null })[] = []
  for (const e of sorted) {
    const end = e.moved_out_on ?? e.turned_in_on
    const last = out[out.length - 1]
    if (last && last.pasture_id === e.pasture_id) {
      if (end > last.end_date) last.end_date = end
      if ((e.head_count ?? 0) > (last.head_count ?? 0)) last.head_count = e.head_count
    } else out.push({ pasture_id: e.pasture_id, start_date: e.turned_in_on, end_date: end, head_count: e.head_count })
  }
  // A one-day stop on the way through is a move, not a stay.
  return out.filter((s, i) => stayDays(s) > 0 || i === out.length - 1)
}

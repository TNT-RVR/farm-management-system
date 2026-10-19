// When a service is due.
//
// Deere will not tell us: every maintenancePlans endpoint returns 403 or 404 to
// this app (probed 2026-08-11, recorded in jd_api_probes). So the intervals are
// Prairie Creek's own, and nothing here should ever be presented as Deere's advice.
//
// What Deere does give us is real: engine hours from the machines that carry a
// modem, and the machine's own diagnostic alerts.
import { localDate } from './date-range'

export type ServicePlan = {
  id: string
  name: string
  interval_hours: number | null
  interval_months: number | null
  last_done_hours: number | null
  last_done_on: string | null
  warn_within_hours: number
  /** Warning on the calendar half, in days. Missing reads as the default. */
  warn_within_days?: number | null
}

/** Starting margins: 25 hours of running, or two weeks on the calendar. */
export const DEFAULT_WARN_HOURS = 25
export const DEFAULT_WARN_DAYS = 14

export type DueState = 'overdue' | 'due-soon' | 'ok' | 'unknown'

export type Due = {
  state: DueState
  /** Engine hours remaining until due; negative means past it. Null if not tracked by hours. */
  hoursRemaining: number | null
  /** Days remaining until due; negative means past it. Null if not tracked by time. */
  daysRemaining: number | null
  /** Which half of the interval is driving the answer. */
  reason: string
  /** The engine-hour reading it falls due at. Null if not tracked by hours or no baseline. */
  nextDueHours: number | null
  /** The calendar day it falls due (YYYY-MM-DD). Null if not tracked by time or no baseline. */
  nextDueOn: string | null
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * A calendar day `months` later, kept inside the month it lands in: 31 Jan
 * plus one month is 28 (or 29) Feb, not 3 March — which is what Date's own
 * setMonth gives, and put a monthly service in the wrong month.
 */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const year = Math.floor(total / 12)
  const month = total - year * 12
  const last = new Date(year, month + 1, 0).getDate()
  return iso(new Date(year, month, Math.min(d, last), 12))
}

/** Where a plan falls due next, from its last service. Either half may be null. */
export function nextDue(plan: ServicePlan): { hours: number | null; on: string | null } {
  return {
    hours:
      plan.interval_hours != null && plan.last_done_hours != null
        ? plan.last_done_hours + plan.interval_hours
        : null,
    on: plan.interval_months != null && plan.last_done_on ? addMonths(plan.last_done_on, plan.interval_months) : null,
  }
}

/**
 * The plan once a service is recorded: the baseline moves to the hours and
 * date it was done at, so the next due point is one interval on from there —
 * not one interval on from where it was due, which would make a late service
 * look early next time. Hours unknown keep the old hour baseline rather than
 * wiping it.
 */
export function rollForward<P extends ServicePlan>(plan: P, doneOn: string, doneHours: number | null): P {
  return { ...plan, last_done_on: doneOn, last_done_hours: doneHours ?? plan.last_done_hours }
}

const DAY = 86_400_000

/**
 * How a plan stands against the machine's current hours and today's date.
 *
 * An interval can be hours, months, or both — "500 hours or once a year,
 * whichever comes first" is how these actually read, and honouring only one half
 * of that gets it wrong in a way nobody notices until the oil is a season old.
 *
 * `unknown` is a real answer and not a failure: a machine with no modem reports
 * no hours, and a plan whose service has never been logged has no baseline. In
 * both cases we cannot say, and saying "ok" would be a guess in the dangerous
 * direction.
 */
export function dueState(
  plan: ServicePlan,
  currentHours: number | null,
  now: Date = new Date(),
): Due {
  let hoursRemaining: number | null = null
  let daysRemaining: number | null = null
  const next = nextDue(plan)

  // Needs both the machine's hours and the hours at the last service; either
  // one missing means there is no interval to measure.
  if (next.hours != null && currentHours != null) hoursRemaining = next.hours - currentHours

  if (next.on) {
    // The calendar day it falls due, not UTC midnight — which is the evening
    // before in Alberta, and put every service a day early.
    daysRemaining = Math.round((localDate(next.on).getTime() - now.getTime()) / DAY)
  }
  const dueAt = { nextDueHours: next.hours, nextDueOn: next.on }

  if (hoursRemaining == null && daysRemaining == null) {
    return {
      state: 'unknown',
      hoursRemaining: null,
      daysRemaining: null,
      ...dueAt,
      reason:
        plan.interval_hours != null && currentHours == null
          ? 'this machine does not report engine hours'
          : 'no service has been logged yet, so there is nothing to measure from',
    }
  }

  const overdueByHours = hoursRemaining != null && hoursRemaining <= 0
  const overdueByDays = daysRemaining != null && daysRemaining <= 0
  if (overdueByHours || overdueByDays) {
    return {
      state: 'overdue',
      hoursRemaining,
      daysRemaining,
      ...dueAt,
      reason: overdueByHours ? 'past the hour interval' : 'past the time interval',
    }
  }

  const soonByHours = hoursRemaining != null && hoursRemaining <= plan.warn_within_hours
  const soonByDays = daysRemaining != null && daysRemaining <= (plan.warn_within_days ?? DEFAULT_WARN_DAYS)
  if (soonByHours || soonByDays) {
    return {
      state: 'due-soon',
      hoursRemaining,
      daysRemaining,
      ...dueAt,
      reason: soonByHours ? 'approaching the hour interval' : 'approaching the time interval',
    }
  }

  return { state: 'ok', hoursRemaining, daysRemaining, ...dueAt, reason: 'not due' }
}

/** "in 120 h", "overdue by 40 h", "in 3 weeks" — whichever half is closer. */
export function dueLabel(due: Due): string {
  if (due.state === 'unknown') return 'cannot tell'
  const bits: string[] = []
  if (due.hoursRemaining != null) {
    const h = Math.round(Math.abs(due.hoursRemaining))
    bits.push(due.hoursRemaining <= 0 ? `${h} h past due` : `in ${h} h`)
  }
  if (due.daysRemaining != null) {
    const d = Math.abs(due.daysRemaining)
    const span = d >= 60 ? `${Math.round(d / 30)} months` : d >= 14 ? `${Math.round(d / 7)} weeks` : `${d} days`
    bits.push(due.daysRemaining <= 0 ? `${span} past due` : `in ${span}`)
  }
  return bits.join(' · ')
}

/** Worst state first, so what needs doing is at the top. */
export function dueRank(state: DueState): number {
  return { overdue: 0, 'due-soon': 1, unknown: 2, ok: 3 }[state]
}

/** "at 2,500 h · 3 Mar 2027" — where it falls due, whichever halves are known. */
export function nextDueLabel(due: Pick<Due, 'nextDueHours' | 'nextDueOn'>): string | null {
  const bits: string[] = []
  if (due.nextDueHours != null) bits.push(`at ${Math.round(due.nextDueHours).toLocaleString('en-CA')} h`)
  if (due.nextDueOn)
    bits.push(localDate(due.nextDueOn).toLocaleDateString('en-CA', { day: 'numeric', month: 'short', year: 'numeric' }))
  return bits.length ? bits.join(' · ') : null
}

/** How a machine's plans stand together, for a one-badge summary in the fleet list. */
export function serviceSummary(
  plans: readonly ServicePlan[],
  currentHours: number | null,
  now: Date = new Date(),
): { overdue: number; dueSoon: number } {
  let overdue = 0
  let dueSoon = 0
  for (const p of plans) {
    const s = dueState(p, currentHours, now).state
    if (s === 'overdue') overdue++
    else if (s === 'due-soon') dueSoon++
  }
  return { overdue, dueSoon }
}

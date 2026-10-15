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
}

export type DueState = 'overdue' | 'due-soon' | 'ok' | 'unknown'

export type Due = {
  state: DueState
  /** Engine hours remaining until due; negative means past it. Null if not tracked by hours. */
  hoursRemaining: number | null
  /** Days remaining until due; negative means past it. Null if not tracked by time. */
  daysRemaining: number | null
  /** Which half of the interval is driving the answer. */
  reason: string
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

  if (plan.interval_hours != null) {
    // Needs both the machine's hours and the hours at the last service; either
    // one missing means there is no interval to measure.
    if (currentHours != null && plan.last_done_hours != null) {
      hoursRemaining = plan.last_done_hours + plan.interval_hours - currentHours
    }
  }

  if (plan.interval_months != null && plan.last_done_on) {
    // The calendar day it was done, not UTC midnight — which is the evening
    // before in Alberta, and put every service a day early.
    const dueAt = localDate(plan.last_done_on)
    dueAt.setMonth(dueAt.getMonth() + plan.interval_months)
    daysRemaining = Math.round((dueAt.getTime() - now.getTime()) / DAY)
  }

  if (hoursRemaining == null && daysRemaining == null) {
    return {
      state: 'unknown',
      hoursRemaining: null,
      daysRemaining: null,
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
      reason: overdueByHours ? 'past the hour interval' : 'past the time interval',
    }
  }

  const soonByHours = hoursRemaining != null && hoursRemaining <= plan.warn_within_hours
  // A month's warning on the calendar half, which is the usual shape of these.
  const soonByDays = daysRemaining != null && daysRemaining <= 30
  if (soonByHours || soonByDays) {
    return {
      state: 'due-soon',
      hoursRemaining,
      daysRemaining,
      reason: soonByHours ? 'approaching the hour interval' : 'approaching the time interval',
    }
  }

  return { state: 'ok', hoursRemaining, daysRemaining, reason: 'not due' }
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

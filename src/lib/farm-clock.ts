/**
 * The farm's wall clock, for jobs that should act at a local time of day.
 *
 * A scheduled job's cron runs in UTC. Pinned to UTC (13:00 for "7 in the
 * morning"), it was right for Alberta in summer only: an hour early all
 * winter, 9 am in Ontario, the middle of the night in Australia. So the jobs
 * people see the result of run every hour and act only when the farm's own
 * clock (Farm setup's time zone) says it is their time (public copy review
 * item 3, 26 Oct 2026).
 */
import { farmTz } from './farm-context'

export type FarmClock = { weekday: number; day: number; month: number; hour: number }

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** What the farm's clock reads at an instant: weekday (0 Sunday … 6 Saturday), day of the month, month (1–12), hour (0–23). */
export function farmClock(at: Date = new Date(), tz: string = farmTz()): FarmClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'numeric', hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  return { weekday: WEEKDAYS[parts.weekday], day: Number(parts.day), month: Number(parts.month), hour: Number(parts.hour) }
}

export type FarmTime = {
  /** The local hours to act in, e.g. [7], or [6, 16] for morning and afternoon. */
  hours: number[]
  /** Only on this weekday (0 Sunday, 1 Monday …). */
  weekday?: number
  /** Only on this day of the month. */
  day?: number
  /** Only in these months (1–12). */
  months?: number[]
}

/** Is it that time on the farm? For a job scheduled every hour that acts once, at a local time. */
export function farmTimeIs(when: FarmTime, at: Date = new Date(), tz: string = farmTz()): boolean {
  const c = farmClock(at, tz)
  return (
    when.hours.includes(c.hour) &&
    (when.weekday == null || c.weekday === when.weekday) &&
    (when.day == null || c.day === when.day) &&
    (when.months == null || when.months.includes(c.month))
  )
}

/** "Mondays at 7:00", for a job's log line when it is not yet its time. */
export function farmTimeLabel(when: FarmTime): string {
  const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
  const at = when.hours.map((h) => `${h}:00`).join(' and ')
  const on = when.weekday != null ? `${days[when.weekday]} ` : when.day != null ? `on day ${when.day} ` : 'daily '
  return `${on}at ${at} on the farm's clock`
}

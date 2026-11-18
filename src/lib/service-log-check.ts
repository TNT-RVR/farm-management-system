/**
 * The sense checks on a recorded service, before it is saved (page-walk batch 6:
 * a service dated Jun 2027 at 900 h saved without a word on a combine reading
 * 2,148 h, and a negative cost came back as the raw database rule).
 *
 * Pure, so it can be tested: dates are `YYYY-MM-DD` local date keys.
 */

const hoursText = (h: number) => `${Math.round(h).toLocaleString('en-CA')} h`
const dayText = (key: string) =>
  new Date(`${key.slice(0, 10)}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })

/** The day after `key`, as a date key. */
function nextDay(key: string): string {
  const d = new Date(`${key}T00:00:00`)
  d.setDate(d.getDate() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export type ServiceLogCheck = {
  doneOn: string
  engineHours: number | null
  cost: number | null
  /** Today, as a local date key. */
  today: string
  /** The machine's meter now, and the local day it was read (null: not known). */
  meterHours: number | null
  meterOn: string | null
  /** The other services already logged on the machine (not the one being edited). */
  others: readonly { done_on: string; engine_hours: number | null }[]
}

/** Why the service cannot be saved as it stands, or null when it can. */
export function serviceLogProblem(c: ServiceLogCheck): string | null {
  const doneOn = c.doneOn.slice(0, 10)
  // A day of grace, for a phone whose clock or time zone runs a little ahead.
  if (doneOn > nextDay(c.today)) return `${dayText(doneOn)} is in the future. Record a service once it is done.`
  if (c.cost != null && c.cost < 0) return 'A service cost cannot be negative.'
  if (c.engineHours == null) return null
  if (c.engineHours < 0) return 'Engine hours cannot be negative.'

  // Below the meter on or after the day it was read: the meter only goes up.
  // A service dated before the reading is history, and may well be lower.
  if (c.meterHours != null && c.engineHours < Math.floor(c.meterHours)) {
    const meterOn = (c.meterOn ?? c.today).slice(0, 10)
    if (doneOn >= meterOn) {
      return `The meter read ${hoursText(c.meterHours)} on ${dayText(meterOn)}, so a service since then can't be at ${hoursText(c.engineHours)}.`
    }
  }

  // Below a service logged earlier.
  const earlier = c.others
    .filter((o) => o.engine_hours != null && o.done_on.slice(0, 10) < doneOn && c.engineHours! < Number(o.engine_hours))
    .sort((a, b) => Number(b.engine_hours) - Number(a.engine_hours))[0]
  if (earlier) {
    return `The service of ${dayText(earlier.done_on)} was already at ${hoursText(Number(earlier.engine_hours))}, so this one can't be at ${hoursText(c.engineHours)}.`
  }
  return null
}

/**
 * How long is left on a machine's warranty.
 *
 * TWO CLOCKS RUN AT ONCE and the answer is whichever stops first. A powertrain
 * term is "5 years or 3,000 engine hours", so on a combine in a heavy year the
 * hours are gone with two years still on the calendar. Reporting only the date
 * would be confidently wrong on exactly the machines the question matters for,
 * so both are worked out and the nearer one decides the state.
 *
 * NOT RECORDED IS NOT THE SAME AS NOT COVERED. A machine with no warranty date
 * on it reports `unknown`, never `expired` — telling somebody their warranty is
 * up when nobody has typed one in is how a real claim gets missed.
 */
import type { Equipment } from './equipment'

export type WarrantyState =
  /** Nothing recorded. Says nothing about whether cover exists. */
  | 'unknown'
  /** Comfortably in force. */
  | 'ok'
  /** Inside the warning window on either clock. */
  | 'soon'
  /** One of the clocks has run out. */
  | 'expired'

export type Warranty = {
  state: WarrantyState
  /** Days until the expiry date. Negative once it has passed. Null if no date. */
  daysLeft: number | null
  /** Engine hours until the hour limit. Negative once past. Null if unknown. */
  hoursLeft: number | null
  /** Which clock is nearest the end — what the badge is actually about. */
  limitedBy: 'date' | 'hours' | null
  /** One line for a list row: "expires in 24 days", "310 h left". */
  label: string | null
}

/**
 * Inside this many days — or engine hours — a warranty is worth acting on.
 *
 * Ninety days because that is long enough to get a machine into a dealer in
 * the busy part of the year; a fortnight's notice in the middle of harvest is
 * notice of something you cannot do anything about. The hours figure is a
 * season of light work on a tractor and a couple of hard days on a combine,
 * which is the right kind of "soon" for a clock that moves while you watch.
 */
export const WARN_DAYS = 90
export const WARN_HOURS = 150

const DAY = 86_400_000

/** Whole days from today to a yyyy-mm-dd date, in local time. */
export function daysUntil(dateISO: string, today = new Date()): number {
  const [y, m, d] = dateISO.slice(0, 10).split('-').map(Number)
  const target = new Date(y, m - 1, d).getTime()
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  return Math.round((target - from) / DAY)
}

type WarrantyFields = Pick<
  Equipment,
  'warranty_expires_on' | 'warranty_hours' | 'engine_hours'
>

export function warrantyStatus(e: WarrantyFields, today = new Date()): Warranty {
  const daysLeft = e.warranty_expires_on ? daysUntil(e.warranty_expires_on, today) : null
  // Hours only mean something with a reading to compare against. A limit and no
  // reading is not "0 hours left"; it is not knowing.
  const hoursLeft =
    e.warranty_hours != null && e.engine_hours != null
      ? Math.round(e.warranty_hours - e.engine_hours)
      : null

  if (daysLeft == null && hoursLeft == null) {
    return { state: 'unknown', daysLeft: null, hoursLeft: null, limitedBy: null, label: null }
  }

  // Score each clock as a fraction of its own warning window so the two can be
  // compared at all — 40 days and 40 hours are not the same amount of "soon".
  const dateScore = daysLeft == null ? Infinity : daysLeft / WARN_DAYS
  const hourScore = hoursLeft == null ? Infinity : hoursLeft / WARN_HOURS
  const limitedBy: 'date' | 'hours' = hourScore < dateScore ? 'hours' : 'date'

  const expired = (daysLeft != null && daysLeft < 0) || (hoursLeft != null && hoursLeft < 0)
  const soon = (daysLeft != null && daysLeft <= WARN_DAYS) || (hoursLeft != null && hoursLeft <= WARN_HOURS)
  const state: WarrantyState = expired ? 'expired' : soon ? 'soon' : 'ok'

  return { state, daysLeft, hoursLeft, limitedBy, label: labelFor(state, limitedBy, daysLeft, hoursLeft) }
}

function plural(n: number, one: string) {
  return `${n.toLocaleString('en-CA')} ${one}${n === 1 ? '' : 's'}`
}

/** Days as something a person says out loud: "3 months", not "91 days". */
function spell(days: number): string {
  if (days < 45) return plural(days, 'day')
  if (days < 365) return plural(Math.round(days / 30), 'month')
  const years = days / 365
  return years < 1.75 ? '1 year' : `${Math.round(years)} years`
}

function labelFor(
  state: WarrantyState,
  limitedBy: 'date' | 'hours' | null,
  daysLeft: number | null,
  hoursLeft: number | null,
): string | null {
  if (state === 'unknown') return null
  if (state === 'expired') {
    // Say which clock ran out. "Expired" on a machine with two years left on
    // the calendar reads as a mistake until you know it went out on hours.
    const byHours = hoursLeft != null && hoursLeft < 0
    const byDate = daysLeft != null && daysLeft < 0
    if (byHours && byDate) return 'warranty expired'
    return byHours ? `over by ${plural(-hoursLeft!, 'hour')}` : `expired ${spell(-daysLeft!)} ago`
  }
  if (limitedBy === 'hours' && hoursLeft != null) return `${plural(hoursLeft, 'hour')} of warranty left`
  if (daysLeft != null) return daysLeft === 0 ? 'warranty ends today' : `warranty ends in ${spell(daysLeft)}`
  return null
}

/** Tailwind classes for the state, shared by the list, the detail page and the calendar. */
export const WARRANTY_STYLE: Record<Exclude<WarrantyState, 'unknown'>, string> = {
  ok: 'bg-green-50 text-green-800 ring-1 ring-green-200',
  soon: 'bg-amber-100 text-amber-900 ring-1 ring-amber-300',
  expired: 'bg-gray-100 text-gray-500 ring-1 ring-gray-300',
}

/**
 * Half-open calendar-date ranges on plain YYYY-MM-DD strings.
 *
 * Lives in src/lib for the same reason et.ts and acis.ts do: it is shared with
 * the Netlify functions, and that is where the test runner can reach it.
 *
 * Everything here treats `to` as EXCLUSIVE, matching FieldNET's
 * /applied-irrigation, so a single day is [D, D+1). Getting that bound wrong
 * silently double-counts a pass or drops one, which is invisible in the output
 * and wrong in the balance — hence the tests.
 *
 * Dates are anchored at UTC midnight deliberately. These are calendar days, not
 * instants, and parsing a bare YYYY-MM-DD through the local-time constructor is
 * the classic way to slip a day either side of the date line.
 */

/** Shift a YYYY-MM-DD by whole days. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Every date in [from, to). Empty when from >= to. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d)
  return out
}

/**
 * Split [from, to) into calendar-month chunks, each clipped to the range, so a
 * caller can probe a whole month before deciding to walk its days.
 */
export function monthsIn(from: string, to: string): { key: string; start: string; end: string }[] {
  const out: { key: string; start: string; end: string }[] = []
  if (from >= to) return out
  let cur = `${from.slice(0, 7)}-01`
  while (cur < to) {
    // The 28th plus a week is always inside the following month, for every
    // month length including a leap February.
    const next = `${addDays(`${cur.slice(0, 7)}-28`, 7).slice(0, 7)}-01`
    out.push({
      key: cur.slice(0, 7),
      start: cur < from ? from : cur,
      end: next > to ? to : next,
    })
    cur = next
  }
  return out
}

/**
 * A YYYY-MM-DD as the wall-clock day it names, for showing or comparing to
 * today.
 *
 * The opposite need from everything above. `new Date('2026-09-18')` is UTC
 * midnight, which in Alberta is six o'clock the previous evening — so a
 * registration that expires on the 18th read as expired on the 17th, and a
 * service due on the 1st came due on the last day of the month before. Noon
 * rather than midnight so a daylight-saving change cannot move it either.
 */
export function localDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

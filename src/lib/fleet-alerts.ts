/**
 * What the whole fleet needs doing, in the words the strip above the equipment
 * list uses.
 *
 * Each machine already wears its own badge in the list — a warranty running
 * out, a service overdue. These are the same facts counted over the fleet, so
 * that there is something to see without scrolling, and while a search or a
 * category has the list narrowed to something else.
 *
 * They used to share the line under the page's title with the fleet's standing
 * numbers. The November frame briefly put the whole of that line behind the ⓘ;
 * asked whether these two should sit on the page instead, Sam said to put
 * them there (20 Nov 2026). The gloss is this file's rather than his: a warning
 * nobody opens is not a warning. Hence a strip of its own, and hence this
 * function — the counts come from two different places (lib/warranty.ts and
 * lib/maintenance.ts), so the wording is worth having in one testable spot.
 *
 * The two have since gone separate ways, which is why the strip stayed when
 * the frame grew a `note` slot. "59 machines and implements" is the `note`:
 * one quiet grey line, in sight, where a standing number belongs. A warning
 * moved into that line would be demoted, not promoted, so it keeps the amber.
 */

/** Which fact a line is about, so the caller can pick its icon. */
export type FleetAlertKey = 'warranty' | 'service'

export type FleetAlert = { key: FleetAlertKey; text: string }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function fleetAlerts(counts: {
  /** Machines whose warranty is close to its date or hour limit. */
  endingSoon: number
  /** Scheduled services overdue or due soon, across every machine. */
  servicesDue: number
}): FleetAlert[] {
  const out: FleetAlert[] = []
  // Nothing to do is not a line saying so: an empty strip is one more thing to
  // read past every day, and the page's `note` already carries the fleet's
  // standing numbers whether or not there is anything to act on.
  if (counts.endingSoon > 0) {
    out.push({ key: 'warranty', text: `${plural(counts.endingSoon, 'warranty', 'warranties')} running out` })
  }
  if (counts.servicesDue > 0) {
    out.push({ key: 'service', text: `${plural(counts.servicesDue, 'service', 'services')} due` })
  }
  return out
}

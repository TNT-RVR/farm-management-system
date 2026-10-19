/**
 * Machines whose engine hours have stopped updating (Sam, 16 Oct 2026).
 * Service reminders count engine hours, so a machine whose Deere modem went
 * quiet stops coming due by hours without anyone noticing.
 *
 * Stale: a Deere machine (not one added by hand, not archived) that has
 * reported hours, whose latest reading is more than 30 days old, while some
 * other machine has reported within those 30 days. When the whole fleet is
 * quiet (winter, or the Deere sync itself is down) no one machine is singled
 * out: the feed watchdog speaks for the sync. Pure, so the equipment pages,
 * the what's-missing checklist and the tests share one copy.
 */

export const STALE_HOURS_DAYS = 30

export type HoursRow = {
  id: string
  engine_hours: number | string | null
  engine_hours_at: string | null
  archived?: boolean | null
  is_manual?: boolean | null
}

const DAY = 86_400_000

const reports = (m: HoursRow) => m.engine_hours != null && m.engine_hours_at != null && !m.archived && !m.is_manual

/** Every stale machine: id → when its hours were last read. */
export function staleHoursMachines(fleet: readonly HoursRow[], now: Date | number = Date.now()): Map<string, string> {
  const cutoff = (typeof now === 'number' ? now : now.getTime()) - STALE_HOURS_DAYS * DAY
  const reporting = fleet.filter(reports)
  const fresh = new Set(reporting.filter((m) => Date.parse(m.engine_hours_at!) >= cutoff).map((m) => m.id))
  const out = new Map<string, string>()
  // Nobody reporting: the silence is the sync's, not any one machine's.
  if (!fresh.size) return out
  for (const m of reporting) if (!fresh.has(m.id)) out.set(m.id, m.engine_hours_at!)
  return out
}

/** When this machine's hours stopped updating, or null when they have not. */
export function hoursStaleSince(machine: HoursRow, fleet: readonly HoursRow[], now: Date | number = Date.now()): string | null {
  const all = fleet.some((m) => m.id === machine.id) ? fleet : [...fleet, machine]
  return staleHoursMachines(all, now).get(machine.id) ?? null
}

/** "Jul 2, 2026", the farm's calendar day of the last reading. */
export function staleHoursDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Edmonton' })
}

/** "hours not updating since Jul 2, 2026". */
export function staleHoursLabel(iso: string): string {
  return `hours not updating since ${staleHoursDate(iso)}`
}

/**
 * When the problem-fixer is stuck (Sam, 16 Oct 2026). The hourly Claude
 * task sets an app_issues row 'working' while it is on it; a run that stalls
 * leaves it there. Past two hours the database sweep (fn_app_issue_stall_sweep,
 * 20261016060000) puts it back in the queue once and tells the managers; a
 * second stall is left 'working' and they are told again. This is the
 * banner's half: which rows read "stuck since".
 *
 * How long a row has been 'working' is working_since: updated_at also moves
 * when the same problem is reported again. updated_at stands in only until
 * the migration adding working_since is applied.
 */

export const STUCK_AFTER_HOURS = 2

export type WorkingRow = { status: string; working_since?: string | null; updated_at?: string | null }

/** When a row being worked on got stuck (the time it started), or null when it is not stuck. */
export function stuckSince(row: WorkingRow, now: Date | number = Date.now()): string | null {
  if (row.status !== 'working') return null
  const since = row.working_since ?? row.updated_at ?? null
  if (!since) return null
  const t = typeof now === 'number' ? now : now.getTime()
  return t - Date.parse(since) > STUCK_AFTER_HOURS * 3_600_000 ? since : null
}

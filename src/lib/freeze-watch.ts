/**
 * When is the first hard freeze, and does it need announcing?
 *
 * Used by the freeze watch (netlify/shared/freeze-watch.ts) for checklists
 * that are due before the ground freezes — winterizing, where water left in a
 * line or a pump splits it. A "hard freeze" is a night at or below `lowC`, or a
 * day that never climbs above `highC` (nothing thaws, so a frozen line stays
 * frozen). Both are farm settings (operating_settings 'freeze_watch').
 */

export type FreezeRule = { lowC: number; highC: number }
export const DEFAULT_FREEZE_RULE: FreezeRule = { lowC: -8, highC: 0 }

export type DayForecast = { date: string; tmin: number | null; tmax: number | null }
export type HardFreeze = { date: string; tmin: number | null; tmax: number | null; why: 'night' | 'day' }

export function firstHardFreeze(days: DayForecast[], rule: FreezeRule = DEFAULT_FREEZE_RULE): HardFreeze | null {
  for (const d of days) {
    if (d.tmin != null && d.tmin <= rule.lowC) return { ...d, why: 'night' }
    if (d.tmax != null && d.tmax <= rule.highC) return { ...d, why: 'day' }
  }
  return null
}

/**
 * Announce a freeze once. Again only if the forecast brings it EARLIER than
 * the one announced (less time than people were told), or the announced one
 * has passed and another is coming while the checklist is still open.
 */
export function freezeNeedsAlert(announced: string | null, freeze: string, today: string): boolean {
  if (!announced) return true
  if (announced < today) return true
  return freeze < announced
}

/** Settings row → rule, ignoring anything that isn't a number. */
export function freezeRuleFrom(value: unknown): FreezeRule {
  const v = (value ?? {}) as { low_c?: unknown; high_c?: unknown }
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d)
  return { lowC: num(v.low_c, DEFAULT_FREEZE_RULE.lowC), highC: num(v.high_c, DEFAULT_FREEZE_RULE.highC) }
}

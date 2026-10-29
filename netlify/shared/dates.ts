import { farmTz } from '../../src/lib/farm-context.ts'

// The farm's calendar and clock, for functions. The zone is Farm setup's
// (America/Edmonton unless a farm says otherwise), read at call time because
// hydrateSecrets fills it in after the module loads.

/** Today's date on the farm, YYYY-MM-DD. */
export const farmToday = (at: Date = new Date()): string => at.toLocaleDateString('en-CA', { timeZone: farmTz() })

/** The farm-local hour (0–23), minute and month (1–12) of an instant. */
export function farmClock(at: Date = new Date()): { hour: number; minute: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: farmTz(), hourCycle: 'h23', hour: 'numeric', minute: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { hour: get('hour'), minute: get('minute'), month: get('month'), day: get('day') }
}

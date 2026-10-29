/**
 * Truck forecast (Sam, 23 Oct 2026): how many semi loads a field should
 * take, from its forecast yield and the farm's own average load off the
 * scale, and, as loads are weighed, how many more are expected.
 *
 *   loads for the field = forecast bushels × test weight ÷ average net load
 *   more expected       = bushels still to come × test weight ÷ average net load
 *
 * "Still to come" is the forecast less what has been weighed, so a field
 * yielding better than forecast runs to zero early and then says it is over
 * ("N past the forecast"); one marked last-load is done whatever the sums say.
 *
 * The average load is the trucks the farm hauls with now: a truck taken off
 * the list (Clay's, used once with half a load) keeps its loads in the
 * history but is left out of the average, or it would make every field look
 * like it needs more trucks than it does.
 */

export const KG_PER_LB = 0.45359237

/** The part of a weigh-in load the forecast reads. */
export type ForecastLoad = {
  field_id: string | null
  crop_id: string | null
  crop_year: number
  net_kg: number | string | null
  bushels: number | string | null
  truck: string | null
  entry_kind?: string | null
  estimated?: boolean | null
  last_from_field?: boolean | null
  /** Half-weighed (full only): not a finished load yet. */
  open?: boolean
}

export type AverageLoad = { kg: number; loads: number; scope: 'crop' | 'all' }

const num = (v: number | string | null | undefined) => (v == null || v === '' ? null : Number(v))

/**
 * The average net load: a finished, weighed load (not a guess, not a bin
 * total) on a truck still on the list or with no truck recorded. The crop's
 * own average once it has three such loads, since a canola load and a wheat
 * load do not weigh the same; the farm's across every crop before that.
 */
export function averageLoad(loads: ForecastLoad[], activeTrucks: ReadonlySet<string>, cropId: string | null): AverageLoad | null {
  const usable = loads.filter((l) => {
    const kg = num(l.net_kg)
    if (l.open || l.estimated || (l.entry_kind && l.entry_kind !== 'weighed') || kg == null || kg <= 0) return false
    return !l.truck || activeTrucks.has(l.truck)
  })
  const avg = (rows: ForecastLoad[]) => rows.reduce((s, l) => s + Number(l.net_kg), 0) / rows.length
  const own = cropId ? usable.filter((l) => l.crop_id === cropId) : []
  if (own.length >= 3) return { kg: avg(own), loads: own.length, scope: 'crop' }
  if (usable.length) return { kg: avg(usable), loads: usable.length, scope: 'all' }
  return null
}

export type TruckForecast = {
  /** Trucks the whole field should take, rounded up. */
  totalTrucks: number
  /** Loads weighed off it so far this season. */
  weighed: number
  weighedBu: number
  /** More trucks expected, rounded up; 0 once the field is done or past its forecast. */
  remaining: number
  /** Bushels still to come by the forecast; negative once past it. */
  remainingBu: number
  /** The last load is marked: the field is finished. */
  done: boolean
  /** Weighed more than the forecast, by this many bushels (0 if not). */
  overBu: number
}

/** One field's (one crop's) forecast. Null when it cannot be worked out: no forecast yield, no test weight or no average load. */
export function truckForecast(input: {
  forecastBu: number | null
  lbPerBu: number | null
  average: AverageLoad | null
  weighed: number
  weighedBu: number
  done: boolean
}): TruckForecast | null {
  const { forecastBu, lbPerBu, average, weighed, weighedBu, done } = input
  if (forecastBu == null || !(forecastBu > 0) || !lbPerBu || !average || !(average.kg > 0)) return null
  const trucksFor = (bu: number) => Math.ceil((bu * lbPerBu * KG_PER_LB) / average.kg - 1e-9)
  const remainingBu = forecastBu - weighedBu
  return {
    totalTrucks: trucksFor(forecastBu),
    weighed,
    weighedBu,
    remaining: done || remainingBu <= 0 ? 0 : trucksFor(remainingBu),
    remainingBu,
    done,
    overBu: remainingBu < 0 ? -remainingBu : 0,
  }
}

/** The loads weighed off a field (one crop of it) this season. */
export function weighedFrom(loads: ForecastLoad[], fieldId: string, cropId: string | null, cropYear: number) {
  const mine = loads.filter((l) => l.field_id === fieldId && l.crop_year === cropYear && !l.open && (!cropId || !l.crop_id || l.crop_id === cropId))
  return {
    weighed: mine.length,
    weighedBu: mine.reduce((s, l) => s + (num(l.bushels) ?? 0), 0),
    done: mine.some((l) => l.last_from_field),
  }
}

/** "About 8 more trucks", "Done", "2,100 bu past the forecast". */
export function remainingText(f: TruckForecast): string {
  if (f.done) return 'Done'
  if (f.overBu > 0) return `${Math.round(f.overBu).toLocaleString('en-CA')} bu past the forecast`
  return `About ${f.remaining} more truck${f.remaining === 1 ? '' : 's'}`
}

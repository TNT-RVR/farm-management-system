/**
 * What it costs to put a depth of water on with a pivot — Sam, 6 Oct 2026:
 * "on each pivot detail page have the cost to put down 1/4 inch, half inch,
 * 3/4 inch and 1 inch."
 *
 * The same sum the water review does: gallons for the depth over the pivot's
 * acres, hours at the pivot's flow, kWh at the horsepower the pivot draws
 * (its share of a pump that feeds more than one), dollars at the grid price
 * (the pumps pay it; the solar is not at the pump sites). Depths are pumped,
 * out of the nozzles: into the soil takes about 1 / application efficiency
 * more.
 */
import { useQuery } from '@tanstack/react-query'
import { fetchFarmPowerCost, powerPrices } from './reports/water-review'
import { GAL_PER_ACRE_INCH, pumpKwh } from './water-review'

export const PIVOT_DEPTHS_IN = [0.25, 0.5, 0.75, 1] as const

export type DepthCost = {
  depthIn: number
  hours: number
  kwh: number | null
  cost: number | null
  perAcre: number | null
  /** Percent-timer setting for the depth in one pass, when the pass time is known; null when lighter than one pass at 100% can go. */
  timerPct: number | null
  /** What the water itself is worth: acre-feet pumped × the farm's value an acre-foot; null when no value is set. */
  waterValue: number | null
}

/** The depth one pass puts on at 100% timer, inches, from the pivot's flow and its pass time. */
export function depthAt100(acres: number, gpm: number, passHours: number): number {
  return (gpm * 60 * passHours) / (acres * GAL_PER_ACRE_INCH)
}

export function depthCosts(o: {
  acres: number | null
  gpm: number | null
  hp: number | null
  pricePerKwh: number
  /** Hours for one pass at 100% timer (field_pivots.time_to_full_circle_h). */
  passHours?: number | null
  /** $ an acre-foot the water is worth (farms.water_value_af). */
  waterValueAf?: number | null
  depths?: readonly number[]
}): DepthCost[] | null {
  const { acres, gpm, hp } = o
  if (!acres || acres <= 0 || !gpm || gpm <= 0) return null
  const full = o.passHours && o.passHours > 0 ? depthAt100(acres, gpm, o.passHours) : null
  return (o.depths ?? PIVOT_DEPTHS_IN).map((d) => {
    const hours = (acres * GAL_PER_ACRE_INCH * d) / (gpm * 60)
    const kwh = hp && hp > 0 ? pumpKwh(hp, hours) : null
    const cost = kwh == null ? null : kwh * o.pricePerKwh
    const pct = full == null ? null : (full / d) * 100
    const waterValue = o.waterValueAf != null && o.waterValueAf > 0 ? ((acres * d) / 12) * o.waterValueAf : null
    return { depthIn: d, hours, kwh, cost, perAcre: cost == null ? null : cost / acres, timerPct: pct == null || pct > 100 ? null : pct, waterValue }
  })
}

/** The farm's power prices (Financials → farm settings), for the pivot pages. */
export function usePowerPrices() {
  const q = useQuery({ queryKey: ['farm-power-prices'], queryFn: fetchFarmPowerCost, staleTime: 10 * 60_000 })
  return { ...q, prices: powerPrices(q.data) }
}

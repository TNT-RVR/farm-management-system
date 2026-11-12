/**
 * What a truckload is worth, at the crop's own price (Sam, 2 Nov 2026:
 * "when you click on an individual weight slip please also show the estimated
 * value of that truckload based of the crop prices page").
 *
 * The sum is only as hard as the units make it. A load is weighed in
 * kilograms and held in bushels; a crop is priced in whatever it sells in —
 * beans by the pound, corn by the bushel, hay by the ton — so the bushels
 * have to be turned into the crop's own unit before the price touches them.
 * Pounds are the common ground, and a bushel only converts to pounds through
 * the crop's bushel weight, which is why a crop without one gets no value.
 *
 * The price is the one the rest of the app uses (forecast.ts resolvePrice):
 * this year's where it is set, else the market, else the last year one was.
 * Nothing here is a sale — it is the load at the price on the crop's page.
 */
import { convertYield } from './fert-savings/checks'
import type { YieldUnit } from './fert-savings/checks'

export type LoadValue = {
  /** The load in the crop's selling unit. */
  amount: number
  unit: YieldUnit
  /** Dollars, at the price given. */
  dollars: number
}

/**
 * Null when it cannot be worked out honestly: no bushels on the load, no
 * price for the crop, or bushels that cannot reach the crop's unit because
 * its bushel weight has never been set.
 */
export function loadValue(a: {
  bushels: number | null | undefined
  /** The load's own bushel weight, else the crop's. */
  lbPerBu: number | null | undefined
  unit: YieldUnit | null | undefined
  price: number | null | undefined
}): LoadValue | null {
  const bu = Number(a.bushels)
  const price = Number(a.price)
  if (!Number.isFinite(bu) || bu <= 0) return null
  if (!Number.isFinite(price) || price <= 0) return null
  const unit = a.unit ?? 'bu'
  const lb = Number(a.lbPerBu)
  const amount = convertYield(bu, 'bu', unit, Number.isFinite(lb) && lb > 0 ? lb : null)
  if (amount == null || !Number.isFinite(amount)) return null
  return { amount, unit, dollars: amount * price }
}

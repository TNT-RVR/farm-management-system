import { describe, expect, it } from 'vitest'
import { weightedAsShown } from './water-review'
import { powerPrices } from './reports/water-review'

describe('weightedAsShown', () => {
  // Batch 6: rows printed 9.4 / 6.6 / 6.6 in on 130 / 131 / 130 ac; the farm row said 7.6.
  const rows = [
    { inches: 9.44, acres: 130.4 },
    { inches: 6.64, acres: 130.6 },
    { inches: 6.64, acres: 130.4 },
  ]
  it('weights the rows as printed, not the figures behind them', () => {
    const raw = rows.reduce((s, r) => s + r.inches * r.acres, 0) / rows.reduce((s, r) => s + r.acres, 0)
    expect(Number(raw.toFixed(1))).toBe(7.6)
    expect(weightedAsShown(rows, (r) => r.inches, (r) => r.acres, 1)).toBe(7.5)
  })
  it('leaves out rows with no value or no acres, and is null with none left', () => {
    expect(weightedAsShown([{ v: 4, a: 10 }, { v: null, a: 50 }, { v: 9, a: 0 }], (r) => r.v, (r) => r.a, 1)).toBe(4)
    expect(weightedAsShown([{ v: null, a: 10 }], (r) => r.v, (r) => r.a, 1)).toBeNull()
  })
  it('rounds the weight to the places it is shown at', () => {
    // 0.4 ac shows as 0 and drops out at whole acres; at two places it counts.
    const rs = [{ v: 10, a: 0.4 }, { v: 2, a: 10 }]
    expect(weightedAsShown(rs, (r) => r.v, (r) => r.a, 1)).toBe(2)
    expect(weightedAsShown(rs, (r) => r.v, (r) => r.a, 1, 2)).toBe(2.3)
  })
})

describe('powerPrices and the Solar switch', () => {
  const farm = { power_sell_kwh: 0.35, power_buy_kwh: 0.085, power_value_basis: 'sell' }
  it('prices at the sell price when the farm has solar and chose it', () => {
    expect(powerPrices({ ...farm, solar_on: true })).toMatchObject({ basis: 'sell', solarOn: true })
  })
  it('prices at the buy price with solar off, whatever the setting says', () => {
    expect(powerPrices({ ...farm, solar_on: false })).toMatchObject({ basis: 'buy', solarOn: false, buy: 0.085 })
  })
  it('keeps the setting when the switch was not read', () => {
    expect(powerPrices(farm).basis).toBe('sell')
    expect(powerPrices(null).basis).toBe('buy')
  })
})

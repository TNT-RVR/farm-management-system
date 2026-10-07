import { describe, expect, it } from 'vitest'
import { historyWeight, ranchSale, saleWeightSource, type SaleLot } from './calf-sale'

const lot = (crop_year: number, animal_class: string, head: number | null, avg_weight_lb: number | null, ranch = 'Home Ranch'): SaleLot => ({ ranch, crop_year, animal_class, head, avg_weight_lb })

describe('calf sale weights per ranch', () => {
  const sales = [
    lot(2025, 'heifers', 78, 547),
    lot(2025, 'bulls', 100, 600),
    lot(2024, 'steers', 50, 560),
    lot(2024, 'runts', 5, 350),
    lot(2018, 'steers', 80, 700), // outside the last five years
    lot(2025, 'steers', 60, 900, 'East Ranch'),
  ]

  it('averages the ranch’s own lots by head, steers with the uncut bulls', () => {
    const s = historyWeight(sales, 'Home Ranch', 'steers')!
    expect(s.lb).toBe(Math.round((100 * 600 + 50 * 560) / 150))
    expect(s.lots).toBe(2)
    expect(s.years).toEqual([2024, 2025])
    expect(historyWeight(sales, 'Home Ranch', 'heifers')!.lb).toBe(547)
  })

  it('a typed weight wins; a blank one comes from history; none falls to Farm setup', () => {
    const farm = { calfSaleWeightLb: 450, calfSaleMonth: 12 }
    const bi = ranchSale({ name: 'East Ranch', steer_sale_weight_lb: 750, heifer_sale_weight_lb: 650, calf_sale_month: 11 }, sales, farm)
    expect(bi.steers).toEqual({ lb: 750, from: 'typed' })
    expect(bi.heifers.lb).toBe(650)
    expect(bi.month).toBe(11)
    const gl = ranchSale({ name: 'Home Ranch', steer_sale_weight_lb: null, heifer_sale_weight_lb: null, calf_sale_month: 12 }, sales, farm)
    expect(gl.steers.from).toBe('history')
    expect(saleWeightSource(gl.steers)).toBe('average of 2 lots, 2024–2025')
    const none = ranchSale({ name: 'Elsewhere', steer_sale_weight_lb: null, heifer_sale_weight_lb: null, calf_sale_month: null }, sales, farm)
    expect(none.steers).toEqual({ lb: 450, from: 'farm' })
    expect(none.monthFrom).toBe('farm')
  })
})

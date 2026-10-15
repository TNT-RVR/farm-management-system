import { describe, expect, it } from 'vitest'
import { contractMinimums, cropMargin, type MarginInputs } from './rotation-margins'

const base: MarginInputs = {
  crops: [
    { id: 'can', name: 'Canola', yield_unit: 'bu', default_yield_per_acre: 70, margin_per_acre: null },
    { id: 'pin', name: 'Beans-Pinto', yield_unit: 'lbs', default_yield_per_acre: 3000, margin_per_acre: null },
    { id: 'bar', name: 'Barley', yield_unit: 'bu', default_yield_per_acre: null, margin_per_acre: null },
  ],
  history: [
    { field_id: 'f1', crop_id: 'can', crop_year: 2025, yield_per_acre: 60, yield_unit: 'bu', source: 'scale' },
    { field_id: 'f1', crop_id: 'can', crop_year: 2023, yield_per_acre: 50, yield_unit: 'bu', source: 'scale' },
    { field_id: 'f2', crop_id: 'can', crop_year: 2024, yield_per_acre: 40, yield_unit: 'bu', source: 'scale' },
    { field_id: 'f2', crop_id: 'can', crop_year: 2015, yield_per_acre: 99, yield_unit: 'bu', source: 'scale' },
  ],
  prices: [{ crop_id: 'can', crop_year: 2026, price_per_unit: 18 }],
  contracts: [],
  inputs: [
    { crop_id: 'can', crop_year: 2026, cost_per_acre: 500 },
    { crop_id: 'can', crop_year: 2026, cost_per_acre: 100 },
  ],
  market: [{ crop_id: 'can', commodity: 'Canola', unit: '$/tonne', value: 705.52, observed_on: '2026-07-01' }],
  today: '2026-09-29',
}

describe('crop margins', () => {
  it('uses the farm average until a field has five seasons, the market for a year with no price, and the latest budget', () => {
    const m = cropMargin(base, 'can', 2027, 'f1')
    expect(m.yield).toBe(50) // 60, 50, 40 — two seasons on f1 is not enough for its own
    expect(m.yieldFrom).toMatch(/farm average/)
    expect(m.price).toBeCloseTo(705.52 / 44.092, 2)
    expect(m.priceFrom).toMatch(/Alberta market, Jul 2026/)
    expect(m.cost).toBe(600)
    expect(m.costFrom).toBe('2026 input budget')
    expect(m.from).toBe('built')
    expect(m.margin).toBeCloseTo(50 * (705.52 / 44.092) - 600, 1)
  })

  it("uses a field's own average once it has five seasons", () => {
    const own = [2021, 2022, 2023, 2024, 2025].map((y) => ({ field_id: 'f1', crop_id: 'can', crop_year: y, yield_per_acre: 66, yield_unit: 'bu', source: 'scale' }))
    const m = cropMargin({ ...base, history: own }, 'can', 2027, 'f1')
    expect(m.yield).toBe(66)
    expect(m.yieldFrom).toMatch(/this field's 5-season average/)
  })

  it('carries 2026 forward for a crop with no market, and uses the year’s own price when there is one', () => {
    const noMarket = { ...base, market: [] }
    expect(cropMargin(noMarket, 'can', 2027).priceFrom).toBe('your 2026 price')
    expect(cropMargin(base, 'can', 2026, 'f9').priceFrom).toBe('your 2026 price')
  })

  it('prices barley off the elevator bid', () => {
    const m = cropMargin({ ...base, bids: new Map([['ab.elevator.feed-barley.central', 251.25]]) }, 'bar', 2027)
    expect(m.price).toBeCloseTo(5.47, 2)
    expect(m.priceFrom).toMatch(/elevator bid, feed barley/)
  })

  it('ignores planned (Farm at Hand) yields', () => {
    const m = cropMargin({ ...base, history: [{ field_id: 'f1', crop_id: 'can', crop_year: 2025, yield_per_acre: 90, yield_unit: 'bu', source: 'fah_import' }] }, 'can', 2027)
    expect(m.yield).toBe(70)
    expect(m.yieldFrom).toMatch(/normal yield/)
  })

  it('a contract outranks every other price', () => {
    const m = cropMargin({ ...base, contracts: [{ crop_id: 'can', crop_year: 2027, bushels: 1000, price_per_unit: 20 }] }, 'can', 2027)
    expect(m.price).toBe(20)
    expect(m.priceFrom).toMatch(/contracted/)
  })

  it('has no margin when a piece is missing, unless one was typed by hand', () => {
    expect(cropMargin(base, 'bar', 2027)).toMatchObject({ from: 'none', margin: null })
    const typed = { ...base, crops: base.crops.map((c) => (c.id === 'bar' ? { ...c, margin_per_acre: 351 } : c)) }
    expect(cropMargin(typed, 'bar', 2027)).toMatchObject({ from: 'budget', margin: 351 })
  })

  it('turns contracted bushels into minimum acres at the expected yield', () => {
    const mins = contractMinimums({ ...base, contracts: [{ crop_id: 'can', crop_year: 2027, bushels: 5000, price_per_unit: 20 }] }, 2027)
    expect(mins.get('can')!.acres).toBeCloseTo(100, 5)
  })

  it('leaves out a yield typed in another unit', () => {
    const alf = {
      ...base,
      crops: [...base.crops, { id: 'alf', name: 'Alfalfa', yield_unit: 'lbs', default_yield_per_acre: 12000, margin_per_acre: null }],
      history: [...base.history, { field_id: 'f1', crop_id: 'alf', crop_year: 2025, yield_per_acre: 12, yield_unit: 'lbs', source: 'manual' }],
    }
    const m = cropMargin(alf, 'alf', 2027)
    expect(m.yield).toBe(12000)
    expect(m.yieldFrom).toMatch(/normal yield/)
  })
})

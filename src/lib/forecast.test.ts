import { describe, expect, it } from 'vitest'
import { expectedYield, isActualYield, marketPrice, resolveCosts, resolvePrice, type YieldRecord } from './forecast'

describe('resolvePrice', () => {
  const prices = [
    { crop_id: 'corn', crop_year: 2026, price_per_unit: 7.24 },
    { crop_id: 'corn', crop_year: 2025, price_per_unit: 6.5 },
  ]
  it("uses the year's own price, and calls a later year's a forecast", () => {
    expect(resolvePrice('corn', 2026, prices, { currentYear: 2026 })).toMatchObject({ value: 7.24, basis: 'set', label: '2026 price' })
    const f = resolvePrice('corn', 2027, [...prices, { crop_id: 'corn', crop_year: 2027, price_per_unit: 6.9 }], { currentYear: 2026 })
    expect(f).toMatchObject({ value: 6.9, basis: 'forecast', label: '2027 forecast' })
  })
  it('carries the latest earlier price forward when the year has none', () => {
    expect(resolvePrice('corn', 2027, prices, { currentYear: 2026 })).toMatchObject({ value: 7.24, basis: 'carried', fromYear: 2026, label: '2026 price' })
  })
  it('fills a crop with a public bid from the market until a price is typed', () => {
    const market = { value: 5.47, label: 'elevator bid, feed barley, Central' }
    expect(resolvePrice('barley', 2026, prices, { market, currentYear: 2026 })).toMatchObject({ value: 5.47, basis: 'market' })
    const typed = resolvePrice('barley', 2026, [{ crop_id: 'barley', crop_year: 2026, price_per_unit: 6 }], { market, currentYear: 2026 })
    expect(typed).toMatchObject({ value: 6, basis: 'set' })
  })
  it('says so when there is no price at all', () => {
    expect(resolvePrice('peas', 2026, prices, { currentYear: 2026 })).toMatchObject({ value: null, basis: 'none' })
  })
})

describe('marketPrice', () => {
  const bids = new Map([['ab.elevator.feed-barley.central', 251.25], ['ab.elevator.canola.central', 776.8]])
  it('turns the feed barley bid into $/bu', () => {
    expect(marketPrice('Barley', 'bu', bids)?.value).toBeCloseTo(5.47, 2)
  })
  it('has no market price for seed canola or a crop sold by the pound', () => {
    expect(marketPrice('BASF Canola', 'bu', bids)).toBeNull()
    expect(marketPrice('Barley', 'lbs', bids)).toBeNull()
  })
})

describe('resolveCosts', () => {
  const inputs = [
    { crop_id: 'corn', crop_year: 2026, cost_per_acre: 495.73, name: 'Variable' },
    { crop_id: 'corn', crop_year: 2026, cost_per_acre: 100, name: 'Seed' },
    { crop_id: 'corn', crop_year: 2025, cost_per_acre: 400, name: 'Old' },
  ]
  it("uses the year's own budget", () => {
    expect(resolveCosts('corn', 2026, inputs, 2026)).toMatchObject({ total: 595.73, basis: 'set' })
  })
  it("follows 2026's budget for 2027 until 2027 has its own", () => {
    const c = resolveCosts('corn', 2027, inputs, 2026)
    expect(c).toMatchObject({ total: 595.73, basis: 'carried', fromYear: 2026, label: '2026 costs' })
    const own = resolveCosts('corn', 2027, [...inputs, { crop_id: 'corn', crop_year: 2027, cost_per_acre: 610, name: 'Variable' }], 2026)
    expect(own).toMatchObject({ total: 610, basis: 'forecast' })
  })
  it('is empty with no budget', () => {
    expect(resolveCosts('peas', 2026, inputs, 2026)).toMatchObject({ total: 0, basis: 'none' })
  })
})

describe('expectedYield', () => {
  const rec = (field: string, year: number, y: number, extra: Partial<YieldRecord> = {}): YieldRecord => ({
    field_id: field,
    crop_id: 'can',
    crop_year: year,
    acres: 100,
    yield_per_acre: y,
    yield_unit: 'bu',
    source: 'scale',
    ...extra,
  })
  const base = { cropId: 'can', year: 2027, unit: 'bu', goal: 40 }

  it('uses the goal until something has been harvested', () => {
    expect(expectedYield({ ...base, history: [] })).toMatchObject({ value: 40, basis: 'goal' })
  })
  it('ignores Farm at Hand planned yields — they are the hopeful figure', () => {
    const h = [rec('a', 2025, 50, { source: 'fah_import' })]
    expect(expectedYield({ ...base, history: h })).toMatchObject({ value: 40, basis: 'goal' })
  })
  it('keeps the goal after one season on one or two fields', () => {
    const h = [rec('moreau', 2026, 40.7, { acres: 140 }), rec('home', 2026, 38)]
    expect(expectedYield({ ...base, history: h })).toMatchObject({ value: 40, basis: 'goal' })
  })
  it('switches to the farm average after two harvested seasons', () => {
    const h = [rec('moreau', 2025, 38), rec('moreau', 2026, 42)]
    expect(expectedYield({ ...base, history: h })).toMatchObject({ value: 40, basis: 'farm', seasons: 2 })
  })
  it('or after one season grown on three fields', () => {
    const h = [rec('a', 2026, 30), rec('b', 2026, 40), rec('c', 2026, 50)]
    expect(expectedYield({ ...base, history: h })).toMatchObject({ value: 40, basis: 'farm', seasons: 1 })
  })
  it('weights a season by acres and counts each season once', () => {
    const h = [rec('a', 2025, 30, { acres: 100 }), rec('b', 2025, 60, { acres: 300 }), rec('a', 2026, 40, { acres: 100 })]
    // 2025: (3000 + 18000) / 400 = 52.5; 2026: 40 → (52.5 + 40) / 2
    expect(expectedYield({ ...base, history: h }).value).toBeCloseTo(46.25, 5)
  })
  it("uses a field's own average once it has five seasons of the crop", () => {
    const own = [2021, 2022, 2023, 2024, 2025].map((y) => rec('home', y, 50))
    const other = [rec('away', 2025, 20)]
    expect(expectedYield({ ...base, history: [...own, ...other], fieldId: 'home' })).toMatchObject({ value: 50, basis: 'field', seasons: 5 })
    // Four seasons is not enough: the farm average still rules.
    const four = own.slice(1)
    expect(expectedYield({ ...base, history: [...four, ...other], fieldId: 'home' }).basis).toBe('farm')
  })
  it('prefers the clean yield, and leaves out other units and later years', () => {
    const h = [
      rec('a', 2025, 45, { clean_yield_per_acre: 42 }),
      rec('a', 2026, 45, { clean_yield_per_acre: 42 }),
      rec('b', 2026, 12, { yield_unit: 'lbs' }),
      rec('c', 2028, 90),
    ]
    expect(expectedYield({ ...base, history: h })).toMatchObject({ value: 42, basis: 'farm' })
  })
  it('throws out a yield typed in the wrong unit', () => {
    expect(isActualYield(rec('a', 2026, 4), 'bu', 40)).toBe(false)
    expect(isActualYield(rec('a', 2026, 41), 'bu', 40)).toBe(true)
  })
})

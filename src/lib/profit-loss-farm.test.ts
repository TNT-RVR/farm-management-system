import { describe, expect, it } from 'vitest'
import { farmBooks, farmTotals, type FarmInputs } from './profit-loss-farm'

const resolve = (n: string) => (n === '46-0-0' ? { name: 'Tonne 46-0-0', pricePerUnit: 0.8 } : null)

const urea = (id: string, field: string) => ({
  id,
  field_id: field,
  operation_type: 'application',
  crop_season: 2026,
  products: [{ name: '46-0-0', '@type': 'Product', tankMix: false }],
  as_applied: [{ name: '46-0-0', carrier: false, totalUnit: 'kg', totalValue: 1000 }],
  applied_area_ha: 40,
})

const base = (): FarmInputs => ({
  cropYear: 2026,
  fields: [
    { id: 'a', name: 'Creek Flat' },
    { id: 'b', name: 'Kellers' },
    { id: 'c', name: 'Idle' },
  ],
  seasons: new Map([
    ['a', { cropName: 'Beans', yieldUnit: 'lbs', acres: 100, yieldTotal: 300000, price: 0.5 }],
    ['b', { cropName: 'Corn', yieldUnit: 'bu', acres: 100, yieldTotal: null, price: 7 }],
  ]),
  ops: [urea('u1', 'a'), urea('u2', 'b')],
  layers: [],
  saved: [],
  resolve,
  priceSource: 'target',
})

describe('farmBooks', () => {
  it('prices each field the way its own page does', () => {
    const [cook] = farmBooks(base())
    expect(cook.name).toBe('Creek Flat')
    expect(cook.revenue).toBe(150000)
    expect(cook.cost).toBeCloseTo(800, 9)
    expect(cook.netPerAcre).toBeCloseTo((150000 - 800) / 100, 9)
  })

  it('gives an unharvested field its costs and no profit, and lists it after', () => {
    const books = farmBooks(base())
    const kellers = books.find((b) => b.name === 'Kellers')!
    expect(kellers.hasYield).toBe(false)
    expect(kellers.net).toBeNull()
    expect(kellers.cost).toBeCloseTo(800, 9)
    expect(books.map((b) => b.name)).toEqual(['Creek Flat', 'Kellers'])
  })

  it('leaves out a field with nothing grown, applied or entered', () => {
    expect(farmBooks(base()).some((b) => b.name === 'Idle')).toBe(false)
  })

  it('applies a field’s saved edits', () => {
    const inp = base()
    inp.saved = [
      { field_id: 'a', side: 'input', line_key: 'm', label: 'Land rent', unit: 'ac', price_per_unit: 200, amount: 100, is_manual: true, removed: false },
    ]
    expect(farmBooks(inp)[0].cost).toBeCloseTo(20800, 9)
  })

  it('charges the farm’s fixed expenses on every field’s acres', () => {
    const inp = { ...base(), fixedPerAcre: 530 }
    const books = farmBooks(inp)
    expect(books.find((b) => b.name === 'Creek Flat')!.cost).toBeCloseTo(800 + 53000, 9)
    expect(books.find((b) => b.name === 'Kellers')!.costPerAcre).toBeCloseTo(8 + 530, 9)
  })

  it('lets a field take the fixed row off', () => {
    const inp = { ...base(), fixedPerAcre: 530 }
    inp.saved = [{ field_id: 'a', side: 'input', line_key: 'auto:fixed-expenses', label: 'Fixed expenses', unit: 'ac', price_per_unit: null, amount: null, is_manual: false, removed: true }]
    expect(farmBooks(inp)[0].cost).toBeCloseTo(800, 9)
  })
})

describe('farmTotals', () => {
  it('nets the harvested fields and reports what the rest have spent', () => {
    const t = farmTotals(farmBooks(base()))
    expect(t.harvestedFields).toBe(1)
    expect(t.net).toBeCloseTo(150000 - 800, 9)
    expect(t.unharvestedFields).toBe(1)
    expect(t.unharvestedCost).toBeCloseTo(800, 9)
  })
})

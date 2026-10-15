import { describe, expect, it } from 'vitest'
import {
  compareRows,
  defaultSort,
  groupProducts,
  isBlend,
  type SortableRow,
} from './product-groups'

const row = (over: Partial<SortableRow>): SortableRow => ({
  name: 'x',
  unit: 'kg',
  price: null,
  pricedOn: null,
  lastApplied: null,
  fieldCount: 0,
  ...over,
})

describe('isBlend', () => {
  it('catches ICI blends and leaves the straights alone', () => {
    expect(isBlend('Tonne 28.2-10.8-4.3-4.3-0.4B-0.1Zn Blend')).toBe(true)
    expect(isBlend('Tonne 46-0-0')).toBe(false)
    expect(isBlend('Filtered 28-0-0 UAN')).toBe(false)
    expect(isBlend('Tonne 40 Rock M.A.P')).toBe(false)
  })
})

describe('groupProducts', () => {
  const p = (name: string, price_updated_on: string | null) => ({ name, price_updated_on })

  it('folds blends into their year and leaves straights as rows', () => {
    const out = groupProducts(
      [
        p('Tonne 46-0-0', '2024-04-29'),
        p('Tonne 18-9-1.7 Blend', '2024-05-01'),
        p('Tonne 20.3-17.4 Blend', '2024-05-13'),
        p('Tonne 31.4-20.9 Blend', '2023-04-29'),
        p('Tonne 32.2-9.9 Blend', '2023-05-19'),
      ],
      true,
    )
    expect(out.filter((g) => g.kind === 'group').map((g) => g.kind === 'group' && g.label)).toEqual([
      '2024 custom blends',
      '2023 custom blends',
    ])
    expect(out.filter((g) => g.kind === 'row')).toHaveLength(1)
  })

  it('does not hide a lone blend behind a group', () => {
    const out = groupProducts([p('Tonne 18-9-1.7 Blend', '2025-08-06')], true)
    expect(out).toEqual([
      { kind: 'row', key: 'Tonne 18-9-1.7 Blend', item: p('Tonne 18-9-1.7 Blend', '2025-08-06') },
    ])
  })

  it('passes everything through when grouping is off', () => {
    const items = [p('Tonne 18-9-1.7 Blend', '2025-08-06'), p('Liberty', null)]
    expect(groupProducts(items, false).every((g) => g.kind === 'row')).toBe(true)
  })
})

describe('compareRows', () => {
  it('keeps blanks last whichever way the column is sorted', () => {
    const priced = row({ name: 'a', price: 5 })
    const blank = row({ name: 'b', price: null })
    expect(compareRows(priced, blank, 'price', 'asc')).toBeLessThan(0)
    expect(compareRows(priced, blank, 'price', 'desc')).toBeLessThan(0)
  })

  it('reverses on direction for values that are present', () => {
    const cheap = row({ name: 'a', price: 1 })
    const dear = row({ name: 'b', price: 9 })
    expect(compareRows(cheap, dear, 'price', 'asc')).toBeLessThan(0)
    expect(compareRows(cheap, dear, 'price', 'desc')).toBeGreaterThan(0)
  })

  it('sorts dates as dates', () => {
    const older = row({ name: 'a', pricedOn: '2023-05-19' })
    const newer = row({ name: 'b', pricedOn: '2025-08-06' })
    expect(compareRows(newer, older, 'priced_on', 'desc')).toBeLessThan(0)
  })

  it('breaks ties by name so the order never wobbles', () => {
    const a = row({ name: 'Aim', price: 5 })
    const b = row({ name: 'Basagran', price: 5 })
    expect(compareRows(a, b, 'price', 'asc')).toBeLessThan(0)
    expect(compareRows(a, b, 'price', 'desc')).toBeLessThan(0)
  })
})

describe('defaultSort', () => {
  it('puts priced products at the top', () => {
    const out = defaultSort([
      row({ name: 'unpriced', price: null }),
      row({ name: 'zebra', price: 2 }),
      row({ name: 'apple', price: 9 }),
    ])
    expect(out.map((r) => r.name)).toEqual(['apple', 'zebra', 'unpriced'])
  })
})

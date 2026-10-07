import { describe, expect, it } from 'vitest'
import { CELL_ACRES } from './pl-grid'
import { FIXED_KEY, LAND_SHARE_KEY, autoFixed, autoInputs, autoOutput, fixedAreasFrom, fixedLines, forMap, mergeLines, type SavedLine } from './profit-loss-lines'

const prices: Record<string, { name: string; pricePerUnit: number | null }> = {
  '46-0-0': { name: 'Tonne 46-0-0', pricePerUnit: 0.8 },
  'pinto seed': { name: 'Pinto seed', pricePerUnit: 2 },
}
const resolve = (n: string) => prices[n.trim().toLowerCase()] ?? null

// The urea pass on #5, 12 May 2026, as Deere stores it: a product with no
// rate at all, and a measured total.
const urea = {
  id: 'urea-op',
  operation_type: 'application',
  crop_season: 2026,
  jd_id: 'u1',
  started_at: '2026-05-12T15:00:00Z',
  applied_area_ha: 62.8,
  products: [{ guid: 'g', name: '46-0-0', '@type': 'Product', tankMix: false, productType: 'FERTILIZER' }],
  as_applied: [{ name: '46-0-0', carrier: false, rateUnit: 'kg1ha-1', rateValue: 39.23, totalUnit: 'kg', totalValue: 2464 }],
}

const seeding = { id: 'seed-op', operation_type: 'seeding', crop_season: 2026, products: [] }
// Two cells at 100 lb/ac, fully covered.
const seedGrid = {
  operation_id: 'seed-op',
  kind: 'input',
  product_name: 'Pinto seed',
  rate_unit: 'lb1ac-1',
  cells: [
    [0, 0, 100, 1],
    [1, 0, 100, 1],
  ] as [number, number, number, number][],
}

describe('autoInputs', () => {
  it('prices a pass from its measured total when it has no per-acre rate', () => {
    const [line] = autoInputs([urea], [], 2026, 155.64, resolve)
    expect(line.label).toBe('Tonne 46-0-0')
    expect(line.unit).toBe('kg')
    expect(line.amount).toBe(2464)
    expect(line.price).toBeCloseTo(0.8, 9)
    expect(line.problem).toBeNull()
    expect(line.passes).toEqual([{ operationId: 'urea-op', share: 1 }])
  })

  it('takes seed off the planter grid, in kg', () => {
    const [line] = autoInputs([seeding], [seedGrid], 2026, 155.64, resolve)
    const lb = 100 * 2 * CELL_ACRES
    expect(line.amount).toBeCloseTo(lb * 0.45359237, 9)
    expect(line.price).toBe(2)
  })

  it('says so when a product has no price, instead of calling it free', () => {
    const [line] = autoInputs([{ ...urea, products: [{ ...urea.products[0], name: 'Mystery' }], as_applied: [{ ...urea.as_applied[0], name: 'Mystery' }] }], [], 2026, 155.64, resolve)
    expect(line.price).toBeNull()
    expect(line.problem).toMatch(/no price/)
  })

  it('ignores other seasons', () => {
    expect(autoInputs([{ ...urea, crop_season: 2025 }], [], 2026, 155.64, resolve)).toEqual([])
  })
})

describe('mergeLines', () => {
  const auto = autoInputs([urea], [], 2026, 155.64, resolve)
  const saved = (over: Partial<SavedLine>): SavedLine => ({
    side: 'input',
    line_key: 'tonne 46-0-0',
    label: 'Tonne 46-0-0',
    unit: 'kg',
    price_per_unit: null,
    amount: null,
    is_manual: false,
    removed: false,
    ...over,
  })

  it('lays a typed price over the automatic one and keeps the automatic amount', () => {
    const [l] = mergeLines(auto, [saved({ price_per_unit: 1 })])
    expect(l.price).toBe(1)
    expect(l.amount).toBe(2464)
    expect(l.total).toBe(2464)
    expect(l.edited).toEqual({ price: true, amount: false })
    expect(l.auto?.price).toBeCloseTo(0.8, 9)
  })

  it('drops a removed automatic row and adds rows typed by hand', () => {
    const lines = mergeLines(auto, [
      saved({ removed: true }),
      saved({ line_key: 'm1', label: 'Labour', unit: 'ac', price_per_unit: 25, amount: 155.64, is_manual: true }),
    ])
    expect(lines.map((l) => l.label)).toEqual(['Labour'])
    expect(lines[0].total).toBeCloseTo(3891, 9)
  })
})

describe('forMap', () => {
  it('places machine rows on their passes and spreads the rest per acre', () => {
    const lines = mergeLines(
      [
        ...autoInputs([urea], [], 2026, 155.64, resolve),
        autoOutput({ name: 'Beans-Pinto', unit: 'lbs', total: 300000 }, 0.5, 'target')!,
      ],
      [
        { side: 'input', line_key: 'm1', label: 'Land rent', unit: 'ac', price_per_unit: 100, amount: 100, is_manual: true, removed: false },
        { side: 'output', line_key: 'm2', label: 'Straw', unit: 'bale', price_per_unit: 20, amount: 50, is_manual: true, removed: false },
      ],
    )
    const m = forMap(lines, 100, new Set(['urea-op']), 'beans-pinto')
    expect(m.placed.get('urea-op')).toBeCloseTo(2464 * 0.8, 9)
    expect(m.flatPerAcre).toBe(100)
    expect(m.otherRevenuePerAcre).toBe(10)
    expect(m.revenue).toBe(150000 + 1000)
    expect(m.cost).toBeCloseTo(2464 * 0.8 + 10000, 9)
  })

  it('spreads a pass evenly when it has not been gridded yet, rather than dropping it', () => {
    const lines = mergeLines(autoInputs([urea], [], 2026, 155.64, resolve), [])
    const m = forMap(lines, 100, new Set(), null)
    expect(m.placed.size).toBe(0)
    expect(m.flatPerAcre).toBeCloseTo((2464 * 0.8) / 100, 9)
  })
})

describe('autoFixed', () => {
  it('charges the farm figure on the field’s acres, spread evenly', () => {
    const line = autoFixed(530, 155.64)!
    expect(line).toMatchObject({ key: FIXED_KEY, side: 'input', label: 'Fixed expenses', unit: 'ac', price: 530, amount: 155.64, passes: [] })
    const m = forMap(mergeLines([line], []), 155.64, new Set(), null)
    expect(m.flatPerAcre).toBeCloseTo(530, 9)
  })

  it('says when the figure is carried from an earlier year', () => {
    expect(autoFixed(530, 100, 2026)!.source).toBe('farm costs, 2026 figure')
  })

  it('adds nothing with no figure set or no acres', () => {
    expect(autoFixed(null, 100)).toBeNull()
    expect(autoFixed(530, 0)).toBeNull()
  })
})

describe('fixed expenses by crop area on a split field (6 Oct 2026)', () => {
  const crops = [
    { id: 'corn', fixed_costs_apply: true, land_rent_only: false },
    { id: 'carrot', fixed_costs_apply: true, land_rent_only: true },
    { id: 'creamer', fixed_costs_apply: true, land_rent_only: false },
    { id: 'spinach', fixed_costs_apply: true, land_rent_only: true },
    { id: 'theirs', fixed_costs_apply: false, land_rent_only: false },
  ]
  const zones = [
    { field_id: '9', crop_id: 'corn', crop_year: 2026, acres: '24.31' },
    { field_id: '9', crop_id: 'carrot', crop_year: 2026, acres: '22.00' },
    { field_id: '10', crop_id: 'creamer', crop_year: 2026, acres: '40.00' },
    { field_id: '10', crop_id: 'spinach', crop_year: 2026, acres: '17.00' },
    { field_id: '10', crop_id: 'theirs', crop_year: 2026, acres: '5' },
    { field_id: '9', crop_id: 'corn', crop_year: 2025, acres: '46.31' },
  ]
  const areas = fixedAreasFrom(zones, crops, 2026)
  const total = (ls: ReturnType<typeof fixedLines>) => ls.reduce((s, l) => s + (l.price ?? 0) * (l.amount ?? 0), 0)

  it('counts our crops in full and land rented out as its land share, by the year asked', () => {
    expect(areas.get('9')).toEqual({ full: 24.31, landShare: 22 })
    expect(areas.get('10')).toEqual({ full: 40, landShare: 17 })
  })

  it('charges 9 by area, not its whole 46.31 ac at the full figure', () => {
    const ls = fixedLines({ perAcre: 790.69, carriedFrom: null, landSharePerAcre: 157.59, acres: 46.31, fixedApplies: true, areas: areas.get('9') })
    expect(ls.map((l) => l.key)).toEqual([FIXED_KEY, LAND_SHARE_KEY])
    expect(total(ls)).toBeCloseTo(24.31 * 790.69 + 22 * 157.59, 2)
  })

  it('leaves the land share off for anyone who cannot see it, and the unplanted ground uncharged', () => {
    const ls = fixedLines({ perAcre: 790.69, carriedFrom: null, landSharePerAcre: null, acres: 77.37, fixedApplies: true, areas: areas.get('10') })
    expect(ls.map((l) => l.key)).toEqual([FIXED_KEY])
    expect(total(ls)).toBeCloseTo(40 * 790.69, 2)
  })

  it('charges an unsplit field on its acres, as before', () => {
    const ls = fixedLines({ perAcre: 790.69, carriedFrom: null, landSharePerAcre: 157.59, acres: 155.64, fixedApplies: true, areas: undefined })
    expect(total(ls)).toBeCloseTo(155.64 * 790.69, 2)
    expect(fixedLines({ perAcre: 790.69, carriedFrom: null, landSharePerAcre: null, acres: 50, fixedApplies: false, areas: undefined })).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { binNumber, byYardThenNumber, estimateBins, planBinsForFields, type CropBinOverride, plansWithZones } from './bins'
import type { BinAllocationRow, BinRow } from './bins'
import type { CropPlanRow, CropRow } from './queries'

const crop = (over: Partial<CropRow>): CropRow =>
  ({
    id: 'corn',
    name: 'Grain Corn',
    yield_unit: 'bu',
    bin_policy: 'mixable',
    active: true,
    default_yield_per_acre: 100,
    needs_bins: true,
    test_weight_lb_per_bu: null,
    ...over,
  }) as unknown as CropRow

const plan = (over: Partial<CropPlanRow>): CropPlanRow =>
  ({
    id: 'p1',
    crop_id: 'corn',
    field_id: 'f1',
    planned_acres: 100,
    variety: null,
    ...over,
  }) as unknown as CropPlanRow

const bin = (id: string, cap: number): BinRow =>
  ({ id, name: id, capacity_bu: cap, active: true }) as unknown as BinRow

const alloc = (bin_id: string): BinAllocationRow =>
  ({ id: bin_id, bin_id, crop_id: 'corn' }) as unknown as BinAllocationRow

const acres = () => 100

describe('estimateBins bin overrides', () => {
  const crops = [crop({})]
  const plans = [plan({})]
  const bins = [bin('b1', 5000)]
  const allocs = [alloc('b1')]

  it('leaves out an archived crop that still has plans on the books', () => {
    const retired = [crop({ active: false, name: 'Summer Fallow' })]
    expect(estimateBins(retired, plans, bins, allocs, acres)).toEqual([])
  })

  it('counts the whole crop with no override', () => {
    const [line] = estimateBins(crops, plans, bins, allocs, acres)
    expect(line.needsBins).toBe(true)
    expect(line.productionBu).toBe(10000)
    expect(line.shortfallBu).toBe(5000)
    expect(line.overridden).toBe(false)
  })

  it('drops a crop the year says is not binned, without touching the crop', () => {
    const ov = new Map<string, CropBinOverride>([
      [
        'corn',
        { crop_id: 'corn', needs_bins: false, stored_bu: null, note: 'straight to the plant' },
      ],
    ])
    const [line] = estimateBins(crops, plans, bins, allocs, acres, ov)
    expect(line.needsBins).toBe(false)
    expect(line.shortfallBu).toBe(0)
    expect(line.summary).toContain('straight to the plant')
    // The crop itself is untouched — next year starts from its own setting.
    expect(crops[0].needs_bins).toBe(true)
  })

  it('sizes storage against the part that is binned, not the whole crop', () => {
    const ov = new Map<string, CropBinOverride>([
      ['corn', { crop_id: 'corn', needs_bins: null, stored_bu: 4000, note: null }],
    ])
    const [line] = estimateBins(crops, plans, bins, allocs, acres, ov)
    expect(line.productionBu).toBe(4000)
    expect(line.shortfallBu).toBe(0) // 5000 bu allocated covers it
    expect(line.overridden).toBe(true)
    expect(line.storedBu).toBe(4000)
  })

  it('a year can bin a crop the crop itself says is never binned', () => {
    const baled = [crop({ needs_bins: false })]
    const ov = new Map<string, CropBinOverride>([
      ['corn', { crop_id: 'corn', needs_bins: true, stored_bu: null, note: null }],
    ])
    const [line] = estimateBins(baled, plans, bins, allocs, acres, ov)
    expect(line.needsBins).toBe(true)
    expect(line.productionBu).toBe(10000)
  })

  it('an override row that says nothing leaves the crop setting alone', () => {
    const baled = [crop({ needs_bins: false })]
    const ov = new Map<string, CropBinOverride>([
      ['corn', { crop_id: 'corn', needs_bins: null, stored_bu: null, note: null }],
    ])
    const [line] = estimateBins(baled, plans, bins, allocs, acres, ov)
    expect(line.needsBins).toBe(false)
  })
})

describe('yard ordering', () => {
  it('reads the number out of a bin name however it is punctuated', () => {
    expect(binNumber('Main Yard - #13')).toBe(13)
    expect(binNumber('Main Yard #23')).toBe(23)
    expect(binNumber('Main Yard- #20 (Fertilizer Bin)')).toBe(20)
    expect(binNumber('Main Yard - #15 (2)')).toBe(15)
  })

  it('puts #2 before #10 — a name sort does not', () => {
    const names = ['#10', '#2', '#1', '#21']
    const sorted = names
      .map((name) => ({ name, site: 'Main Yard' }))
      .sort(byYardThenNumber)
      .map((b) => b.name)
    expect(sorted).toEqual(['#1', '#2', '#10', '#21'])
    // The failure this guards against.
    expect([...names].sort()).not.toEqual(sorted)
  })

  it('keeps each yard together so the list is walked in order', () => {
    const sorted = [
      { name: 'Main Yard - #1', site: 'Main Yard' },
      { name: 'Creek Yard - #2', site: 'Creek Yard' },
      { name: 'Creek Yard - #1', site: 'Creek Yard' },
      { name: 'Main Yard - #2', site: 'Main Yard' },
    ]
      .sort(byYardThenNumber)
      .map((b) => b.name)
    expect(sorted).toEqual([
      'Creek Yard - #1',
      'Creek Yard - #2',
      'Main Yard - #1',
      'Main Yard - #2',
    ])
  })
})

describe('planBinsForFields', () => {
  const f = (fieldId: string, bushels: number | null) => ({ fieldId, bushels })

  it('uses the smallest bin the remainder fits in, not the biggest', () => {
    // Moreaus' 9,800 bushels is 5,800 + 4,000. Taking the largest every time
    // makes it two 5,800s and burns the big bins on remainders.
    const out = planBinsForFields([f('moreaus', 9800)], [5800, 5800, 4000, 4000])
    expect(out.total).toBe(2)
  })

  it('does not let two fields use the same bin', () => {
    // The bug this replaced: sizing each field against the whole yard
    // separately let all three canola fields "use" the same pair of
    // fertiliser bins and reported five where six are needed.
    const yard = [5800, 5800, 4000, 4000, 4000, 4000, 2000, 2000]
    const shared = planBinsForFields(
      [f('moreaus', 9798), f('lindgren', 7722), f('moreauw', 4541)],
      yard,
    )
    const independent = [9798, 7722, 4541]
      .map((bu) => planBinsForFields([f('x', bu)], yard).total)
      .reduce((a, b) => a + b, 0)
    expect(shared.total).toBeGreaterThan(independent)
    expect(shared.total).toBe(6)
  })

  it('gives the big bins to the big fields', () => {
    // Sized smallest-first, a 60 acre field takes the 5,800 and the big field
    // behind it splits across three.
    const out = planBinsForFields([f('small', 1000), f('big', 9000)], [5800, 4000, 4000])
    expect(out.perField.get('big')).toBe(2)
    expect(out.perField.get('small')).toBe(1)
  })

  it('keeps counting when the yard runs out', () => {
    // Storage the farm does not have is still the answer being asked for.
    const out = planBinsForFields([f('huge', 30000)], [4000, 4000])
    expect(out.total).toBe(2 + Math.ceil(22000 / 4000))
  })

  it('leaves out a field it cannot size rather than calling it one bin', () => {
    const out = planBinsForFields([f('a', null), f('b', 0)], [4000])
    expect(out.total).toBe(0)
    expect(out.perField.size).toBe(0)
  })

  it('fits exactly without spilling into another bin', () => {
    expect(planBinsForFields([f('a', 4000)], [4000, 4000]).total).toBe(1)
    expect(planBinsForFields([f('a', 4001)], [4000, 4000]).total).toBe(2)
  })
})

describe('estimateBins sizes a segregated field by its yield', () => {
  const canola = crop({
    id: 'canola',
    name: 'Canola',
    bin_policy: 'segregate_by_field',
    default_yield_per_acre: 70,
  })
  // The three real 2026 canola fields.
  const plans = [
    plan({ id: 'p1', crop_id: 'canola', field_id: 'moreaus', planned_acres: 140 }),
    plan({ id: 'p2', crop_id: 'canola', field_id: 'lindgren', planned_acres: 110 }),
    plan({ id: 'p3', crop_id: 'canola', field_id: 'moreauw', planned_acres: 65 }),
  ]
  const yard = [bin('b1', 4000), bin('b2', 4000), bin('b3', 4000), bin('b4', 4000)]

  it('counts the bins each field actually needs, not one each', () => {
    // 9,800 + 7,700 + 4,550 bushels against 4,000 bushel bins is 3 + 2 + 2.
    // The old line said three — one per field — and was wrong on every field
    // big enough to matter.
    const [line] = estimateBins([canola], plans, yard, [], acres)
    expect(line.neededBins).toBe(7)
    expect(line.summary).toContain('7 bins for 3 fields')
  })

  it('does not hand the same fertiliser bin to two fields', () => {
    // Two 5,800s among the 4,000s. Sized independently every field claims one
    // and the answer comes out a bin short.
    const withFertBins = [...yard, bin('f1', 5800), bin('f2', 5800)]
    const [line] = estimateBins([canola], plans, withFertBins, [], acres)
    expect(line.neededBins).toBe(6)
  })

  it('says which fields have to be split, so the count does not read as a bug', () => {
    const [line] = estimateBins([canola], plans, yard, [], acres)
    expect(line.summary).toContain('3 fields need more than one bin')
  })

  it('takes fewer bins when a bigger one is on the yard', () => {
    const withFertBins = [...yard, bin('f1', 5800), bin('f2', 5800)]
    const [line] = estimateBins([canola], plans, withFertBins, [], acres)
    expect(line.neededBins).toBeLessThan(7)
  })

  it('still needs one bin per field when every field is small', () => {
    const small = [
      plan({ id: 'p1', crop_id: 'canola', field_id: 'a', planned_acres: 20 }),
      plan({ id: 'p2', crop_id: 'canola', field_id: 'b', planned_acres: 20 }),
    ]
    const [line] = estimateBins([canola], small, yard, [], acres)
    expect(line.neededBins).toBe(2)
    expect(line.summary).not.toContain('more than one bin')
  })
})

describe('plansWithZones', () => {
  const plan = { id: 'p1', field_id: 'whitfield', crop_id: 'corn', crop_year: 2026, planned_acres: 171.46, yield_per_acre_override: 175 }
  it('counts a split field as its crop areas, keeping the plan yield on the plan crop', () => {
    const out = plansWithZones(
      [plan, { ...plan, id: 'p2', field_id: 'moreaus', crop_id: 'canola', planned_acres: 139.97 }],
      [
        { id: 'z1', field_id: 'whitfield', crop_year: 2026, crop_id: 'corn', acres: '31.37' },
        { id: 'z2', field_id: 'whitfield', crop_year: 2026, crop_id: 'potato', acres: 140.09 },
        { id: 'z3', field_id: 'whitfield', crop_year: 2025, crop_id: 'wheat', acres: 171 },
      ],
      2026,
    )
    expect(out.map((p) => [p.field_id, p.crop_id, p.planned_acres, p.yield_per_acre_override])).toEqual([
      ['whitfield', 'corn', 31.37, 175],
      ['whitfield', 'potato', 140.09, null],
      ['moreaus', 'canola', 139.97, 175],
    ])
  })
})

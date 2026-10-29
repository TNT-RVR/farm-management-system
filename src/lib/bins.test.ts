import { describe, expect, it } from 'vitest'
import { binNumber, byYardThenNumber, estimateBins, planBinsForFields, type CropBinOverride, plansWithZones, yardRoom } from './bins'
import type { BinAllocationRow, BinRow } from './bins'
import type { VarietySettingRow } from './crop-variety-settings'
import type { CropPlanRow, CropRow } from './queries'
import type { YieldCut } from './yield-estimate'

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
    const [line] = estimateBins(crops, plans, bins, allocs, acres, { overrideByCrop: ov })
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
    const [line] = estimateBins(crops, plans, bins, allocs, acres, { overrideByCrop: ov })
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
    const [line] = estimateBins(baled, plans, bins, allocs, acres, { overrideByCrop: ov })
    expect(line.needsBins).toBe(true)
    expect(line.productionBu).toBe(10000)
  })

  it('an override row that says nothing leaves the crop setting alone', () => {
    const baled = [crop({ needs_bins: false })]
    const ov = new Map<string, CropBinOverride>([
      ['corn', { crop_id: 'corn', needs_bins: null, stored_bu: null, note: null }],
    ])
    const [line] = estimateBins(baled, plans, bins, allocs, acres, { overrideByCrop: ov })
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

describe('estimateBins with yield cuts and ranges', () => {
  // Made-up figures: 100 ac at 100 bu/ac.
  const cut = (over: Partial<YieldCut>): YieldCut => ({ id: 'c', field_id: 'f1', crop_year: 2030, crop_id: null, zone_id: null, loss_pct: 50, reason: 'hail', ...over })
  const p = (over: Partial<CropPlanRow>) => plan({ crop_year: 2030, ...over })

  it('takes a cut off the estimate and says how much', () => {
    const [line] = estimateBins([crop({})], [p({})], [bin('b1', 5000)], [], acres, { cuts: [cut({ crop_id: 'corn', loss_pct: 25 })] })
    expect(line.estimatedBu).toBe(7500)
    expect(line.cutBu).toBe(2500)
    expect(line.cuts).toEqual([{ fieldId: 'f1', label: '−25% · hail' }])
  })

  it('shows the bushel range from the crop’s normal range', () => {
    const [line] = estimateBins([crop({ yield_low_per_acre: 80, yield_high_per_acre: 120 })], [p({})], [], [], acres)
    expect([line.estimatedLowBu, line.estimatedBu, line.estimatedHighBu]).toEqual([8000, 10000, 12000])
  })

  it('has no range with no range set', () => {
    const [line] = estimateBins([crop({})], [p({})], [], [], acres)
    expect(line.estimatedLowBu).toBeNull()
    expect(line.estimatedHighBu).toBeNull()
  })

  it('a field hailed out needs no bin of its own', () => {
    const canola = crop({ id: 'canola', bin_policy: 'segregate_by_field', default_yield_per_acre: 50 })
    const plans = [p({ id: 'a', crop_id: 'canola', field_id: 'f1' }), p({ id: 'b', crop_id: 'canola', field_id: 'f2' })]
    const [line] = estimateBins([canola], plans, [bin('b1', 6000), bin('b2', 6000)], [], acres, { cuts: [cut({ loss_pct: 100 })] })
    expect(line.neededBins).toBe(1)
    expect(line.estimatedBu).toBe(5000)
  })

  it('a cut on one crop area of a split field leaves the other area alone', () => {
    const plans = plansWithZones(
      [p({ id: 'p1', field_id: 'f1', crop_id: 'corn', planned_acres: 100 })],
      [
        { id: 'z1', field_id: 'f1', crop_year: 2030, crop_id: 'corn', acres: 40 },
        { id: 'z2', field_id: 'f1', crop_year: 2030, crop_id: 'corn', acres: 60 },
      ],
      2030,
    )
    const [line] = estimateBins([crop({})], plans, [], [], acres, { cuts: [cut({ zone_id: 'z2', loss_pct: 50 })] })
    // 40 × 100 + 60 × 50
    expect(line.estimatedBu).toBe(7000)
    expect(line.cutBu).toBe(3000)
  })

  it('a harvested yield is not cut again', () => {
    const [line] = estimateBins([crop({})], [p({ yield_per_acre_override: 90, yield_basis: 'clean' })], [], [], acres, { cuts: [cut({ loss_pct: 50 })] })
    expect(line.estimatedBu).toBe(9000)
    expect(line.cutBu).toBe(0)
  })

  it('a split area of another crop does not take the plan’s range or harvest label', () => {
    const [, other] = plansWithZones(
      [p({ id: 'p1', crop_id: 'corn', yield_per_acre_override: 90, yield_basis: 'clean', yield_low: 80, yield_high: 100 })],
      [
        { id: 'z1', field_id: 'f1', crop_year: 2030, crop_id: 'corn', acres: 40 },
        { id: 'z2', field_id: 'f1', crop_year: 2030, crop_id: 'beans', acres: 60 },
      ],
      2030,
    )
    expect([other.yield_per_acre_override, other.yield_basis, other.yield_low, other.yield_high]).toEqual([null, null, null, null])
  })
})

describe('estimateBins follows each plan’s variety', () => {
  // Made-up figures: 100 ac a plan, crop 100 bu/ac.
  const own = (variety: string, over: Partial<VarietySettingRow>): VarietySettingRow => ({
    id: `v-${variety}`, crop_id: 'corn', variety, default_yield_per_acre: null, days_to_maturity: null, test_weight_lb_per_bu: null,
    moisture_dry_min: null, moisture_dry_max: null, moisture_tough_max: null, moisture_damp_max: null, moisture_moist_max: null,
    seeds_per_acre_min: null, seeds_per_acre_max: null, seed_spacing_in: null, depth_in_min: null, depth_in_max: null,
    row_spacing_in: null, planting_speed_mph: null, plate_holes: null, notes: null, updated_at: '', ...over,
  })
  const p = (over: Partial<CropPlanRow>) => plan({ crop_year: 2030, ...over })

  it('takes the variety’s own normal yield, the crop’s for the rest', () => {
    const plans = [p({ id: 'a', field_id: 'f1', variety: 'Tall' }), p({ id: 'b', field_id: 'f2', variety: 'Plain' })]
    const [line] = estimateBins([crop({})], plans, [], [], acres, { varieties: [own('tall', { default_yield_per_acre: 150 })] })
    expect(line.estimatedBu).toBe(25000)
  })

  it('weighs a crop kept in pounds at each variety’s test weight', () => {
    const beans = crop({ yield_unit: 'lbs', default_yield_per_acre: 3000, test_weight_lb_per_bu: 60 })
    const plans = [p({ id: 'a', field_id: 'f1', variety: 'Light' }), p({ id: 'b', field_id: 'f2' })]
    const [line] = estimateBins([beans], plans, [], [], acres, { varieties: [own('Light', { test_weight_lb_per_bu: 50 })] })
    // 300,000 lb at 50 + 300,000 lb at 60
    expect(line.estimatedBu).toBe(11000)
  })
})

describe('estimateBins sizes what is left, not what was promised', () => {
  // Sam, 27 Oct 2026: "the assessment is off as it takes allocation over
  // what was actually binned and so there is wasted space not being shown as
  // available." 100 ac at 100 bu/ac against one 5,000 bu bin.
  const held = (bin_id: string, onhand_bu: number, crop_id: string | null = 'corn') => ({ bin_id, crop_id, onhand_bu })

  it('counts the room left in a part-full bin, not the bin', () => {
    const [line] = estimateBins([crop({})], [plan({})], [bin('b1', 5000)], [alloc('b1')], acres, {
      onHand: [held('b1', 3000)],
    })
    expect(line.binnedBu).toBe(3000)
    expect(line.toComeBu).toBe(7000) // 10,000 grown, 3,000 away
    expect(line.freeInAllocatedBu).toBe(2000)
    expect(line.shortfallBu).toBe(5000)
    expect(line.summary).toContain('7,000 bu still to come vs 2,000 bu room')
  })

  it('is covered where the bin it has left is enough for the rest', () => {
    const ov = new Map<string, CropBinOverride>([['corn', { crop_id: 'corn', needs_bins: null, stored_bu: 4000, note: null }]])
    const [line] = estimateBins([crop({})], [plan({})], [bin('b1', 5000)], [alloc('b1')], acres, {
      overrideByCrop: ov,
      onHand: [held('b1', 3000)],
    })
    expect(line.toComeBu).toBe(1000)
    expect(line.shortfallBu).toBe(0)
    expect(line.summary).toContain('covered')
  })

  it('says so when the whole crop is already away', () => {
    const [line] = estimateBins([crop({ default_yield_per_acre: 30 })], [plan({})], [bin('b1', 5000)], [alloc('b1')], acres, {
      onHand: [held('b1', 3200)],
    })
    expect(line.toComeBu).toBe(0)
    expect(line.shortfallBu).toBe(0)
    expect(line.summary).toContain('All of it is in the bins')
    expect(line.summary).toContain('1,800 bu room')
  })

  it('a crop marked not binned with grain in the bins says it out loud', () => {
    const ov = new Map<string, CropBinOverride>([['corn', { crop_id: 'corn', needs_bins: false, stored_bu: null, note: null }]])
    const [line] = estimateBins([crop({})], [plan({})], [bin('b1', 5000)], [], acres, {
      overrideByCrop: ov,
      onHand: [held('b1', 2500)],
    })
    expect(line.needsBins).toBe(false)
    expect(line.binnedBu).toBe(2500)
    expect(line.summary).toContain('2,500 bu of it is in the bins')
  })

  it('says when the bin set aside for a crop is full of something else', () => {
    // #20 is held for the Corteva canola and has corn in it: the canola is
    // still in the field and has nowhere allocated to go.
    const canola = crop({ id: 'canola', name: 'Canola', bin_policy: 'segregate_by_field', default_yield_per_acre: 16 })
    const [line] = estimateBins([canola], [plan({ crop_id: 'canola' })], [bin('b1', 3200)], [{ ...alloc('b1'), crop_id: 'canola' } as BinAllocationRow], acres, {
      onHand: [held('b1', 3200)],
    })
    expect(line.binnedBu).toBe(0)
    expect(line.shortfallBins).toBe(1)
    expect(line.summary).toContain('1 bin for 1 field kept apart')
    expect(line.summary).toContain('Its one bin is full')
  })

  it('a field already in a bin needs no more bins', () => {
    const canola = crop({ id: 'canola', name: 'Canola', bin_policy: 'segregate_by_field', default_yield_per_acre: 70 })
    const plans = [
      plan({ id: 'p1', crop_id: 'canola', field_id: 'moreaus', planned_acres: 100 }),
      plan({ id: 'p2', crop_id: 'canola', field_id: 'lindgren', planned_acres: 100 }),
    ]
    const yard = [bin('b1', 4000), bin('b2', 4000), bin('b3', 4000)]
    // Both fields make 7,000 bu: two bins each out of 4,000 bu bins, four in all.
    const dry = estimateBins([canola], plans, yard, [], acres)
    expect(dry[0].neededBins).toBe(4)
    // Moreaus is away in b1 and b2; only Lindgren is left.
    const [line] = estimateBins([canola], plans, yard, [alloc('b1'), alloc('b2')], acres, {
      onHand: [held('b1', 4000, 'canola'), held('b2', 3000, 'canola')],
      binnedByField: new Map([['moreaus', 7000]]),
      fieldsInBin: new Map([['b1', ['moreaus']], ['b2', ['moreaus']]]),
    })
    expect(line.neededBins).toBe(2)
    expect(line.binnedBu).toBe(7000)
    expect(line.summary).toContain('1 field still out')
  })
})

describe('yardRoom', () => {
  it('counts the empty half of a bin with grain in it', () => {
    const room = yardRoom([bin('b1', 5000), bin('b2', 5000), bin('b3', 5000)], [
      { bin_id: 'b1', crop_id: 'corn', onhand_bu: 5000 },
      { bin_id: 'b2', crop_id: 'corn', onhand_bu: 1000 },
    ])
    expect(room.roomBu).toBe(9000)
    expect(room.inUseRoomBu).toBe(4000)
    expect([room.emptyBins, room.partBins, room.fullBins]).toEqual([1, 1, 1])
  })

  it('leaves out a bin holding a previous year’s grain, and any bin out of use', () => {
    const bins = [bin('b1', 5000), { ...bin('b2', 5000), active: false } as BinRow]
    expect(yardRoom(bins, [], new Set(['b1'])).roomBu).toBe(0)
  })

  it('is the whole capacity before anything is binned', () => {
    expect(yardRoom([bin('b1', 4000), bin('b2', 2000)]).roomBu).toBe(6000)
  })
})

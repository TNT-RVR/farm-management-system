import { describe, expect, it } from 'vitest'
import { buildPlan, carryover, cropKey, evaluate, type CropInfo, type FieldCtx, type RecropRule } from './rotation-engine'

const crops: CropInfo[] = [
  { id: 'can', name: 'Canola', key: 'canola', minReturn: 3, margin: 288 },
  { id: 'bean', name: 'Beans-Pinto', key: 'dry_bean', minReturn: 3, margin: 596 },
  { id: 'wht', name: 'Wheat', key: 'wheat', minReturn: 1, margin: 335 },
  { id: 'dur', name: 'Durum Wheat', key: 'durum', minReturn: 1, margin: 540 },
  { id: 'pot', name: 'Potato', key: 'potato', minReturn: 3, margin: null },
  { id: 'crn', name: 'Corn', key: 'corn', minReturn: 0, margin: null },
  { id: 'alf', name: 'Alfalfa', key: 'alfalfa', minReturn: 0, margin: 243 },
]
const byId = new Map(crops.map((c) => [c.id, c]))
const RULES: Record<string, { preference: 'recommended' | 'caution' | 'no_go'; notes: string }> = {
  'can>bean': { preference: 'no_go', notes: 'Dry beans on canola stubble: volunteer canola.' },
  'crn>wht': { preference: 'no_go', notes: 'Small grain after corn: FHB.' },
  'crn>dur': { preference: 'no_go', notes: 'Small grain after corn: FHB.' },
  'bean>wht': { preference: 'recommended', notes: 'Recommended: legume before.' },
  'bean>dur': { preference: 'recommended', notes: 'Recommended: legume before.' },
  'wht>dur': { preference: 'caution', notes: 'Caution: FHB hosts.' },
}
const pref = (p: string, n: string) => RULES[`${p}>${n}`] ?? null
const field = (o: Partial<FieldCtx>): FieldCtx => ({ id: 'f', name: 'F', acres: 100, irrigated: true, sandy: false, ec: null, crops: new Map(), apps: [], ...o })

describe('rotation engine', () => {
  it('maps crop names to keys', () => {
    expect(cropKey('Beans-Great Northern')).toBe('dry_bean')
    expect(cropKey('Seed Canola')).toBe('seed_canola')
    expect(cropKey('Durum Wheat')).toBe('durum')
  })
  it('blocks beans on canola stubble, wheat after corn, beans on dryland and a short return', () => {
    const f = field({ crops: new Map([[2026, ['can']]]) })
    expect(evaluate(f, byId.get('bean')!, 2027, byId, pref, new Map()).blocked[0]).toMatch(/canola stubble/)
    expect(evaluate(field({ crops: new Map([[2026, ['crn']]]) }), byId.get('wht')!, 2027, byId, pref, new Map()).blocked.length).toBe(1)
    expect(evaluate(field({ irrigated: false }), byId.get('bean')!, 2027, byId, pref, new Map()).blocked[0]).toMatch(/irrigation/)
    expect(evaluate(field({ crops: new Map([[2025, ['can']]]) }), byId.get('can')!, 2027, byId, pref, new Map()).blocked[0]).toMatch(/needs 3 years/)
  })
  it('penalises salinity by the FAO slope and blocks beans on a salty field', () => {
    const e = evaluate(field({ ec: 4 }), byId.get('bean')!, 2027, byId, pref, new Map())
    expect(e.blocked[0]).toMatch(/57%/)
  })
  it('reads label carryover: 22 months before canola after a product sprayed last June', () => {
    const rules = new Map<string, RecropRule[]>([
      ['123', [{ registration_number: '123', crop_key: 'canola', following_crop: 'Canola', months: 22, status: 'wait', condition: null, quote: 'Canola 22 months' }]],
    ])
    const hits = carryover('canola', [{ product: 'Muster', registration: '123', appliedOn: '2026-06-10' }], rules, '2027-05-01')
    expect(hits[0].message).toMatch(/22 months/)
    expect(carryover('canola', [{ product: 'Muster', registration: '123', appliedOn: '2025-06-10' }], rules, '2027-05-01')).toHaveLength(0)
  })
  it('builds three different plans inside the acre limits', () => {
    const fields = [
      field({ id: 'a', name: 'A', crops: new Map([[2026, ['bean']]]) }),
      field({ id: 'b', name: 'B', crops: new Map([[2026, ['wht']]]) }),
      field({ id: 'c', name: 'C', crops: new Map([[2026, ['can']]]) }),
    ]
    const limits = new Map([['dur', 100]])
    const profit = buildPlan('profit', 2027, fields, crops, pref, new Map(), limits)
    expect(profit.acres.get('dur') ?? 0).toBeLessThanOrEqual(100)
    // Beans are the top margin but cannot go on canola stubble (C).
    expect(profit.assignments.find((a) => a.fieldId === 'c')!.cropId).not.toBe('bean')
    const soil = buildPlan('soil', 2027, fields, crops, pref, new Map(), limits)
    expect(soil.assignments.some((a) => a.cropId === 'alf' || a.cropId === 'wht')).toBe(true)
  })
})

describe('carryover from the labels', () => {
  const rule = (r: Partial<RecropRule>): RecropRule => ({
    registration_number: '1', crop_key: 'any_other', following_crop: 'All other crops', months: null, status: 'bioassay', condition: null, quote: null, ...r,
  })
  const rules = new Map([['1', [
    rule({ following_crop: 'small-seeded grasses (timothy, canaryseed)', status: 'do_not' }),
    rule({ following_crop: 'rye (fall seeded or cover crop)', status: 'do_not', condition: 'planted within the same season as application' }),
    rule({ crop_key: 'dry_bean', following_crop: 'Dry Beans', months: 22, status: 'wait' }),
    rule({}),
  ]]])
  const sprays = [
    { product: 'X', registration: '1', appliedOn: '2025-06-10' },
    { product: 'X', registration: '1', appliedOn: '2026-06-10' },
    { product: 'X', registration: '1', appliedOn: '2027-07-01' },
  ]

  it('a named wait blocks, once, from the latest spray before planting', () => {
    const hits = carryover('dry_bean', sprays, rules, '2027-05-01')
    expect(hits).toHaveLength(1)
    expect(hits[0].block).toBe(true)
    expect(hits[0].appliedOn).toBe('2026-06-10')
  })

  it('a crop the label does not name gets the catch-all bioassay as a caution, not the grass or rye lines', () => {
    const hits = carryover('corn', sprays, rules, '2027-05-01')
    expect(hits).toHaveLength(1)
    expect(hits[0].block).toBe(false)
    expect(hits[0].message).toContain('bioassay')
  })
})

describe('group acre limits', () => {
  const two: CropInfo[] = [...crops, { id: 'gn', name: 'Beans-Great Northern', key: 'dry_bean', minReturn: 3, margin: 596 }]
  const fields = ['a', 'b', 'c', 'd'].map((id) => field({ id, name: id.toUpperCase(), crops: new Map([[2026, ['wht']]]) }))

  it('holds every bean crop together under one cap', () => {
    const p = buildPlan('profit', 2027, fields, two, pref, new Map(), new Map(), new Map([['dry_bean', 150]]))
    const beans = (p.acres.get('bean') ?? 0) + (p.acres.get('gn') ?? 0)
    expect(beans).toBeLessThanOrEqual(150)
  })

  it('fills around fields already planned, counting them toward the cap', () => {
    const fixed = new Map([['a', 'gn']])
    const p = buildPlan('profit', 2027, fields, two, pref, new Map(), new Map(), new Map([['dry_bean', 150]]), fixed)
    expect(p.assignments.find((x) => x.fieldId === 'a')!.cropId).toBe('gn')
    expect(p.assignments.filter((x) => x.cropId === 'bean' || x.cropId === 'gn')).toHaveLength(1)
  })
})

describe("renter's crops", () => {
  it('are never recommended', () => {
    const withCarrot: CropInfo[] = [...crops, { id: 'car', name: 'Carrot', key: 'carrot', minReturn: 4, margin: 5000, renterOnly: true }]
    const p = buildPlan('profit', 2027, [field({ id: 'a', crops: new Map([[2026, ['wht']]]) })], withCarrot, pref, new Map(), new Map())
    expect(p.assignments[0].cropId).not.toBe('car')
  })
})

describe('markets, water, scouting and heat', () => {
  const wet: CropInfo[] = crops.map((c) => ({ ...c, waterNeedIn: c.key === 'alfalfa' ? 16 : c.key === 'potato' ? 12 : 8 }))

  it("uses a field's own revenue and cost, scaling revenue (not margin) by the rotation effects", () => {
    const f = field({ crops: new Map([[2026, ['bean']]]), economics: new Map([['wht', { revenue: 1000, cost: 900, margin: 100, basis: '' }]]) })
    const e = evaluate(f, byId.get('wht')!, 2027, byId, pref, new Map())
    // Wheat after beans: +10% on revenue → 1100 − 900.
    expect(e.profit).toBeCloseTo(200, 5)
  })

  it('keeps each water source inside what it has', () => {
    const fs = ['a', 'b'].map((id) => field({ id, crops: new Map([[2026, ['wht']]]), waterSource: 'smrid', irrigatedAcres: 100 }))
    const p = buildPlan('profit', 2027, fs, wet, pref, new Map(), new Map(), new Map(), new Map(), { waterAvailable: new Map([['smrid', 1600]]) })
    expect(p.water.get('smrid')!).toBeLessThanOrEqual(1600)
  })

  it('fills a contract first, on its best field', () => {
    const fs = ['a', 'b', 'c'].map((id) => field({ id, crops: new Map([[2026, ['wht']]]) }))
    const p = buildPlan('soil', 2027, fs, wet, pref, new Map(), new Map(), new Map(), new Map(), { minAcres: new Map([['can', 100]]) })
    expect(p.assignments.filter((a) => a.cropId === 'can')).toHaveLength(1)
    expect(p.shortOfContract.size).toBe(0)
  })

  it('a heavy clubroot find rules canola out; a light sclerotinia find is a caution', () => {
    const club = field({ scouting: [{ category: 'disease', subject: 'Clubroot', severity: 3, year: 2026 }] })
    expect(evaluate(club, byId.get('can')!, 2027, byId, pref, new Map()).blocked.join()).toMatch(/Clubroot/)
    const scl = field({ scouting: [{ category: 'disease', subject: 'Sclerotinia', severity: 1, year: 2026 }] })
    const e = evaluate(scl, byId.get('bean')!, 2027, byId, pref, new Map())
    expect(e.blocked).toHaveLength(0)
    expect(e.cautions.join()).toMatch(/Sclerotinia/)
  })

  it('flags corn where the season is short of heat units', () => {
    const cool = field({ chu: 2050 })
    expect(evaluate(cool, byId.get('crn')!, 2027, byId, pref, new Map()).cautions.join()).toMatch(/heat units/)
  })
})

describe("a label's 'ok after N months'", () => {
  const rules = new Map([['9', [
    { registration_number: '9', crop_key: 'barley', following_crop: 'Barley', months: 11, status: 'ok' as const, condition: null, quote: null },
    { registration_number: '9', crop_key: 'corn', following_crop: 'Field corn', months: 12, status: 'ok' as const, condition: 'the following year', quote: null },
  ]]])
  const fall = [{ product: 'Z', registration: '9', appliedOn: '2026-09-29' }]
  it('holds a real wait of 11 months or less', () => {
    expect(carryover('barley', fall, rules, '2027-05-01')).toHaveLength(1)
  })
  it('reads 12 months or more as "the following year"', () => {
    expect(carryover('corn', fall, rules, '2027-05-01')).toHaveLength(0)
  })
})

describe('never an empty field', () => {
  it('takes the least thirsty crop when the water runs out, and says so', () => {
    const wet: CropInfo[] = crops.map((c) => ({ ...c, waterNeedIn: 10 }))
    const fs = ['a', 'b'].map((id) => field({ id, crops: new Map([[2026, ['wht']]]), waterSource: 'lic', irrigatedAcres: 100 }))
    const p = buildPlan('profit', 2027, fs, wet, pref, new Map(), new Map(), new Map(), new Map(), { waterAvailable: new Map([['lic', 1000]]) })
    expect(p.assignments.every((a) => a.cropId)).toBe(true)
    expect(p.assignments.some((a) => /Over its/.test(a.note ?? ''))).toBe(true)
  })

  it('holds Corn and a second corn crop under one share of the farm', () => {
    const two: CropInfo[] = [...crops, { id: 'vandermeer', name: 'Vandermeer Corn', key: 'corn', minReturn: 0, margin: 9000 }]
    const fs = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => field({ id, crops: new Map([[2026, ['wht']]]) }))
    const p = buildPlan('profit', 2027, fs, two, pref, new Map(), new Map())
    const corn = (p.acres.get('crn') ?? 0) + (p.acres.get('vandermeer') ?? 0)
    expect(corn).toBeLessThanOrEqual(300) // 50% of 600 acres
  })

  it('steps a thirsty field down so another on the licence gets water', () => {
    // Durum is worth most here but takes 16 in; everything else 6 in. 100 + 100 ac on 2,200 acre-inches:
    // both in durum is 3,200; the greedy pass gives one durum (1,600) and leaves 600 — not enough for
    // durum on the second, but plenty for a 6 in crop. With no room at all the repair steps one down.
    const thirsty: CropInfo[] = crops.map((c) => ({ ...c, waterNeedIn: c.id === 'dur' ? 16 : 6 }))
    const fs = ['a', 'b'].map((id) => field({ id, crops: new Map([[2026, ['bean']]]), waterSource: 'lic', irrigatedAcres: 100 }))
    const p = buildPlan('profit', 2027, fs, thirsty, pref, new Map(), new Map(), new Map(), new Map(), { waterAvailable: new Map([['lic', 2200]]) })
    expect(p.assignments.every((a) => a.cropId)).toBe(true)
    expect(p.water.get('lic')!).toBeLessThanOrEqual(2200)
    const tight = buildPlan('profit', 2027, fs, thirsty.map((c) => ({ ...c, waterNeedIn: c.id === 'dur' ? 16 : 11 })), pref, new Map(), new Map(), new Map(), new Map(), { waterAvailable: new Map([['lic', 2200]]) })
    // 1,600 + 1,100 is over; stepping durum down to 11 in fits both (2,200).
    expect(tight.water.get('lic')!).toBeLessThanOrEqual(2200)
    expect(tight.assignments.some((a) => /Stepped down/.test(a.note ?? ''))).toBe(true)
  })

  it('reads a "do not plant" with no months as the next season only', () => {
    const rules = new Map([['E', [{ registration_number: 'E', crop_key: 'oats', following_crop: 'oats', months: null, status: 'do_not' as const, condition: null, quote: null }]]])
    const edge = [{ product: 'Edge', registration: 'E', appliedOn: '2026-05-12' }]
    expect(carryover('oats', edge, rules, '2027-05-01')).toHaveLength(1)
    expect(carryover('oats', edge, rules, '2028-05-01')).toHaveLength(0)
  })

  it('keeps a stand to its minimum, lets it go between, and takes it out after its maximum', () => {
    const withStand: CropInfo[] = crops.map((c) => (c.id === 'alf' ? { ...c, standMin: 3, standMax: 4 } : c))
    const aged = (n: number) => field({ crops: new Map(Array.from({ length: n }, (_, i) => [2026 - i, ['alf']] as [number, string[]])) })
    expect(buildPlan('profit', 2027, [aged(2)], withStand, pref, new Map(), new Map()).assignments[0].cropId).toBe('alf')
    const byId2 = new Map(withStand.map((c) => [c.id, c]))
    expect(evaluate(aged(3), byId2.get('alf')!, 2027, byId2, pref, new Map()).blocked).toHaveLength(0)
    expect(evaluate(aged(4), byId2.get('alf')!, 2027, byId2, pref, new Map()).blocked.join()).toMatch(/comes out after 4/)
  })
})

describe('herbicide trait of seed canola', () => {
  const seed: CropInfo[] = [
    { id: 'basf', name: 'BASF Canola', key: 'canola', minReturn: 4, margin: 300, trait: 'liberty' },
    { id: 'ctv', name: 'Corteva Canola', key: 'canola', minReturn: 4, margin: 300, trait: 'roundup' },
    { id: 'unk', name: 'Unknown Canola', key: 'canola', minReturn: 4, margin: 300, trait: null },
    { id: 'wht', name: 'Wheat', key: 'wheat', minReturn: 1, margin: 335 },
  ]
  const ids = new Map(seed.map((c) => [c.id, c]))
  const f = field({ crops: new Map([[2022, ['basf']], [2023, ['wht']]]) })
  it('warns, without blocking, on a same-trait canola within the window', () => {
    const e = evaluate(f, ids.get('basf')!, 2028, ids, pref, new Map())
    expect(e.blocked).toEqual([])
    expect(e.cautions.join()).toMatch(/BASF Canola \(Liberty\) was here in 2022/)
  })
  it('lets the other trait and an unknown company through', () => {
    expect(evaluate(f, ids.get('ctv')!, 2028, ids, pref, new Map()).cautions).toEqual([])
    expect(evaluate(f, ids.get('unk')!, 2028, ids, pref, new Map()).cautions).toEqual([])
  })
  it("reads the field's canola record where the history only names the company in the variety", () => {
    const g = field({ crops: new Map([[2023, ['wht']]]), canola: [{ year: 2022, crop: 'Canola', trait: 'roundup' }] })
    expect(evaluate(g, ids.get('ctv')!, 2028, ids, pref, new Map()).cautions.join()).toMatch(/Canola \(Roundup\) was here in 2022/)
  })
})

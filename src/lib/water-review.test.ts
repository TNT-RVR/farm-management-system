import { describe, expect, it } from 'vitest'
import { balanceTotals, buildWaterReview, pickBalance, pivotFlow, pumpingCost, reviewTotals, verdictFor, type ReviewBalanceRow, type ReviewData } from './water-review'

const day = (field_id: string, date: string, o: Partial<ReviewBalanceRow> = {}): ReviewBalanceRow => ({
  field_id,
  zone_id: null,
  date,
  is_forecast: false,
  rainfall_mm: 0,
  etc_mm: 5,
  status: 'ok',
  ks: 1,
  dr_mm: 10,
  raw_mm: 40,
  ...o,
})

/** n days for a field, the first `stress` of them in stress. */
const days = (field: string, n: number, stress = 0, rain = 0) =>
  Array.from({ length: n }, (_, i) =>
    day(field, `2026-07-${String(i + 1).padStart(2, '0')}`, i < stress ? { status: 'stress', ks: 0.8, dr_mm: 50 } : { rainfall_mm: rain }),
  )

const base: ReviewData = {
  year: 2026,
  seasons: [
    { field_id: 'a', zone_id: null, application_efficiency: 0.85 },
    { field_id: 'b', zone_id: null, application_efficiency: 0.85 },
    { field_id: 'c', zone_id: null, application_efficiency: 0.85 },
  ],
  fields: [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Bravo' },
    { id: 'c', name: 'Charlie' },
  ],
  plans: [
    { field_id: 'a', crop_id: 'corn', planned_acres: 130, yield_per_acre_override: 200, yield_basis: 'pre_clean' },
    { field_id: 'b', crop_id: 'corn', planned_acres: 130, yield_per_acre_override: 160, yield_basis: 'pre_clean' },
    { field_id: 'c', crop_id: 'bean', planned_acres: 100, yield_per_acre_override: 3000, yield_basis: null },
  ],
  history: [
    { field_id: 'a', crop_id: 'corn', acres: 130, yield_per_acre: 200, yield_unit: 'bu', source: 'scale' },
    { field_id: 'b', crop_id: 'corn', acres: 130, yield_per_acre: 160, yield_unit: 'bu', source: 'scale' },
  ],
  crops: [
    { id: 'corn', name: 'Corn', color: '#eab308', yield_unit: 'bu', default_yield_per_acre: 180 },
    { id: 'bean', name: 'Beans', color: '#a16207', yield_unit: 'lbs', default_yield_per_acre: 2800 },
  ],
  pivots: [
    { field_id: 'a', acres_irrigated: 130, gpm: 800, system_capacity_ls: null, application_efficiency: null, pump_id: 'p1' },
    { field_id: 'b', acres_irrigated: 130, gpm: null, system_capacity_ls: null, application_efficiency: 0.8, pump_id: 'p2' },
    { field_id: 'c', acres_irrigated: 100, gpm: 700, system_capacity_ls: null, application_efficiency: null, pump_id: null },
  ],
  pumps: [
    { id: 'p1', name: 'Alpha pump', horse_power: 100, gpm: null },
    { id: 'p2', name: 'Bravo pump', horse_power: 75, gpm: null },
  ],
  fieldnetFlow: [{ field_id: 'b', flow: 750 }],
  events: [
    // Alpha: 254 mm gross (10 in). Bravo: 381 mm (15 in). Charlie: 127 mm.
    { field_id: 'a', gross_mm: 127, net_mm: null },
    { field_id: 'a', gross_mm: 127, net_mm: null },
    { field_id: 'b', gross_mm: 381, net_mm: null },
    { field_id: 'c', gross_mm: null, net_mm: 127 },
  ],
  balance: [...days('a', 30, 0, 2), ...days('b', 30, 12), ...days('c', 10)],
  prices: [{ crop_id: 'corn', crop_year: 2026, price_per_unit: 6 }],
  contracts: [],
  market: [],
  today: '2026-10-01',
}

describe('pumping cost', () => {
  it('turns acre-inches into hours, kWh and dollars', () => {
    const p = pumpingCost({ irrigationIn: 10, acres: 130, gpm: 800, hp: 100, powerCostKwh: 0.15 })
    const hours = (1300 * 27154) / (800 * 60)
    const kw = (100 * 0.7457) / 0.9
    expect(p.acreInches).toBe(1300)
    expect(p.hours).toBeCloseTo(hours, 6)
    expect(p.kwh).toBeCloseTo(kw * hours, 6)
    expect(p.cost).toBeCloseTo(kw * hours * 0.15, 6)
    expect(p.perAc).toBeCloseTo((kw * hours * 0.15) / 130, 6)
    expect(p.perAcIn).toBeCloseTo((kw * hours * 0.15) / 1300, 6)
    expect(p.missing).toEqual([])
  })

  it('names what is missing instead of guessing', () => {
    const p = pumpingCost({ irrigationIn: 10, acres: 130, gpm: null, hp: null, powerCostKwh: 0.15 })
    expect(p.cost).toBeNull()
    expect(p.missing).toEqual(['pivot flow (gpm)', 'pump horsepower'])
  })
})

describe('balance', () => {
  it('reads the whole-field rows, else the first zone, and never the forecast', () => {
    const rows = [day('a', '2026-07-01', { zone_id: 'z2' }), day('a', '2026-07-01', { zone_id: 'z1' }), day('a', '2026-07-02', { zone_id: 'z1', is_forecast: true })]
    expect(pickBalance(rows).map((r) => r.zone_id)).toEqual(['z1'])
    expect(pickBalance([...rows, day('a', '2026-07-01')]).map((r) => r.zone_id)).toEqual([null])
  })

  it('counts stress days by status and days below threshold by Ks', () => {
    const t = balanceTotals([day('a', '1', { status: 'now', ks: 1 }), day('a', '2', { status: 'stress', ks: 0.7 }), day('a', '3', { ks: null, dr_mm: 50, raw_mm: 40 }), day('a', '4', { rainfall_mm: 12 })])
    expect(t).toEqual({ days: 4, rainMm: 12, etcMm: 20, stressDays: 2, belowThresholdDays: 2 })
  })
})

describe('water review', () => {
  const rows = buildWaterReview(base, 0.15)
  const a = rows.find((r) => r.fieldId === 'a')!
  const b = rows.find((r) => r.fieldId === 'b')!
  const c = rows.find((r) => r.fieldId === 'c')!

  it('totals the water and the yield per inch', () => {
    expect(a.grossMm).toBe(254)
    expect(a.irrigationIn).toBeCloseTo(10, 6)
    expect(a.efficiency).toBe(0.85) // nothing on the pivot: the season's
    expect(a.effectiveMm).toBeCloseTo(215.9, 6)
    expect(a.rainMm).toBe(60)
    expect(a.etcMm).toBe(150)
    expect(a.totalWaterIn).toBeCloseTo((215.9 + 60) / 25.4, 6)
    expect(a.yieldPerInIrrigation).toBeCloseTo(20, 6)
    expect(a.yieldPerInTotal).toBeCloseTo(200 / ((215.9 + 60) / 25.4), 6)
    expect(b.efficiency).toBe(0.8) // the pivot's own figure wins
    expect(c.grossMm).toBe(127) // net stands in when gross is missing
  })

  it('labels a harvested yield and an estimate', () => {
    expect(a.yieldKind).toBe('actual')
    expect(a.yieldFrom).toMatch(/scale/)
    expect(c.yieldKind).toBe('estimate')
    expect(c.yieldFrom).toBe('plan estimate')
    expect(c.yield).toBe(3000)
  })

  it('normalises yield to the crop average, acre-weighted', () => {
    expect(a.relYield).toBeCloseTo((200 / 180) * 100, 6)
    expect(b.relYield).toBeCloseTo((160 / 180) * 100, 6)
    expect(c.relYield).toBeCloseTo(100, 6)
  })

  it('prices pumping from the pivot gpm or FieldNET, and says when a pump is missing', () => {
    expect(a.gpmFrom).toBe('pivot gpm')
    expect(a.pumpCost).toBeCloseTo(pumpingCost({ irrigationIn: 10, acres: 130, gpm: 800, hp: 100, powerCostKwh: 0.15 }).cost!, 6)
    expect(b.gpmFrom).toBe('FieldNET reported flow')
    expect(b.gpm).toBe(750)
    expect(b.pumpCost).not.toBeNull()
    expect(c.pumpCost).toBeNull()
    expect(c.pumpNote).toMatch(/a pump linked to the pivot/)
  })

  it('values the crop where a price is known, in the same unit only', () => {
    expect(a.price).toBe(6)
    expect(a.grossPerAc).toBe(1200)
    expect(a.dollarsPerInIrrigation).toBeCloseTo(120, 6)
    expect(c.price).toBeNull()
    expect(c.grossPerAc).toBeNull()
  })

  it('says what the season means', () => {
    expect(b.verdict).toMatch(/water-limited/)
    expect(a.verdict).toMatch(/Made the most|Top of/)
    expect(c.verdict).toMatch(/estimate/)
  })

  it('charges a shared pump by its share of the flow', () => {
    const shared = buildWaterReview({
      ...base,
      pivots: base.pivots.map((p) => (p.field_id === 'b' ? { ...p, pump_id: 'p1' } : p)),
      pumps: [{ id: 'p1', name: 'Station', horse_power: 200, gpm: 1600 }],
    })
    const sa = shared.find((r) => r.fieldId === 'a')!
    expect(sa.hp).toBeCloseTo(100, 6) // 800 of 1600 gpm
    expect(sa.pumpNote).toMatch(/feeds 2 pivots/)
  })

  it('shows a yield typed in the wrong unit but neither values nor compares it', () => {
    const odd = buildWaterReview({ ...base, history: base.history.map((h) => (h.field_id === 'b' ? { ...h, yield_per_acre: 12 } : h)) })
    const ob = odd.find((r) => r.fieldId === 'b')!
    const oa = odd.find((r) => r.fieldId === 'a')!
    expect(ob.yieldSuspect).toBe(true)
    expect(ob.relYield).toBeNull()
    expect(ob.grossPerAc).toBeNull()
    expect(ob.verdict).toMatch(/wrong unit/)
    expect(oa.relYield).toBeCloseTo(100, 6) // compared with itself only
  })

  it('reads no logged pass as unknown irrigation, not a dry field', () => {
    const none = buildWaterReview({ ...base, events: base.events.filter((e) => e.field_id !== 'b') })
    expect(none.find((r) => r.fieldId === 'b')!.verdict).toMatch(/No irrigation logged/)
  })

  it('falls back to pivots with a crop in a year with no seasons', () => {
    const old = buildWaterReview({ ...base, seasons: [], events: [], balance: [] })
    expect(old.map((r) => r.fieldId).sort()).toEqual(['a', 'b', 'c'])
    expect(old.find((r) => r.fieldId === 'a')!.verdict).toMatch(/no water record/)
  })

  it('totals the farm', () => {
    const t = reviewTotals(rows)
    expect(t.fields).toBe(3)
    expect(t.acres).toBe(360)
    expect(t.grossMm).toBeCloseTo((254 * 130 + 381 * 130 + 127 * 100) / 360, 6)
    expect(t.pumpFields).toBe(2)
    expect(t.pumpCost).toBeCloseTo(a.pumpCost! + b.pumpCost!, 6)
    expect(t.pumpCostPerAc).toBeCloseTo((a.pumpCost! + b.pumpCost!) / 260, 6)
    expect(t.grossValue).toBeCloseTo(1200 * 130 + 960 * 130, 6)
  })
})

describe('verdicts', () => {
  const r = { cropName: 'Corn', yield: 200, yieldKind: 'actual' as const, relYield: 100, irrigationIn: 12, events: 5, balanceDays: 90, stressDays: 0 }
  const ctx = { cropAvgIrrigationIn: 10, cropFieldsWithYield: 4 }
  it('flags water above what paid', () => {
    expect(verdictFor({ ...r, irrigationIn: 14 }, ctx)).toMatch(/Water above what paid/)
  })
  it('flags a short yield that water does not explain', () => {
    expect(verdictFor({ ...r, relYield: 80, irrigationIn: 10 }, ctx)).toMatch(/not the limit/)
  })
  it('is plain when nothing stands out', () => {
    expect(verdictFor({ ...r, irrigationIn: 10 }, ctx)).toBe('In line with the other corn fields.')
  })
  it('has nothing to compare a lone field with', () => {
    expect(verdictFor(r, { ...ctx, cropFieldsWithYield: 1 })).toMatch(/only harvested corn/)
  })
})

describe('pivotFlow', () => {
  it('prefers the pivot, then its capacity, then FieldNET', () => {
    expect(pivotFlow({ gpm: 900, system_capacity_ls: 60 }, 800, { gpm: 700 })).toEqual({ gpm: 900, from: 'pivot gpm' })
    expect(pivotFlow({ gpm: null, system_capacity_ls: 63.0902 }, 800, { gpm: 700 }).gpm).toBeCloseTo(1000)
    expect(pivotFlow({ gpm: null, system_capacity_ls: null }, 800, { gpm: 700 })).toEqual({ gpm: 800, from: 'FieldNET reported flow' })
  })
  it("falls back to the pump's flow, measured or estimated, only when given its sole pivot", () => {
    const blank = { gpm: null, system_capacity_ls: null }
    expect(pivotFlow(blank, null, { gpm: 700, gpm_estimate: 780 })).toEqual({ gpm: 700, from: 'pump gpm (its only pivot)' })
    // #8 Ray Dalton after the unmeasured 1,000 gpm was cleared: the curve estimate stands in.
    expect(pivotFlow(blank, null, { gpm: null, gpm_estimate: 780 })).toEqual({ gpm: 780, from: 'pump-curve estimate (its only pivot)' })
    expect(pivotFlow(blank, null, null)).toEqual({ gpm: null, from: null })
  })
})

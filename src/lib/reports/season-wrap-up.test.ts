import { describe, expect, it } from 'vitest'
import type { BookRow, CropBooks } from './crop-books'
import type { YieldScore } from '@/lib/yield-goal'
import { reportCsv, reportTable } from './framework'
import { buildWrapUp, cleanAndPreClean, versusCell, weatherNotes, wrapUpCsv, wrapUpPdf, WRAP_COLUMNS, type WrapPlanRow, type WrapUpInput } from './season-wrap-up'

/*
 * Made-up figures throughout: small, round and obviously not the farm's.
 */

const CANOLA = { id: 'c-canola', name: 'Canola', yield_unit: 'bu' }
const WHEAT = { id: 'c-wheat', name: 'Wheat', yield_unit: 'bu' }

const score = (o: { goal: number; estimate: number; actual?: number; clean?: boolean }): YieldScore => {
  const vs = (ref: number) => (o.actual == null ? null : { diff: o.actual - ref, pct: ((o.actual - ref) / ref) * 100, dir: o.actual > ref ? ('above' as const) : o.actual < ref ? ('below' as const) : ('on' as const) })
  return {
    goal: { value: o.goal, source: 'field' },
    estimate: { value: o.estimate, low: o.estimate, high: o.estimate, before: o.estimate, cutPct: 0, note: 'this field’s average', typed: false, fromDefault: false, history: { value: o.estimate, basis: 'field', label: 'this field’s average' } as never },
    actual: o.actual == null ? null : { value: o.actual, clean: o.clean ?? true },
    vsEstimate: vs(o.estimate),
    vsGoal: vs(o.goal),
  }
}

const planRow = (o: Partial<Omit<WrapPlanRow, 'field' | 'crop'>> & { fieldId: string; field?: string; crop: typeof CANOLA; acres: number }): WrapPlanRow => ({
  field: { id: o.fieldId, name: o.field ?? o.fieldId, legal_land_description: null },
  plan: o.isZone ? null : { crop_id: o.crop.id, variety: 'V-1' },
  crop: o.crop,
  acres: o.acres,
  cut: o.cut ?? null,
  cutPct: o.cut?.loss_pct ?? 0,
  zoneId: o.zoneId ?? null,
  isZone: o.isZone,
  score: o.score ?? null,
})

const book = (o: { fieldId: string; field?: string; crop: typeof CANOLA; zoneId?: string | null; acres: number; gross: number | null; cost: number; margin: number | null; fixed?: number; yieldFrom?: BookRow['yieldFrom'] }): BookRow => ({
  fieldId: o.fieldId,
  field: o.field ?? o.fieldId,
  zoneId: o.zoneId ?? null,
  crop: o.crop as never,
  unit: 'bu',
  acres: o.acres,
  yieldPerAcre: 40,
  yieldFrom: o.yieldFrom ?? 'actual',
  price: 10,
  priceFrom: 'contract',
  gross: o.gross,
  otherRevenue: 0,
  costs: { seed: 50, fertilizer: 40, chemical: 30, fuel: 10, trucking: 5, other: 0, fixed: o.fixed ?? 60 },
  insurance: 0,
  rent: 0,
  ownerShare: 0,
  rentReceived: 0,
  ourFraction: 1,
  deal: null,
  landDeal: null,
  inputs: 120,
  cost: o.cost,
  margin: o.margin,
  unpriced: 0,
})

const books = (rows: BookRow[], extra: Partial<CropBooks> = {}): CropBooks => ({ year: 2099, rows, rentIn: [], fixedPerAcre: 6, fixedFrom: null, offBooks: [], ...extra })

function input(over: Partial<WrapUpInput> = {}): WrapUpInput {
  return {
    year: 2099,
    today: '2099-10-01',
    fieldId: null,
    planRows: [
      planRow({ fieldId: 'f1', field: '1', crop: CANOLA, acres: 10, score: score({ goal: 50, estimate: 40, actual: 44 }) }),
      planRow({ fieldId: 'f2', field: '2', crop: WHEAT, acres: 20, score: score({ goal: 60, estimate: 60, actual: 54, clean: false }) }),
    ],
    books: books([
      book({ fieldId: 'f1', field: '1', crop: CANOLA, acres: 10, gross: 400, cost: 300, margin: 100 }),
      book({ fieldId: 'f2', field: '2', crop: WHEAT, acres: 20, gross: 600, cost: 500, margin: 100 }),
    ]),
    estimates: [
      { fieldId: 'f1', zoneId: null, cropId: CANOLA.id, variety: 'V-1', seeded: '2099-05-01', harvestedOn: '2099-09-05', harvestedFrom: 'last_load', estimate: { mature: '2099-09-01', seeded: '2099-05-01', notReached: false } as never, reasons: 'seeded 1 May' },
    ],
    history: [{ field_id: 'f1', crop_id: CANOLA.id, crop_year: 2099, acres: 10, yield_per_acre: 46, clean_yield_per_acre: 44, yield_unit: 'bu', source: 'scale' }],
    hail: [{ field_id: 'f1', event_date: '2099-07-10', loss_pct: 15, acres: 4, notes: null }],
    irrigation: new Map([['f1', { mm: 254, days: 6 }]]),
    seasonWater: new Map([['f1', { rainMm: 127, stressDays: 3 }]]),
    weather: new Map(),
    work: [{ field_id: 'f2', zone_id: null, crop_id: null, label: 'Swathing', counts_as: null, started_at: '2099-08-20' }],
    scouting: [],
    inspections: [],
    finance: false,
    fixedParts: null,
    ...over,
  }
}

describe('season wrap-up assembly', () => {
  it('puts each crop on a field together with its dates, yields, hail, water and money', () => {
    const w = buildWrapUp(input())
    expect(w.fields.map((f) => f.field)).toEqual(['1', '2'])
    const a = w.fields[0].areas[0]
    expect(a.seeded).toBe('2099-05-01')
    expect(a.harvestEstimate).toBe('2099-09-01')
    expect(a.harvested).toBe('2099-09-05')
    expect(a.harvestVsEstimate).toBe(4)
    expect(a.harvestedFrom).toBe('last load from the field')
    expect(a.actual).toBe(44)
    expect(a.actualBasis).toBe('clean')
    expect(a.actualClean).toBe(44)
    expect(a.actualPreClean).toBe(46)
    expect(a.vsGoal?.diff).toBe(-6)
    expect(a.vsEstimate?.pct).toBeCloseTo(10)
    expect(a.money?.revenue).toBe(400)
    expect(a.money?.margin).toBe(100)
    expect(a.money?.fixed).toBe(60)
    expect(w.fields[0].hail).toHaveLength(1)
    expect(w.fields[0].irrigationMm).toBe(254)
    expect(w.fields[0].notes.join(' ')).toContain('3 days short of water')
    expect(w.fields[1].notes.join(' ')).toContain('Work entered by hand: Swathing')
    expect(w.fields[1].areas[0].actualBasis).toBe('pre-clean')
  })

  it('rolls the crops up with the Crop P&L’s money and the farm margin as that report works it out', () => {
    const w = buildWrapUp(
      input({
        books: books(
          [
            book({ fieldId: 'f1', field: '1', crop: CANOLA, acres: 10, gross: 400, cost: 300, margin: 100 }),
            book({ fieldId: 'f2', field: '2', crop: WHEAT, acres: 20, gross: 600, cost: 500, margin: 100 }),
            { ...book({ fieldId: 'f9', field: '9', crop: CANOLA, acres: 0, gross: null, cost: 25, margin: null }), crop: null },
          ],
          { rentIn: [{ landlord: 'Somebody', amount: 50, landShare: 10 }] },
        ),
      }),
    )
    expect(w.crops.map((c) => c.crop)).toEqual(['Canola', 'Wheat'])
    expect(w.crops[0].revenue).toBe(400)
    expect(w.totals.revenue).toBe(1000)
    // Crop margins plus the rent less its land share; the off-plan costs are in no margin.
    expect(w.totals.margin).toBe(240)
    expect(w.totals.costsOffPlan).toBe(25)
    expect(w.totals.cost).toBe(300 + 500 + 25 + 10)
  })

  it('compares a crop’s average only over its harvested acres', () => {
    const w = buildWrapUp(
      input({
        planRows: [
          planRow({ fieldId: 'f1', field: '1', crop: CANOLA, acres: 10, score: score({ goal: 50, estimate: 40, actual: 40 }) }),
          planRow({ fieldId: 'f3', field: '3', crop: CANOLA, acres: 30, score: score({ goal: 50, estimate: 40, actual: 60 }) }),
          planRow({ fieldId: 'f4', field: '4', crop: CANOLA, acres: 99, score: score({ goal: 10, estimate: 10 }) }),
        ],
      }),
    )
    const c = w.crops.find((x) => x.crop === 'Canola')!
    expect(c.harvested).toBe(2)
    expect(c.areas).toBe(3)
    expect(c.actual).toBe(55)
    expect(c.goal).toBe(50)
    expect(c.vsGoal?.pct).toBeCloseTo(10)
  })

  it('gives a split field a column a crop area, matched to its own book row', () => {
    const w = buildWrapUp(
      input({
        planRows: [
          planRow({ fieldId: 'f5', field: '5', crop: CANOLA, acres: 12, zoneId: 'z-a', isZone: true }),
          planRow({ fieldId: 'f5', field: '5', crop: WHEAT, acres: 8, zoneId: 'z-b', isZone: true }),
        ],
        books: books([
          book({ fieldId: 'f5', field: '5', crop: CANOLA, zoneId: 'z-a', acres: 12, gross: 120, cost: 90, margin: 30 }),
          book({ fieldId: 'f5', field: '5', crop: WHEAT, zoneId: 'z-b', acres: 8, gross: 80, cost: 70, margin: 10 }),
        ]),
      }),
    )
    expect(w.fields).toHaveLength(1)
    expect(w.fields[0].areas.map((a) => a.money?.margin)).toEqual([30, 10])
    const pdf = wrapUpPdf(w, 'Season wrap-up')
    const page = pdf.sections.find((s) => s.title === 'Field 5')!
    expect(page.head).toEqual(['', 'Canola (area)', 'Wheat (area)'])
    const hail = page.rows.find((r) => r[0] === 'Hail records (AFSC and marked)')!
    expect(hail).toEqual(['Hail records (AFSC and marked)', 'none', '(whole field)'])
  })

  it('leaves out crops that are not on our books, and says so', () => {
    const w = buildWrapUp(
      input({
        planRows: [...input().planRows, planRow({ fieldId: 'f6', field: '6', crop: { id: 'c-pot', name: 'Potatoes', yield_unit: 'cwt' }, acres: 5 })],
        books: books(input().books.rows, { offBooks: [{ field: '6', crop: 'Potatoes', acres: 5, why: 'grown by a renter, not on our books' }] }),
      }),
    )
    expect(w.fields.map((f) => f.field)).toEqual(['1', '2'])
    expect(wrapUpPdf(w, 'T').lead!.join(' ')).toContain('Not on our books: Potatoes on Field 6')
  })

  it('names the best and the worst field on margin and on yield', () => {
    const w = buildWrapUp(input())
    const margin = w.standouts.find((s) => s.measure === 'Margin an acre')!
    expect(margin.best).toContain('Field 1 Canola')
    expect(margin.worst).toContain('Field 2 Wheat')
    const goal = w.standouts.find((s) => s.measure === 'Yield against goal')!
    // 54 against 60 (−10%) beats 44 against 50 (−12%).
    expect(goal.best).toBe('Field 2 Wheat: 54 bu/ac, −6 (−10%) against goal')
    expect(goal.worst).toContain('Field 1 Canola')
  })
})

describe('what the viewer may not see', () => {
  it('says the fixed-cost breakdown is hidden to anyone without finance access', () => {
    const w = buildWrapUp(input({ finance: false, fixedParts: [{ label: 'Land', perAcre: 3 }] }))
    expect(w.fixedParts).toBeNull()
    const pdf = wrapUpPdf(w, 'Season wrap-up')
    expect(pdf.meta.find(([k]) => k === 'Fixed-cost breakdown')?.[1]).toMatch(/hidden/)
    const fixed = pdf.sections.find((s) => s.title === 'Fixed costs an acre')!
    expect(fixed.rows).toEqual([['Breakdown', 'hidden (owners and the accountant only)']])
    // The $/ac every budget charges is everyone's.
    expect(fixed.foot?.[1]).toBe('$6.00')
    const csv = reportCsv(wrapUpCsv(w, 'Season wrap-up'))
    expect(csv).toContain('hidden (owners and the accountant only)')
  })

  it('shows the parts to the owners and the accountant', () => {
    const w = buildWrapUp(input({ finance: true, fixedParts: [{ label: 'Land', perAcre: 3 }, { label: 'Labour', perAcre: 2 }] }))
    const pdf = wrapUpPdf(w, 'Season wrap-up')
    expect(pdf.meta.some(([k]) => k === 'Fixed-cost breakdown')).toBe(false)
    expect(pdf.sections.find((s) => s.title === 'Fixed costs an acre')!.rows).toEqual([
      ['Land', '$3.00'],
      ['Labour', '$2.00'],
    ])
  })

  it('says a flat rent’s land share is hidden rather than counting it as nothing', () => {
    const w = buildWrapUp(input({ books: books(input().books.rows, { rentIn: [{ landlord: 'Somebody', amount: 50, landShare: 0 }] }) }))
    expect(wrapUpPdf(w, 'T').lead!.join(' ')).toContain('land share of the fixed costs is hidden')
  })
})

describe('the files', () => {
  it('makes a CSV row a crop area with the whole farm at the foot', () => {
    const d = wrapUpCsv(buildWrapUp(input()), 'Season wrap-up')
    expect(d.groups[0].rows).toHaveLength(2)
    expect(d.columns).toBe(WRAP_COLUMNS)
    const at = (l: string) => WRAP_COLUMNS.findIndex((c) => c.label === l)
    const row = d.groups[0].rows[0]
    expect(row[at('Field')]).toBe('Field 1')
    expect(row[at('Harvest vs estimate (days)')]).toBe(4)
    expect(row[at('Irrigation (in)')]).toBe(10)
    expect(row[at('Rain (in)')]).toBe(5)
    expect(row[at('Margin /ac')]).toBe(10)
    expect(d.totals![0]).toBe('Whole farm')
    expect(d.totals![at('Margin')]).toBe(200)
  })

  it('makes one field’s page alone when a field is picked', () => {
    const w = buildWrapUp(input({ fieldId: 'f2' }))
    expect(w.fields.map((f) => f.field)).toEqual(['2'])
    const pdf = wrapUpPdf(w, 'Season wrap-up')
    expect(pdf.sections.map((s) => s.title)).toEqual(['Field 2'])
    expect(pdf.sections[0].pageBreakBefore).toBe(false)
    expect(pdf.subtitle).toBe('Crop year 2099 · Field 2')
    expect(wrapUpCsv(w, 'T').totals![0]).toBe('Field total')
  })

  it('starts each field on its own page after the farm summary', () => {
    const pdf = wrapUpPdf(buildWrapUp(input()), 'Season wrap-up')
    expect(pdf.sections.map((s) => s.title)).toEqual(['The farm by crop', 'Best and worst fields', 'Fixed costs an acre', 'Field 1', 'Field 2'])
    expect(pdf.sections.filter((s) => s.pageBreakBefore).map((s) => s.title)).toEqual(['Field 1', 'Field 2'])
    // It lays out as a PDF table without complaint.
    expect(reportTable(pdf).sections).toHaveLength(5)
  })

  it('says so when there is nothing to wrap up', () => {
    expect(() => wrapUpPdf(buildWrapUp(input({ planRows: [] })), 'T')).toThrow(/Nothing is planned for 2099/)
    expect(() => wrapUpCsv(buildWrapUp(input({ fieldId: 'nope' })), 'T')).toThrow(/Nothing was grown on that field/)
  })
})

describe('the pieces', () => {
  it('weights clean and pre-clean yields by acres', () => {
    const h = [
      { field_id: 'f', crop_id: 'c', crop_year: 2099, acres: 10, yield_per_acre: 50, clean_yield_per_acre: 48, yield_unit: 'bu', source: 'scale' },
      { field_id: 'f', crop_id: 'c', crop_year: 2099, acres: 30, yield_per_acre: 70, clean_yield_per_acre: null, yield_unit: 'bu', source: 'scale' },
      { field_id: 'f', crop_id: 'c', crop_year: 2099, acres: 30, yield_per_acre: 99, clean_yield_per_acre: 99, yield_unit: 'bu', source: 'fah_import' },
    ]
    expect(cleanAndPreClean(h, { fieldId: 'f', cropId: 'c', year: 2099, unit: 'bu' })).toEqual({ clean: 48, preClean: 65 })
  })

  it('finds heat in canola’s flowering and frost before it matures', () => {
    const days = [
      { date: '2099-06-20', tmax: 31, tmin: 12 }, // 50 days after seeding: in flower
      { date: '2099-06-21', tmax: 33, tmin: 14 },
      { date: '2099-05-10', tmax: 35, tmin: 5 }, // too early to matter
      { date: '2099-08-10', tmax: 20, tmin: -3 }, // frost before maturity
    ]
    const notes = weatherNotes('Canola', '2099-05-01', '2099-09-01', days)
    expect(notes[0]).toMatch(/^2 days of heat, up to 33\.0 °C \(2099-06-20 to 2099-06-21\)/)
    expect(notes[1]).toMatch(/^1 night of frost, down to -3\.0 °C \(2099-08-10\)/)
    expect(weatherNotes('Canola', null, '2099-09-01', days)).toEqual([])
  })

  it('writes a difference with its sign and its %', () => {
    expect(versusCell({ diff: 7.24, pct: 13.2, dir: 'above' })).toBe('+7.2 (+13%)')
    expect(versusCell({ diff: -3, pct: -5, dir: 'below' })).toBe('−3 (−5%)')
    expect(versusCell({ diff: 0, pct: 0, dir: 'on' })).toBe('on')
    expect(versusCell(null)).toBeNull()
  })
})

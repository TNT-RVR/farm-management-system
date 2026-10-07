import { beforeAll, describe, expect, it } from 'vitest'
import { ADDER_WINDOW_MONTHS, MIN_ICI_TONNES, computeAdders, monthSpan, surveyKeyOf, type FxDay } from './adder'
import { KG_PER_SHORT_TON } from './straights'
import { setFarmContext } from '../farm-context'

// Written against the original farm, whose retailer is ICI; the generic default is "Retailer".
beforeAll(() => setFarmContext({ retailer: 'ICI' }))

const toCad = (usd: number, fx: number) => usd * (1000 / KG_PER_SHORT_TON) * fx

describe('surveyKeyOf', () => {
  it('maps the bulk straights the survey and DTN share', () => {
    expect(surveyKeyOf('fertilizer-46-0-0-urea-bulk-tonne')).toBe('46-0-0')
    expect(surveyKeyOf('fertilizer-11-52-0-monoammonium-phosphate-bulk-tonne')).toBe('11-52-0')
    // The survey's pre-2025 name for MAP.
    expect(surveyKeyOf('fertilizer-11-51-0-bulk-tonne')).toBe('11-52-0')
    expect(surveyKeyOf('fertilizer-0-0-60-potassium-chloride-bulk-tonne')).toBe('0-0-60')
    expect(surveyKeyOf('fertilizer-21-0-0-24-ammonium-sulphate-bulk-tonne')).toBe('21-0-0-24')
  })
  it('leaves out anhydrous (the survey price includes the applicator) and anything not bulk', () => {
    expect(surveyKeyOf('fertilizer-82-0-0-anhydrous-ammonia-full-service-with-applicator-bulk-tonne')).toBeNull()
    expect(surveyKeyOf('fertilizer-46-0-0-urea-bagged-25-kg')).toBeNull()
    expect(surveyKeyOf('diesel-fuel-100-litres')).toBeNull()
  })
})

describe('monthSpan', () => {
  it('reads like a person wrote it', () => {
    expect(monthSpan(['2026-07'])).toBe('Jul 2026')
    expect(monthSpan(['2026-09', '2026-07', '2026-08'])).toBe('Jul–Sep 2026')
    expect(monthSpan(['2025-11', '2026-02'])).toBe('Nov 2025–Feb 2026')
  })
})

describe('computeAdders', () => {
  const fx: FxDay[] = [
    { on: '2026-07-02', rate: 1.36 },
    { on: '2026-07-20', rate: 1.38 },
  ]

  it('subtracts DTN, averaged over the month and converted short ton → tonne at the month’s rate', () => {
    const dtn = new Map([['46-0-0', [{ on: '2026-07-01', usd: 700 }, { on: '2026-07-22', usd: 680 }]]])
    const res = computeAdders({ ici: [], survey: [{ key: '46-0-0', on: '2026-07-01', perTonne: 1100 }], dtn, fx }).get('46-0-0')!
    const dtnCad = toCad(690, 1.37)
    expect(res.months).toHaveLength(1)
    expect(res.months[0].dtnCad).toBeCloseTo(dtnCad, 6)
    expect(res.months[0].fxBorrowedFrom).toBeNull()
    expect(res.perTonne).toBeCloseTo(1100 - dtnCad, 6)
    expect(res.basis).toBe("from Alberta's input price survey, Jul 2026")
  })

  it('keeps a negative adder: Alberta running below US retail is a real figure', () => {
    // MAP at $89/t under DTN, as the survey had it in Draft 2 (Sam: "Sure").
    const dtn = new Map([['11-52-0', [{ on: '2026-07-08', usd: 800 }]]])
    const below = toCad(800, 1.37) - 89
    const res = computeAdders({ ici: [], survey: [{ key: '11-52-0', on: '2026-07-01', perTonne: below }], dtn, fx }).get('11-52-0')!
    expect(res.perTonne).toBeCloseTo(-89, 6)
    expect(res.used).toHaveLength(1)
  })

  it('prefers ICI over the survey, tonne-weighted, and drops lots too small to be bulk', () => {
    const dtn = new Map([['46-0-0', [{ on: '2026-07-08', usd: 700 }]]])
    const res = computeAdders({
      ici: [
        { key: '46-0-0', on: '2026-07-03', perTonne: 1000, tonnes: 30 },
        { key: '46-0-0', on: '2026-07-15', perTonne: 1200, tonnes: 10 },
        { key: '46-0-0', on: '2026-07-16', perTonne: 5000, tonnes: MIN_ICI_TONNES - 0.5 },
      ],
      survey: [{ key: '46-0-0', on: '2026-07-01', perTonne: 900 }],
      dtn,
      fx,
    }).get('46-0-0')!
    expect(res.months[0].localSource).toBe('ICI')
    expect(res.months[0].local).toBeCloseTo(1050, 6)
    expect(res.months[0].localTonnes).toBe(40)
    expect(res.basis).toBe('from ICI invoices, Jul 2026')
  })

  it('borrows the nearest day’s rate when a month has none, and says so', () => {
    const dtn = new Map([['0-0-60', [{ on: '2026-03-11', usd: 490 }]]])
    const res = computeAdders({ ici: [], survey: [{ key: '0-0-60', on: '2026-03-01', perTonne: 700 }], dtn, fx }).get('0-0-60')!
    expect(res.months[0].fxBorrowedFrom).toBe('2026-07-02')
    expect(res.months[0].fx).toBe(1.36)
  })

  it('takes the median of the last months, and flags a wild month instead of using it', () => {
    const weeks = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'].map((m) => ({ on: `${m}-10`, usd: 500 }))
    const rate: FxDay[] = weeks.map((w) => ({ on: w.on, rate: 1.4 }))
    const base = toCad(500, 1.4)
    // Adders: Jan +500 (outside the window), Feb..Jun +10,+20,+30,+40,+50, Jul −300 (flagged).
    const adds = [500, 10, 20, 30, 40, 50, -300]
    const survey = weeks.map((w, i) => ({ key: '11-52-0', on: `${w.on.slice(0, 7)}-01`, perTonne: base + adds[i] }))
    const res = computeAdders({ ici: [], survey, dtn: new Map([['11-52-0', weeks]]), fx: rate }).get('11-52-0')!
    expect(res.months).toHaveLength(7)
    expect(res.months[6].flag).toMatch(/under DTN/)
    // Jan is +500 on a ~$770 price: flagged as over the ceiling share too.
    expect(res.months[0].flag).toMatch(/over DTN/)
    expect(res.used.map((m) => m.month)).toEqual(['2026-02', '2026-03', '2026-04', '2026-05', '2026-06'])
    expect(res.used.length).toBeLessThanOrEqual(ADDER_WINDOW_MONTHS)
    expect(res.perTonne).toBeCloseTo(30, 6)
  })

  it('windows on calendar months back from the latest good month', () => {
    const months = ['2025-10', '2025-12', '2026-02', '2026-03', '2026-04', '2026-05', '2026-07']
    const weeks = months.map((m) => ({ on: `${m}-15`, usd: 600 }))
    const rate: FxDay[] = weeks.map((w) => ({ on: w.on, rate: 1.4 }))
    const survey = months.map((m, i) => ({ key: '46-0-0', on: `${m}-01`, perTonne: toCad(600, 1.4) + i }))
    const res = computeAdders({ ici: [], survey, dtn: new Map([['46-0-0', weeks]]), fx: rate }).get('46-0-0')!
    expect(res.used.map((m) => m.month)).toEqual(['2026-02', '2026-03', '2026-04', '2026-05', '2026-07'])
    expect(res.basis).toBe("from Alberta's input price survey, Feb–Jul 2026")
  })

  it('has no adder when nothing local lines up with a DTN week', () => {
    const dtn = new Map([['28-0-0', [{ on: '2026-07-08', usd: 400 }]]])
    const res = computeAdders({ ici: [], survey: [], dtn, fx }).get('28-0-0')!
    expect(res.perTonne).toBeNull()
    expect(res.basis).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  binTonnes,
  isNutrientGrant,
  isOvercharge,
  manureValue,
  nerpLevel,
  ofcafEstimate,
  prepayVsInterest,
  priceChecks,
  samplingPayback,
  seasonalGap,
  spreadVerdict,
  storeValue,
} from './more'

describe('invoice versus agreed price', () => {
  it('holds each line to the latest deal made before it', () => {
    const checks = priceChecks(
      [
        { product: '46-0-0', perTonne: 1066, on: '2026-05-13', invoice: 'INV1', tonnes: 10 },
        { product: '46-0-0', perTonne: 1040, on: '2026-03-01', invoice: 'INV0', tonnes: 5 },
        { product: '11-52-0', perTonne: 1200, on: '2026-05-13', invoice: 'INV1', tonnes: 4 },
      ],
      [
        { product: '46-0-0', perTonne: 1000, on: '2026-02-01', label: 'booked 2026-02-01' },
        { product: '46-0-0', perTonne: 1050, on: '2026-04-01', label: 'quote 2026-04-01' },
      ],
    )
    expect(checks).toHaveLength(2)
    const may = checks.find((c) => c.invoice === 'INV1')!
    expect(may.agreed).toBe(1050)
    expect(may.overTotal).toBe(160)
    expect(isOvercharge(may)).toBe(true)
    const march = checks.find((c) => c.invoice === 'INV0')!
    expect(march.over).toBe(40)
  })

  it('does not call rounding an over-charge', () => {
    expect(isOvercharge({ product: 'x', invoice: null, on: '', tonnes: 1, charged: 1005, agreed: 1000, agreedFrom: '', over: 5, overTotal: 5 })).toBe(false)
  })
})

describe('money on offer', () => {
  it('caps OFCAF by the field and the zone', () => {
    const r = ofcafEstimate(
      [
        { acres: 100, zoneMapped: false, thirdParty: false },
        { acres: 100, zoneMapped: true, thirdParty: true },
      ],
      215,
    )
    // Field one: lab fees capped at $100 of grant, so $117.65 of cost counts.
    // Field two: zone mapping, $800 of grant cap, so the whole $215 counts.
    expect(r.grant).toBeCloseTo(100 + 215 * 0.85, 1)
  })

  it('finds the nutrient grants in the tracker', () => {
    expect(isNutrientGrant({ title: 'On-Farm Climate Action Fund - RDAR', categories: ['nitrogen management'] })).toBe(true)
    expect(isNutrientGrant({ title: 'On-Farm Value-Added Program', categories: ['processing'] })).toBe(false)
  })

  it('grades a field’s 4R plan', () => {
    expect(nerpLevel({ soilTest: false, rateFromTest: false, zoneRx: false, split: false, enhanced: false }).level).toBe('none')
    expect(nerpLevel({ soilTest: true, rateFromTest: true, zoneRx: false, split: true, enhanced: false }).level).toBe('basic')
    expect(nerpLevel({ soilTest: true, rateFromTest: true, zoneRx: true, split: false, enhanced: false }).level).toBe('intermediate')
    expect(nerpLevel({ soilTest: true, rateFromTest: true, zoneRx: true, split: true, enhanced: false }).level).toBe('advanced')
  })
})

describe('spread window', () => {
  const day = (precip: number, hi = 15, windMax = 10) => ({ date: '2026-10-01', precip, hi, windMax })
  it('wants half an inch in the next two days', () => {
    expect(spreadVerdict([day(8), day(6)], 0).verdict).toBe('good')
    expect(spreadVerdict([day(2), day(1)], 0).verdict).toBe('poor')
    expect(spreadVerdict([day(0, 24), day(0)], 0).verdict).toBe('poor')
    expect(spreadVerdict([day(0, 10), day(0)], 0).verdict).toBe('fair')
    // A pivot makes its own half inch.
    expect(spreadVerdict([day(0, 24), day(0)], 0, true).verdict).toBe('good')
  })
  it('waits up to a week for rain in cool weather, two with treated urea', () => {
    const week = (rainDay: number, hi = 6) =>
      Array.from({ length: 14 }, (_, k) => ({ date: `2026-10-${String(k + 1).padStart(2, '0')}`, precip: k === rainDay ? 15 : 0, hi, lo: 2, windMax: 10 }))
    expect(spreadVerdict(week(5), 0).verdict).toBe('good')
    expect(spreadVerdict(week(10), 0).verdict).toBe('fair')
    expect(spreadVerdict(week(10), 0, false, { nbpt: true }).verdict).toBe('good')
    // Warm days are not rescued by rain a week away, unless it is treated.
    expect(spreadVerdict(week(5, 24), 0).verdict).toBe('poor')
    expect(spreadVerdict(week(5, 24), 0, false, { nbpt: true }).verdict).toBe('fair')
  })
  it('does not call a frosty morning safe', () => {
    const d = Array.from({ length: 7 }, (_, k) => ({ date: `2026-11-0${k + 1}`, precip: k === 4 ? 15 : 0, hi: 5, lo: -4, windMax: 10 }))
    expect(spreadVerdict(d, 0).verdict).toBe('fair')
    expect(spreadVerdict(d, 0).why).toContain('frost')
  })
})

describe('manure in dollars', () => {
  it('counts only what the field needs, less the haul', () => {
    const v = manureValue({
      perTon: { n: 12, p2o5: 9, k2o: 14 },
      firstYearN: 0.25,
      firstYearP: 0.5,
      firstYearK: 0.9,
      needs: { n: true, p: true, k: false },
      price: { n: 1, p2o5: 1, k2o: 0.6 },
      roadKm: 5,
      haulPerTonKm: 0.3,
      loadPerTon: 1,
      buyPerTon: 0,
    })
    expect(v.parts.k).toBe(0)
    expect(v.gross).toBeCloseTo(3 + 4.5)
    expect(v.cost).toBeCloseTo(4)
    expect(v.net).toBeCloseTo(3.5)
  })
})

describe('prepay versus interest', () => {
  it('takes the discount only when it beats the interest', () => {
    const r = prepayVsInterest({ spend: 100000, tonnes: 100, discountPct: 3, discountPerTonne: null, payBy: '2026-11-30', wouldPayOn: '2027-04-30', ratePct: 7 })
    expect(r.discount).toBe(3000)
    expect(r.days).toBe(151)
    expect(r.interest).toBeCloseTo((97000 * 0.07 * 151) / 365, 0)
    expect(r.net).toBeGreaterThan(0)
  })
})

describe('buy and store', () => {
  it('turns a bin into tonnes of urea', () => {
    expect(binTonnes(5800, '46-0-0')).toBeCloseTo(151.2, 0)
  })

  it('reads the summer-to-spring move off a quarterly index', () => {
    const pts = [
      { on: '2024-07-01', value: 100 },
      { on: '2025-04-01', value: 110 },
      { on: '2025-07-01', value: 120 },
      { on: '2026-04-01', value: 126 },
    ]
    const g = seasonalGap(pts)!
    expect(g.years).toBe(2)
    expect(g.pct).toBeCloseTo(7.5)
  })

  it('weighs the spring premium against interest and shrink', () => {
    const v = storeValue({ tonnes: 100, pricePerTonne: 1000, springPremiumPct: 8, ratePct: 7, months: 7, shrinkPct: 1 })
    expect(v.gain).toBe(8000)
    expect(v.interest).toBeCloseTo(4083.3, 0)
    expect(v.net).toBeCloseTo(8000 - 4083.3 - 1000, 0)
  })
})

describe('sampling payback', () => {
  it('says whether denser sampling would have paid', () => {
    const r = samplingPayback(4000, 130, 215, 8)
    expect(r.paysField).toBe(true)
    expect(r.zoneCost).toBe(1040)
    expect(r.paysZone).toBe(true)
    expect(samplingPayback(100, 130, 215, 8).paysField).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  cheapestPerLb,
  costPerLbPrimary,
  nutrientCosts,
  perLitreToPerTonne,
  straightByKey,
  straightKeyOf,
  straightsCost,
  straightsForBlend,
  usdShortTonToCadTonne,
} from './straights'
import { checkFractionFor, economicNRate, legumeCredit, nitrogenLossRisk, removalFor } from './agronomy'
import {
  buyWindow,
  creditCheck,
  cropRemoval,
  nutrientBalance,
  overApplied,
  productPositions,
  quoteRequestText,
  serviceKind,
  serviceTotals,
  splitPlan,
  stripResult,
  suggestedRate,
  tissueGate,
  vrSaving,
} from './tools'

describe('straights', () => {
  it('reads the straight out of the names ICI and Deere use', () => {
    expect(straightKeyOf('Tonne 46-0-0')).toBe('46-0-0')
    expect(straightKeyOf('Tonne 28-0-0-0 UAN')).toBe('28-0-0')
    expect(straightKeyOf('Filtered 28-0-0 UAN')).toBe('28-0-0')
    expect(straightKeyOf('0-0-60 KCL')).toBe('0-0-60')
    expect(straightKeyOf('ESN 44-0-0')).toBe('44-0-0')
    expect(straightKeyOf('Tonne 46.0-0.0-0.0-0.0 Blend')).toBe('46-0-0')
    expect(straightKeyOf('Tonne 28.2-10.8-4.3-4.3-0.4B Blend')).toBeNull()
  })

  it('turns a DTN US$/short ton into CAD/tonne', () => {
    // Urea at US$658/ton and 1.4064: about $1,020/t, as the market tab showed.
    expect(Math.round(usdShortTonToCadTonne(658, 1.4064))).toBe(1020)
  })

  it('turns UAN at $1.15/L into a tonne price through its density', () => {
    expect(Math.round(perLitreToPerTonne(1.15, 1.28))).toBe(898)
  })

  it('credits MAP’s nitrogen before charging the rest to phosphate', () => {
    const map = straightByKey('11-52-0')!
    const bare = costPerLbPrimary(map, 1200, 0)!
    const credited = costPerLbPrimary(map, 1200, 0.8)!
    expect(credited).toBeLessThan(bare)
    // Without an N price there is no honest P figure.
    expect(costPerLbPrimary(map, 1200, null)).toBeNull()
  })

  it('finds the cheapest pound of each nutrient, leaving ESN out of the race', () => {
    const rows = nutrientCosts([
      { key: '46-0-0', perTonne: 800, source: 'ICI invoice', on: '2024-04-29' },
      { key: '28-0-0', perTonne: 898, source: 'ICI invoice', on: '2026-06-18' },
      { key: '44-0-0', perTonne: 700, source: 'Quote', on: '2026-09-01' },
      { key: '11-52-0', perTonne: 1200, source: 'ICI invoice', on: '2024-06-13' },
    ])
    const best = cheapestPerLb(rows)
    expect(best.n?.key).toBe('46-0-0')
    // Anhydrous is cheaper per pound but needs a toolbar this farm does not run.
    const withNh3 = cheapestPerLb(nutrientCosts([{ key: '46-0-0', perTonne: 1020, source: 'DTN US retail', on: '2026-09-16' }, { key: '82-0-0', perTonne: 1454, source: 'DTN US retail', on: '2026-09-16' }]))
    expect(withNh3.n?.key).toBe('46-0-0')
    expect(best.p2o5?.key).toBe('11-52-0')
    // ESN is costed, just not crowned.
    expect(rows.some((r) => r.key === '44-0-0')).toBe(true)
  })

  it('makes a blend out of straights and prices it', () => {
    const recipe = straightsForBlend({ n: 21, p2o5: 0, k2o: 0, s: 10 })!
    // 10% S needs 0.417 t of AMS, which brings 8.75% N; the rest is urea.
    expect(recipe['21-0-0-24']).toBeCloseTo(0.4167, 3)
    expect(recipe['46-0-0']).toBeCloseTo((21 - 0.4167 * 21) / 46, 3)
    const priced = straightsCost({ n: 21, p2o5: 0, k2o: 0, s: 10 }, (k) => (k === '46-0-0' ? 800 : k === '21-0-0-24' ? 600 : null))
    expect(priced && 'cost' in priced ? Math.round(priced.cost) : null).toBe(Math.round(0.4167 * 600 + ((21 - 0.4167 * 21) / 46) * 800))
    // A missing straight is named, not treated as free.
    expect(straightsCost({ n: 20, p2o5: 20, k2o: 10, s: 0 }, (k) => (k === '0-0-60' ? null : 900))).toEqual({ missing: ['0-0-60'] })
  })

  it('refuses a blend the straights cannot make', () => {
    expect(straightsForBlend({ n: 5, p2o5: 52, k2o: 0, s: 0 })).toBeNull()
  })
})

describe('agronomy', () => {
  it('knows removal for the crops grown here', () => {
    expect(removalFor('Canola')?.p2o5).toBeCloseTo(0.67)
    expect(removalFor('Durum Wheat')?.n).toBeCloseTo(1.64)
    expect(removalFor('Buckwheat')).toBeNull()
    expect(removalFor('Alfalfa Seed')?.unit).toBe('lb')
    expect(removalFor('Alfalfa')?.unit).toBe('ton')
    expect(removalFor('Beans-Pinto')?.unit).toBe('cwt')
    expect(removalFor('Summer Fallow')).toBeNull()
  })

  it('credits the legumes, and nothing else', () => {
    expect(legumeCredit('Alfalfa')?.lbN).toBe(100)
    expect(legumeCredit('Alfalfa')?.year2).toBe(50)
    expect(legumeCredit('Beans-Pinto')?.lbN).toBe(10)
    expect(legumeCredit('Canola')).toBeNull()
  })

  it('cuts the N rate when nitrogen is dear against the crop', () => {
    // Canola: 120 lb N for 60 bu, check yield 55%. N at $0.90/lb, canola $17.97/bu.
    const r = economicNRate({ recN: 120, yieldGoal: 60, checkFraction: 0.55, nPerLb: 0.9, cropPerUnit: 17.97 })!
    expect(r.ratio).toBeCloseTo(0.0501, 3)
    // cut = 0.0501 × 14400 / (2 × 0.45 × 60) = 13.4
    expect(r.cut).toBeCloseTo(13.4, 0)
    // Free nitrogen changes nothing.
    expect(economicNRate({ recN: 120, yieldGoal: 60, checkFraction: 0.55, nPerLb: 0.0001, cropPerUnit: 17.97 })!.cut).toBeLessThan(0.1)
  })

  it('uses a setting over the table when one is given', () => {
    expect(checkFractionFor('Canola')).toBe(0.55)
    expect(checkFractionFor('Canola', 0.7)).toBe(0.7)
    expect(checkFractionFor('Alfalfa')).toBeNull()
  })

  it('rates nitrogen loss from texture and water', () => {
    expect(nitrogenLossRisk('loamy sand', true).risk).toBe('high')
    expect(nitrogenLossRisk('sandy loam', false).risk).toBe('moderate')
    expect(nitrogenLossRisk('loam', true).risk).toBe('moderate')
    expect(nitrogenLossRisk('loam', false).risk).toBe('low')
  })
})

describe('tools', () => {
  const weeks = (vals: number[]) => vals.map((v, i) => ({ on: `2026-${String(Math.floor(i / 4) + 1).padStart(2, '0')}-${String((i % 4) * 7 + 1).padStart(2, '0')}`, value: v }))

  it('says where this week sits, and nothing until there is a range', () => {
    expect(buyWindow(weeks([1, 2, 3]))).toBeNull()
    const cheap = buyWindow(weeks([700, 720, 740, 760, 780, 760, 740, 705]))!
    expect(cheap.state).toBe('cheap')
    const dear = buyWindow(weeks([700, 720, 740, 760, 780, 760, 740, 775]))!
    expect(dear.state).toBe('dear')
  })

  it('works out what is left to book', () => {
    const pos = productPositions({
      needs: [{ key: '46-0-0', label: '46-0-0 urea', tonnes: 60 }],
      onHand: [{ product: '46-0-0', tonnes: 5 }],
      booked: [{ product: '46-0-0', tonnes: 40 }],
      invoiced: [],
    })
    expect(pos[0].toBook).toBe(15)
    const text = quoteRequestText('Prairie Creek Farm', 2027, pos)
    expect(text).toContain('46-0-0 urea')
    expect(text).toContain('15.0 t')
  })

  it('finds the custom application and delivery lines on ICI invoices', () => {
    expect(serviceKind('Floating 3rd Party')).toBe('application')
    expect(serviceKind('Delivery - Liquid Fert')).toBe('delivery')
    expect(serviceKind('Deposit-DelaroComplete 113.8L drum')).toBeNull()
    const t = serviceTotals([
      { invoice_date: '2026-05-08', description: 'Floating 3rd Party', quantity: 130, pack_unit: 'Acre', unit_price: 15.5, amount: null },
      { invoice_date: '2026-07-04', description: 'Delivery - Liquid Fert', quantity: 1, pack_unit: 'Each', unit_price: 250, amount: 250 },
    ])
    expect(t[0].application).toBeCloseTo(2015)
    expect(t[0].perAcre).toBeCloseTo(15.5)
    expect(t[0].delivery).toBe(250)
  })

  it('flags credits a recommendation cannot have counted', () => {
    const c = creditCheck({
      manure: { n: 60, p2o5: 126, k2o: 252 },
      manureRecordedAt: '2026-08-31T00:00:00Z',
      assessmentAt: '2026-05-01T00:00:00Z',
      priorCrop: 'Canola',
      priorRecordedAt: null,
      residualN: 40,
      recN: 120,
      recMentionsPrior: true,
    })
    expect(c.manureNewer).toBe(true)
    expect(c.missedN).toBe(60)
    const l = creditCheck({
      manure: { n: 0, p2o5: 0, k2o: 0 },
      manureRecordedAt: null,
      assessmentAt: '2026-05-01T00:00:00Z',
      priorCrop: 'Alfalfa',
      priorRecordedAt: null,
      residualN: null,
      recN: 30,
      recMentionsPrior: false,
    })
    // Never more than the recommendation itself.
    expect(l.missedN).toBe(30)
  })

  it('builds low soils, maintains adequate ones and draws down high ones', () => {
    expect(suggestedRate('high', 40, 30)).toEqual({ rate: 10, rule: 'draw down' })
    expect(suggestedRate('high', 40, 30, { nutrient: 'k' })).toEqual({ rate: 0, rule: 'draw down' })
    expect(suggestedRate('low', 40, 27, { olsenPpm: 7, texture: 'sand' })).toEqual({ rate: 27 + 40, rule: 'build' })
    expect(suggestedRate('ok', 40, 27.4)).toEqual({ rate: 27, rule: 'maintain' })
    expect(suggestedRate('low', 40, 27)).toEqual({ rate: 40, rule: 'build' })
    expect(cropRemoval('Canola', 60, 'bu/ac')!.p2o5).toBeCloseTo(40.2)
    // Alfalfa is recorded in lbs and removal is per ton: this used to come back empty.
    expect(cropRemoval('Alfalfa', 10000, 'lbs')!.k2o).toBeCloseTo(300)
    expect(cropRemoval('Canola', null, 'bu/ac')).toBeNull()
  })

  it('splits nitrogen between seeding and the pivot', () => {
    const p = splitPlan(150, 70, 100)
    expect(p.upfrontLbAc).toBe(105)
    expect(p.inSeasonLbAc).toBe(45)
    expect(p.uanLitresPerAc).toBeCloseTo(45 / (1.28 * 0.28 * 2.20462262), 3)
  })

  it('skips a top-up the tissue test says is not needed', () => {
    expect(tissueGate({ n_pct: 3.4 }, [3, 4.5])).toBe('skip')
    expect(tissueGate({ n_pct: 2.6 }, [3, 4.5])).toBe('apply')
    expect(tissueGate(null, [3, 4.5])).toBe('no test')
  })

  it('prices a zone prescription against a flat top-zone rate', () => {
    const v = vrSaving([
      { acres: 50, rate: 100 },
      { acres: 50, rate: 60 },
    ])!
    expect(v.weighted).toBe(80)
    expect(v.lbSaved).toBe(2000)
    expect(vrSaving([{ acres: 100, rate: 80 }])).toBeNull()
  })

  it('counts over-application only beyond a tolerance', () => {
    const o = overApplied({ n: 100, p2o5: 40 }, { n: 104, p2o5: 50, k2o: 0, s: 0 })
    expect(o.n).toBe(0)
    expect(o.p2o5).toBe(10)
  })

  it('keeps a running phosphate and potash balance', () => {
    const b = nutrientBalance([
      { year: 2025, applied: { p2o5: 40, k2o: 0 }, removed: { p2o5: 54, k2o: 30 } },
      { year: 2024, applied: { p2o5: 70, k2o: 45 }, removed: { p2o5: 30, k2o: 20 } },
    ])
    expect(b.rows[0].year).toBe(2024)
    expect(b.p).toBe(26)
    expect(b.k).toBe(-5)
  })

  it('says whether the fertilizer on a check strip paid', () => {
    const r = stripResult({ field_rate: 120, strip_rate: 80, field_yield: 62, strip_yield: 60 }, 0.9, 17.97)!
    expect(r.cost).toBeCloseTo(36)
    expect(r.value).toBeCloseTo(35.94)
    expect(r.paid! < 0).toBe(true)
  })
})

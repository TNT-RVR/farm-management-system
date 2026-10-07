import { describe, expect, it } from 'vitest'
import {
  analysisOf,
  creditSpreadOver,
  manureAssumptions,
  manureCredit,
  nh4LossShare,
  sourceOf,
  type ManureApplication,
} from './manure-credit'

const spread = (over: Partial<ManureApplication> = {}): ManureApplication => ({
  id: 'a',
  field_id: 'f',
  crop_year: 2026,
  applied_on: '2026-04-01',
  source: 'solid_beef',
  rate_tons_per_acre: 20,
  n_lb_ton: null,
  p2o5_lb_ton: null,
  k2o_lb_ton: null,
  incorporated: true,
  geojson: { type: 'MultiPolygon', coordinates: [] },
  acres: 40,
  notes: null,
  created_at: '2026-04-01',
  ...over,
})

describe('manureCredit', () => {
  // 20 t/ac of 12-9-14 fresh pen manure: 240 lb total N, 24 of it ammonium.
  it("follows Alberta's feedlot method: ammonium less loss, plus a quarter of the organic N", () => {
    // Incorporated, days not recorded → read as two days, 30% of the NH4 lost.
    const c = manureCredit(spread(), 2026)
    expect(c.n).toBeCloseTo(24 * 0.7 + 216 * 0.25, 6) // ≈ 71, the research worked example
    expect(c.p2o5).toBeCloseTo(9 * 20 * 0.5, 6) // 50% of P in year 1, not 70%
    expect(c.k2o).toBeCloseTo(14 * 20 * 0.9, 6)
  })

  it('keeps crediting the organic N in the two years after', () => {
    expect(manureCredit(spread(), 2027).n).toBeCloseTo(216 * 0.12, 6)
    expect(manureCredit(spread(), 2028).n).toBeCloseTo(216 * 0.06, 6)
    expect(manureCredit(spread(), 2027).p2o5).toBeCloseTo(9 * 20 * 0.2, 6)
  })

  it('stops after three years rather than trailing off forever', () => {
    expect(manureCredit(spread(), 2029)).toEqual({ n: 0, p2o5: 0, k2o: 0 })
  })

  it('credits nothing before it was spread', () => {
    expect(manureCredit(spread(), 2025)).toEqual({ n: 0, p2o5: 0, k2o: 0 })
  })

  it('takes ammonia loss from the ammonium only, by days to incorporation', () => {
    const surface = manureCredit(spread({ incorporated: false }), 2026)
    expect(surface.n).toBeCloseTo(24 * 0.34 + 54, 6) // ≈ 62, not half
    expect(surface.p2o5).toBeCloseTo(manureCredit(spread(), 2026).p2o5, 6)
    expect(manureCredit(spread({ incorporated_days: 1 }), 2026).n).toBeCloseTo(24 * 0.75 + 54, 6)
    expect(nh4LossShare({ incorporated: true, incorporated_days: 5 }).loss).toBe(0.45)
  })

  it('does not dock later years for surface application', () => {
    expect(manureCredit(spread({ incorporated: false }), 2027).n).toBeCloseTo(
      manureCredit(spread(), 2027).n,
      6,
    )
  })

  it('reads an unrecorded spread as surface-applied, and says so', () => {
    // Only the ammonium is at stake (about 16 lb here), not half the credit.
    expect(manureCredit(spread({ incorporated: null }), 2026).n).toBeCloseTo(24 * 0.34 + 54, 6)
    expect(manureAssumptions({ incorporated: null })).toHaveLength(2)
    expect(manureAssumptions({ incorporated: false, manure_type: 'fresh_pen' })).toHaveLength(0)
  })

  it('gives compost and bedded manure far less first-year N', () => {
    const fresh = manureCredit(spread(), 2026).n
    const bedded = manureCredit(spread({ manure_type: 'straw_bedded' }), 2026).n
    const compost = manureCredit(spread({ manure_type: 'composted' }), 2026).n
    expect(bedded / 240).toBeGreaterThanOrEqual(0.1)
    expect(bedded / 240).toBeLessThanOrEqual(0.2)
    expect(compost).toBeLessThan(bedded)
    expect(bedded).toBeLessThan(fresh)
  })

  it('uses a lab analysis over the table when there is one', () => {
    const tested = spread({ n_lb_ton: 20 })
    expect(analysisOf(tested).measured).toBe(true)
    expect(manureCredit(tested, 2026).n).toBeCloseTo(40 * 0.7 + 360 * 0.25, 6)
    expect(analysisOf(tested).k2o).toBe(14)
  })

  it('falls back to beef for a source it does not recognise', () => {
    expect(sourceOf('compost').key).toBe('solid_beef')
    expect(manureCredit(spread({ source: 'compost' }), 2026).n).toBeCloseTo(manureCredit(spread(), 2026).n, 6)
  })

  it('returns nothing when no rate was recorded', () => {
    expect(manureCredit(spread({ rate_tons_per_acre: null }), 2026)).toEqual({
      n: 0,
      p2o5: 0,
      k2o: 0,
    })
  })
})

describe('creditSpreadOver', () => {
  const full = 24 * 0.7 + 216 * 0.25

  it('scales a partial spread to the field it sits in', () => {
    // 40 acres covered on a 130 acre field. Reported field-wide, the crop gets
    // roughly a third of the rate — and treating it as a full credit is how a
    // plan ends up short across the other ninety acres.
    const c = creditSpreadOver([spread()], 2026, 130)
    expect(c.n).toBeCloseTo(full * (40 / 130), 6)
  })

  it('does not credit more than the field for an overlapping spread', () => {
    // Two overlapping records that each claim the whole field must not add up
    // to twice the field.
    const c = creditSpreadOver([spread({ acres: 200 })], 2026, 130)
    expect(c.n).toBeCloseTo(full, 6)
  })

  it('adds several spreads on one field', () => {
    const c = creditSpreadOver([spread({ acres: 65 }), spread({ id: 'b', acres: 65 })], 2026, 130)
    expect(c.n).toBeCloseTo(full, 6)
  })

  it('falls back to the full credit when the field acres are unknown', () => {
    expect(creditSpreadOver([spread()], 2026, null).n).toBeCloseTo(full, 6)
  })
})

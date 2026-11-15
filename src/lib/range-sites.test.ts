import { describe, expect, it } from 'vitest'
import { essrTotals, type PastureEssr } from './range-sites'

const row = (over: Partial<PastureEssr>): PastureEssr => ({
  grazing_pasture_id: 'p',
  paddock: 'P',
  ranch_id: 'r',
  soil_acres: 100,
  grazed_acres: 100,
  essr_auds: 600,
  essr_auds_low: 450,
  essr_auds_high: 750,
  pct_rated: 100,
  ...over,
})

const map = (rows: PastureEssr[]) => new Map(rows.map((r, i) => [`p${i}`, { ...r, grazing_pasture_id: `p${i}` }]))

describe('essrTotals', () => {
  it('adds the paddocks and keeps the band with them', () => {
    const t = essrTotals(map([row({}), row({ essr_auds: 400, essr_auds_low: 300, essr_auds_high: 500 })]))!
    expect(t.auds).toBe(1000)
    expect(t.low).toBe(750)
    expect(t.high).toBe(1250)
    expect(t.paddocks).toBe(2)
  })

  it('weights the rated share by acres, not by paddock count', () => {
    // A big fully-rated paddock beside a small half-rated one is not 75%.
    const t = essrTotals(map([
      row({ grazed_acres: 900, pct_rated: 100 }),
      row({ grazed_acres: 100, pct_rated: 50 }),
    ]))!
    expect(t.grazedAcres).toBe(1000)
    expect(t.ratedShare).toBeCloseTo(0.95, 6)
  })

  it('keeps an unrated paddock in the acres and lets it dilute the share', () => {
    // The case that matters: some ground rated, some not. The unrated acres
    // must not vanish, or the share would read 100% on a half-known ranch.
    const t = essrTotals(map([
      row({ grazed_acres: 300, pct_rated: 100 }),
      row({ grazed_acres: 100, pct_rated: 0, essr_auds: null, essr_auds_low: null, essr_auds_high: null }),
    ]))!
    expect(t.grazedAcres).toBe(400)
    expect(t.ratedShare).toBeCloseTo(0.75, 6)
    expect(t.auds).toBe(600)
  })

  it('is null when there is nothing to report, so a screen can leave the line out', () => {
    expect(essrTotals(null)).toBeNull()
    expect(essrTotals(undefined)).toBeNull()
    expect(essrTotals(new Map())).toBeNull()
    // Nothing rated anywhere means there is no sustainable figure to show, so
    // the line is left out rather than drawn as a zero.
    expect(essrTotals(map([row({ essr_auds: null, essr_auds_low: null, essr_auds_high: null })]))).toBeNull()
  })

  it('survives a paddock whose band is missing but whose middle is not', () => {
    const t = essrTotals(map([row({ essr_auds_low: null, essr_auds_high: null })]))!
    expect(t.auds).toBe(600)
    expect(t.low).toBe(0)
    expect(t.high).toBe(0)
  })
})

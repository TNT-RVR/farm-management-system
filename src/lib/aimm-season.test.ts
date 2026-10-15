import { describe, expect, it } from 'vitest'
import { binsToWedges, calibrationFactor, gdd5, seasonOutlook, wedgeBalance, WEDGES } from './aimm-season'

describe('calibrationFactor', () => {
  it('stays put with nothing to learn from', () => {
    expect(calibrationFactor([], 1)).toEqual({ factor: 1, basisMm: 0 })
  })
  it('raises water use when the soil was drier than the model said', () => {
    // Model had 120 mm, soil had 100 after 200 mm of modelled use: use was 10% low.
    const r = calibrationFactor([{ predicted: 120, measured: 100, etSincePrev: 200 }])
    expect(r.factor).toBeCloseTo(1.1, 2)
  })
  it('shrinks toward 1 on little evidence and is capped', () => {
    expect(calibrationFactor([{ predicted: 120, measured: 100, etSincePrev: 50 }]).factor).toBeLessThan(1.15)
    expect(calibrationFactor([{ predicted: 300, measured: 0, etSincePrev: 400 }]).factor).toBe(1.3)
  })
})

describe('wedges', () => {
  it('averages 1-degree bins into 36 wedges', () => {
    const bins = new Array(360).fill(0).map((_, i) => (i < 10 ? 10 : 0))
    const w = binsToWedges(bins)
    expect(w).toHaveLength(WEDGES)
    expect(w[0]).toBe(10)
    expect(w[1]).toBe(0)
  })
  it('keeps a dry wedge dry when the pass stopped short', () => {
    const fc = new Array(WEDGES).fill(150)
    const irr = new Array(WEDGES).fill(0).map((_, i) => (i < 18 ? 20 : 0))
    const out = wedgeBalance([{ date: '2026-07-01', etcTable: 6, etcFloor: 0.5, rain: 0, irrWedges: irr, irrField: 10 }], fc, 0.6)
    expect(out[0].avail[0]).toBeGreaterThan(out[0].avail[30])
    expect(out[0].irr[0]).toBe(20)
  })
})

describe('season outlook', () => {
  const day = (i: number, et = 4) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, gdd: 12, etcTable: et, etcFloor: 0.4, rain: 0 })
  it('needs nothing once the crop is mature', () => {
    const r = seasonOutlook({ today: '2026-08-01', gddToDate: 1500, maturityGdd: 1465, harvestDate: null, avail: 80, fc: 180, ahead: [], netPerPassMm: 16 })
    expect(r.needMoreMm).toBe(0)
  })
  it('counts the water short of the late-season floor before maturity', () => {
    const ahead = Array.from({ length: 25 }, (_, i) => day(i, 5))
    const r = seasonOutlook({ today: '2026-08-01', gddToDate: 1200, maturityGdd: 1465, harvestDate: null, avail: 100, fc: 180, ahead, netPerPassMm: 16 })
    expect(r.maturityOn).toBe('2026-08-23')
    expect(r.needMoreMm).toBeGreaterThan(0)
    expect(r.lastIrrigationBy).not.toBeNull()
  })
  it('GDD5 is zero below freezing', () => {
    expect(gdd5(20, -1)).toBe(0)
    expect(gdd5(25, 11)).toBe(13)
  })
})

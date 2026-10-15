import { describe, expect, it } from 'vitest'
import {
  arcFraction,
  assessPivot,
  clampCorrection,
  flowDepthMm,
  impliedCorrection,
  irrigatedArea,
  meterToDepth,
  panelMmAtSpeed,
  panelOffline,
  readPanel,
  seasonEffectMm,
  verdictFor,
} from './pivot-depth'

describe('flowDepthMm', () => {
  it('is flow × revolution time ÷ area, one litre per m² = one mm', () => {
    // 750 US gpm for 20 h over 130 ac
    const expected = (750 * 3.78541 * 1200) / (130 * 4046.86)
    expect(flowDepthMm(750, 72000, 130)).toBeCloseTo(expected, 9)
    expect(flowDepthMm(750, 72000, 130)).toBeCloseTo(6.4758, 3)
  })

  it('gives the same depth for a part circle with the same flow per metre', () => {
    const full = flowDepthMm(750, 72000, 130)!
    const half = flowDepthMm(750, 72000, 65, 0.5)!
    expect(half).toBeCloseTo(full, 9)
  })

  it('needs flow, time and area', () => {
    expect(flowDepthMm(null, 72000, 130)).toBeNull()
    expect(flowDepthMm(750, 0, 130)).toBeNull()
    expect(flowDepthMm(750, 72000, null)).toBeNull()
  })
})

describe('irrigatedArea', () => {
  it('prefers the farm record, then FieldNET, then π r² scaled by arc', () => {
    expect(irrigatedArea({ recordAcres: 128, fieldnetAcres: 130, wetM: 400 })).toEqual({ acres: 128, source: 'record' })
    expect(irrigatedArea({ recordAcres: null, fieldnetAcres: 130, wetM: 400 })).toEqual({ acres: 130, source: 'fieldnet' })
    const r = irrigatedArea({ wetM: 400, arcFrac: 0.5 })!
    expect(r.source).toBe('radius')
    expect(r.acres).toBeCloseTo((Math.PI * 400 * 400 * 0.5) / 4046.86, 6)
    expect(irrigatedArea({})).toBeNull()
  })
})

describe('arcFraction', () => {
  it('treats 0/0 as a full circle and sweeps clockwise otherwise', () => {
    expect(arcFraction(0, 0)).toBe(1)
    expect(arcFraction(null, null)).toBe(1)
    expect(arcFraction(86, 255)).toBeCloseTo(169 / 360, 9)
    expect(arcFraction(300, 60)).toBeCloseTo(120 / 360, 9)
  })
})

describe('verdictFor', () => {
  it('bands at 5% and 15%', () => {
    expect(verdictFor(1)).toBe('consistent')
    expect(verdictFor(1.05)).toBe('consistent')
    expect(verdictFor(0.95)).toBe('consistent')
    expect(verdictFor(1.06)).toBe('check')
    expect(verdictFor(0.85)).toBe('check')
    expect(verdictFor(0.84)).toBe('likely_wrong')
    expect(verdictFor(1.2)).toBe('likely_wrong')
    expect(verdictFor(null)).toBeNull()
  })
})

describe('checks and corrections', () => {
  it('scales the panel depth by 1/speed', () => {
    expect(panelMmAtSpeed(10, 50)).toBeCloseTo(20, 9)
    expect(panelMmAtSpeed(10, 100)).toBeCloseTo(10, 9)
    expect(panelMmAtSpeed(10, 0)).toBeNull()
  })

  it('implies measured ÷ panel', () => {
    expect(impliedCorrection(17, 20)).toBeCloseTo(0.85, 9)
    expect(impliedCorrection(17, null)).toBeNull()
  })

  it('rounds to 0.01 and clamps to 0.5–1.5', () => {
    expect(clampCorrection(0.8533)).toBe(0.85)
    expect(clampCorrection(0.2)).toBe(0.5)
    expect(clampCorrection(2)).toBe(1.5)
  })

  it('signs the season effect', () => {
    expect(seasonEffectMm(200, 0.85)).toBeCloseTo(200 - 200 / 0.85, 9)
    expect(seasonEffectMm(220, 1.1)).toBeCloseTo(20, 9)
    expect(seasonEffectMm(200, 1)).toBe(0)
  })
})

describe('meterToDepth', () => {
  it('turns gallons over hours into flow and depth', () => {
    // 640 gpm for 10 h
    const r = meterToDepth({ volume: 640 * 600, unit: 'usgal', hours: 10, acres: 130, runTime100S: 72000, speedPct: 50 })!
    expect(r.gpm).toBeCloseTo(640, 6)
    expect(r.onFieldMm).toBeCloseTo((640 * 600 * 3.78541) / (130 * 4046.86), 9)
    // per pass at 50% = 2 × the 100% depth at that real flow
    expect(r.perPassMm).toBeCloseTo(2 * flowDepthMm(640, 72000, 130)!, 9)
  })

  it('reads cubic metres', () => {
    const r = meterToDepth({ volume: 100, unit: 'm3', hours: 1, acres: null })!
    expect(r.litresPerS).toBeCloseTo(100000 / 3600, 9)
    expect(r.onFieldMm).toBeNull()
    expect(r.perPassMm).toBeNull()
  })

  it('rejects empty input', () => {
    expect(meterToDepth({ volume: 0, unit: 'm3', hours: 1, acres: 100 })).toBeNull()
  })
})

describe('panelOffline', () => {
  const now = Date.parse('2026-10-01T12:00:00Z')
  it('flags offline panels silent more than two days', () => {
    expect(panelOffline('offline', '2026-09-28T12:00:00Z', now)).toBe(true)
    expect(panelOffline('offline', '2026-09-30T12:00:00Z', now)).toBe(false)
    expect(panelOffline('online', '2026-09-01T12:00:00Z', now)).toBe(false)
    expect(panelOffline('offline', null, now)).toBe(false)
  })
})

describe('assessPivot', () => {
  // A panel whose depth chart is exactly 750 gpm × 20 h over 130 ac.
  const depthIn = (750 * 3.78541 * 1200) / (130 * 4046.86) / 25.4
  const raw = {
    application_depth_at_full_speed: depthIn,
    run_time_100_percent: 72000,
    reporting_flow: 750,
    system_length_wet: 410,
    irrigated_area: 130,
    partial_start_angle: 0,
    partial_end_angle: 0,
    communication_status: 'online',
    last_updated: '2026-09-30T00:00:00Z',
  }

  it('reads the panel setup from raw', () => {
    const p = readPanel(raw)
    expect(p.flowGpm).toBe(750)
    expect(p.wetM).toBe(410)
    expect(p.commStatus).toBe('online')
    expect(readPanel(null).depth100In).toBeNull()
  })

  it('finds the panel consistent with its own flow, and the 640 gpm record 15% low', () => {
    const a = assessPivot(readPanel(raw), { gpm: 640, acres: null })
    expect(a.area?.source).toBe('fieldnet')
    expect(a.flows).toHaveLength(2)
    const [fn, rec] = a.flows
    expect(fn.label).toBe('fieldnet')
    expect(fn.ratio).toBeCloseTo(1, 9)
    expect(fn.verdict).toBe('consistent')
    expect(rec.label).toBe('record')
    expect(rec.ratio).toBeCloseTo(640 / 750, 9)
    expect(rec.verdict).toBe('check')
    expect(a.flowGap).toBeCloseTo(640 / 750 - 1, 9)
  })

  it('skips the record flow when it matches FieldNET', () => {
    const a = assessPivot(readPanel(raw), { gpm: 751, acres: null })
    expect(a.flows).toHaveLength(1)
  })

  it('uses the record acres over FieldNET when present', () => {
    const a = assessPivot(readPanel(raw), { gpm: null, acres: 160 })
    expect(a.area).toEqual({ acres: 160, source: 'record' })
    expect(a.flows[0].ratio).toBeCloseTo(130 / 160, 9)
    expect(a.flows[0].verdict).toBe('likely_wrong')
  })
})

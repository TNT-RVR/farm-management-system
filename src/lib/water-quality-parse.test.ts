import { describe, expect, it } from 'vitest'
import { ecToMicro, idwqTime, parseReading, sarFrom } from './water-quality-parse'
import { soToLbSPerInch } from './water-quality'

describe('water-quality parsing', () => {
  it('reads below-detection values as the limit, flagged', () => {
    expect(parseReading('<0.01')).toEqual({ value: 0.01, below: true })
    expect(parseReading('26.0')).toEqual({ value: 26, below: false })
    expect(parseReading('ND')).toEqual({ value: 0, below: true })
    expect(parseReading('')).toBeNull()
    expect(parseReading('n/a')).toBeNull()
  })
  it('puts the mislabelled IDWQ EC column into µS/cm', () => {
    expect(ecToMicro(272)).toBe(272)
    expect(ecToMicro(0.31)).toBeCloseTo(310)
  })
  it('reads the IDWQ local timestamp as Alberta summer time', () => {
    expect(idwqTime('2024-09-04 10:35')).toBe('2024-09-04T10:35:00-06:00')
    expect(idwqTime('2024-01-15')).toBe('2024-01-15T12:00:00-07:00')
  })
  it('works SAR from the cations', () => {
    // Na 20, Ca 45, Mg 15 mg/L → about 0.7
    expect(sarFrom(20, 45, 15)).toBeCloseTo(0.7, 1)
  })
  it('turns sulphate into pounds of sulphur an acre-inch', () => {
    // 27.5 mg/L at the Home Ranch outlet ≈ 2.1 lb S per inch.
    expect(soToLbSPerInch(27.5)).toBeCloseTo(2.08, 2)
  })
})

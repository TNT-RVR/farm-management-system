import { describe, expect, it } from 'vitest'
import { blendAnalysis, fertInfo, fertKind } from './fertilizer-info'

describe('fertKind', () => {
  it('knows the same product under its ICI, Deere and spoken names', () => {
    expect(fertKind('Tonne 46-0-0')).toBe('urea')
    expect(fertKind('46-0-0')).toBe('urea')
    expect(fertKind('Tonne 46.0-0.0-0.0-0.0 Blend')).toBe('blend')
    expect(fertKind('Filtered 28-0-0 UAN')).toBe('uan')
    expect(fertKind('28-0-0-UAN')).toBe('uan')
    expect(fertKind('Tonne 11-52-0')).toBe('map')
    expect(fertKind('Tonne 40 Rock M.A.P')).toBe('map')
    expect(fertKind('0-0-60 KCL')).toBe('potash')
    expect(fertKind('ESN 44-0-0')).toBe('esn')
    expect(fertKind('SULF4R 0-0-0-17-21')).toBe('sulf4r')
    expect(fertKind('Tonne 21-0-0-10S Blend')).toBe('blend')
  })
})

describe('blendAnalysis', () => {
  it('reads N-P-K-S and the micros off an ICI blend name', () => {
    expect(blendAnalysis('Tonne 28.2-10.8-4.3-4.3-0.4B-0.1Zn Blend')).toEqual({
      n: 28.2,
      p: 10.8,
      k: 4.3,
      s: 4.3,
      extras: ['0.4% B', '0.1% Zn'],
    })
    expect(blendAnalysis('Tonne 21-0-0-10S Blend')).toEqual({ n: 21, p: 0, k: 0, s: 10, extras: [] })
  })
})

describe('fertInfo', () => {
  it('writes a blend up from its analysis', () => {
    const i = fertInfo('Tonne 21-0-0-10S Blend')
    expect(i.kind).toBe('blend')
    expect(i.title).toBe('21-0-0-10S Blend')
    expect(i.what).toContain('21% nitrogen')
    expect(i.what).toContain('10% sulphur')
  })

  it('has a paragraph for every straight', () => {
    for (const n of ['Tonne 46-0-0', 'Filtered 28-0-0 UAN', 'Tonne 11-52-0', '0-0-60 KCL', 'ESN 44-0-0', 'SULF4R 0-0-0-17-21']) {
      const i = fertInfo(n)
      expect(i.what.length).toBeGreaterThan(80)
      expect(i.usedFor.length).toBeGreaterThan(40)
    }
  })
})

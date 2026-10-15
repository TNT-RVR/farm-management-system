import { describe, expect, it } from 'vitest'
import { hasMarker, stripMarker } from '../../netlify/shared/anydo-marker'

describe('Any.do marker', () => {
  it('is found in any case', () => {
    expect(hasMarker('Fix the gate #rvr', '#RVR')).toBe(true)
    expect(hasMarker('Fix the gate', '#RVR')).toBe(false)
  })
  it('comes off the title wherever it sits', () => {
    expect(stripMarker('Fix the gate #RVR', '#RVR')).toBe('Fix the gate')
    expect(stripMarker('#rvr Fix the gate', '#RVR')).toBe('Fix the gate')
    expect(stripMarker('Fix #RVR the gate', '#RVR')).toBe('Fix the gate')
  })
})

describe('a dedicated list (no marker)', () => {
  it('takes every task and leaves titles alone', () => {
    expect(hasMarker('Fix the gate', '')).toBe(true)
    expect(stripMarker('  Fix the gate ', '')).toBe('Fix the gate')
  })
})

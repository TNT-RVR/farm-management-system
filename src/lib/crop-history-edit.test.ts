import { describe, expect, it } from 'vitest'
import { deleteNeedsPlanRestore, fillYieldPair, isCropYearLocked } from './crop-history-edit'

describe('fillYieldPair', () => {
  it('fills the total from per-acre and acres', () => {
    expect(fillYieldPair(150, 52.3, null)).toEqual({ perAcre: 52.3, total: 7845 })
  })
  it('fills per-acre from the total, to one decimal', () => {
    expect(fillYieldPair(148.5, null, 7000)).toEqual({ perAcre: 47.1, total: 7000 })
  })
  it('leaves both alone when both are typed or acres are missing', () => {
    expect(fillYieldPair(100, 50, 4800)).toEqual({ perAcre: 50, total: 4800 })
    expect(fillYieldPair(null, 50, null)).toEqual({ perAcre: 50, total: null })
    expect(fillYieldPair(0, null, 900)).toEqual({ perAcre: null, total: 900 })
  })
})

describe('isCropYearLocked', () => {
  it('locks past years unless unlocked', () => {
    expect(isCropYearLocked(2024, [], 2026)).toBe(true)
    expect(isCropYearLocked(2024, [2024], 2026)).toBe(false)
    expect(isCropYearLocked(2026, [], 2026)).toBe(false)
  })
})

describe('deleteNeedsPlanRestore', () => {
  it('only for scale or typed yields the plan took', () => {
    expect(deleteNeedsPlanRestore({ plan_yield_saved: true, source: 'scale' })).toBe(true)
    expect(deleteNeedsPlanRestore({ plan_yield_saved: true, source: 'manual' })).toBe(true)
    expect(deleteNeedsPlanRestore({ plan_yield_saved: true, source: 'fah_import' })).toBe(false)
    expect(deleteNeedsPlanRestore({ plan_yield_saved: false, source: 'manual' })).toBe(false)
  })
})

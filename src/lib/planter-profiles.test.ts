import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { populationOffTarget } from './planter-profiles'
import { isBookkeepingCrop } from './crop-label'

describe('populationOffTarget', () => {
  const canola = { seeds_per_acre_min: 400_000, seeds_per_acre_max: 450_000 }

  it('says so when a sheet works out far under the crop’s own target', () => {
    expect(populationOffTarget(83_635, canola)).toBe(
      '83,635 seeds/ac is under this crop’s 400,000–450,000 target — check the seed and row spacing.',
    )
    expect(populationOffTarget(500_000, canola)).toMatch(/is over this crop/)
  })

  it('is quiet inside the target, or with no target to judge against', () => {
    expect(populationOffTarget(425_000, canola)).toBeNull()
    expect(populationOffTarget(83_635, { seeds_per_acre_min: null, seeds_per_acre_max: null })).toBeNull()
    expect(populationOffTarget(null, canola)).toBeNull()
    expect(populationOffTarget(83_635, null)).toBeNull()
  })

  it('reads a single figure as ±10%', () => {
    const corn = { seeds_per_acre_min: 34_000, seeds_per_acre_max: null }
    expect(populationOffTarget(33_000, corn)).toBeNull()
    expect(populationOffTarget(28_000, corn)).toMatch(/under this crop’s 34,000 target/)
  })
})

describe('isBookkeepingCrop', () => {
  it('names the entries nobody sows', () => {
    for (const name of ['Summer Fallow', 'Not farmed by us', 'Custom Crop bu/ac', 'Potato (kind not chosen)']) {
      expect(isBookkeepingCrop(name)).toBe(true)
    }
    for (const name of ['Canola', 'Barley', 'Alfalfa', 'Green Feed']) expect(isBookkeepingCrop(name)).toBe(false)
  })
})

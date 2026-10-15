import { describe, expect, it } from 'vitest'
import { lastSeedCanola, seedCanolaYear } from './seed-canola-year'

const crops = [
  { id: 'c', name: 'Canola', herbicide_trait: null, category: 'seed' },
  { id: 'b', name: 'BASF Canola', herbicide_trait: 'liberty', category: 'seed' },
  { id: 'v', name: 'Corteva Canola', herbicide_trait: 'both', category: 'seed' },
  { id: 'w', name: 'Wheat', herbicide_trait: null, category: 'cereal' },
]
const companyOf = (id: string, variety: string | null) => (id === 'c' && variety === 'Specialty - Corteva' ? 'Corteva' : null)
const year = (cropId: string, variety: string | null, yearTrait: string | null = null) => seedCanolaYear({ crop: crops.find((c) => c.id === cropId), variety, yearTrait, crops, companyOf })

describe('seedCanolaYear', () => {
  it('names the company and the system', () => {
    expect(year('b', 'Specialty - BASF')).toEqual({ company: 'BASF', trait: 'liberty', label: 'BASF LibertyLink' })
    expect(year('v', null, 'roundup')?.label).toBe('Corteva Roundup Ready')
  })
  it('reads the company off the variety, and a BASF year takes BASF’s trait', () => {
    expect(year('c', 'Specialty - Corteva')?.label).toBe('Corteva (trait not recorded)')
    expect(year('c', 'Specialty - BASF')?.label).toBe('BASF LibertyLink')
  })
  it('says what is not recorded, and is nothing for a crop that is not canola', () => {
    expect(year('c', null)?.label).toBe('Seed canola (company and trait not recorded)')
    expect(year('w', null)).toBeNull()
  })
  it('finds the newest canola year', () => {
    const ys = [{ year: 2024, canola: year('b', null) }, { year: 2025, canola: null }, { year: 2021, canola: year('c', null) }]
    expect(lastSeedCanola(ys)?.year).toBe(2024)
  })
})

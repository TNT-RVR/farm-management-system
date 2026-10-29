import { describe, expect, it } from 'vitest'
import { NEW_SOURCE_KEY, waterSourceLabel, waterSourceOptions, withNewSource } from './water-source-names'

describe('water source names', () => {
  it('reads a built-in by its name, and a named source as itself', () => {
    expect(waterSourceLabel('oldman_river', 'SMRID')).toBe('Oldman River')
    expect(waterSourceLabel('smrid', 'SMRID')).toBe('SMRID canal')
    expect(waterSourceLabel('Bow River', 'SMRID')).toBe('Bow River')
    expect(waterSourceLabel(null, 'SMRID')).toBeNull()
  })

  it('offers the built-ins and every source already named on the farm, once', () => {
    const o = waterSourceOptions(['oldman_river', 'Bow River', ' Bow River ', 'Well 2', null], 'LNID', { withDistrict: true })
    expect(o.map((x) => x.label)).toEqual(['— not set —', 'Oldman River', 'South Saskatchewan River', 'LNID canal', 'Other', 'Bow River', 'Well 2'])
    // A licence draws from a river, not the district's canal.
    expect(waterSourceOptions([], 'LNID', { withDistrict: false }).map((x) => x.value)).not.toContain('smrid')
  })

  it('saves a newly named source in place of the choice', () => {
    expect(withNewSource({ water_source: 'other', [NEW_SOURCE_KEY]: ' North Canal ', acres: 120 }, 'water_source')).toEqual({ water_source: 'North Canal', acres: 120 })
    expect(withNewSource({ water_source: 'oldman_river', [NEW_SOURCE_KEY]: null }, 'water_source')).toEqual({ water_source: 'oldman_river' })
  })
})

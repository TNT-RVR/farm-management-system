import { describe, expect, it } from 'vitest'
import { waterBudget } from './rotation-water'

const pivots = [
  { field_id: 'a', acres_irrigated: 100, alloted_inches: null, smrid_area: 24, water_licence_id: null },
  { field_id: 'b', acres_irrigated: null, alloted_inches: null, smrid_area: 21, water_licence_id: null },
  { field_id: 'c', acres_irrigated: 150, alloted_inches: null, smrid_area: null, water_licence_id: 'L1' },
  { field_id: 'd', acres_irrigated: 50, alloted_inches: null, smrid_area: null, water_licence_id: 'L1' },
  { field_id: 'e', acres_irrigated: 80, alloted_inches: null, smrid_area: null, water_licence_id: null },
]
const licences = [{ id: 'L1', licence_number: '1990-01-01-002', volume: 200 }]
const allotments = [{ year: 2026, inches: 14, contract_inches: 18 }]

describe('water budget', () => {
  it('pools SMRID parcels, licences and own allotments', () => {
    const w = waterBudget(pivots, licences, allotments, 2027, new Map([['b', 60]]))
    const smrid = w.sources.find((s) => s.key === 'smrid')!
    expect(smrid.acres).toBe(160) // b has no irrigated acres on file, so its field acres
    expect(smrid.acreInches).toBe(160 * 14)
    expect(smrid.basis).toMatch(/2026's, until 2027's is set/)
    expect(w.sources.find((s) => s.key === 'licence:L1')!.acreInches).toBe(2400)
    expect(w.sources.find((s) => s.key === 'field:e')).toBeUndefined()
    expect(w.noRight).toEqual(['e'])
    expect(w.byField.get('d')!.source).toBe('licence:L1')
  })

  it('takes a dry-year what-if for SMRID', () => {
    const w = waterBudget(pivots, licences, allotments, 2027, new Map(), 10)
    expect(w.sources.find((s) => s.key === 'smrid')!.acreInches).toBe(1000)
  })

  it('lets a pivot’s own override beat the website figure', () => {
    const own = pivots.map((p) => (p.field_id === 'a' ? { ...p, alloted_inches: 12 } : p))
    const w = waterBudget(own, licences, allotments, 2026, new Map([['b', 60]]))
    expect(w.sources.find((s) => s.key === 'smrid')!.acreInches).toBe(100 * 12 + 60 * 14)
  })
})

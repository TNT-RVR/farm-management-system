import { describe, expect, it } from 'vitest'
import { allocationRow, allottedInchesFor } from './water-allocation'

const pivot = { fieldId: 'f', name: 'P', acres: 120, allottedInches: 16, allottedFrom: 'smrid' as const, licenceAcreFeet: 150, source: 'SMRID' }
const ev = (date: string, mm: number) => ({ date, gross_mm: mm, net_mm: null })

describe('water allocation', () => {
  it('adds up the season and projects the last fortnight forward', () => {
    // 254 mm = 10 in so far; 50.8 mm (2 in) in the last 14 days → 1/7 in a day.
    const r = allocationRow(pivot, [ev('2026-06-01', 203.2), ev('2026-09-20', 50.8)], '2026-09-28', '2026-10-15')
    expect(r.usedInches).toBeCloseTo(10, 6)
    expect(r.recentRate).toBeCloseTo(2 / 14, 6)
    expect(r.projectedInches).toBeCloseTo(10 + (2 / 14) * 17, 6)
    expect(r.usedAcreFeet).toBeCloseTo(100, 6)
    expect(r.inchesPct).toBeCloseTo(62.5, 6)
    expect(r.verdict).toBe('ok')
  })
  it('warns when the pace runs past the allotment before the season ends', () => {
    const r = allocationRow({ ...pivot, licenceAcreFeet: null }, [ev('2026-07-01', 330), ev('2026-09-25', 60)], '2026-09-28', '2026-10-15')
    expect(r.verdict).toBe('will_run_out')
  })
  it('says unknown when nothing is allotted on file', () => {
    expect(allocationRow({ ...pivot, allottedInches: null, licenceAcreFeet: null }, [], '2026-09-28', '2026-10-15').verdict).toBe('unknown')
  })
  it('takes the licence share as acre-feet, and judges the licence over the inches', () => {
    // A 87.5 ac-ft share on a 70 ac pivot is 15 in.
    const r = allocationRow({ ...pivot, acres: 70, allottedInches: 8, licenceAcreFeet: 87.5 }, [ev('2026-07-01', 254)], '2026-09-28', '2026-10-15')
    expect(r.licenceInches).toBeNull()
    expect(r.licenceAcreFeet).toBeCloseTo(87.5, 6)
    expect(r.licencePct).toBeCloseTo((10 / 15) * 100, 6)
    expect(r.verdict).toBe('ok')
  })
  it('gives a canal pivot SMRID’s figure unless it carries its own override', () => {
    expect(allottedInchesFor({ alloted_inches: null, smrid_area: 24, water_source: 'smrid' }, 17)).toEqual({ inches: 17, from: 'smrid' })
    expect(allottedInchesFor({ alloted_inches: '14', smrid_area: 24, water_source: 'smrid' }, 17)).toEqual({ inches: 14, from: 'override' })
    expect(allottedInchesFor({ alloted_inches: null, smrid_area: null, water_source: 'oldman_river' }, 17)).toEqual({ inches: null, from: null })
  })
})

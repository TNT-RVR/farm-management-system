import { describe, expect, it } from 'vitest'
import { grownTrait, VOLUNTEER_WINDOW_YEARS, volunteerConflicts, type CanolaYear } from './canola-trait'

const crops = [
  { id: 'old', name: 'Canola', herbicide_trait: null },
  { id: 'basf', name: 'BASF Canola', herbicide_trait: 'liberty' },
  { id: 'ctv', name: 'Corteva Canola', herbicide_trait: 'roundup' },
  { id: 'nut', name: 'Nutrien Canola', herbicide_trait: null },
  { id: 'unk', name: 'Unknown Canola', herbicide_trait: null },
  { id: 'wht', name: 'Wheat', herbicide_trait: null },
]
const byId = (id: string) => crops.find((c) => c.id === id)

describe('grownTrait', () => {
  it("takes the crop's own trait", () => {
    expect(grownTrait(byId('basf'), null, crops)).toEqual({ trait: 'liberty', from: 'BASF Canola' })
  })
  it("reads plain Canola's company from its variety", () => {
    expect(grownTrait(byId('old'), 'Corteva', crops)).toEqual({ trait: 'roundup', from: 'Corteva Canola' })
  })
  it('says nothing it does not know', () => {
    expect(grownTrait(byId('old'), null, crops)).toBeNull()
    expect(grownTrait(byId('old'), 'Nutrien', crops)).toBeNull()
    expect(grownTrait(byId('unk'), null, crops)).toBeNull()
    expect(grownTrait(byId('wht'), 'BASF', crops)).toBeNull()
  })
})

describe('volunteerConflicts', () => {
  const past: CanolaYear[] = [
    { year: 2022, crop: 'BASF Canola', trait: 'liberty' },
    { year: 2024, crop: 'Corteva Canola', trait: 'roundup' },
  ]
  it('warns when a canola of the same trait grew inside the window', () => {
    const w = volunteerConflicts({ name: 'BASF Canola', trait: 'liberty' }, 2028, past)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/BASF Canola \(Liberty\) was here in 2022/)
  })
  it('does not warn for the other trait — the spray clears those volunteers', () => {
    expect(volunteerConflicts({ name: 'Nutrien Canola', trait: 'liberty' }, 2029, [past[1]])).toEqual([])
  })
  it('stops counting past the window', () => {
    expect(volunteerConflicts({ name: 'X', trait: 'liberty' }, 2022 + VOLUNTEER_WINDOW_YEARS, past)).toHaveLength(1)
    expect(volunteerConflicts({ name: 'X', trait: 'liberty' }, 2022 + VOLUNTEER_WINDOW_YEARS + 1, past)).toEqual([])
  })
  it('ignores the planned year itself and later years', () => {
    expect(volunteerConflicts({ name: 'X', trait: 'roundup' }, 2024, past)).toEqual([])
  })
  it('raises nothing for a canola with no trait set', () => {
    expect(volunteerConflicts({ name: 'Unknown Canola', trait: null }, 2028, past)).toEqual([])
  })
  it('reports a year once, newest first', () => {
    const twice: CanolaYear[] = [
      { year: 2023, crop: 'BASF Canola', trait: 'liberty' },
      { year: 2023, crop: 'Canola', trait: 'liberty' },
      { year: 2025, crop: 'BASF Canola', trait: 'liberty' },
    ]
    const w = volunteerConflicts({ name: 'BASF Canola', trait: 'liberty' }, 2029, twice)
    expect(w).toHaveLength(2)
    expect(w[0]).toMatch(/2025/)
  })
})

import { describe, expect, it } from 'vitest'
import { MINERAL_KINDS, daysOut } from './cattle-mineral'

describe('daysOut', () => {
  const today = new Date('2026-11-12T18:00:00Z')

  it('counts the days since the tub went out', () => {
    expect(daysOut({ placed_on: '2026-11-12' }, today)).toBe(0)
    expect(daysOut({ placed_on: '2026-11-05' }, today)).toBe(7)
    expect(daysOut({ placed_on: '2026-09-13' }, today)).toBe(60)
  })

  it('says nothing when nobody said when it went out', () => {
    expect(daysOut({ placed_on: null }, today)).toBeNull()
    expect(daysOut({ placed_on: 'not a date' }, today)).toBeNull()
  })

  it('never counts backwards from a date typed in the future', () => {
    expect(daysOut({ placed_on: '2026-12-01' }, today)).toBe(0)
  })
})

describe('MINERAL_KINDS', () => {
  it('matches the kinds the table will accept', () => {
    expect(MINERAL_KINDS.map((k) => k.value)).toEqual(['mineral', 'salt', 'protein', 'other'])
  })
})

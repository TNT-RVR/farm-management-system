import { describe, expect, it } from 'vitest'
import { firstHardFreeze, freezeNeedsAlert, freezeRuleFrom } from './freeze-watch'

const day = (date: string, tmin: number | null, tmax: number | null) => ({ date, tmin, tmax })

describe('firstHardFreeze', () => {
  it('ignores an ordinary frost', () => {
    expect(firstHardFreeze([day('2026-10-10', -3, 8), day('2026-10-11', -5, 6)])).toBeNull()
  })
  it('finds the first cold night', () => {
    expect(firstHardFreeze([day('2026-10-10', -3, 8), day('2026-10-12', -9, 2)])).toMatchObject({ date: '2026-10-12', why: 'night' })
  })
  it('counts a day that never thaws', () => {
    expect(firstHardFreeze([day('2026-10-14', -6, -1)])).toMatchObject({ date: '2026-10-14', why: 'day' })
  })
  it('uses the farm setting', () => {
    expect(firstHardFreeze([day('2026-10-10', -6, 4)], { lowC: -5, highC: 0 })).toMatchObject({ date: '2026-10-10' })
  })
  it('skips missing values', () => {
    expect(firstHardFreeze([day('2026-10-10', null, null)])).toBeNull()
  })
})

describe('freezeNeedsAlert', () => {
  const today = '2026-10-10'
  it('announces the first time', () => expect(freezeNeedsAlert(null, '2026-10-14', today)).toBe(true))
  it('stays quiet about the same freeze', () => expect(freezeNeedsAlert('2026-10-14', '2026-10-14', today)).toBe(false))
  it('stays quiet when it moves later', () => expect(freezeNeedsAlert('2026-10-14', '2026-10-16', today)).toBe(false))
  it('speaks up when it moves earlier', () => expect(freezeNeedsAlert('2026-10-14', '2026-10-12', today)).toBe(true))
  it('speaks up for a new freeze after the old one passed', () => expect(freezeNeedsAlert('2026-10-05', '2026-10-20', today)).toBe(true))
})

describe('freezeRuleFrom', () => {
  it('defaults', () => expect(freezeRuleFrom(null)).toEqual({ lowC: -8, highC: 0 }))
  it('reads numbers only', () => expect(freezeRuleFrom({ low_c: -10, high_c: 'x' })).toEqual({ lowC: -10, highC: 0 }))
})

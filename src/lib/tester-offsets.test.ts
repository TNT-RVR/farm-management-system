import { describe, expect, it } from 'vitest'
import { offsetsFrom, toBench } from './tester-offsets'

const r = (field: string, at: string, pct: number, tester: 'bench' | 'handheld' | 'bean_plant' | null) => ({ field_id: field, tested_at: at, moisture_pct: pct, tester })

describe('tester offsets', () => {
  it('learns how far the hand held reads from the bench on the same sample', () => {
    const o = offsetsFrom([
      r('a', '2026-10-05T19:00:00Z', 12, 'bench'),
      r('a', '2026-10-05T19:20:00Z', 13, 'handheld'),
      r('b', '2026-10-06T19:00:00Z', 10, 'bench'),
      r('b', '2026-10-06T18:30:00Z', 11, 'handheld'),
    ])
    // Two gaps of +1, pulled toward 0 by one: 2/3.
    expect(o.handheld).toEqual({ offset: 0.67, n: 2 })
    expect(toBench(13, 'handheld', o)).toBeCloseTo(12.33, 2)
  })
  it('ignores tests of other fields or hours apart', () => {
    const o = offsetsFrom([r('a', '2026-10-05T12:00:00Z', 12, 'bench'), r('a', '2026-10-05T19:00:00Z', 9, 'bean_plant'), r('b', '2026-10-05T12:10:00Z', 15, 'bean_plant')])
    expect(o.bean_plant).toBeUndefined()
  })
  it('leaves bench and unknown readings alone', () => {
    expect(toBench(11, 'bench', { handheld: { offset: 1, n: 3 } })).toBe(11)
    expect(toBench(11, null, {})).toBe(11)
    expect(toBench(11, 'handheld', {})).toBe(11)
  })
})

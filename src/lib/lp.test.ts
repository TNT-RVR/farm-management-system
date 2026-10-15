import { describe, expect, it } from 'vitest'
import { lpMinimize } from './lp'

describe('lpMinimize', () => {
  it('solves a textbook minimum with ≥ rows', () => {
    // min 2x + 3y  s.t. x + y ≥ 4, x + 3y ≥ 6, x ≤ 3
    const r = lpMinimize([2, 3], [
      { a: [1, 1], op: '>=', b: 4 },
      { a: [1, 3], op: '>=', b: 6 },
      { a: [1, 0], op: '<=', b: 3 },
    ])!
    expect(r.x[0]).toBeCloseTo(3)
    expect(r.x[1]).toBeCloseTo(1)
    expect(r.value).toBeCloseTo(9)
  })
  it('says so when it cannot be done', () => {
    expect(lpMinimize([1], [{ a: [1], op: '<=', b: 1 }, { a: [1], op: '>=', b: 2 }])).toBeNull()
  })
  it('handles a negative right-hand side', () => {
    // x − y ≤ −1 → y ≥ x + 1; min y
    const r = lpMinimize([0, 1], [{ a: [1, -1], op: '<=', b: -1 }])!
    expect(r.x[1]).toBeCloseTo(1)
  })
})

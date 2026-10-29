import { describe, expect, it } from 'vitest'
import { fitMeasured, fitTabs } from './fitTabs'

// Five tabs of 100px, 4px gaps, a 40px ▾.
const W = [100, 100, 100, 100, 100]

describe('fitTabs', () => {
  it('shows everything, and no ▾, when it all fits', () => {
    // 5 × 100 + 4 × 4 = 516
    expect(fitTabs(W, 516, 40, 0, 4)).toEqual({ shown: [0, 1, 2, 3, 4], overflow: [] })
  })

  it('puts what does not fit behind the ▾, leaving room for it', () => {
    // Room for tabs = 400 − 40 − 4 = 356: three tabs (308), not four (412).
    expect(fitTabs(W, 400, 40, 0, 4)).toEqual({ shown: [0, 1, 2], overflow: [3, 4] })
  })

  it('swaps the active tab in for the last one that fits, keeping the list in order', () => {
    expect(fitTabs(W, 400, 40, 4, 4)).toEqual({ shown: [0, 1, 4], overflow: [2, 3] })
  })

  it('keeps more tabs when the active one is narrow enough to fit beside them', () => {
    // Room 356: tabs 0–2 take 308; a 40px active tab makes 352.
    expect(fitTabs([100, 100, 100, 100, 40], 400, 40, 4, 4)).toEqual({
      shown: [0, 1, 2, 4],
      overflow: [3],
    })
  })

  it('shows just the active tab and the ▾ in a very narrow bar', () => {
    expect(fitTabs(W, 120, 40, 2, 4)).toEqual({ shown: [2], overflow: [0, 1, 3, 4] })
    // Even when the active tab alone is wider than the room.
    expect(fitTabs(W, 60, 40, 3, 4)).toEqual({ shown: [3], overflow: [0, 1, 2, 4] })
  })

  it('shows a single tab with no ▾, even squeezed', () => {
    expect(fitTabs([100], 500, 40, 0, 4)).toEqual({ shown: [0], overflow: [] })
    expect(fitTabs([100], 50, 40, 0, 4)).toEqual({ shown: [0], overflow: [] })
  })

  it('caps the row at six tabs even when more would fit', () => {
    const eight = Array(8).fill(50)
    expect(fitTabs(eight, 2000, 40, 0, 4)).toEqual({ shown: [0, 1, 2, 3, 4, 5], overflow: [6, 7] })
    expect(fitTabs(eight, 2000, 40, 7, 4)).toEqual({ shown: [0, 1, 2, 3, 4, 7], overflow: [5, 6] })
  })

  it('handles no tabs and no active tab', () => {
    expect(fitTabs([], 400, 40, -1, 4)).toEqual({ shown: [], overflow: [] })
    expect(fitTabs(W, 400, 40, -1, 4)).toEqual({ shown: [0, 1, 2], overflow: [3, 4] })
  })
})

describe('fitMeasured', () => {
  it('shows every tab when the measurement was taken with more tabs than there are now', () => {
    const stale = { width: 300, widths: W, more: 40, gap: 4 }
    expect(fitMeasured(stale, 2, 0)).toEqual({ shown: [0, 1], overflow: [] })
  })

  it('shows every tab before anything has been measured', () => {
    expect(fitMeasured(null, 3, 0)).toEqual({ shown: [0, 1, 2], overflow: [] })
  })

  it('fits from the measurement when it matches the tabs', () => {
    expect(fitMeasured({ width: 400, widths: W, more: 40, gap: 4 }, 5, -1)).toEqual({
      shown: [0, 1, 2],
      overflow: [3, 4],
    })
  })
})

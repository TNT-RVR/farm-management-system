import { describe, expect, it } from 'vitest'
import { escalation, looksContinuous } from '../../netlify/shared/cost-benchmarks'

const quarterly = (vals: number[]) =>
  vals.map((v, i) => ({ refPer: `${2022 + Math.floor(i / 4)}-${((i % 4) * 3 + 1).toString().padStart(2, '0')}-01`, value: v }))

describe('looksContinuous', () => {
  it('accepts a series that only moves like a price', () => {
    expect(looksContinuous(quarterly([150, 152, 149, 155, 158, 160, 163, 165]))).toBe(true)
  })

  it('rejects one that jumps like a rebase', () => {
    // A ratio taken across a rebase is a change of units wearing the clothes of
    // a change of price.
    expect(looksContinuous(quarterly([150, 152, 149, 100, 101, 103, 104, 106]))).toBe(false)
  })

  it('rejects a series too short to judge', () => {
    expect(looksContinuous(quarterly([150, 152]))).toBe(false)
  })
})

describe('escalation', () => {
  const series = quarterly([150, 152, 148, 150, 160, 165, 170, 175])

  it('carries a base year forward on the index', () => {
    // 2022 averages 150; the latest is 175.
    expect(escalation(series, 2022)).toBeCloseTo(175 / 150, 6)
  })

  it('is happy to move a cost DOWN', () => {
    // 2022 was the drought year and Alberta feed has fallen since. A benchmark
    // that only ever inflates would be wrong most years.
    const falling = quarterly([170, 172, 168, 170, 140, 135, 130, 127])
    expect(escalation(falling, 2022)!).toBeLessThan(1)
  })

  it('refuses a rebased series rather than reporting nonsense', () => {
    expect(escalation(quarterly([150, 152, 149, 100, 101, 103, 104, 106]), 2022)).toBeNull()
  })

  it('refuses when the base year is not in the series', () => {
    expect(escalation(series, 2015)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { cardVerdict, coverLabel } from './grazing-forage'

const row = {
  readiness: 'overgrazed' as const,
  readiness_reason: 'Standing forage is below the residual floor.',
  regrowth_per_day: -0.01,
  regrowth_points: 4,
}

describe('cardVerdict', () => {
  it('in season, says what the readiness view says', () => {
    const v = cardVerdict(row, false)
    expect(v.label).toBe('Overgrazed')
    expect(v.trend).toBe('going backwards')
    expect(v.reason).toBe(row.readiness_reason)
  })

  it('out of season, reads Dormant and calls the fall seasonal', () => {
    const v = cardVerdict(row, true)
    expect(v.label).toBe('Dormant')
    expect(v.trend).toBe('seasonal decline')
    expect(v.reason).not.toMatch(/overgraz|residual/i)
  })
})

describe('coverLabel', () => {
  const four = { top: 0.8, topName: 'Pasture C', compared: 4 }

  it('names the paddock the percentage is measured against', () => {
    expect(coverLabel({ index: 0.632, ...four })).toEqual({ value: '79%', note: 'of Pasture C, the most' })
  })

  it('says the leader leads, rather than "100% of best"', () => {
    expect(coverLabel({ index: 0.8, ...four })).toEqual({ value: 'Most grass', note: 'of the 4 compared' })
  })

  it('never lets a second paddock round up to the top', () => {
    // 0.797 of 0.8 is 99.6%, which rounds to 100 and reads as a tie.
    expect(coverLabel({ index: 0.797, ...four })?.value).toBe('99%')
  })

  it('does not pretend a lone paddock was compared with others', () => {
    expect(coverLabel({ index: 0.4, top: 0.4, topName: 'Pasture A', compared: 1 })).toEqual({
      value: 'Most grass',
      note: 'the only paddock compared',
    })
  })

  it('gives nothing when the paddock has no look, or nothing to compare to', () => {
    expect(coverLabel({ index: null, ...four })).toBeNull()
    expect(coverLabel({ index: 0.5, top: 0, topName: 'C', compared: 3 })).toBeNull()
    expect(coverLabel({ index: 0.5, top: null, topName: 'C', compared: 3 })).toBeNull()
  })

  it('reads a bare paddock in a drought as a share, not an amount', () => {
    // Every paddock poor: the leader still leads and nothing claims a figure.
    expect(coverLabel({ index: 0.05, top: 0.09, topName: 'Pasture N', compared: 12 })).toEqual({
      value: '56%',
      note: 'of Pasture N, the most',
    })
  })
})

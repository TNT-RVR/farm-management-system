import { describe, expect, it } from 'vitest'
import { bandSegments } from './moisture'

describe('bandSegments', () => {
  it('lays the bands end to end with a floor and an overflow band', () => {
    // Canola: dry to 10.0, tough to 12.5, wet over.
    const b = bandSegments({ dry_max: 10, tough_max: 12.5 })
    expect(b.segments).toEqual([
      { grade: 'dry', from: 7, to: 10 },
      { grade: 'tough', from: 10, to: 12.5 },
      { grade: 'wet', from: 12.5, to: 15.5 },
    ])
    expect(b.edges).toEqual([10, 12.5])
  })
  it('leaves out an empty band and starts at the too-dry floor', () => {
    // Beans: dry 16 to 18, no tough range, wet over 18.
    const b = bandSegments({ dry_min: 16, dry_max: 18, tough_max: 18 })
    expect(b.segments.map((s) => s.grade)).toEqual(['too_dry', 'dry', 'wet'])
    expect(b.segments[0]).toEqual({ grade: 'too_dry', from: 13, to: 16 })
  })
  it('draws nothing for a crop with no bands', () => {
    expect(bandSegments({ dry_max: null, tough_max: null }).segments).toEqual([])
  })
})

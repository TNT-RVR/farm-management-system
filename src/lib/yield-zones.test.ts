import { describe, expect, it } from 'vitest'
import {
  YIELD_COLOURS,
  byField,
  fieldSpread,
  midYield,
  rangeLabel,
  yieldBands,
  yieldColour,
  WORTH_VARYING,
  type YieldZone,
} from './yield-zones'

let n = 0
const z = (o: Partial<YieldZone>): YieldZone => ({
  id: `z${++n}`,
  field_id: 'f1',
  field_name: 'Creek Flat',
  zone: 1,
  min_yield: null,
  max_yield: null,
  yield_unit: null,
  acres: null,
  legal_desc: null,
  source_name: null,
  geometry: { type: 'MultiPolygon', coordinates: [] },
  ...o,
})

describe('midYield', () => {
  it('takes the middle of the range', () => {
    expect(midYield({ min_yield: 74, max_yield: 100 })).toBe(87)
  })
  it('uses whichever end it has when only one is given', () => {
    expect(midYield({ min_yield: 74, max_yield: null })).toBe(74)
    expect(midYield({ min_yield: null, max_yield: 100 })).toBe(100)
    expect(midYield({ min_yield: null, max_yield: null })).toBeNull()
  })
})

describe('yieldBands', () => {
  const spread = Array.from({ length: 100 }, (_, i) => z({ min_yield: 40 + i, max_yield: 40 + i }))

  it('returns one band per colour', () => {
    expect(yieldBands(spread)).toHaveLength(YIELD_COLOURS.length)
  })

  it('cuts at the 5th and 95th percentile, not the extremes', () => {
    // One zone on one field runs to 161 where everything else tops out near
    // 125. Stretching the ramp to reach it puts four fifths of the farm in one
    // colour, which is the failure that makes people stop trusting a map.
    const withOutlier = [...spread, z({ min_yield: 900, max_yield: 900 })]
    const bands = yieldBands(withOutlier)
    expect(bands[bands.length - 1].to).toBeLessThan(200)
  })

  it('does not pretend to five bands when every zone is the same', () => {
    const flat = [z({ min_yield: 90, max_yield: 90 }), z({ min_yield: 90, max_yield: 90 })]
    expect(yieldBands(flat)).toHaveLength(1)
  })

  it('has nothing to say about no zones', () => {
    expect(yieldBands([])).toEqual([])
  })

  it('bands run low to high and butt up against each other', () => {
    const bands = yieldBands(spread)
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].from).toBe(bands[i - 1].to)
    }
  })
})

describe('yieldColour', () => {
  const bands = yieldBands(Array.from({ length: 100 }, (_, i) => z({ min_yield: i, max_yield: i })))

  it('puts poor ground at the brown end and good ground at the green end', () => {
    expect(yieldColour(bands, 0)).toBe(YIELD_COLOURS[0])
    expect(yieldColour(bands, 1000)).toBe(YIELD_COLOURS[YIELD_COLOURS.length - 1])
  })

  it('greys out a zone with no yield recorded rather than calling it poor', () => {
    // Colouring an unknown as the lowest band would say something false about
    // the ground.
    expect(yieldColour(bands, null)).toBe('#9ca3af')
    expect(yieldColour(bands, Number.NaN)).toBe('#9ca3af')
  })

  it('has a colour even before the bands are known', () => {
    expect(yieldColour([], 90)).toBe('#9ca3af')
  })
})

describe('rangeLabel', () => {
  it('leaves the unit off when the source never recorded one', () => {
    // The shapefiles carry min and max yield but never say of what, so a made-up
    // "bu/ac" would be inventing precision.
    expect(rangeLabel({ min_yield: 74.6, max_yield: 100.4, yield_unit: null })).toBe('75–100')
    expect(rangeLabel({ min_yield: 74.6, max_yield: 100.4, yield_unit: 'bu/ac' })).toBe('75–100 bu/ac')
  })

  it('copes with a half-known range', () => {
    expect(rangeLabel({ min_yield: 74, max_yield: null, yield_unit: null })).toBe('74+')
    expect(rangeLabel({ min_yield: null, max_yield: 100, yield_unit: null })).toBe('up to 100')
    expect(rangeLabel({ min_yield: null, max_yield: null, yield_unit: null })).toBe('—')
  })
})

describe('byField', () => {
  it('groups by field and puts the best ground first', () => {
    const out = byField([
      z({ field_id: 'a', field_name: 'Novak', min_yield: 40, max_yield: 50 }),
      z({ field_id: 'a', field_name: 'Novak', min_yield: 100, max_yield: 110 }),
      z({ field_id: 'b', field_name: 'Kellers', min_yield: 60, max_yield: 70 }),
    ])
    expect(out.map((f) => f.name)).toEqual(['Kellers', 'Novak'])
    expect(out[1].zones.map((x) => x.min_yield)).toEqual([100, 40])
  })
})

describe('fieldSpread', () => {
  it('reports how variable the field is, which is what a rate decision turns on', () => {
    const out = fieldSpread([
      z({ min_yield: 84, max_yield: 95 }),
      z({ min_yield: 95, max_yield: 116 }),
    ])
    expect(out).toEqual({ lo: 84, hi: 116, spread: 32 })
  })

  it('is what replaced the average, because the average is 100 by construction', () => {
    // The index normalises every field to its own mean, so an average column
    // read 99, 100, 99, 100 down the whole farm and invited the reading that
    // every field is equally good.
    const tight = fieldSpread([z({ min_yield: 97, max_yield: 103 })])
    const wide = fieldSpread([z({ min_yield: 60, max_yield: 140 })])
    expect(tight!.spread).toBeLessThan(WORTH_VARYING)
    expect(wide!.spread).toBeGreaterThan(WORTH_VARYING)
  })

  it('has nothing to say when no zone carries a range', () => {
    expect(fieldSpread([z({})])).toBeNull()
  })
})

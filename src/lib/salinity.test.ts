import { describe, expect, it } from 'vitest'
import { fieldSalinity, saltColour, zoneSalinity, SALT_CLASSES, SALT_NO_DATA } from './salinity'

const rep = (field_id: string, crop_year: number) => ({ field_id, crop_year, report_date: `${crop_year}-04-01` })

describe('salinity', () => {
  it('uses the latest report, topsoil only, mean and worst', () => {
    const m = fieldSalinity([
      { ec_ms_cm: 3, base_na_pct: 1, depth_top_in: 0, depth_label: '0-6', soil_test_reports: rep('a', 2024) },
      { ec_ms_cm: 0.4, base_na_pct: 1, depth_top_in: 0, depth_label: '0-6', soil_test_reports: rep('a', 2026) },
      { ec_ms_cm: 1.2, base_na_pct: 3, depth_top_in: null, depth_label: '0" - 6"', soil_test_reports: rep('a', 2026) },
      { ec_ms_cm: 9, base_na_pct: 3, depth_top_in: 6, depth_label: '6-24', soil_test_reports: rep('a', 2026) },
    ])
    const a = m.get('a')!
    expect(a.year).toBe(2026)
    expect(a.samples).toBe(2)
    expect(a.ec).toBeCloseTo(0.8)
    expect(a.worst).toBe(1.2)
    expect(a.naPct).toBe(2)
  })
  it('colours by class', () => {
    expect(saltColour(null)).toBe(SALT_NO_DATA)
    expect(saltColour(0.2)).toBe(SALT_CLASSES[0].colour)
    expect(saltColour(5)).toBe(SALT_CLASSES[5].colour)
    expect(saltColour(99)).toBe(SALT_CLASSES[SALT_CLASSES.length - 1].colour)
  })

  // The farm tests 0.09 to 1.32. A ramp whose first break is 1 paints all of
  // that one colour, which is the map Sam could not read anything off.
  it('separates the range our own ground falls in', () => {
    const ours = [0.09, 0.23, 0.31, 0.56, 0.8, 1.11, 1.32].map(saltColour)
    expect(new Set(ours).size).toBeGreaterThanOrEqual(4)
  })

  // Green over a green field is invisible, which is the whole farm on a good
  // map. No class may be a vegetation colour.
  it('has no green in the ramp', () => {
    for (const c of SALT_CLASSES) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.colour.slice(i, i + 2), 16))
      expect(g, c.label).toBeLessThanOrEqual(Math.max(r, b) + 8)
    }
  })
})

describe('zoneSalinity', () => {
  const salt = (ec: number, worst: number) => ({ ec, worst, naPct: null, year: 2026, samples: 4 })
  /** Four zones of equal size, running 84 to 116 around a field average of 100. */
  const zones = [
    { id: 'z1', acres: 20, min_yield: 80, max_yield: 88 },
    { id: 'z2', acres: 20, min_yield: 92, max_yield: 96 },
    { id: 'z3', acres: 20, min_yield: 104, max_yield: 108 },
    { id: 'z4', acres: 20, min_yield: 112, max_yield: 120 },
  ]

  const acreMean = (m: Map<string, number>) =>
    zones.reduce((s, z) => s + z.acres * m.get(z.id)!, 0) / zones.reduce((s, z) => s + z.acres, 0)

  it('keeps the measured mean and puts the worst sample on the poorest ground', () => {
    const m = zoneSalinity(salt(2, 6), zones)
    expect(acreMean(m)).toBeCloseTo(2)
    expect(m.get('z1')).toBeCloseTo(6)
    // Best ground comes out below the field mean, by as much as the poorest is above.
    expect(m.get('z4')!).toBeLessThan(2)
    expect([...m.values()].every((v) => v >= 0)).toBe(true)
  })

  it('leans the salt in order, poorest zone first', () => {
    const m = zoneSalinity(salt(3, 7), zones)
    const vals = ['z1', 'z2', 'z3', 'z4'].map((id) => m.get(id)!)
    expect(vals).toEqual([...vals].sort((a, b) => b - a))
  })

  // A report with one sample says nothing about where the salt is, and the map
  // must not pretend otherwise.
  it('gives one figure when the report has no spread', () => {
    const m = zoneSalinity(salt(2.5, 2.5), zones)
    expect([...m.values()]).toEqual([2.5, 2.5, 2.5, 2.5])
  })

  it('falls back to the field figure for unrated zones, and weights unequal acres', () => {
    expect([...zoneSalinity(salt(2, 6), [{ id: 'z', acres: 30, min_yield: null, max_yield: null }]).values()]).toEqual([2])
    const lopsided = [
      { id: 'a', acres: 70, min_yield: 96, max_yield: 100 },
      { id: 'b', acres: 10, min_yield: 70, max_yield: 78 },
    ]
    const m = zoneSalinity(salt(2, 6), lopsided)
    const mean = (m.get('a')! * 70 + m.get('b')! * 10) / 80
    expect(mean).toBeCloseTo(2)
    expect(m.get('b')).toBeCloseTo(6)
  })

  it('says nothing about a field with no zone map', () => {
    expect(zoneSalinity(salt(2, 6), []).size).toBe(0)
  })

  // Half the field at ten times its own mean is arithmetically impossible: the
  // other half would have to be negative. The measured mean is the invariant
  // that holds, and the worst zone lands as high as it can instead.
  it('keeps the mean exact when the worst sample is too extreme to place', () => {
    const half = [
      { id: 'a', acres: 40, min_yield: 70, max_yield: 78 },
      { id: 'b', acres: 40, min_yield: 122, max_yield: 130 },
    ]
    const m = zoneSalinity(salt(1, 10), half)
    expect((m.get('a')! + m.get('b')!) / 2).toBeCloseTo(1)
    expect(m.get('a')!).toBeGreaterThan(1)
    expect(m.get('a')!).toBeLessThan(10)
  })
})

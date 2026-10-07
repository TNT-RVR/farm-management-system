import { describe, expect, it } from 'vitest'
import { neediestZones, rankField, rankFields, sinceManure, type FieldSoil } from './manure-priority'

const field = (over: Partial<FieldSoil> = {}): FieldSoil => ({
  fieldId: 'f',
  name: 'Field',
  acres: 130,
  omPct: 3.2,
  olsenPPpm: 25,
  kPpm: 250,
  testYear: 2026,
  lastManureYear: null,
  lastManureAcres: null,
  ...over,
})

describe('rankField', () => {
  it('puts a low-organic-matter, low-phosphorus field near the top', () => {
    const poor = rankField(field({ omPct: 2.0, olsenPPpm: 10, kPpm: 120 }), 2026)
    const rich = rankField(field({ omPct: 4.5, olsenPPpm: 45, kPpm: 400 }), 2026)
    expect(poor.score).toBeGreaterThan(rich.score)
    expect(poor.reasons.join(' ')).toContain('Organic matter')
  })

  it('refuses to send manure to the field with the most phosphorus already', () => {
    // The failure this ranking is built against: manure goes to whichever
    // field is nearest the yard, year after year, until its phosphorus is far
    // past anything a crop can use and the next load is a runoff risk rather
    // than a benefit.
    const loaded = rankField(field({ omPct: 2.0, olsenPPpm: 85 }), 2026)
    expect(loaded.caution).toContain('runoff')
    const same = rankField(field({ omPct: 2.0, olsenPPpm: 10 }), 2026)
    expect(loaded.score).toBeLessThan(same.score)
  })

  it('flags a field over the AOPA soil-nitrate limit, higher on irrigated ground', () => {
    // Brown zone: 125 lb/ac dryland, 240 irrigated (0–60 cm, not sandy).
    const dry = rankField(field({ no3nLbAc: 150, irrigated: false }), 2026)
    expect(dry.caution).toContain('AOPA')
    const wet = rankField(field({ no3nLbAc: 150, irrigated: true }), 2026)
    expect(wet.caution).toBeNull()
    expect(rankField(field({ ecMsCm: 4.5 }), 2026).caution).toContain('EC')
  })

  it('still gives a phosphorus-loaded field some credit for poor organic matter', () => {
    // Halved, not zeroed. A flat refusal on a field that genuinely needs the
    // organic fraction is the kind of advice people learn to ignore.
    expect(rankField(field({ omPct: 1.8, olsenPPpm: 90 }), 2026).score).toBeGreaterThan(0)
  })

  it('ranks a field with no soil test on timing alone, and says so', () => {
    const blind = rankField(
      field({ omPct: null, olsenPPpm: null, kPpm: null, testYear: null }),
      2026,
    )
    expect(blind.unrated).toBe(true)
    expect(blind.reasons.join(' ')).toContain('No soil test')
  })

  it('does not penalise a field for a missing potassium reading', () => {
    // Renormalised over what is known. Treating an absent number as a zero
    // shortfall would quietly push every partially tested field down the list.
    const full = rankField(field({ omPct: 2.0, olsenPPpm: 10, kPpm: 120 }), 2026)
    const noK = rankField(field({ omPct: 2.0, olsenPPpm: 10, kPpm: null }), 2026)
    expect(noK.score).toBeGreaterThanOrEqual(full.score)
  })

  it('drops a field that was manured recently', () => {
    const fresh = rankField(field({ lastManureYear: 2026, lastManureAcres: 130 }), 2026)
    const never = rankField(field(), 2026)
    expect(fresh.score).toBeLessThan(never.score)
    expect(fresh.reasons.join(' ')).toContain('still carrying credit')
  })
})

describe('sinceManure', () => {
  it('is full for a field that has never had any', () => {
    expect(sinceManure(field(), 2026)).toBe(1)
  })

  it('climbs back over five years', () => {
    const f = (y: number) => sinceManure(field({ lastManureYear: y, lastManureAcres: 130 }), 2026)
    expect(f(2026)).toBe(0)
    expect(f(2024)).toBeCloseTo(0.4, 6)
    expect(f(2021)).toBe(1)
    expect(f(2015)).toBe(1)
  })

  it('never scores a manured field as needier than one never manured', () => {
    // A spread saved with a negative acreage — which is what a clockwise-drawn
    // polygon produced — made `covered` negative, and the arithmetic turned
    // that into MORE than a full need. Field 1 outranked field 0 on the real
    // list despite field 0 being poorer on organic matter, phosphorus and
    // potassium and never having seen a load.
    const bad = sinceManure(
      field({ lastManureYear: 2026, lastManureAcres: -39.33, acres: 133 }),
      2026,
    )
    expect(bad).toBeLessThanOrEqual(1)
    expect(bad).toBeGreaterThanOrEqual(0)
  })

  it('counts a corner as a corner, not as the field', () => {
    // Twenty acres of a hundred and thirty. The other hundred and ten are as
    // needy as they ever were, and marking the whole quarter done is how a
    // field goes another five years without.
    const corner = sinceManure(
      field({ lastManureYear: 2026, lastManureAcres: 20, acres: 130 }),
      2026,
    )
    expect(corner).toBeCloseTo(1 - 20 / 130, 6)
  })
})

describe('rankFields', () => {
  it('orders worst-off first and breaks ties by name', () => {
    const ranked = rankFields(
      [
        field({ fieldId: 'a', name: 'Rich', omPct: 4.5, olsenPPpm: 50, kPpm: 400 }),
        field({ fieldId: 'b', name: 'Poor', omPct: 1.9, olsenPPpm: 8, kPpm: 100 }),
        field({ fieldId: 'c', name: 'Middling' }),
      ],
      2026,
    )
    expect(ranked.map((r) => r.name)).toEqual(['Poor', 'Middling', 'Rich'])
  })
})

describe('neediestZones', () => {
  it('orders the fertility bands, poorest ground first', () => {
    // Straight off a real prescription: the bands are printed low to high and
    // the lowest is the ground that has been giving least.
    const zones = [
      { zone: 3, fertility_index: '95.02 - 101.02', acres: 32.84 },
      { zone: 1, fertility_index: '61.19 - 84.00', acres: 7.57 },
      { zone: 5, fertility_index: '103.71 - 108.05', acres: 36.77 },
    ]
    expect(neediestZones(zones).map((z) => z.zone)).toEqual([1, 3, 5])
    expect(neediestZones(zones)[0].rank).toBe(1)
  })

  it('sends a zone with no band to the back rather than the front', () => {
    // An unparsed band must not be treated as an index of zero and reported as
    // the neediest ground on the field.
    const zones = [
      { zone: 1, fertility_index: null, acres: 10 },
      { zone: 2, fertility_index: '84.00 - 95.02', acres: 20 },
    ]
    expect(neediestZones(zones).map((z) => z.zone)).toEqual([2, 1])
  })

  it('gives nothing back for a field with no zones', () => {
    expect(neediestZones([])).toEqual([])
  })
})

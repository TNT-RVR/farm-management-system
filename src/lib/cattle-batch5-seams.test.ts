import { describe, expect, it } from 'vitest'
import { occupiedWithNoFeed, sumAsShown } from './grazing'
import { conditionNote, restrictionText, type Restriction } from './grazing-restrictions'
import { shortFenceDays } from './virtual-fence'

// Batch 5 (18 Nov 2026): rough edges on /cattle — totals that did not add up
// on screen, a herd on a paddock worth nothing, label conditions read twice.

describe('sumAsShown', () => {
  it('adds the rows as printed, so three 152-ac paddocks total 456', () => {
    const rows = [151.6, 151.6, 151.6]
    expect(Math.round(rows.reduce((a, r) => a + r, 0))).toBe(455)
    expect(sumAsShown(rows, (r) => r)).toBe(456)
  })

  it('keeps the places asked for', () => {
    expect(sumAsShown([1.04, 1.04, 1.04], (r) => r, 1)).toBeCloseTo(3.0, 10)
    expect(sumAsShown([127.4, 0.2, 147.6], (r) => r)).toBe(127 + 0 + 148)
  })

  it('is 0 for no rows', () => {
    expect(sumAsShown([], (r: number) => r)).toBe(0)
  })
})

describe('shortFenceDays', () => {
  it('makes whole fences × days plus the short one equal the days shown', () => {
    // 34.6 days at 3 a fence: 11 whole fences, then one that lasts 2.
    const p = { rotations: 11, totalDays: 34.6 }
    expect(shortFenceDays(p, 3)).toBe(2)
    expect(p.rotations * 3 + shortFenceDays(p, 3)).toBe(Math.round(p.totalDays))
  })

  it('is 0 when the fences come out even, or no days are set', () => {
    expect(shortFenceDays({ rotations: 10, totalDays: 30.2 }, 3)).toBe(0)
    expect(shortFenceDays({ rotations: 0, totalDays: 5 }, 0)).toBe(0)
  })
})

describe('occupiedWithNoFeed', () => {
  const pastures = [
    { id: 'g1', name: 'Hay Flat aftermath', pasture_id: 'p1', auds: 0.2 },
    { id: 'g2', name: 'North', pasture_id: 'p2', auds: 2_400 },
    { id: 'g3', name: 'Unmapped', pasture_id: null, auds: 0 },
    { id: 'g4', name: 'Empty and empty', pasture_id: 'p4', auds: 0 },
  ]

  it('flags a paddock with cattle on it now that counts 0 AUDs', () => {
    const out = occupiedWithNoFeed(pastures, [
      { pasture_id: 'p1', head_count: 200, turned_in_on: '2026-11-12' },
      { pasture_id: 'p1', head_count: 25, turned_in_on: '2026-11-10' },
      { pasture_id: 'p2', head_count: 90, turned_in_on: '2026-10-01' },
    ])
    expect(out).toEqual([{ id: 'g1', name: 'Hay Flat aftermath', head: 225, since: '2026-11-10' }])
  })

  it('says nothing for a 0-AUD paddock with no one on it, or one not on the map', () => {
    expect(occupiedWithNoFeed(pastures, [])).toEqual([])
  })

  it('leaves head unknown when no event says how many', () => {
    expect(occupiedWithNoFeed(pastures, [{ pasture_id: 'p4', head_count: null, turned_in_on: '2026-11-01' }])[0].head).toBeNull()
  })
})

describe('conditionNote', () => {
  const r = (p: Partial<Restriction>): Restriction => ({
    kind: 'graze',
    product: 'X',
    registration: '1',
    appliedOn: '2026-11-01',
    sourceId: 's',
    days: 21,
    never: false,
    until: '2026-11-22',
    crop: null,
    condition: null,
    quote: null,
    assumed: null,
    eatenBecause: [],
    endsAtHarvest: false,
    harvestedOn: null,
    ...p,
  })

  it('drops a condition that only says the line again', () => {
    const dairy = r({ kind: 'dairy', days: 14, until: '2026-11-15', condition: 'Lactating dairy animals: 14 days.' })
    expect(restrictionText(dairy)).toMatch(/lactating dairy/)
    expect(conditionNote(dairy)).toBeNull()
    const slaughter = r({ kind: 'slaughter', days: 3, until: null, condition: 'Remove meat animals from treated fields 3 days before slaughter.' })
    expect(conditionNote(slaughter)).toBeNull()
  })

  it('drops one the label quote under the line already holds', () => {
    expect(conditionNote(r({ condition: 'cut for hay', quote: 'Do not graze or cut for hay within 21 days.' }))).toBeNull()
  })

  it('keeps a real qualifier, without its trailing stop', () => {
    expect(conditionNote(r({ kind: 'feed', days: 14, condition: 'hay PHI.' }))).toBe('hay PHI')
    expect(conditionNote(r({ kind: 'feed', days: 30, condition: 'forage' }))).toBe('forage')
    expect(conditionNote(r({ kind: 'graze', days: 0, condition: 'livestock other than lactating dairy animals' }))).toBe(
      'livestock other than lactating dairy animals',
    )
  })

  it('does not let the until date stand in for a number in the condition', () => {
    // until 1 Dec: the "1" of the date must not cover "1 application".
    expect(conditionNote(r({ days: 30, until: '2026-12-01', condition: '1 application' }))).toBe('1 application')
  })

  it('is null with no condition', () => {
    expect(conditionNote(r({ condition: '  ' }))).toBeNull()
  })
})

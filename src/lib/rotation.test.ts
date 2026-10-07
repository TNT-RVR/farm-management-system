import { describe, expect, it } from 'vitest'
import {
  buildSuccessionMap,
  checkPlacement,
  preferenceFor,
  suggestCrop,
  type CropInfo,
  type SuccessionRule,
} from './rotation'

const crop = (id: string, name: string, min_return_years = 0): CropInfo => ({
  id,
  name,
  min_return_years,
  color: null,
})

const WHEAT = crop('w', 'Wheat')
const CANOLA = crop('c', 'Canola', 4)
const ALFALFA = { ...crop('a', 'Alfalfa'), stand_max_years: 4 }
const BEANS = crop('b', 'Dry Beans')
const CROPS = [WHEAT, CANOLA, ALFALFA, BEANS]
const cropMap = new Map(CROPS.map((c) => [c.id, c]))

const rule = (prev: string, next: string, preference: string | null): SuccessionRule =>
  ({ id: `${prev}${next}`, prev_crop_id: prev, next_crop_id: next, preference, notes: null, created_at: '' }) as SuccessionRule

// Prairie Creek's sheet: recommended / possible / no-go, plus everything it simply
// never mentions.
const RULES = [
  rule('w', 'c', 'recommended'),
  rule('w', 'w', 'no_go'),
  rule('c', 'w', 'recommended'),
  rule('c', 'c', 'no_go'),
  rule('b', 'b', 'no_go'),
]
const map = buildSuccessionMap(RULES)
const lastYear = (id: string) => new Map([[2025, new Set([id])]])

describe('buildSuccessionMap', () => {
  it('records the tier for each pair', () => {
    expect(preferenceFor(map, 'w', 'c')).toBe('recommended')
    expect(preferenceFor(map, 'w', 'w')).toBe('no_go')
  })

  it('returns null for a pair the sheet never mentions', () => {
    expect(preferenceFor(map, 'w', 'a')).toBeNull()
  })

  // Rows created before the sheet existed meant "allowed" by their presence.
  it('treats a rule with no tier as merely possible', () => {
    const legacy = buildSuccessionMap([rule('w', 'a', null)])
    expect(preferenceFor(legacy, 'w', 'a')).toBe('possible')
  })
})

describe('checkPlacement', () => {
  it('blocks a no-go succession', () => {
    const v = checkPlacement('w', 2026, lastYear('w'), cropMap, map)
    expect(v.map((x) => x.kind)).toContain('succession')
    expect(v[0].message).toMatch(/must not follow/)
  })

  // The whole reason unlisted pairs stay legal: the sheet lists what to do and
  // what never to do, not every combination. Alfalfa after wheat is unmentioned
  // and perfectly fine — flagging it would be a false alarm on a real plan.
  it('allows a pair the sheet never mentions', () => {
    expect(checkPlacement('a', 2026, lastYear('w'), cropMap, map)).toEqual([])
  })

  it('allows a recommended succession', () => {
    expect(checkPlacement('c', 2026, lastYear('w'), cropMap, map)).toEqual([])
  })

  // A stand carrying on is not a reseeding, even where the sheet says
  // "no alfalfa into alfalfa".
  it('lets an alfalfa stand carry on', () => {
    const noReseed = buildSuccessionMap([...RULES, rule('a', 'a', 'no_go')])
    expect(checkPlacement('a', 2026, lastYear('a'), cropMap, noReseed)).toEqual([])
  })

  it('takes a stand out after its maximum, and lets a crop repeat up to its limit', () => {
    const noReseed = buildSuccessionMap([...RULES, rule('a', 'a', 'no_go'), rule('w', 'w', 'no_go')])
    const four = new Map([2022, 2023, 2024, 2025].map((y) => [y, new Set(['a'])]))
    expect(checkPlacement('a', 2026, four, cropMap, noReseed)[0].message).toMatch(/comes out after 4/)
    const twice = new Map([...cropMap, ['w', { ...cropMap.get('w')!, max_in_a_row: 2 }]])
    const once = checkPlacement('w', 2026, lastYear('w'), twice, noReseed)
    expect(once.map((v) => v.kind)).toEqual(['caution'])
    const two = new Map([2024, 2025].map((y) => [y, new Set(['w'])]))
    expect(checkPlacement('w', 2026, two, twice, noReseed).some((v) => v.kind !== 'caution')).toBe(true)
  })

  it('still enforces the return interval', () => {
    const sets = new Map([[2023, new Set(['c'])]])
    const v = checkPlacement('c', 2026, sets, cropMap, map)
    expect(v.map((x) => x.kind)).toContain('return')
  })

  // A split field carries several crops; the new crop must clear all of them.
  it('blocks when any part of a split field forbids it', () => {
    const sets = new Map([[2025, new Set(['w', 'a'])]])
    expect(checkPlacement('w', 2026, sets, cropMap, map)).toHaveLength(1)
  })
})

describe('suggestCrop', () => {
  it('prefers a crop the farm recommends after last year', () => {
    // Both canola and alfalfa are legal after wheat; only canola is recommended.
    expect(suggestCrop(2026, lastYear('w'), [ALFALFA, CANOLA], cropMap, map)).toBe('c')
  })

  it('never suggests a no-go', () => {
    const got = suggestCrop(2026, lastYear('b'), [BEANS], cropMap, map)
    expect(got).not.toBe('b')
  })
})

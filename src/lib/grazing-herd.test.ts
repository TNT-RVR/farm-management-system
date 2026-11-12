import { describe, expect, it } from 'vitest'
import { computePasture, computeHerds, datesInYear, grassBalance, type HerdRow, type PastureRow } from './grazing'
import { grassAumsFromAuDays } from './grazing-plan'

const row = (over: Partial<HerdRow>): HerdRow =>
  ({ id: 'x', ranch_id: 'R', class_name: 'Cows', head_count: 100, avg_weight_lb: 1300, au_equivalent: 1.3, au_override: false, graze_start: null, graze_end: null, feed_class: 'cow', background_head: null, ...over }) as HerdRow

// Home Ranch on 3 Nov 2026: only the bulls had dates, and last year's.
const homeRanch = [
  row({ id: 'b', class_name: 'Bulls', feed_class: 'bull', head_count: 23, avg_weight_lb: 1800, graze_start: '2025-05-15', graze_end: '2025-12-15' }),
  row({ id: 'c', class_name: 'Cows', head_count: 277, avg_weight_lb: 1350 }),
  row({ id: 'h', class_name: 'Replacement heifers', feed_class: 'bred_heifer', head_count: 39, avg_weight_lb: 1200 }),
  row({ id: 'k', class_name: 'Calves', feed_class: 'backgrounder', head_count: 320, avg_weight_lb: 480, background_head: 300 }),
  row({ id: 'y', class_name: 'Yearlings', feed_class: 'backgrounder', head_count: 67, avg_weight_lb: 850 }),
]

describe('grazing dates', () => {
  it('reads dates typed for an earlier year as the same days this year', () => {
    expect(datesInYear('2025-05-15', '2025-12-15', 2026)).toEqual({ start: '2026-05-15', end: '2026-12-15' })
    // A season over New Year runs into the next one.
    expect(datesInYear('2025-11-01', '2026-02-01', 2026)).toEqual({ start: '2026-11-01', end: '2027-02-01' })
    expect(datesInYear(null, '2025-12-15', 2026)).toBeNull()
  })
})

describe('a class with no grazing dates', () => {
  const calc = computeHerds(homeRanch, { month: 5, day: 6 }, '2026-12-01', 2026)
  const by = (id: string) => calc.find((h) => h.id === id)!

  it('is counted over the ranch season, flagged as assumed', () => {
    // The season is the dated classes' span: the bulls' 15 May – 15 Dec.
    expect(by('h')).toMatchObject({ start: '2026-05-15', end: '2026-12-15', days: 215, assumedSeason: true })
    expect(by('y').audsRequired).toBeCloseTo(67 * 0.85 * 215, 6)
    expect(by('c').days).toBe(215)
    expect(by('c').calfAuds).toBeGreaterThan(0)
  })

  it('keeps a class with its own dates unflagged, moved into this year', () => {
    expect(by('b')).toMatchObject({ start: '2026-05-15', end: '2026-12-15', days: 215, assumedSeason: false })
    expect(by('b').audsRequired).toBeCloseTo(23 * 1.8 * 215, 6)
  })

  it('leaves the calves at side in the cows’ row, not counted twice', () => {
    expect(by('k')).toMatchObject({ withCows: true, days: 0, audsRequired: 0 })
  })

  it('falls back to 1 May – 16 Nov when no class has dates', () => {
    const [cows] = computeHerds([row({})], null, null, 2026)
    expect(cows).toMatchObject({ start: '2026-05-01', end: '2026-11-16', days: 200, assumedSeason: true })
  })

  it('no longer reads 8,901 AUDs for the whole herd (the bulls alone)', () => {
    const need = calc.reduce((a, h) => a + h.audsRequired, 0)
    expect(Math.round(by('b').audsRequired)).toBe(8901)
    expect(need).toBeGreaterThan(8901 * 10)
  })
})

describe('grassBalance', () => {
  const calc = computeHerds(homeRanch, { month: 5, day: 6 }, '2026-12-01', 2026)

  it('makes the Herd page’s cows over the grass the Grazing tab’s shortfall ÷ a cow’s need', () => {
    const b = grassBalance(91_030, calc)
    const cows = 277
    expect(b.surplus).toBeCloseTo(91_030 - b.need, 6)
    expect(cows - b.capacityCows!).toBeCloseTo(-b.surplus / b.perCow!, 6)
    expect(b.cowDays).toBe(215)
  })

  it('has no cow capacity without cows', () => {
    const b = grassBalance(1000, computeHerds([row({ feed_class: 'bull', class_name: 'Bulls' })], null, null, 2026))
    expect(b.capacityCows).toBeNull()
    expect(b.others).toBe(b.need)
  })
})

describe('the Plan reads grass in the Grazing tab’s AUMs', () => {
  it('turns 91,030 AUDs into 3,034 AUM, as the Grazing tab does', () => {
    expect(Math.round(grassAumsFromAuDays(91_030))).toBe(3034)
  })

  it('matches computePasture’s own AUMs for the same pasture', () => {
    const p = { id: 'p', km2: 2, non_grazeable_ac: 10, irrigated_ac: 0, grazeable_irrigated_ac: 0, grass_quality: 'Fair' } as unknown as PastureRow
    const c = computePasture(p, 300, 0.8)
    expect(grassAumsFromAuDays(c.auds)).toBeCloseTo(c.aums, 6)
  })
})

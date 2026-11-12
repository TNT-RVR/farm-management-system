import { describe, expect, it } from 'vitest'
import { calvesAtSideAU, median, mobClass, MOVE_DEFAULTS, moveVerdict, seasonGrowthShare, type MoveInput } from './pasture-move'

// A 500-acre Fair paddock at 300 mm projected (370 lb/ac), 80% utilisation:
// 148,000 lb a full season; in early July 95% of the season has grown, so
// 140,600 lb to graze. 400 AU eat 10,400 lb a day, so it lasts about 13 days.
const base: MoveInput = {
  pasture: 'Pasture N',
  acres: 500,
  quality: 'Fair',
  utilisation: 0.8,
  projectedSeasonMm: 300,
  pctOfNormal: 100,
  animalUnits: 400,
  turnedInOn: '2026-07-01',
  today: '2026-07-04',
  looks: [
    { on: '2026-06-01', fi: 0.5 },
    { on: '2026-06-30', fi: 0.5 },
    { on: '2026-07-03', fi: 0.48 },
  ],
  rested: [
    { on: '2026-06-01', fi: 0.5 },
    { on: '2026-06-30', fi: 0.5 },
    { on: '2026-07-03', fi: 0.5 },
  ],
  thresholds: MOVE_DEFAULTS,
}

describe('moveVerdict', () => {
  it('stays put on a full paddock with days to spare', () => {
    const v = moveVerdict(base)
    expect(v.expectedLbAc).toBe(370)
    expect(v.availableLb).toBe(140_600)
    expect(v.daysOn).toBe(3)
    expect(v.daysLeft).toBeCloseTo(140_600 / 10_400 - 3, 1)
    expect(v.move).toBe(false)
  })

  it('says move when the estimate runs down to the threshold', () => {
    const v = moveVerdict({ ...base, today: '2026-07-11' })
    expect(v.daysLeft!).toBeLessThanOrEqual(5)
    expect(v.move).toBe(true)
    expect(v.reasons[0]).toMatch(/days? of grazing left/)
  })

  it('moves earlier in a dry year', () => {
    // 7 days left: fine normally, a move at 60% of normal (threshold doubles to 10).
    const day = { ...base, today: '2026-07-08' }
    expect(moveVerdict(day).move).toBe(false)
    const dry = moveVerdict({ ...day, pctOfNormal: 60 })
    expect(dry.daysLeftMin).toBe(10)
    expect(dry.move).toBe(true)
    expect(dry.reasons.at(-1)).toMatch(/60% of the 10-year average/)
  })

  it('starts a second turn with what the first one left', () => {
    // At turn-in the paddock stood at half its season best while the rested
    // paddocks were still at theirs: it was grazed before, so half the forage.
    const v = moveVerdict({ ...base, looks: [{ on: '2026-06-01', fi: 0.6 }, { on: '2026-06-30', fi: 0.3 }] })
    expect(v.shareStanding).toBe(0.5)
    expect(v.availableLb).toBe(70_300)
  })

  it('credits only the grass grown so far in spring', () => {
    // Turned in mid-May: 30% of the season's growth is there, not all of it.
    const may = moveVerdict({ ...base, turnedInOn: '2026-05-15', today: '2026-05-16', looks: [], rested: [] })
    expect(may.availableLb).toBe(Math.round(148_000 * 0.3))
    const aug = moveVerdict({ ...base, turnedInOn: '2026-08-15', today: '2026-08-16', looks: [], rested: [] })
    expect(aug.availableLb).toBe(148_000)
  })

  it('does not mistake curing grass for grazing', () => {
    // Every paddock has fallen to half its peak by September; this one too.
    const v = moveVerdict({
      ...base,
      turnedInOn: '2026-09-01',
      today: '2026-09-03',
      looks: [{ on: '2026-07-01', fi: 0.6 }, { on: '2026-08-30', fi: 0.3 }, { on: '2026-09-02', fi: 0.29 }],
      rested: [{ on: '2026-07-01', fi: 0.6 }, { on: '2026-08-30', fi: 0.3 }, { on: '2026-09-02', fi: 0.3 }],
    })
    expect(v.shareStanding).toBe(1)
    expect(v.move).toBe(false)
  })

  it('flags a paddock grazed down below the floor and below the rested ones', () => {
    const v = moveVerdict({
      ...base,
      looks: [...base.looks, { on: '2026-07-04', fi: 0.2 }],
      rested: [...base.rested, { on: '2026-07-04', fi: 0.45 }],
    })
    expect(v.move).toBe(true)
    expect(v.reasons.some((r) => /under the 0.25 floor/.test(r))).toBe(true)
    expect(v.reasons.some((r) => /fallen \d+% more than the rested/.test(r))).toBe(true)
  })

  it('does not call a low index grazed when the rested paddocks are just as low', () => {
    const v = moveVerdict({
      ...base,
      looks: [...base.looks, { on: '2026-07-04', fi: 0.2 }],
      rested: [...base.rested, { on: '2026-07-04', fi: 0.21 }],
    })
    expect(v.reasons.some((r) => /floor/.test(r))).toBe(false)
  })
})

describe('helpers', () => {
  it('reads a mob name as a herd class', () => {
    expect(mobClass('Home Ranch Bulls')).toBe('Bulls')
    expect(mobClass('East Ranch Replacement Heifer')).toBe('Replacement heifers')
    expect(mobClass('East Ranch Herd')).toBe('Cows')
  })

  it('takes a median', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('seasonGrowthShare', () => {
  it('follows the mixed-grass curve by month, and is whole outside the growing months', () => {
    expect(seasonGrowthShare('2026-04-20')).toBe(0.05)
    expect(seasonGrowthShare('2026-05-01')).toBe(0.3)
    expect(seasonGrowthShare('2026-06-30')).toBe(0.75)
    expect(seasonGrowthShare('2026-07-10')).toBe(0.95)
    expect(seasonGrowthShare('2026-09-01')).toBe(1)
    expect(seasonGrowthShare('2027-02-01')).toBe(1)
  })
})

describe('calves at side on the move-out check', () => {
  const base = { mobClass: 'Cows', mobHead: 270, cows: 277, calves: 320, calfAu: 0.48, countCalves: true, weaningDate: '2026-12-01', today: '2026-10-05' }
  it('adds a calf per cow, at the calves AU, until weaning', () => {
    expect(calvesAtSideAU(base)).toBeCloseTo(270 * 0.48, 6)
    expect(calvesAtSideAU({ ...base, calves: 125, cows: 250 })).toBeCloseTo(270 * 0.5 * 0.48, 6)
  })
  it('stops at weaning, for other mobs, and when switched off', () => {
    expect(calvesAtSideAU({ ...base, today: '2026-12-01' })).toBe(0)
    expect(calvesAtSideAU({ ...base, mobClass: 'Bulls' })).toBe(0)
    expect(calvesAtSideAU({ ...base, countCalves: false })).toBe(0)
  })
  it('counts a calf by its age when the calving date is known', () => {
    // Born 6 May, on 1 Oct it is in its fifth month: 8 lb of forage, 8/26 AU.
    expect(calvesAtSideAU({ ...base, today: '2026-10-01', calving: { month: 5, day: 6 } })).toBeCloseTo(270 * (8 / 26), 6)
    // A June calf barely eats grass yet.
    expect(calvesAtSideAU({ ...base, today: '2026-06-01', calving: { month: 5, day: 6 } })).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import {
  MIN_GRAZED_DAYS,
  forageCalibration,
  grazedSeasons,
  mobUnits,
  type GrazedRow,
  type MobUnits,
} from './grazed-yield'

const UNITS: MobUnits = { cows: 1.25, heifers: 1.15, bulls: 1.55 }
const ONE_RAIN = () => 1

/** A mob in a paddock for `days` days from 1 May 2026. */
const run = (mob: string, pasture: string, days: number, head: number, fromDay = 1): GrazedRow => ({
  mob,
  pasture_id: pasture,
  started_at: `2026-05-${String(fromDay).padStart(2, '0')}T00:00:00Z`,
  ended_at: new Date(Date.UTC(2026, 4, fromDay + days)).toISOString(),
  head_count: head,
})

const UNTIL = new Date('2026-12-01T00:00:00Z')

describe('grazedSeasons', () => {
  it('counts head times days at the mob’s animal units', () => {
    const [s] = grazedSeasons([run('Home Ranch Herd', 'p1', 10, 100)], UNITS, UNTIL)
    expect(s.season).toBe(2026)
    expect(s.auds).toBe(Math.round(10 * 100 * 1.25))
    expect(s.paddocks).toBe(1)
  })

  it('reads the mob name for which animal it is', () => {
    const [s] = grazedSeasons(
      [run('Home Ranch Bulls', 'p1', 10, 10), run('Home Ranch Replacement Heifer', 'p2', 10, 10)],
      UNITS,
      UNTIL,
    )
    expect(s.auds).toBe(Math.round(10 * 10 * 1.55 + 10 * 10 * 1.15))
  })

  it('counts one mob once a day however many times it was logged in a paddock', () => {
    // The same mob, same paddock, same days, logged twice as the virtual fence
    // moved inside it. Summing the activations would double the herd.
    const once = grazedSeasons([run('Herd', 'p1', 10, 100)], UNITS, UNTIL)[0]
    const twice = grazedSeasons([run('Herd', 'p1', 10, 100), run('Herd', 'p1', 10, 100)], UNITS, UNTIL)[0]
    expect(twice.auds).toBe(once.auds)
  })

  it('counts the same mob in two paddocks on one day as two paddocks', () => {
    // It really was eating in both, so this is not double counting.
    const [s] = grazedSeasons([run('Herd', 'p1', 10, 100), run('Herd', 'p2', 10, 100)], UNITS, UNTIL)
    expect(s.auds).toBe(Math.round(2 * 10 * 100 * 1.25))
    expect(s.paddocks).toBe(2)
  })

  it('bounds a mob that is still out at today', () => {
    const open: GrazedRow = { mob: 'Herd', pasture_id: 'p1', started_at: '2026-05-01T00:00:00Z', ended_at: null, head_count: 10 }
    const [s] = grazedSeasons([open], UNITS, new Date('2026-05-11T00:00:00Z'))
    expect(s.auds).toBe(Math.round(10 * 10 * 1.25))
  })

  it('ignores a row with no paddock or no head', () => {
    expect(grazedSeasons([{ ...run('Herd', 'p1', 10, 100), pasture_id: null }], UNITS, UNTIL)).toEqual([])
    expect(grazedSeasons([{ ...run('Herd', 'p1', 10, 0), head_count: 0 }], UNITS, UNTIL)).toEqual([])
  })
})

describe('mobUnits', () => {
  it('reads each class off the ranch’s own herd', () => {
    const u = mobUnits(
      [
        { feed_class: 'cow', class_name: 'Cows' },
        { feed_class: 'bull', class_name: 'Bulls' },
        { feed_class: 'bred_heifer', class_name: 'Replacement heifers' },
      ],
      (r) => ({ cow: 1.25, bull: 1.55, bred_heifer: 1.15 })[r.feed_class as string] ?? 0,
    )
    expect(u).toEqual({ cows: 1.25, bulls: 1.55, heifers: 1.15 })
  })

  it('falls back to a 1,000 lb cow when the class is not on file', () => {
    expect(mobUnits([], () => 0).cows).toBe(1)
  })
})

describe('forageCalibration', () => {
  const season = { season: 2026, auds: 84_000, paddocks: 7, days: 198 }

  it('lifts the table to what the cattle actually took', () => {
    const c = forageCalibration([season], 50_000, ONE_RAIN)
    expect(c.factor).toBeCloseTo(1.68, 2)
    expect(c.season).toBe(2026)
    expect(c.grazedAuds).toBe(84_000)
  })

  it('reads a wet year as an ordinary one before comparing', () => {
    // The same take in a 125% year is worth less as a normal-year figure.
    const wet = forageCalibration([season], 50_000, () => 1.25)
    expect(wet.normalisedAuds).toBe(67_200)
    expect(wet.factor).toBeCloseTo(1.344, 3)
  })

  it('never lowers the table on the strength of a paddock left alone', () => {
    // The model already says more than the cattle took: that is not evidence
    // the grass is worse, only that nobody grazed it that hard.
    expect(forageCalibration([season], 200_000, ONE_RAIN).factor).toBe(1)
  })

  it('refuses a season too short or too thin to mean anything', () => {
    expect(forageCalibration([{ ...season, days: MIN_GRAZED_DAYS - 1 }], 50_000, ONE_RAIN).factor).toBe(1)
    expect(forageCalibration([{ ...season, paddocks: 2 }], 50_000, ONE_RAIN).factor).toBe(1)
    expect(forageCalibration([], 50_000, ONE_RAIN).season).toBeNull()
  })

  it('stops at three times, where the inputs are the likelier fault', () => {
    expect(forageCalibration([{ ...season, auds: 900_000 }], 50_000, ONE_RAIN).factor).toBe(3)
  })

  it('does nothing without a model figure to measure against', () => {
    expect(forageCalibration([season], 0, ONE_RAIN).factor).toBe(1)
  })
})

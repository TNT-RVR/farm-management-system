import { describe, expect, it } from 'vitest'
import {
  acresPerHour,
  calibrationDistanceFt,
  hoursForAcres,
  planterDefaultsOf,
  plateRpm,
  populationFromSpacing,
  rowFeetPerAcre,
  seedsPerCalibration,
  spacingFromPopulation,
  stepSpeed,
  withPlanterDefault,
} from './planter'

describe('rowFeetPerAcre', () => {
  it('is 43,560 at 12-inch rows, by definition', () => {
    // One row twelve inches apart covers a strip a foot wide, so an acre is
    // 43,560 row feet. Everything else scales off this.
    expect(rowFeetPerAcre(12)).toBe(43_560)
  })

  it('falls as the rows get wider', () => {
    // 22-inch rows: each foot of travel covers 22/12 sq ft.
    expect(rowFeetPerAcre(22)).toBeCloseTo(23_760, 0)
    expect(rowFeetPerAcre(30)).toBeCloseTo(17_424, 0)
  })
})

describe('spacing and population are the same equation', () => {
  it('gives the textbook figure for 30-inch corn', () => {
    // 34,000 seeds/ac on 30-inch rows is 6.15 in — the number on every corn
    // population chart, which is what makes it a good check on the algebra.
    expect(spacingFromPopulation(34_000, 30)).toBeCloseTo(6.15, 2)
  })

  it('gives the right spacing on this farm 22-inch rows', () => {
    expect(spacingFromPopulation(34_000, 22)).toBeCloseTo(8.385, 2)
  })

  it('round-trips', () => {
    const s = spacingFromPopulation(32_000, 22)!
    expect(populationFromSpacing(s, 22)).toBeCloseTo(32_000, 4)
  })

  it('refuses nonsense rather than returning a number', () => {
    // A zero or a blank box must not come out as Infinity dressed as advice.
    expect(spacingFromPopulation(0, 22)).toBeNull()
    expect(spacingFromPopulation(34_000, 0)).toBeNull()
    expect(populationFromSpacing(-3, 22)).toBeNull()
  })
})

describe('calibrationDistanceFt', () => {
  it('is spacing x holes x turns, in feet', () => {
    // 30 holes at 8 in: one turn lays 240 in = 20 ft, so ten turns is 200 ft.
    expect(calibrationDistanceFt(8, 30, 10)).toBeCloseTo(200, 6)
  })

  it('takes a different turn count', () => {
    expect(calibrationDistanceFt(8, 30, 5)).toBeCloseTo(100, 6)
    expect(calibrationDistanceFt(8, 30, 1)).toBeCloseTo(20, 6)
  })

  it('scales with the plate, not with the speed', () => {
    // Nothing about ground speed enters this: the drive ratio is whatever makes
    // the spacing come out, and the spacing is the input.
    expect(calibrationDistanceFt(6.15, 60, 10)).toBeCloseTo(307.5, 3)
  })

  it('says how many seeds should be on the ground', () => {
    expect(seedsPerCalibration(30, 10)).toBe(300)
  })
})

describe('acresPerHour', () => {
  it('matches the hand figure for this planter', () => {
    // 20 rows at 22 in is 36.67 ft wide. At 5 mph that is 36.67 x 5 x 5280
    // = 968,000 sq ft an hour, or 22.2 acres.
    expect(acresPerHour({ rows: 20, rowSpacingIn: 22 }, 5)).toBeCloseTo(22.22, 2)
  })

  it('scales with speed and with width', () => {
    const base = acresPerHour({ rows: 20, rowSpacingIn: 22 }, 5)!
    expect(acresPerHour({ rows: 20, rowSpacingIn: 22 }, 10)).toBeCloseTo(base * 2, 6)
    expect(acresPerHour({ rows: 10, rowSpacingIn: 22 }, 5)).toBeCloseTo(base / 2, 6)
  })

  it('turns acres into hours', () => {
    expect(hoursForAcres(133, 22.22)).toBeCloseTo(5.99, 1)
    expect(hoursForAcres(133, null)).toBeNull()
    expect(hoursForAcres(0, 22.22)).toBeNull()
  })
})

describe('plateRpm', () => {
  it('gives a sane figure at working speed', () => {
    // 5 mph is 5,280 in/min. At 8.385 in spacing that is 630 seeds a minute;
    // a 30-hole plate turns 21 times to drop them.
    expect(plateRpm(5, 8.385, 30)).toBeCloseTo(21.0, 1)
  })

  it('rises with speed and falls with more holes', () => {
    // The reason more holes exist: same population, slower plate.
    expect(plateRpm(6, 8.385, 30)!).toBeGreaterThan(plateRpm(5, 8.385, 30)!)
    expect(plateRpm(5, 8.385, 60)!).toBeCloseTo(plateRpm(5, 8.385, 30)! / 2, 6)
  })

  it('is null when something is missing', () => {
    expect(plateRpm(0, 8, 30)).toBeNull()
    expect(plateRpm(5, 0, 30)).toBeNull()
    expect(plateRpm(5, 8, 0)).toBeNull()
  })
})

describe('the farm planter setting', () => {
  it('has no figure of its own when nothing is saved', () => {
    // The public copy and the demo have no row, so every box starts empty.
    expect(planterDefaultsOf(undefined)).toEqual({ rowSpacingIn: null, rows: null, speedMph: null })
    expect(planterDefaultsOf(null)).toEqual({ rowSpacingIn: null, rows: null, speedMph: null })
  })

  it('reads the saved figures, numbers or numeric strings', () => {
    expect(planterDefaultsOf({ rowSpacingIn: 22, rows: '20', speedMph: 5 })).toEqual({
      rowSpacingIn: 22,
      rows: 20,
      speedMph: 5,
    })
  })

  it('drops anything that is not a positive number', () => {
    expect(planterDefaultsOf({ rowSpacingIn: 0, rows: 'x', speedMph: -1 })).toEqual({
      rowSpacingIn: null,
      rows: null,
      speedMph: null,
    })
  })

  it('replaces only the figure that was typed', () => {
    expect(withPlanterDefault({ rowSpacingIn: 22, rows: 20, speedMph: 5 }, { speedMph: '5.5' })).toEqual({
      rowSpacingIn: 22,
      rows: 20,
      speedMph: 5.5,
    })
    expect(withPlanterDefault(undefined, { rowSpacingIn: '30' })).toEqual({
      rowSpacingIn: 30,
      rows: null,
      speedMph: null,
    })
  })

  it('writes nothing for a blank box or an unchanged figure', () => {
    expect(withPlanterDefault({ rowSpacingIn: 22 }, { rowSpacingIn: '' })).toBeNull()
    expect(withPlanterDefault({ rowSpacingIn: 22 }, { rowSpacingIn: '22' })).toBeNull()
  })
})

describe('stepSpeed', () => {
  it('moves a tenth at a time without float creep', () => {
    expect(stepSpeed(4.5, 0.1)).toBe(4.6)
    expect(stepSpeed(5.2, -0.1)).toBe(5.1)
  })

  it('starts from nothing and never reaches zero', () => {
    expect(stepSpeed(0, 0.1)).toBe(0.1)
    expect(stepSpeed(0.1, -0.1)).toBeNull()
  })
})

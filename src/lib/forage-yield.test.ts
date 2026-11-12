import { describe, expect, it } from 'vitest'
import {
  audsFromLb,
  computePasture,
  computePastures,
  forageYieldPerAcre,
  FORAGE_YIELD_IRRIGATION,
  type PastureRow,
} from './forage-yield'

describe('forageYieldPerAcre', () => {
  it('reads each band at its middle', () => {
    expect(forageYieldPerAcre(300, 'Fair')).toBe(370)
    expect(forageYieldPerAcre(400, 'Fair')).toBe(550)
    expect(forageYieldPerAcre(500, 'Good')).toBe(1300)
    expect(forageYieldPerAcre(600, 'Excellent')).toBe(3000)
  })

  it('draws a straight line between band middles instead of a staircase', () => {
    // Halfway from 300 (370) to 400 (550).
    expect(forageYieldPerAcre(350, 'Fair')).toBeCloseTo(460, 6)
    // No jump at a band edge.
    expect(Math.abs(forageYieldPerAcre(351, 'Fair') - forageYieldPerAcre(349, 'Fair'))).toBeLessThan(5)
  })

  it('falls with the rain below the lowest band, to nothing at none', () => {
    expect(forageYieldPerAcre(150, 'Fair')).toBeCloseTo(185, 6)
    expect(forageYieldPerAcre(0, 'Fair')).toBe(0)
    expect(forageYieldPerAcre(-20, 'Fair')).toBe(0)
  })

  it('holds at the top band above it, and reads an unknown quality as Fair', () => {
    expect(forageYieldPerAcre(900, 'Poor')).toBe(1000)
    expect(forageYieldPerAcre(300, 'Unknown')).toBe(370)
  })
})

const row = (over: Partial<PastureRow>): PastureRow =>
  ({ id: 'p', name: 'P', km2: 1, non_grazeable_ac: 0, irrigated_ac: 0, grazeable_irrigated_ac: 0, grass_quality: 'Fair', ...over }) as PastureRow

describe('computePasture', () => {
  it('grows the irrigated acres at the irrigated yield', () => {
    // 1 km² = 247.1 ac: 100 ac irrigated (all grazeable), 147.1 ac native.
    const p = computePasture(row({ irrigated_ac: 100, grazeable_irrigated_ac: 100 }), 300, 0.8)
    expect(p.nativeGrassAc).toBeCloseTo(147.105, 2)
    expect(p.irrigatedForagePerAcre).toBe(FORAGE_YIELD_IRRIGATION.Fair)
    expect(p.totalLbs).toBeCloseTo((147.105 * 370 + 100 * 3500) * 0.8, 0)
    expect(p.foragePerAcreUtil).toBeCloseTo(p.totalLbs / p.totalGrazeableAc, 6)
  })

  it('never counts native acres below zero', () => {
    const p = computePasture(row({ km2: 0.1, non_grazeable_ac: 20, irrigated_ac: 20, grazeable_irrigated_ac: 10 }), 300, 0.8)
    expect(p.nativeGrassAc).toBe(0)
    expect(p.totalGrazeableAc).toBe(10)
  })
})

describe('the AUD split', () => {
  it('splits a pasture into its native grass and its irrigated acres, and the two add up', () => {
    const p = computePasture(row({ irrigated_ac: 100, grazeable_irrigated_ac: 100 }), 300, 0.8)
    expect(p.fieldAuds).toBeCloseTo((100 * FORAGE_YIELD_IRRIGATION.Fair * 0.8) / 26, 6)
    expect(p.nativeAuds).toBeCloseTo((147.105 * 370 * 0.8) / 26, 1)
    expect(p.nativeAuds + p.fieldAuds).toBeCloseTo(p.auds, 6)
  })

  it('gives a pasture with no irrigated acres nothing off the fields', () => {
    const p = computePasture(row({}), 300, 0.8)
    expect(p.fieldAuds).toBe(0)
    expect(p.nativeAuds).toBeCloseTo(p.auds, 6)
  })

  it('reads pounds as animal-unit days at 26 lb a day', () => {
    expect(audsFromLb(2600)).toBe(100)
    expect(audsFromLb(0)).toBe(0)
  })
})


describe('seasonFactor', () => {
  it('scales the dryland grass and leaves the irrigated acres alone', () => {
    const r = row({ irrigated_ac: 100, grazeable_irrigated_ac: 100 })
    const plain = computePasture(r, 300, 0.8)
    const up = computePasture(r, 300, 0.8, null, 1.2)
    // Native grass up by a fifth; irrigated grass untouched, because it does
    // not grow on rain.
    expect(up.foragePerAcre).toBeCloseTo(plain.foragePerAcre * 1.2, 6)
    expect(up.irrigatedForagePerAcre).toBe(plain.irrigatedForagePerAcre)
    expect(up.nativeLbs).toBeCloseTo(plain.nativeLbs * 1.2, 4)
    expect(up.fieldLbs).toBeCloseTo(plain.fieldLbs, 4)
  })

  it('is 1 when absent, and ignores a nonsense value rather than zeroing the grass', () => {
    const r = row({})
    const base = computePasture(r, 400, 0.8).totalLbs
    expect(computePasture(r, 400, 0.8).seasonFactor).toBe(1)
    expect(computePasture(r, 400, 0.8, null, null).totalLbs).toBeCloseTo(base, 4)
    expect(computePasture(r, 400, 0.8, null, 0).totalLbs).toBeCloseTo(base, 4)
    expect(computePasture(r, 400, 0.8, null, Number.NaN).totalLbs).toBeCloseTo(base, 4)
  })
})

describe('computePastures', () => {
  const dry = row({ id: 'dry', name: 'Dry' })
  const wet = row({ id: 'wet', name: 'Wet' })
  // Home Ranch's real shape: a 382 mm annual zone, a 270 mm normal season,
  // and a wet year projected to 379 mm — so the season ran 1.404 of normal.
  const rain = { forecastMm: 270, projectedMm: 379, zoneMm: 382, rainFactor: 379 / 270 }

  it('reads the row off the zone, never off this year’s rain', () => {
    const [p] = computePastures([dry], rain, 0.8, null, null)
    // 382 mm picks the row; the wet season scales what that row yields. The
    // old rule looked the row up at 379 mm instead, which let a wet year
    // promote the pasture to a zone it does not sit in.
    expect(p.foragePerAcre).toBeCloseTo(forageYieldPerAcre(382, 'Fair') * (379 / 270), 6)
    expect(p.foragePerAcre).not.toBeCloseTo(forageYieldPerAcre(379, 'Fair'), 2)
  })

  it('a dry year and a wet year sit in the same zone', () => {
    const [wetYear] = computePastures([dry], rain, 0.8, null, null)
    const [dryYear] = computePastures([dry], { ...rain, projectedMm: 190, rainFactor: 190 / 270 }, 0.8, null, null)
    // Same row both times — only the multiplier moved.
    expect(wetYear.foragePerAcre / wetYear.seasonFactor).toBeCloseTo(dryYear.foragePerAcre / dryYear.seasonFactor, 6)
    expect(dryYear.foragePerAcre).toBeLessThan(wetYear.foragePerAcre)
  })

  it('prefers the satellite’s own measurement where there is one', () => {
    const [p] = computePastures([wet], rain, 0.8, null, new Map([['wet', 1.16]]))
    // The zone times the measured growth, and NOT also times the rain ratio:
    // they measure the same weather and multiplying both counts it twice.
    expect(p.foragePerAcre).toBeCloseTo(forageYieldPerAcre(382, 'Fair') * 1.16, 6)
    expect(p.seasonFactor).toBe(1.16)
  })

  it('falls back to the rain ratio for a paddock the satellite has not watched', () => {
    const [p] = computePastures([dry], rain, 0.8, null, new Map([['wet', 1.16]]))
    expect(p.foragePerAcre).toBeCloseTo(forageYieldPerAcre(382, 'Fair') * (379 / 270), 6)
    expect(p.seasonFactor).toBeCloseTo(379 / 270, 6)
  })

  it('shows a wet year as extra AUDs against a baseline that has not moved', () => {
    // What the Grazing tab prints: "N AUDs in a normal year" is the same
    // pastures with the season's multiplier set to 1, so the gap between that
    // and the live figure is this year's rain and nothing else. If the zone
    // moved with the weather too, the gap would overstate the rain.
    const normal = computePastures([dry], { ...rain, rainFactor: 1 }, 0.8, null, null)[0]
    const live = computePastures([dry], rain, 0.8, null, null)[0]
    expect(live.auds / normal.auds).toBeCloseTo(379 / 270, 6)
    expect(live.auds).toBeGreaterThan(normal.auds)

    // And a dry year reads the other way, off the same baseline.
    const poor = computePastures([dry], { ...rain, projectedMm: 160, rainFactor: 160 / 270 }, 0.8, null, null)[0]
    const poorNormal = computePastures([dry], { ...rain, rainFactor: 1 }, 0.8, null, null)[0]
    expect(poorNormal.auds).toBeCloseTo(normal.auds, 6)
    expect(poor.auds).toBeLessThan(poorNormal.auds)
  })

  it('reads as it always did when no zone is given, as a past season has none', () => {
    const [p] = computePastures([dry], { forecastMm: 270, projectedMm: null }, 0.8)
    expect(p.foragePerAcre).toBeCloseTo(forageYieldPerAcre(270, 'Fair'), 6)
    expect(p.seasonFactor).toBe(1)
  })
})

describe('the estimator against its source page', () => {
  /*
   * Alberta Forage Manual (2nd ed.) p.205, Table 36. Every cell is printed
   * twice there, kg/ha then lb/ac in brackets, and the model wants lb/ac. Good
   * irrigated grass had the kg/ha figure (5,150) sitting in the lb/ac slot,
   * which overstated it by 12 % — so the whole row is pinned here against the
   * page, and so is the top dryland row, to catch the same slip next time.
   */
  it('takes the Irrigation row from the lb/ac column, not kg/ha', () => {
    expect(FORAGE_YIELD_IRRIGATION).toEqual({ Excellent: 6900, Good: 4600, Fair: 3500, Poor: 2300 })
  })

  it('takes the dryland rows from the lb/ac column too', () => {
    // 550–650 mm, read at the row's middle: 3,360 (3,000) kg/ha (lb/ac) etc.
    expect(forageYieldPerAcre(600, 'Excellent')).toBe(3000)
    expect(forageYieldPerAcre(600, 'Good')).toBe(2000)
    expect(forageYieldPerAcre(600, 'Fair')).toBe(1500)
    expect(forageYieldPerAcre(600, 'Poor')).toBe(1000)
  })

  it('still grows more on good dry grass than on poor wet grass', () => {
    // The point of the rows being rainfall and the columns being quality: a
    // wet year cannot promote a pasture past what its own grass can do.
    expect(forageYieldPerAcre(300, 'Good')).toBeGreaterThan(forageYieldPerAcre(600, 'Poor') / 3)
    expect(forageYieldPerAcre(300, 'Fair')).toBeGreaterThan(forageYieldPerAcre(300, 'Poor'))
  })
})

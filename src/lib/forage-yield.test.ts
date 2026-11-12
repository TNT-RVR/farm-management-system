import { describe, expect, it } from 'vitest'
import {
  audsFromLb,
  computePasture,
  computePastures,
  forageYieldPerAcre,
  FORAGE_YIELD_IRRIGATION,
  precipZoneEdges,
  precipZones,
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
  const rain = { forecastMm: 270, projectedMm: 379 }

  it('costs a measured paddock on the normal rain, so a wet year is not counted twice', () => {
    const [p] = computePastures([wet], rain, 0.8, null, new Map([['wet', 1.16]]))
    // The normal season times the measured growth, NOT 379 mm times 1.16.
    expect(p.foragePerAcre).toBeCloseTo(forageYieldPerAcre(270, 'Fair') * 1.16, 6)
    expect(p.foragePerAcre).toBeLessThan(forageYieldPerAcre(379, 'Fair') * 1.16)
  })

  it('costs an unmeasured paddock on this year’s projected rain', () => {
    const [p] = computePastures([dry], rain, 0.8, null, new Map([['wet', 1.16]]))
    expect(p.foragePerAcre).toBeCloseTo(forageYieldPerAcre(379, 'Fair'), 6)
    expect(p.seasonFactor).toBe(1)
  })

  it('falls back to rainfall throughout when nothing is measured', () => {
    const out = computePastures([dry, wet], rain, 0.8, null, null)
    for (const p of out) expect(p.foragePerAcre).toBeCloseTo(forageYieldPerAcre(379, 'Fair'), 6)
  })

  it('uses the forecast when there is no projection, as a past season has none', () => {
    const [p] = computePastures([dry], { forecastMm: 270, projectedMm: null }, 0.8)
    expect(p.foragePerAcre).toBeCloseTo(forageYieldPerAcre(270, 'Fair'), 6)
  })
})

describe('precipZones', () => {
  it('reads the bands off the estimator, so the chart cannot drift from the table', () => {
    expect(precipZones(400).map((z) => z.label)).toEqual(['under 250 mm', '250–350 mm', '350–450 mm'])
    expect(precipZoneEdges()).toEqual([250, 350, 450, 550, 650])
  })

  it('marks the band under the table as not being one', () => {
    const [lowest] = precipZones(400)
    expect(lowest).toMatchObject({ lo: 0, hi: 250, inTable: false })
    // Every band the estimator actually has yields for is flagged.
    expect(precipZones(700).filter((z) => z.inTable).map((z) => z.lo)).toEqual([250, 350, 450, 550])
  })

  it('leaves the band above the table open-ended', () => {
    const top = precipZones(900).at(-1)!
    expect(top).toMatchObject({ lo: 650, hi: null, inTable: false })
  })

  it('shows only the bands a season could reach', () => {
    // A 300 mm year needs no 550 mm band drawn above it.
    expect(precipZones(350).some((z) => z.lo >= 350)).toBe(false)
  })

  it('never names a band after a grass quality', () => {
    const names = precipZones(900).map((z) => z.label).join(' ')
    for (const q of ['Poor', 'Fair', 'Good', 'Excellent']) expect(names).not.toContain(q)
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

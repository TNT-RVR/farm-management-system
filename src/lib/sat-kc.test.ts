import { describe, expect, it } from 'vitest'
import {
  fcoverFromNdvi,
  kcbFromFcover,
  NDVI_BARE,
  NDVI_FULL_COVER,
} from '../../netlify/shared/sat-kc'

/*
 * The scale is written down twice: here in TypeScript, where the irrigation
 * schedule reads it, and again in SQL as `sat_fcover`, where the pasture grass
 * rating reads it (migration 20261110110000). One function cannot serve both —
 * a Netlify function and a Postgres view do not share code — so the next best
 * thing is a test that fails loudly if the two drift apart.
 *
 * These are not arbitrary numbers to pin. The anchors decide what a pixel
 * MEANS: move NDVI_BARE and the same paddock reads as more or less grass,
 * which changes its rating against the rest of the ranch and therefore the
 * pounds per acre the Alberta table pays it. If you have a better bare-soil
 * figure for these chocolate-brown soils, change it in both places and update
 * the expectations below in the same commit.
 */
describe('the NDVI-to-cover scale', () => {
  it('still reads bare at 0.15 and a closed canopy at 0.90', () => {
    expect(NDVI_BARE).toBe(0.15)
    expect(NDVI_FULL_COVER).toBe(0.9)
  })

  it('matches sat_fcover in SQL at the points the rating turns on', () => {
    // Read back off the database, not worked out on paper:
    //   select sat_fcover(0.48), sat_fcover(0.38), sat_fcover(0.557)
    //       -> 0.1936, 0.0940, 0.2945
    // The ranch middle, a Poor paddock and a Good one, from the 2024-26 record.
    expect(fcoverFromNdvi(0.48)).toBe(0.1936)
    expect(fcoverFromNdvi(0.38)).toBe(0.094)
    expect(fcoverFromNdvi(0.557)).toBe(0.2945)
  })

  it('is squared, not linear, which is the whole reason the rating uses it', () => {
    // Half way up the scale carries a quarter of the cover. In NDVI space this
    // ranch's real 2:1 spread between paddocks read as 1.2:1 and every paddock
    // came out Fair.
    expect(fcoverFromNdvi((NDVI_BARE + NDVI_FULL_COVER) / 2)).toBeCloseTo(0.25, 4)
  })

  it('clamps outside the anchors and passes nothing through for nothing', () => {
    expect(fcoverFromNdvi(0.1)).toBe(0)
    expect(fcoverFromNdvi(-0.4)).toBe(0)
    expect(fcoverFromNdvi(0.95)).toBe(1)
    expect(fcoverFromNdvi(null)).toBeNull()
    expect(fcoverFromNdvi(Number.NaN)).toBeNull()
  })

  it('runs cover through to Kcb without extending it past the FAO ceiling', () => {
    expect(kcbFromFcover(0)).toBe(0.15)
    expect(kcbFromFcover(1)).toBe(1.15)
    expect(kcbFromFcover(null)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  bboxOf,
  inSeason,
  numOrNull,
  scoreQuality,
  shouldRunToday,
  FULL_QUALITY,
  MIN_PLAUSIBLE_SAMPLES,
  PARTIAL_QUALITY,
} from '../../netlify/shared/sat-ingest'

describe('scoreQuality', () => {
  it('calls a mostly-clear look full', () => {
    expect(scoreQuality(0.95)).toBe('full')
    expect(scoreQuality(FULL_QUALITY)).toBe('full')
  })

  it('keeps a partial look rather than discarding it', () => {
    // Good enough for the field mean, not for comparing zones against a
    // baseline that is itself incomplete (spec §4.3).
    expect(scoreQuality(0.75)).toBe('partial')
    expect(scoreQuality(PARTIAL_QUALITY)).toBe('partial')
  })

  it('rejects a look that saw less than 60% of the field', () => {
    // A mean computed from half a field is a number about cloud, not crop.
    // The row is still written, with its score, so season-end can show whether
    // the free stack was enough.
    expect(scoreQuality(0.55)).toBe('rejected')
    expect(scoreQuality(0.1)).toBe('rejected')
    expect(scoreQuality(0)).toBe('rejected')
  })

  it('holds the spec §4.3 thresholds exactly', () => {
    expect(FULL_QUALITY).toBe(0.9)
    expect(PARTIAL_QUALITY).toBe(0.6)
  })
})

describe('bboxOf', () => {
  it('bounds a multipolygon', () => {
    const geom = {
      coordinates: [[[[-112, 49], [-111, 49], [-111, 50], [-112, 50], [-112, 49]]]],
    }
    expect(bboxOf(geom)).toEqual([-112, 49, -111, 50])
  })

  it('gives null for a geometry with no coordinates rather than an infinite box', () => {
    // An infinite bbox would ask the catalog for every scene on Earth.
    expect(bboxOf({ coordinates: [] })).toBeNull()
  })
})

describe('numOrNull', () => {
  it('turns the "NaN" Sentinel Hub sends into null', () => {
    // A fully-clouded look has no mean. Postgres accepts 'NaN' into a numeric
    // column without complaint, and one of them makes every later average NaN.
    expect(numOrNull('NaN')).toBeNull()
    expect(numOrNull(Number.NaN)).toBeNull()
    expect(numOrNull(Infinity)).toBeNull()
    expect(numOrNull(undefined)).toBeNull()
    expect(numOrNull(null)).toBeNull()
  })

  it('keeps real numbers, including zero and negatives', () => {
    // NDMI is routinely negative over dry ground, and 0 is a real NDVI.
    expect(numOrNull(0)).toBe(0)
    expect(numOrNull(-0.127)).toBe(-0.127)
    expect(numOrNull('0.42')).toBe(0.42)
  })
})

describe('the single-pixel guard', () => {
  it('is set below any real field and far above a misconfigured one', () => {
    // The smallest field in the phase 1 set is 46 acres — about 1,900 pixels at
    // 10 m. The bug this guards against returned exactly 1.
    expect(MIN_PLAUSIBLE_SAMPLES).toBeGreaterThan(1)
    expect(MIN_PLAUSIBLE_SAMPLES).toBeLessThan(1_800)
  })
})

describe('the season window', () => {
  const d = (iso: string) => new Date(`${iso}T12:00:00Z`)

  it('runs every day inside 15 April to 31 October', () => {
    expect(shouldRunToday(d('2026-04-15'))).toBe(true)
    expect(shouldRunToday(d('2026-07-02'))).toBe(true)
    expect(shouldRunToday(d('2026-10-31'))).toBe(true)
  })

  it('covers the months the old expression silently dropped', () => {
    // '0 8 15-30 4 *' meant April only: a day-of-month range applies to every
    // month named. May through October went dark and nothing would have said so
    // until the season was over.
    for (const iso of ['2026-05-20', '2026-06-10', '2026-08-14', '2026-09-30']) {
      expect(inSeason(d(iso))).toBe(true)
      expect(shouldRunToday(d(iso))).toBe(true)
    }
  })

  it('excludes the edges by a day', () => {
    expect(inSeason(d('2026-04-14'))).toBe(false)
    expect(inSeason(d('2026-11-01'))).toBe(false)
  })

  it('drops to Mondays off-season rather than stopping', () => {
    // A winter gap in the record is harder to explain later than a few requests.
    expect(shouldRunToday(d('2026-01-05'))).toBe(true) // Monday
    expect(shouldRunToday(d('2026-01-06'))).toBe(false)
  })
})

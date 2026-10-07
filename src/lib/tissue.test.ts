import { describe, expect, it } from 'vitest'
import { NUTRIENTS, cropKey, judge, needsStage, rangesFor, readTissue, shortages, tissueFormOf } from './tissue'

describe('tissueFormOf', () => {
  it('fills the edit form from a saved test, leaving unmeasured nutrients blank', () => {
    const f = tissueFormOf({ id: 'x', field_id: 'f1', crop: 'Corn', n_pct: 3.1, zn_ppm: 0, p_pct: null, notes: null, created_at: '2026-07-01' })
    expect(f).toEqual({ field_id: 'f1', crop: 'Corn', n_pct: '3.1', zn_ppm: '0' })
  })
})

describe('cropKey', () => {
  it('reads the labels the labs and the crop plan actually use', () => {
    expect(cropKey('Corn - Grain')).toBe('corn')
    expect(cropKey('Silage Corn')).toBe('corn')
    expect(cropKey('Wheat - CWRS')).toBe('wheat')
    expect(cropKey('Durum Wheat')).toBe('wheat')
    expect(cropKey('BASF CANOLA')).toBe('canola')
  })

  it('says nothing rather than guessing at a crop it has no bands for', () => {
    expect(cropKey('Pinto Beans')).toBeNull()
    expect(cropKey(null)).toBeNull()
  })
})

describe('rangesFor', () => {
  it('uses the stage it was told', () => {
    const r = rangesFor('Corn - Grain', 'early vegetative (V4–V8)')!
    expect(r.assumed).toBe(false)
    expect(r.ranges.n_pct).toEqual([3.5, 5.0])
  })

  it('will not judge a staged crop until the stage is known', () => {
    // Guessing either band moves money: the lean late band calls a hungry
    // early crop fine, the rich early band calls a healthy late crop short.
    expect(rangesFor('Corn - Grain', null)).toBeNull()
    expect(needsStage('Corn - Grain', null)).toBe(true)
    expect(needsStage('Corn - Grain', 'early vegetative (V4–V8)')).toBe(false)
  })

  it('reads potato petiole nitrate by days after planting', () => {
    const r = rangesFor('Potatoes', '60 days after planting')!
    expect(r.ranges.no3n_ppm).toEqual([13000, 21400])
  })

  it("uses Alberta's early-flower canola N line", () => {
    expect(rangesFor('Canola', 'early flower')!.ranges.n_pct![0]).toBe(2.5)
  })

  it('does not read buckwheat as wheat', () => {
    expect(cropKey('Buckwheat')).toBeNull()
    expect(cropKey('Feed Barley')).toBe('barley')
  })

  it('has nothing to say about a crop it holds no bands for', () => {
    expect(rangesFor('Pinto Beans', null)).toBeNull()
  })
})

describe('judge', () => {
  it('places a reading against its band', () => {
    expect(judge(1, [2, 4])).toBe('low')
    expect(judge(3, [2, 4])).toBe('ok')
    expect(judge(5, [2, 4])).toBe('high')
  })

  it('counts the edges as sufficient', () => {
    expect(judge(2, [2, 4])).toBe('ok')
    expect(judge(4, [2, 4])).toBe('ok')
  })

  it('withholds a verdict with no reading or no band', () => {
    expect(judge(null, [2, 4])).toBe('unknown')
    expect(judge(3, undefined)).toBe('unknown')
  })
})

describe('readTissue', () => {
  // The real 3 July 2026 corn sample off SE 31-70-13.
  const sample = {
    n_pct: 3.5054,
    p_pct: 0.4047,
    k_pct: 2.2392,
    ca_pct: 0.5488,
    mg_pct: 0.21,
    s_pct: 0.2164,
    b_ppm: 6.9195,
    cu_ppm: 2.9958,
    fe_ppm: 132.792,
    mn_ppm: 53.5102,
    zn_ppm: 17.1576,
  }

  it('judges every nutrient on the panel', () => {
    const { readings } = readTissue(sample, 'Corn', 'tasselling / early silk')
    expect(readings).toHaveLength(NUTRIENTS.length - 1) // no petiole nitrate on a corn leaf
    expect(readings.every((r) => r.verdict !== 'unknown')).toBe(true)
  })

  it('finds the zinc short on the real sample', () => {
    // 17.2 ppm against a 20–70 band. This is the finding the test was for.
    const { readings } = readTissue(sample, 'Corn', 'tasselling / early silk')
    const zn = readings.find((r) => r.nutrient.key === 'zn_ppm')!
    expect(zn.verdict).toBe('low')
  })

  it('reads the same sample differently at an earlier stage', () => {
    // Nitrogen at 3.51% is high-normal for an ear leaf and bottom-of-band for a
    // young whole plant. Same number, different meaning — which is the reason
    // the stage is stored at all.
    const late = readTissue(sample, 'Corn', 'tasselling / early silk').readings
    const early = readTissue(sample, 'Corn', 'early vegetative (V4–V8)').readings
    expect(late.find((r) => r.nutrient.key === 'n_pct')!.verdict).toBe('high')
    expect(early.find((r) => r.nutrient.key === 'n_pct')!.verdict).toBe('ok')
    expect(early.find((r) => r.nutrient.key === 'k_pct')!.verdict).toBe('low')
  })

  it('returns unknown verdicts, not zeroes, for a crop with no bands', () => {
    const { readings, ranges } = readTissue(sample, 'Pinto Beans', null)
    expect(ranges).toBeNull()
    expect(readings.every((r) => r.verdict === 'unknown')).toBe(true)
    // The values still come through — a reading without a band is still a
    // reading, and somebody with a book can use it.
    expect(readings.find((r) => r.nutrient.key === 'zn_ppm')!.value).toBeCloseTo(17.1576)
  })

  it('leaves a missing nutrient null rather than reading it as zero', () => {
    const { readings } = readTissue({ n_pct: 3 }, 'Corn', 'tasselling / early silk')
    const zn = readings.find((r) => r.nutrient.key === 'zn_ppm')!
    expect(zn.value).toBeNull()
    expect(zn.verdict).toBe('unknown')
  })
})

describe('shortages', () => {
  it('lists what is short, furthest below its band first', () => {
    const { readings } = readTissue(
      { zn_ppm: 18, cu_ppm: 1, k_pct: 2.0 },
      'Corn',
      'tasselling / early silk',
    )
    const out = shortages(readings)
    // Copper at 1 against a floor of 3 is a third of sufficiency; zinc at 18
    // against 20 is nearly there.
    expect(out[0].nutrient.key).toBe('cu_ppm')
    expect(out.map((r) => r.nutrient.key)).toContain('zn_ppm')
  })

  it('says nothing when everything is in band', () => {
    const { readings } = readTissue({ n_pct: 3, p_pct: 0.3 }, 'Corn', 'tasselling / early silk')
    expect(shortages(readings)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { describeProgress, progressFor, type ProgressField } from './fieldProgress'

const field = (over: Partial<ProgressField> & { name: string; acres: number }): ProgressField => ({
  fieldId: over.name,
  cropName: 'Corn',
  countsForSeeding: true,
  countsForHarvest: true,
  hasSeeding: true,
  hasHarvest: false,
  hasAnyOperation: true,
  ...over,
})

// The real 2026 farm: 21 fields, 2,195 mapped acres. Only the ones that make a
// difference are spelled out; the rest are seeded corn and beans.
const FARM: ProgressField[] = [
  // Perennial alfalfa. Cut every year, drilled once in several, and no 2026
  // operations at all.
  field({
    name: 'Home Alfalfa Field',
    acres: 129.4,
    cropName: 'Alfalfa',
    countsForSeeding: false,
    countsForHarvest: true,
    hasSeeding: false,
    hasAnyOperation: false,
  }),
  // The potatoes. Crop-shared: the partner does the planting AND the harvest,
  // so they are out of both targets. Two of them have no seeding record
  // precisely because no machine of ours ever went over them.
  field({
    name: '3',
    acres: 131.1,
    cropName: 'Potato',
    countsForSeeding: false,
    countsForHarvest: false,
    hasSeeding: false,
    hasAnyOperation: true,
  }),
  field({
    name: '10/Aspen Flat',
    acres: 52.9,
    cropName: 'Potato',
    countsForSeeding: false,
    countsForHarvest: false,
    hasSeeding: false,
    hasAnyOperation: true,
  }),
  field({
    name: '2',
    acres: 128.9,
    cropName: 'Potato',
    countsForSeeding: false,
    countsForHarvest: false,
  }),
  // Harvested so far.
  field({ name: '5/Creek Flat', acres: 155.6, hasHarvest: true }),
  field({ name: '6/Kellers', acres: 122.5, hasHarvest: true }),
  field({ name: 'East Ranch Main', acres: 226.0, hasHarvest: true }),
  // Seeded, not yet off.
  field({ name: '0', acres: 73.8 }),
  field({ name: '1', acres: 133.0 }),
  field({ name: '11/ Coulee', acres: 66.0 }),
  field({ name: '12/ Crown Hill', acres: 121.5 }),
  field({ name: '4', acres: 129.4 }),
  field({ name: '7/65 acres', acres: 54.9 }),
  field({ name: '8/Ray Daltons', acres: 125.8 }),
  field({ name: '9/Maple Flat', acres: 22.0 }),
  field({ name: 'East Ranch South', acres: 88.1 }),
  field({ name: 'Dave Lindgren Jr. Home', acres: 110.3 }),
  field({ name: 'Whitfield SE 12-70-13', acres: 31.4 }),
  field({ name: 'Moreau W 1/2 SE 9-71-14', acres: 64.9 }),
  field({ name: 'Moreaus (NE 12-71-15)', acres: 140.0 }),
  field({ name: 'Novak Main', acres: 87.9 }),
]

describe('seeding progress on the real farm', () => {
  const p = progressFor('seeding', FARM)

  it('leaves out the perennial and the crop-shared potatoes', () => {
    // 2,195 mapped, less 129 of alfalfa and 313 of potatoes.
    expect(Math.round(p.target.acres)).toBe(1753)
    expect(Math.round(p.excluded.acres)).toBe(442)
  })

  it('reads 100% once the ground that is not ours to seed is out', () => {
    // The same farm read 91% while the potatoes were still counted, and the
    // missing 9% was ground a crop-share partner plants.
    expect(Math.round(p.done.acres)).toBe(1753)
    expect(Math.round(p.pct!)).toBe(100)
    expect(p.remaining.acres).toBe(0)
  })

  it('has nothing left in the unrecorded bucket', () => {
    // Both fields that sat there were potatoes: no seeding record because no
    // drill of ours ever went over them.
    expect(p.unrecorded.acres).toBe(0)
  })
})

describe('harvest progress on the real farm', () => {
  const p = progressFor('harvest', FARM)

  it('keeps alfalfa, which we cut, and drops the potatoes, which we do not', () => {
    // The farm less 313 of potatoes. Alfalfa stays: it is not seeded by us but
    // it IS cut by us, which is exactly why the two flags are separate.
    //
    // 1,883 rather than the 1,882 the database returns: these acres are the
    // real ones rounded to a tenth, and twenty-one roundings add up to an acre.
    expect(Math.round(p.target.acres)).toBe(1883)
    expect(Math.round(p.excluded.acres)).toBe(313)
  })

  it('counts the three fields that are off', () => {
    expect(Math.round(p.done.acres)).toBe(504)
    expect(Math.round(p.pct!)).toBe(27)
  })

  // Nothing short of a harvest record implies a harvest, so the optimistic
  // reading must equal the plain one.
  it('never infers a harvest from other operations', () => {
    expect(p.unrecorded.acres).toBe(0)
    expect(p.pctIncludingUnrecorded).toBe(p.pct)
  })
})

describe('summer fallow', () => {
  const fallow = field({
    name: 'Fallow quarter',
    acres: 160,
    cropName: 'Summer Fallow',
    countsForSeeding: false,
    countsForHarvest: false,
    hasSeeding: false,
    hasAnyOperation: true,
  })

  it('is in neither denominator', () => {
    expect(progressFor('seeding', [fallow]).target.acres).toBe(0)
    expect(progressFor('harvest', [fallow]).target.acres).toBe(0)
    expect(progressFor('seeding', [fallow]).excluded.acres).toBe(160)
  })

  it('is not counted as unrecorded work just because it was tilled', () => {
    expect(progressFor('seeding', [fallow]).unrecorded.acres).toBe(0)
  })
})

describe('edge cases', () => {
  it('gives no percentage rather than a wrong one when nothing is targeted', () => {
    const p = progressFor('seeding', [])
    expect(p.pct).toBeNull()
    expect(p.pctIncludingUnrecorded).toBeNull()
  })

  it('drops a field whose acreage is negative or missing rather than counting it', () => {
    // Maple computed to minus 2.4 acres while rented_out_acres was being
    // subtracted from a boundary that already excluded the rented part. A
    // negative acreage is a fault; letting it through shrinks the denominator
    // and flatters the percentage.
    const p = progressFor('seeding', [
      field({ name: 'good', acres: 100 }),
      field({ name: 'negative', acres: -2.4, hasSeeding: false, hasAnyOperation: false }),
      field({ name: 'nan', acres: Number.NaN, hasSeeding: false, hasAnyOperation: false }),
    ])
    expect(p.target.acres).toBe(100)
    expect(p.target.fields).toBe(1)
    expect(p.pct).toBe(100)
  })

  it('reports a field that is genuinely still to do', () => {
    const p = progressFor('seeding', [
      field({ name: 'untouched', acres: 80, hasSeeding: false, hasAnyOperation: false }),
    ])
    expect(p.remaining.acres).toBe(80)
    expect(p.unrecorded.acres).toBe(0)
    expect(p.pct).toBe(0)
  })
})

describe('describeProgress', () => {
  it('reads as acres of acres', () => {
    expect(describeProgress(progressFor('seeding', FARM))).toBe('1,753 of 1,753 ac')
  })
})

// Kept on a synthetic field now that the real farm has none: the bucket exists
// for any crop of ours where Deere loses the seeding record, and the potatoes
// only happened to be the first example.
describe('work done but not recorded', () => {
  it('is counted apart from ground genuinely still to seed', () => {
    const p = progressFor('seeding', [
      field({ name: 'sprayed but no seeding record', acres: 100, hasSeeding: false }),
      field({
        name: 'untouched',
        acres: 50,
        hasSeeding: false,
        hasAnyOperation: false,
      }),
    ])
    expect(p.done.acres).toBe(0)
    expect(p.unrecorded.acres).toBe(100)
    expect(p.remaining.acres).toBe(50)
    expect(p.pct).toBe(0)
    expect(Math.round(p.pctIncludingUnrecorded!)).toBe(67)
  })
})

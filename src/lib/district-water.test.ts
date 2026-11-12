import { describe, expect, it } from 'vitest'
import { districtValues, fedByLabel, readingFor, type DistrictWater } from './district-water'
import { judgeWater } from './livestock-water'

/** The canal as the view actually returns it: no metals, no fluoride. */
const SMRID: DistrictWater = {
  water_source: 'smrid',
  tds_mg_l: 156,
  so4_mg_l: 26,
  no3n_mg_l: 0.01,
  ph: 8.35,
  na_mg_l: 9.1,
  alkalinity_mg_l: 123,
  hardness_mg_l: 130,
  fe_mg_l: null,
  cu_mg_l: null,
  mo_mg_l: null,
  se_mg_l: null,
  f_mg_l: null,
  samples: 232,
  stations: 2,
  station_names: 'SMRID canal, Sherburne (Home Ranch) Reservoir outlet; SMRID North Grassy / North Burdett split',
  latest_sample: '2026-09-15T16:50:00+00:00',
}

const OLDMAN: DistrictWater = { ...SMRID, water_source: 'oldman', tds_mg_l: 200, so4_mg_l: 48, fe_mg_l: 0.119, f_mg_l: 0.14, latest_sample: '2025-09-17T16:30:00+00:00' }

const DISTRICT = new Map([
  ['smrid' as const, SMRID],
  ['oldman' as const, OLDMAN],
])

describe('districtValues', () => {
  it('leaves out what the station does not measure', () => {
    const v = districtValues(SMRID)
    expect(v.tds_mg_l).toBe(156)
    // A null must be absent, not null: judgeWater counts a present key as a
    // reading, and a nulled one would be judged as zero if it ever coerced.
    expect('fe_mg_l' in v).toBe(false)
    expect('cu_mg_l' in v).toBe(false)
  })

  it('carries nothing but chemistry — no counts, no station names', () => {
    const v = districtValues(OLDMAN)
    expect('samples' in v).toBe(false)
    expect('station_names' in v).toBe(false)
    expect('water_source' in v).toBe(false)
  })
})

describe('readingFor', () => {
  it('reads a pin fed by the canal off the district', () => {
    const r = readingFor({ fedBy: 'smrid', test: null, district: DISTRICT })
    expect(r?.from).toBe('district')
    expect(r?.fedBy).toBe('smrid')
    expect(r?.samples).toBe(232)
    // The date shown is the day of the newest sample behind the median.
    expect(r?.sampledOn).toBe('2026-09-15')
  })

  it('says nothing about a pin that holds its own water', () => {
    expect(readingFor({ fedBy: null, test: null, district: DISTRICT })).toBeNull()
  })

  it('prefers a lab sheet to the district, because the sheet is this water', () => {
    const r = readingFor({ fedBy: 'smrid', test: { tds_mg_l: 4200 }, district: DISTRICT, sampledOn: '2026-07-02' })
    expect(r?.from).toBe('lab')
    expect(r?.values.tds_mg_l).toBe(4200)
    expect(r?.sampledOn).toBe('2026-07-02')
    // The pin is still fed by the canal; only the reading came from elsewhere.
    expect(r?.fedBy).toBe('smrid')
  })

  it('says nothing when the district has no row for that source yet', () => {
    expect(readingFor({ fedBy: 'oldman', test: null, district: new Map() })).toBeNull()
    expect(readingFor({ fedBy: 'oldman', test: null, district: undefined })).toBeNull()
  })
})

describe('the chart run over the district', () => {
  it('grades the canal acceptable but for its pH, which the chart calls poor above 8.0', () => {
    const j = judgeWater(districtValues(SMRID))
    const byKey = new Map(j.findings.map((f) => [f.param.key, f.grade]))
    expect(byKey.get('tds_mg_l')).toBe('acceptable')
    expect(byKey.get('so4_mg_l')).toBe('acceptable')
    expect(byKey.get('na_mg_l')).toBe('acceptable')
    // 8.35 sits in the chart's 8.0-to-10 band, which it calls Poor. That is
    // the publication's own reading of ordinary southern Alberta canal water.
    expect(byKey.get('ph')).toBe('limits')
  })

  it('names what the canal stations never measured rather than passing it', () => {
    const j = judgeWater(districtValues(SMRID))
    expect(j.untested).toContain('Iron')
  })
})

describe('fedByLabel', () => {
  it('names a source and shrugs at nothing', () => {
    expect(fedByLabel('oldman')).toBe('Oldman River')
    expect(fedByLabel('smrid')).toBe('SMRID canal')
    expect(fedByLabel(null)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { effectiveHarvestDate, farmDay, harvestEvidenceByField } from './harvest-date'

describe('effectiveHarvestDate', () => {
  const opts = { plantingDate: '2026-05-23', today: '2026-10-01' }

  it('keeps a date a person typed over everything the machines say', () => {
    expect(effectiveHarvestDate({ typed: '2026-09-20', lastLoadOn: '2026-09-24', jdLastPassOn: '2026-09-23' }, opts)).toEqual({
      date: '2026-09-20',
      source: 'manual',
    })
  })

  it('takes the last-load day before the last Deere pass', () => {
    // 5/Creek Flat 2026: last load weighed 24 Sep, combine last logged 23 Sep.
    expect(effectiveHarvestDate({ typed: null, lastLoadOn: '2026-09-24', jdLastPassOn: '2026-09-23' }, opts)).toEqual({
      date: '2026-09-24',
      source: 'last_load',
    })
  })

  it('falls back to the last Deere harvest pass', () => {
    expect(effectiveHarvestDate({ typed: null, lastLoadOn: null, jdLastPassOn: '2026-09-26' }, opts)).toEqual({
      date: '2026-09-26',
      source: 'john_deere',
    })
  })

  it('passes over machine dates before planting or after today', () => {
    expect(effectiveHarvestDate({ typed: null, lastLoadOn: '2026-11-04', jdLastPassOn: '2026-05-01' }, opts)).toEqual({ date: null, source: null })
    expect(effectiveHarvestDate({ typed: null, lastLoadOn: '2026-11-04', jdLastPassOn: '2026-09-26' }, opts).source).toBe('john_deere')
  })

  it('leaves the date blank with nothing to go on', () => {
    expect(effectiveHarvestDate({ typed: null, lastLoadOn: null, jdLastPassOn: null })).toEqual({ date: null, source: null })
  })
})

describe('harvestEvidenceByField', () => {
  it('keeps the latest load and pass per field, on the farm’s day', () => {
    const m = harvestEvidenceByField(
      2026,
      [
        { field_id: 'a', loaded_on: '2026-09-22' },
        { field_id: 'a', loaded_on: '2026-09-24' },
        { field_id: null, loaded_on: '2026-09-25' },
      ],
      [
        // 6/Kellers: two harvest operations; the later end wins.
        { field_id: 'b', crop_season: 2026, started_at: '2026-09-04T17:20:32Z', ended_at: '2026-09-26T14:24:35Z' },
        { field_id: 'b', crop_season: 2026, started_at: '2026-09-24T17:46:29Z', ended_at: '2026-09-24T23:02:41Z' },
        // Ended 01:02 UTC on 1 Oct = 7 pm on 30 Sep in Alberta.
        { field_id: 'c', crop_season: null, started_at: '2026-09-11T20:39:11Z', ended_at: '2026-10-01T01:02:53Z' },
        // Last year's pass.
        { field_id: 'c', crop_season: 2025, started_at: '2025-09-11T20:00:00Z', ended_at: '2025-09-20T20:00:00Z' },
      ],
    )
    expect(m.get('a')).toEqual({ lastLoadOn: '2026-09-24', jdLastPassOn: null })
    expect(m.get('b')).toEqual({ lastLoadOn: null, jdLastPassOn: '2026-09-26' })
    expect(m.get('c')).toEqual({ lastLoadOn: null, jdLastPassOn: '2026-09-30' })
  })

  it('reads a UTC timestamp as the Alberta day', () => {
    expect(farmDay('2026-09-24T03:00:00Z')).toBe('2026-09-23')
  })
})

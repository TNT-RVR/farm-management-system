import { describe, expect, it } from 'vitest'
import {
  lossChecksAsUsed,
  lowestLossInSimilar,
  moistureForCheck,
  similarConditions,
  sortWhatWorked,
  whatWorked,
  type Conditions,
  type LossHistoryRow,
} from './combine-what-worked'
import type { MoistureBands } from './moisture'

// Every field, combine and figure here is made up.
const TZ = 'America/Edmonton'
const check = (over: Partial<LossHistoryRow> & { id: string }): LossHistoryRow => ({
  checked_at: '2027-09-10T20:00:00Z',
  crop_key: 'canola',
  field_id: 'f1',
  equipment_id: 'c1',
  loss_bu_per_acre: 1,
  loss_pct: 2,
  moisture_pct: 9,
  weather: { temp_c: 18, rh: 45, wind_kmh: 12 },
  rotor_rpm: 600,
  fan_rpm: 550,
  ...over,
})
const at = (moisturePct: number | null, rh: number | null): Conditions => ({ moisturePct, rh, tempC: null, windKmh: null })
const bands: MoistureBands = { dry_max: 10, tough_max: 12.5, damp_max: 15, moist_max: null }

describe('similar conditions', () => {
  it('matches the same moisture band and near the same humidity', () => {
    expect(similarConditions(at(9, 45), at(9.8, 55), bands)).toBe(true)
    // RH 16 points apart.
    expect(similarConditions(at(9, 45), at(9, 61), bands)).toBe(false)
  })

  it('does not match across a band edge, however close', () => {
    // 9.9 is dry, 10.2 is tough.
    expect(similarConditions(at(9.9, 45), at(10.2, 45), bands)).toBe(false)
  })

  it('caps the distance inside one band, and uses points without bands', () => {
    const wide: MoistureBands = { dry_max: 20, tough_max: null, damp_max: null, moist_max: null }
    expect(similarConditions(at(10, 45), at(13, 45), wide)).toBe(false)
    expect(similarConditions(at(10, 45), at(11.5, 45), null)).toBe(true)
    expect(similarConditions(at(10, 45), at(11.6, 45), null)).toBe(false)
  })

  it('needs both moisture and humidity known on both', () => {
    expect(similarConditions(at(null, 45), at(9, 45), bands)).toBe(false)
    expect(similarConditions(at(9, null), at(9, 45), bands)).toBe(false)
  })
})

describe('lowest loss in similar conditions', () => {
  const rows = [
    check({ id: 'a', loss_pct: 3.1, rotor_rpm: 650 }),
    check({ id: 'b', loss_pct: 1.2, rotor_rpm: 580, checked_at: '2027-09-11T20:00:00Z' }),
    // Lower still, but taken tough: not similar.
    check({ id: 'c', loss_pct: 0.4, moisture_pct: 11.5 }),
    // Lower, but another crop.
    check({ id: 'd', loss_pct: 0.2, crop_key: 'wheat' }),
    // No settings: nothing to learn from.
    check({ id: 'e', loss_pct: 0.1, rotor_rpm: null, fan_rpm: null }),
  ]

  it('picks the lowest-loss check of the crop with settings in similar conditions, whole', () => {
    const r = lowestLossInSimilar(rows, { cropKey: 'canola', now: at(9.4, 50), bands })
    expect(r?.best.id).toBe('b')
    expect(r?.settings).toEqual({ rotor_rpm: 580, fan_rpm: 550 })
    expect(r?.similar).toBe(2)
  })

  it('says nothing when no check was taken in conditions like these', () => {
    expect(lowestLossInSimilar(rows, { cropKey: 'canola', now: at(14, 80), bands })).toBeNull()
  })
})

describe('what worked table', () => {
  const rows = [
    check({ id: 'a', loss_pct: 3.1, checked_at: '2027-09-12T20:00:00Z' }),
    check({ id: 'b', loss_pct: 1.2, checked_at: '2027-09-11T20:00:00Z', weather: null }),
    check({ id: 'c', loss_pct: null, loss_bu_per_acre: 0.5 }),
  ]

  it('marks the lowest loss and the checks under target, newest first', () => {
    const t = whatWorked(rows, 'canola', 2)
    expect(t.map((r) => r.row.id)).toEqual(['a', 'b', 'c'])
    // Without a yield there is no share of the crop: bushels an acre decide (0.5 < 1).
    expect(t.find((r) => r.best)?.row.id).toBe('c')
    expect(whatWorked(rows.slice(0, 2), 'canola', 2).find((r) => r.best)?.row.id).toBe('b')
    expect(t.filter((r) => r.underTarget).map((r) => r.row.id)).toEqual(['b'])
  })

  it('sorts by any column with blanks last', () => {
    const t = whatWorked(rows, 'canola', 2)
    expect(sortWhatWorked(t, 'rh', 'asc').at(-1)?.row.id).toBe('b')
    expect(sortWhatWorked(t, 'rh', 'desc').at(-1)?.row.id).toBe('b')
    expect(sortWhatWorked(t, 'date', 'asc')[0].row.id).toBe('c')
  })
})

describe('a new check', () => {
  it('turns checks with settings into prefill rows on the farm day', () => {
    const u = lossChecksAsUsed([check({ id: 'a', checked_at: '2027-09-11T03:00:00Z' }), check({ id: 'z', rotor_rpm: null, fan_rpm: null })], TZ)
    expect(u).toHaveLength(1)
    // 3 am UTC is the evening before on the farm.
    expect(u[0]).toMatchObject({ id: 'loss:a', used_on: '2027-09-10', rotor_rpm: 600, equipment_id: 'c1' })
  })

  it('takes a test within three hours, else the model for the hour, else a test within a day', () => {
    const t = '2027-09-10T21:00:00Z' // 3 pm on the farm
    const tests = [{ tested_at: '2027-09-10T19:30:00Z', moisture_pct: '9.6' }]
    expect(moistureForCheck(t, tests, [], TZ)).toMatchObject({ pct: 9.6 })
    const hourly = [{ date: '2027-09-10', hour: 15, pct: 8.84 }]
    const far = [{ tested_at: '2027-09-10T15:00:00Z', moisture_pct: 11 }]
    expect(moistureForCheck(t, far, hourly, TZ)).toEqual({ pct: 8.8, from: 'dry-down estimate' })
    expect(moistureForCheck(t, far, [], TZ)).toEqual({ pct: 11, from: 'meter test 6 h before' })
    expect(moistureForCheck(t, [], [], TZ)).toBeNull()
  })
})

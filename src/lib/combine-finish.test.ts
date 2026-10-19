import { describe, expect, it } from 'vitest'
import { OPERATOR_MAX, operatorText, settingsValues, syncSettingsRows } from './combine-finish'
import { finishedDays, finishedFor, workTypeLabel, FIELD_FINISHED } from './field-work'
import { effectiveHarvestDate } from './harvest-date'
import { finishedByField, harvestDates } from './reports/field-season'

// Every field, combine and figure here is made up.
const TZ = 'America/Edmonton'

describe('settings rows on a finish', () => {
  it('keeps the rows of combines still on it, adds the new, removes the rest', () => {
    const r = syncSettingsRows(
      [
        { id: 's1', equipment_id: 'c1' },
        { id: 's2', equipment_id: 'c2' },
      ],
      ['c1', 'c3'],
    )
    expect(r).toEqual({ update: [{ id: 's1', equipment_id: 'c1' }], insert: ['c3'], remove: ['s2'] })
  })

  it('writes one row with no combine when none is named', () => {
    expect(syncSettingsRows([], [])).toEqual({ update: [], insert: [null], remove: [] })
    expect(syncSettingsRows([{ id: 's1', equipment_id: null }], ['c1'])).toEqual({ update: [], insert: ['c1'], remove: ['s1'] })
  })

  it('stores nothing when no setting was entered', () => {
    expect(settingsValues({ rotor_rpm: null })).toBeNull()
    expect(settingsValues({ rotor_rpm: 600, fan_rpm: Number.NaN })).toMatchObject({ rotor_rpm: 600, fan_rpm: null })
  })

  it('joins the operators and cuts them to the column', () => {
    expect(operatorText([' Sam ', '', 'A custom operator'])).toBe('Sam, A custom operator')
    expect(operatorText([])).toBeNull()
    expect(operatorText(['x'.repeat(100)])!.length).toBe(OPERATOR_MAX)
  })
})

describe('field finished as the harvest date', () => {
  const recs = [
    { field_id: 'f1', zone_id: null, crop_year: 2027, started_at: '2027-09-08T15:00:00Z', finished_at: '2027-09-10T03:00:00Z', field_finished: true },
    { field_id: 'f2', zone_id: 'z1', crop_year: 2027, started_at: null, finished_at: '2027-09-12T20:00:00Z', field_finished: true },
    // A harvest by hand that is not a finish, and last year's finish.
    { field_id: 'f3', zone_id: null, crop_year: 2027, started_at: null, finished_at: '2027-09-12T20:00:00Z', field_finished: false },
    { field_id: 'f1', zone_id: null, crop_year: 2026, started_at: null, finished_at: '2026-09-30T20:00:00Z', field_finished: true },
  ]
  const days = finishedDays(recs, 2027, TZ)

  it('files each finish under its field and crop area, as the farm day', () => {
    // 3 am UTC on the 10th is the evening of the 9th on the farm.
    expect(finishedFor(days, 'f1', null)).toEqual({ finished: '2027-09-09', started: '2027-09-08' })
    expect(finishedFor(days, 'f2', 'z1')?.finished).toBe('2027-09-12')
    // One area done is not the whole field done.
    expect(finishedFor(days, 'f2', null)).toBeNull()
    expect(finishedFor(days, 'f3', null)).toBeNull()
    // An area with no finish of its own takes the whole field's.
    expect(finishedFor(days, 'f1', 'z9')?.finished).toBe('2027-09-09')
  })

  it('comes before every other source', () => {
    expect(effectiveHarvestDate({ finishedOn: '2027-09-09', typed: '2027-09-20', lastLoadOn: '2027-09-11', jdLastPassOn: '2027-09-12' })).toEqual({
      date: '2027-09-09',
      source: 'finished',
    })
  })

  it('gives the field season report its start and finish', () => {
    const began = harvestDates([{ field_id: 'f1', zone_id: null, planting_date: null, planting_date_source: null, harvest_date: '2027-09-05' }], [], [], [], days)
    expect(began.get('f1')).toEqual({ date: '2027-09-08', from: 'Field finished record' })
    const done = finishedByField(days)
    expect(done.get('f1')?.date).toBe('2027-09-09')
    expect(done.get('f2')).toEqual({ date: '2027-09-12', from: 'Field finished record (crop area)' })
  })

  it('reads as "Field finished" in the work list', () => {
    expect(workTypeLabel({ work_type: FIELD_FINISHED, work_type_other: null })).toBe('Field finished')
  })
})

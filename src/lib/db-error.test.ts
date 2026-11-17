import { describe, expect, it } from 'vitest'
import { dbErrorMessage } from './db-error'

describe('dbErrorMessage', () => {
  it('never shows [object Object] for a supabase error', () => {
    // supabase-js rejects with a plain object, not an Error: this is the bug.
    const e = { message: 'new row for relation "field_hail_events" violates check constraint "field_hail_events_loss_pct_check"', details: null, hint: null, code: '23514' }
    expect(String(e)).toBe('[object Object]')
    expect(dbErrorMessage(e)).toBe('Hail loss has to be between 0 and 100%.')
  })

  it('reads the rule out of the constraint name', () => {
    const check = (constraint: string) => dbErrorMessage({ message: `violates check constraint "${constraint}"`, code: '23514' })
    expect(check('crops_test_weight_check')).toBe('Test weight has to be between 0 and 200 lb/bu.')
    expect(check('crops_days_to_maturity_check')).toBe('Days to maturity has to be between 1 and 400.')
    expect(check('crop_plans_planned_acres_check')).toBe('Planned acres cannot be negative.')
    expect(check('land_leases_term_order_check')).toBe("The lease's end date has to be on or after its start date.")
  })

  it('falls back to the class of error when the constraint is unknown', () => {
    expect(dbErrorMessage({ message: 'violates check constraint "crops_something_new_check"', code: '23514' })).toBe('That value is outside what this field allows.')
    expect(dbErrorMessage({ message: 'permission denied', code: '42501' })).toBe("You don't have permission to change that.")
  })

  it('keeps the database detail on a duplicate', () => {
    expect(dbErrorMessage({ message: 'duplicate key value', details: 'Key (name)=(Creek Flat) already exists.', code: '23505' })).toBe('That one already exists. (Key (name)=(Creek Flat) already exists.)')
  })

  it('still handles a thrown Error and a thrown string', () => {
    expect(dbErrorMessage(new Error('the network went away'))).toBe('the network went away')
    expect(dbErrorMessage('plain words')).toBe('plain words')
  })

  it('apologises rather than printing punctuation when it cannot read the error', () => {
    expect(dbErrorMessage(null)).toBe('That could not be saved.')
    expect(dbErrorMessage({})).toBe('That could not be saved.')
    expect(dbErrorMessage(undefined, 'That upload failed.')).toBe('That upload failed.')
  })
})

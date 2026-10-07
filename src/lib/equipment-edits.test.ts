import { describe, expect, it } from 'vitest'
import { editableEquipmentColumns, latestForPlan, manualEquipmentPatch, newManualJdId } from './equipment-edits'

describe('editableEquipmentColumns', () => {
  it('keeps the synced columns off a Deere machine', () => {
    const cols = editableEquipmentColumns(false)
    expect(cols).toContain('notes')
    expect(cols).not.toContain('name')
    expect(cols).not.toContain('serial_number')
    expect(cols).not.toContain('archived')
  })
  it('opens everything on a hand-added one', () => {
    expect(editableEquipmentColumns(true)).toEqual(expect.arrayContaining(['name', 'make', 'model', 'serial_number', 'category', 'notes', 'archived']))
  })
})

describe('newManualJdId', () => {
  it('is never one of Deere’s ids', () => {
    expect(newManualJdId('abc')).toBe('manual:abc')
    expect(newManualJdId()).toMatch(/^manual:[0-9a-f-]{36}$/)
  })
})

describe('manualEquipmentPatch', () => {
  const now = new Date('2026-10-07T15:00:00Z')
  it('dates a changed hour reading and turns archived into a boolean', () => {
    expect(manualEquipmentPatch({ engine_hours: 100 }, { name: 'Shop tractor', engine_hours: 120, archived: 'true', jd_id: 'x' }, now)).toEqual({
      name: 'Shop tractor',
      engine_hours: 120,
      engine_hours_at: now.toISOString(),
      archived: true,
    })
  })
  it('leaves an unchanged reading and its date alone', () => {
    expect(manualEquipmentPatch({ engine_hours: 100 }, { engine_hours: 100, archived: 'false' }, now)).toEqual({ archived: false })
  })
  it('clears the date with the reading', () => {
    expect(manualEquipmentPatch({ engine_hours: 100 }, { engine_hours: null }, now)).toEqual({ engine_hours: null, engine_hours_at: null })
  })
})

describe('latestForPlan', () => {
  const logs = [
    { id: '1', plan_id: 'p', done_on: '2026-05-01', engine_hours: 100, created_at: '2026-05-01T10:00:00Z' },
    { id: '2', plan_id: 'p', done_on: '2026-08-01', engine_hours: 300, created_at: '2026-08-01T10:00:00Z' },
    { id: '3', plan_id: 'p', done_on: '2026-08-01', engine_hours: 310, created_at: '2026-08-02T10:00:00Z' },
    { id: '4', plan_id: 'q', done_on: '2026-09-01', engine_hours: 400 },
  ]
  it('takes the newest by date, then by when it was written', () => {
    expect(latestForPlan(logs, 'p')).toEqual({ done_on: '2026-08-01', engine_hours: 310 })
  })
  it('is null for a plan with nothing left', () => {
    expect(latestForPlan(logs, 'r')).toBeNull()
  })
})

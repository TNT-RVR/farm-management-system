import { describe, expect, it } from 'vitest'
import { ALL_ITEMS, INSPECTION_SECTIONS, allAnswered, isDue, progress, toFix } from './truck-inspection'
import { inspectionReport } from './reports/truck-inspection-report'
import type { Inspection } from './truck-inspection-data'

describe('the checklist', () => {
  it('every item and section has its own key (answers are kept by key)', () => {
    const keys = ALL_ITEMS.map((i) => i.key)
    expect(new Set(keys).size).toBe(keys.length)
    const sections = INSPECTION_SECTIONS.map((s) => s.key)
    expect(new Set(sections).size).toBe(sections.length)
  })
  it('has no bus or ambulance items', () => {
    expect(ALL_ITEMS.some((i) => /school bus|ambulance|wheelchair|stop arm|patient/i.test(i.text))).toBe(false)
  })
})

describe('progress, the to-do list and sign-off', () => {
  const all = Object.fromEntries(ALL_ITEMS.map((i) => [i.key, 'ok' as const]))
  it('counts what is answered and lists what needs work with its section note', () => {
    const answers = { ...all, battery: 'fix' as const, mud_flap: 'fix' as const, trailer_decal: 'na' as const }
    expect(progress(answers)).toEqual({ done: ALL_ITEMS.length, total: ALL_ITEMS.length })
    expect(allAnswered(answers)).toBe(true)
    expect(toFix(answers, { hood: 'Battery terminals green' })).toEqual([
      { section: 'Under the hood', text: expect.stringContaining('Battery'), note: 'Battery terminals green' },
      { section: 'Driver’s side of the truck', text: expect.stringContaining('Mud flap'), note: null },
    ])
  })
  it('cannot be signed off with an item left', () => {
    expect(allAnswered({ ...all, battery: undefined })).toBe(false)
  })
  it('is due when none was signed off this calendar year', () => {
    expect(isDue(null, 2027)).toBe(true)
    expect(isDue('2026-10-21', 2027)).toBe(true)
    expect(isDue('2027-01-12', 2027)).toBe(false)
  })
})

describe('inspectionReport', () => {
  it('puts what needs doing first, every section after, and the sign-off last', () => {
    const i: Inspection = {
      id: 'i1',
      equipment_id: 't1',
      answers: { radiator: 'ok', battery: 'fix' },
      notes: { hood: 'New battery ordered' },
      started_by: 'u1',
      started_at: '2027-01-11T16:00:00Z',
      updated_at: '2027-01-11T17:00:00Z',
      signed_by: null,
      signed_on: null,
      signed_at: null,
      signer_name: null,
      signature: null,
    }
    const r = inspectionReport(i, { name: 'Teal Kenworth 76-P843', make: null, model: null }, null)
    expect(r.subtitle).toMatch(/^DRAFT/)
    expect(r.sections[0].title).toBe('What needs to be done')
    expect(r.sections[0].rows).toEqual([['', expect.stringContaining('Battery'), 'Under the hood', 'New battery ordered']])
    expect(r.sections[1].note).toBe('Notes: New battery ordered')
    expect(r.sections[1].rows[0][1]).toBe('OK')
    expect(r.sections[1].rows[1][1]).toBe('not checked')
    expect(r.sections.at(-1)!.title).toBe('Signed off')
    expect(r.sections.length).toBe(INSPECTION_SECTIONS.length + 2)
  })
})

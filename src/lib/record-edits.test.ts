import { describe, expect, it } from 'vitest'
import {
  findTransferPartner,
  keepInspectionRef,
  levelsToForm,
  loadIdOf,
  localDate,
  moistureTestPatch,
  movementEditProblem,
  movementSource,
  moveToDate,
  ticketEditPatch,
  watchNeedsRearm,
} from './record-edits'

const move = (o: Partial<Parameters<typeof findTransferPartner>[0]> = {}) => ({
  id: 'm1',
  bin_id: 'b1',
  crop_id: 'corn',
  crop_year: 2026,
  movement_type: 'transfer_out',
  bushels: 1200,
  moved_at: '2026-10-01',
  ticket_number: null,
  notes: 'Moved 1200 bu from #1 to #2',
  created_at: '2026-10-01T15:00:00.000Z',
  ...o,
})

describe('movementSource', () => {
  it('knows a load mirror, a transfer and a hand entry apart', () => {
    expect(movementSource({ ticket_number: 'load:abc', movement_type: 'harvest_in' })).toBe('load')
    expect(movementSource({ ticket_number: null, movement_type: 'transfer_in' })).toBe('transfer')
    expect(movementSource({ ticket_number: '1001', movement_type: 'delivery_out' })).toBe('hand')
    expect(movementSource({ ticket_number: null, movement_type: 'adjustment' })).toBe('hand')
  })
  it('reads the load id off the mirror', () => {
    expect(loadIdOf({ ticket_number: 'load:abc-1' })).toBe('abc-1')
    expect(loadIdOf({ ticket_number: '1001' })).toBeNull()
  })
})

describe('findTransferPartner', () => {
  it('finds the other half of a move', () => {
    const out = move()
    const into = move({ id: 'm2', bin_id: 'b2', movement_type: 'transfer_in', created_at: '2026-10-01T15:00:00.400Z' })
    expect(findTransferPartner(out, [out, into])?.id).toBe('m2')
    expect(findTransferPartner(into, [out, into])?.id).toBe('m1')
  })
  it('ignores a different amount, bin, day or a move made later', () => {
    const out = move()
    const cands = [
      move({ id: 'a', bin_id: 'b2', movement_type: 'transfer_in', bushels: 1100 }),
      move({ id: 'b', bin_id: 'b1', movement_type: 'transfer_in' }),
      move({ id: 'c', bin_id: 'b2', movement_type: 'transfer_in', moved_at: '2026-10-02' }),
      move({ id: 'd', bin_id: 'b2', movement_type: 'transfer_in', created_at: '2026-10-01T16:00:00.000Z' }),
    ]
    expect(findTransferPartner(out, cands)).toBeNull()
  })
  it('takes the nearest in time when two match', () => {
    const out = move()
    const far = move({ id: 'far', bin_id: 'b2', movement_type: 'transfer_in', created_at: '2026-10-01T15:00:30.000Z' })
    const near = move({ id: 'near', bin_id: 'b3', movement_type: 'transfer_in', created_at: '2026-10-01T15:00:01.000Z' })
    expect(findTransferPartner(out, [far, near])?.id).toBe('near')
  })
  it('has no partner for a hand entry', () => {
    expect(findTransferPartner(move({ movement_type: 'harvest_in' }), [move({ id: 'x', movement_type: 'transfer_in', bin_id: 'b2' })])).toBeNull()
  })
})

describe('movementEditProblem', () => {
  it('wants a date and an amount', () => {
    expect(movementEditProblem({ movement_type: 'harvest_in', bushels: 100, moved_at: null })).toMatch(/date/)
    expect(movementEditProblem({ movement_type: 'harvest_in', bushels: null, moved_at: '2026-10-01' })).toMatch(/amount/)
  })
  it('lets only an adjustment go negative', () => {
    expect(movementEditProblem({ movement_type: 'adjustment', bushels: -40, moved_at: '2026-10-01' })).toBeNull()
    expect(movementEditProblem({ movement_type: 'adjustment', bushels: 0, moved_at: '2026-10-01' })).toMatch(/0 bu/)
    expect(movementEditProblem({ movement_type: 'shrink', bushels: -40, moved_at: '2026-10-01' })).toMatch(/more than 0/)
    expect(movementEditProblem({ movement_type: 'delivery_out', bushels: 900, moved_at: '2026-10-01' })).toBeNull()
  })
})

describe('ticketEditPatch', () => {
  const old = { contract_id: 'k1', crop_id: 'corn', unit: 'bu', gross_lb: 100_000, tare_lb: 40_000, net_lb: 60_000, net_units: 1071.43 }
  const ctx = {
    contracts: [
      { id: 'k1', crop_id: 'corn' },
      { id: 'k2', crop_id: 'beans' },
    ],
    crops: [
      { id: 'corn', name: 'Corn', yield_unit: 'bu' },
      { id: 'beans', name: 'Dry Beans', yield_unit: 'lbs' },
    ],
  }
  it('works the net and the bushels from a corrected gross', () => {
    const p = ticketEditPatch(old, { ...old, gross_lb: 101_120 }, ctx)
    expect(p.net_lb).toBe(61_120)
    expect(p.net_units).toBeCloseTo(61_120 / 56, 2)
  })
  it('keeps a net that was typed', () => {
    const p = ticketEditPatch(old, { ...old, gross_lb: 101_120, net_lb: 60_500 }, ctx)
    expect(p.net_lb).toBe(60_500)
    expect(p.net_units).toBeCloseTo(60_500 / 56, 2)
  })
  it('keeps a contract figure that was typed', () => {
    const p = ticketEditPatch(old, { ...old, net_lb: 60_500, net_units: 1080 }, ctx)
    expect(p.net_units).toBe(1080)
  })
  it('leaves the figures alone when only a note changes', () => {
    const p = ticketEditPatch(old, { ...old, notes: 'wet' } as typeof old & { notes: string }, ctx)
    expect(p.net_units).toBe(1071.43)
    expect(p.net_lb).toBe(60_000)
  })
  it('takes the crop and unit of a new contract', () => {
    const p = ticketEditPatch(old, { ...old, contract_id: 'k2' }, ctx)
    expect(p.crop_id).toBe('beans')
    expect(p.unit).toBe('lbs')
    expect(p.net_units).toBe(60_000)
  })
})

describe('moistureTestPatch', () => {
  const bands = { dry_max: 14.5, tough_max: 17, damp_max: null, moist_max: null }
  const old = { tested_at: '2026-09-20T21:30:00.000Z', crop_id: 'wheat', moisture_pct: 14, grade: 'dry' as const, entered_by_hand: false }
  const bandsFor = (id: string | null) => (id === 'wheat' ? bands : null)

  it('grades a corrected moisture again and marks it typed in', () => {
    const p = moistureTestPatch(old, { moisture_pct: 15.2, tested_on: localDate(old.tested_at) }, bandsFor)
    expect(p.grade).toBe('tough')
    expect(p.entered_by_hand).toBe(true)
    expect(p.tested_at).toBeUndefined()
  })
  it('leaves grade and source alone when only the note changes', () => {
    const p = moistureTestPatch(old, { moisture_pct: 14, note: 'north end' }, bandsFor)
    expect(p.grade).toBeUndefined()
    expect(p.entered_by_hand).toBeUndefined()
    expect(p.note).toBe('north end')
  })
  it('drops the grade for a crop with no bands', () => {
    expect(moistureTestPatch(old, { crop_id: 'hay', moisture_pct: 14 }, bandsFor).grade).toBeNull()
  })
  it('moves the day and keeps the hour', () => {
    const p = moistureTestPatch(old, { tested_on: '2026-09-18', moisture_pct: 14 }, bandsFor)
    expect(localDate(p.tested_at as string)).toBe('2026-09-18')
    expect(new Date(p.tested_at as string).getHours()).toBe(new Date(old.tested_at).getHours())
  })
  it('moveToDate ignores a bad date', () => {
    expect(moveToDate(old.tested_at, 'nope')).toBe(old.tested_at)
  })
})

describe('keepInspectionRef', () => {
  const afsc = 'AFSC inspection 26-01234 — 17% loss on 125 acres, adjuster Smith'
  it('puts the inspection number back when it is edited out', () => {
    expect(keepInspectionRef(afsc, '17% on the north half')).toBe('AFSC inspection 26-01234 — 17% on the north half')
    expect(keepInspectionRef(afsc, '')).toBe('AFSC inspection 26-01234')
  })
  it('leaves a note that still has it, or a hand-entered one', () => {
    expect(keepInspectionRef(afsc, 'Inspection 26-01234, 20% after reassessment')).toBe('Inspection 26-01234, 20% after reassessment')
    expect(keepInspectionRef(null, '  hit on the 12th ')).toBe('hit on the 12th')
    expect(keepInspectionRef('by hand', '')).toBeNull()
  })
})

describe('levelsToForm', () => {
  it('reads humidity readings back as humidity, top first', () => {
    const f = levelsToForm([
      { level: 2, temp_c: 12, rh_pct: 60, moisture_pct: 8.1, moisture_from: 'table' },
      { level: 1, temp_c: 14, rh_pct: 55, moisture_pct: 7.6, moisture_from: 'table', air: true },
    ])
    expect(f.mode).toBe('rh')
    expect(f.rows).toEqual([
      { temp: '14', pct: '55', air: true },
      { temp: '12', pct: '60', air: false },
    ])
  })
  it('reads sensor moisture back as moisture', () => {
    const f = levelsToForm([{ level: 1, temp_c: null, rh_pct: null, moisture_pct: 9.4, moisture_from: 'sensor' }])
    expect(f.mode).toBe('moisture')
    expect(f.rows).toEqual([{ temp: '', pct: '9.4', air: false }])
  })
  it('always gives one row to type in', () => {
    expect(levelsToForm([]).rows).toHaveLength(1)
  })
})

describe('watchNeedsRearm', () => {
  it('re-arms when the line or the direction moves', () => {
    expect(watchNeedsRearm({ threshold: 6, direction: 'above' }, { threshold: 6.5, direction: 'above' })).toBe(true)
    expect(watchNeedsRearm({ threshold: 6, direction: 'above' }, { threshold: 6, direction: 'below' })).toBe(true)
    expect(watchNeedsRearm({ threshold: 6, direction: 'above' }, { threshold: 6, direction: 'above' })).toBe(false)
  })
})

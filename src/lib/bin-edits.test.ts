import { describe, expect, it } from 'vitest'
import { binEdits, type EditNames } from './bin-edits'

const BIN = 'bin-20'
const names: EditNames = {
  field: (id) => ({ f1: 'Moreau W Half SE 9-40-26' })[id] ?? 'a field',
  crop: (id) => ({ c1: 'Corteva Canola' })[id] ?? 'a crop',
  bin: (id) => ({ 'bin-20': '#20', 'bin-21': '#21' })[id] ?? 'a bin',
  site: () => 'Bunge',
  person: (id) => (id === 'u1' ? 'Sam Hansen' : 'the app'),
  movementType: (v) => ({ harvest_in: 'Harvest in', adjustment: 'Adjustment' })[v] ?? v,
  inflow: (v) => v.endsWith('_in'),
}
const load = { bin_id: BIN, field_id: 'f1', loaded_on: '2026-10-19', gross_kg: 39840, tare_kg: 23030, net_kg: 16810, bushels: 741.19 }

describe('binEdits', () => {
  it('tells a corrected load in the farm’s words, once (not its ledger mirror)', () => {
    const rows = [
      { changed_at: '2026-10-20T17:34:23Z', table_name: 'bin_loads', record_id: 'l1', action: 'update', actor_id: 'u1', old_values: load, new_values: { ...load, tare_kg: 21740, net_kg: 18100, bushels: 798.07 } },
      { changed_at: '2026-10-20T17:34:23Z', table_name: 'grain_movements', record_id: 'm1', action: 'update', actor_id: 'u1', old_values: { bin_id: BIN, ticket_number: 'load:l1', bushels: 741.19 }, new_values: { bin_id: BIN, ticket_number: 'load:l1', bushels: 798.07 } },
    ]
    expect(binEdits(rows, BIN, names)).toEqual([
      {
        at: '2026-10-20T17:34:23Z',
        who: 'Sam Hansen',
        what: 'Load from Moreau W Half SE 9-40-26',
        on: '2026-10-19',
        crop: null,
        bushels: 798.07,
        direction: 'in',
        fields: ['empty weight', 'net'],
        changes: ['empty weight 23,030 kg → 21,740 kg', 'net 16,810 kg → 18,100 kg'],
      },
    ])
  })
  it('a load moved to another bin, a deleted load, a hand movement changed', () => {
    const rows = [
      { changed_at: '2026-10-20T10:00:00Z', table_name: 'bin_loads', record_id: 'l2', action: 'update', actor_id: 'u1', old_values: load, new_values: { ...load, bin_id: 'bin-21' } },
      { changed_at: '2026-10-20T11:00:00Z', table_name: 'bin_loads', record_id: 'l3', action: 'delete', actor_id: 'u1', old_values: load, new_values: null },
      { changed_at: '2026-10-20T12:00:00Z', table_name: 'grain_movements', record_id: 'm2', action: 'update', actor_id: null, old_values: { bin_id: BIN, movement_type: 'adjustment', moved_at: '2026-10-01', bushels: 100 }, new_values: { bin_id: BIN, movement_type: 'adjustment', moved_at: '2026-10-01', bushels: 120 } },
    ]
    expect(binEdits(rows, BIN, names).map((e) => `${e.who}: ${e.what} — ${e.changes.join('; ')}`)).toEqual([
      'the app: Adjustment — bushels 100 bu → 120 bu',
      'Sam Hansen: Load from Moreau W Half SE 9-40-26 deleted — net 16,810 kg',
      'Sam Hansen: Load from Moreau W Half SE 9-40-26 moved out of this bin — bin #20 → #21',
    ])
  })
  it('leaves out other bins, additions and saves that changed nothing', () => {
    const rows = [
      { changed_at: '2026-10-20T10:00:00Z', table_name: 'bin_loads', record_id: 'l4', action: 'update', actor_id: 'u1', old_values: { ...load, bin_id: 'bin-21' }, new_values: { ...load, bin_id: 'bin-21', net_kg: 1 } },
      { changed_at: '2026-10-20T10:00:00Z', table_name: 'bin_loads', record_id: 'l5', action: 'insert', actor_id: 'u1', old_values: null, new_values: load },
      { changed_at: '2026-10-20T10:00:00Z', table_name: 'bin_loads', record_id: 'l6', action: 'update', actor_id: 'u1', old_values: load, new_values: { ...load, updated_at: 'x' } },
    ]
    expect(binEdits(rows, BIN, names)).toEqual([])
  })
})

describe('binEdits: photos and split loads', () => {
  it('says a photo was added and where the rest went, in the second bin too', () => {
    const rows = [
      {
        changed_at: '2026-10-20T19:00:00Z',
        table_name: 'bin_loads',
        record_id: 'l9',
        action: 'update',
        actor_id: 'u1',
        old_values: { ...load, full_photo: null, overflow_bin_id: null },
        new_values: { ...load, full_photo: '2026-10/a.jpg', overflow_bin_id: 'bin-21', first_bin_bu: 500 },
      },
    ]
    const want = [
      {
        at: '2026-10-20T19:00:00Z',
        who: 'Sam Hansen',
        what: 'Load from Moreau W Half SE 9-40-26',
        on: '2026-10-19',
        crop: null,
        bushels: 741.19,
        direction: 'in' as const,
        fields: ['rest went into', 'full-weight photo'],
        changes: ['rest went into — → #21', 'full-weight photo added'],
      },
    ]
    expect(binEdits(rows, BIN, names)).toEqual(want)
    expect(binEdits(rows, 'bin-21', names)).toEqual(want)
  })
})

describe('binEdits: what moved', () => {
  it('carries the crop, the bushels and which way, so a row reads without opening it', () => {
    const rows = [
      {
        changed_at: '2026-10-25T18:00:00Z',
        table_name: 'grain_movements',
        record_id: 'm9',
        action: 'update',
        actor_id: null,
        old_values: { bin_id: BIN, movement_type: 'delivery_out', moved_at: '2026-10-24', bushels: 900, crop_id: 'c1' },
        new_values: { bin_id: BIN, movement_type: 'delivery_out', moved_at: '2026-10-24', bushels: 950, crop_id: 'c1' },
      },
    ]
    expect(binEdits(rows, BIN, names)).toEqual([
      {
        at: '2026-10-25T18:00:00Z',
        who: 'the app',
        what: 'delivery_out',
        on: '2026-10-24',
        crop: 'Corteva Canola',
        bushels: 950,
        direction: 'out',
        fields: ['bushels'],
        changes: ['bushels 900 bu → 950 bu'],
      },
    ])
  })
})

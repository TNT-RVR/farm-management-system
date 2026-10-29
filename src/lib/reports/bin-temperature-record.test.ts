import { describe, expect, it } from 'vitest'
import type { MonitorRow } from '@/lib/bin-monitor-data'
import { binTempRecords } from './bin-temperature-record'

const row = (o: Partial<MonitorRow>): MonitorRow =>
  ({
    id: 'r',
    bin_id: 'b1',
    crop_year: 2026,
    crop_id: 'can',
    read_on: '2026-10-05',
    lot_number: null,
    lld: null,
    initials: null,
    levels: [],
    source: 'manual',
    notes: null,
    aeration_on: null,
    created_by: null,
    created_at: '',
    updated_at: '',
    ...o,
  }) as MonitorRow

describe('bin temperature records for the Reports page', () => {
  const names: Record<string, string> = { b1: 'Bin 10', b2: 'Bin 2', b3: 'Main Yard- #4 (Fert)' }
  const records = binTempRecords({
    readings: [
      row({ bin_id: 'b1', read_on: '2026-10-05', lld: 'NE-1-31-15-W4' }),
      row({ bin_id: 'b1', read_on: '2026-10-12', lot_number: 'L9' }),
      row({ bin_id: 'b2', crop_id: null }),
      row({ bin_id: 'b3' }),
    ],
    binName: (id) => names[id],
    cropName: (id) => (id === 'can' ? 'Canola' : null),
    variety: (id) => (id === 'b1' ? 'L340' : null),
    seedBins: [{ bin_id: 'b1', company_bin_id: 'A1', company: 'Nutrien', legal: 'SW-9-38-21-W4', grower: 'G' }],
  })
  it('a record a bin, in bin-number order', () => {
    expect(records.map((r) => r.bin)).toEqual(['Main Yard #4', 'Bin 2', 'Bin 10'])
  })
  it('takes the seed report’s company and bin label, the newest lot, and the land written on the readings', () => {
    expect(records[2]).toMatchObject({ companyBin: 'A1', company: 'Nutrien', crop: 'Canola', variety: 'L340', lot: 'L9', legal: 'NE-1-31-15-W4' })
    expect(records[2].readings).toHaveLength(2)
  })
  it('leaves blanks where nothing is known', () => {
    expect(records[1]).toMatchObject({ companyBin: null, company: null, crop: null, lot: null, legal: null })
  })
})

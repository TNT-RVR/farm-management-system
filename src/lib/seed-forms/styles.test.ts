import { describe, expect, it } from 'vitest'
import type { MonitorRow } from '@/lib/bin-monitor-data'
import type { SeedReport, SeedReportBin } from './data'
import { binTempRecord, formStyleFor, GENERIC_STYLE, type FormStyle } from './styles'

describe('which form a company prints on', () => {
  it('is the generic form for a company with no pages of its own', () => {
    expect(formStyleFor('Nutrien').key).toBe('generic')
    expect(formStyleFor('  ').key).toBe('generic')
    expect(formStyleFor(null).key).toBe('generic')
  })
  it('is the company’s own when there is one, whatever the case', () => {
    const own: FormStyle = { ...GENERIC_STYLE, key: 'acme', companies: ['acme seeds'] }
    expect(formStyleFor(' ACME Seeds ', [own, GENERIC_STYLE]).key).toBe('acme')
    expect(formStyleFor('Other', [own, GENERIC_STYLE]).key).toBe('generic')
  })
})

const row = (o: Partial<MonitorRow>): MonitorRow =>
  ({
    id: 'r',
    bin_id: 'b1',
    crop_year: 2026,
    crop_id: 'can',
    read_on: '2026-10-05',
    lot_number: null,
    lld: null,
    initials: 'TT',
    levels: [{ level: 1, temp_c: 9, rh_pct: null, moisture_pct: 7, moisture_from: 'sensor' }],
    source: 'manual',
    notes: null,
    aeration_on: false,
    created_by: null,
    created_at: '',
    updated_at: '',
    ...o,
  }) as MonitorRow

describe('the generic form’s sensors', () => {
  it('keeps a reading it cannot retype without losing something', () => {
    const s = GENERIC_STYLE.sensors
    expect(s.readOnly(row({}))).toBe(false)
    expect(s.readOnly(row({ source: 'screenshot' }))).toBe(true)
    expect(s.readOnly(row({ levels: [{ level: 1, temp_c: 9, rh_pct: 55, moisture_pct: null, moisture_from: null }] }))).toBe(true)
    expect(s.readOnly(row({ levels: [{ level: 1, temp_c: 30, rh_pct: null, moisture_pct: null, moisture_from: null, air: true }] }))).toBe(true)
  })
  it('follows the cable, top first', () => {
    expect(GENERIC_STYLE.sensors.fixedCount).toBeNull()
    expect(GENERIC_STYLE.sensors.topFirst).toBe(true)
    expect(GENERIC_STYLE.sensors.label(0, 8)).toBe('1 (top)')
    expect(GENERIC_STYLE.sensors.label(7, 8)).toBe('8 (bottom)')
  })
  it('prints the legal land whole', () => {
    expect(GENERIC_STYLE.legal('NE-12-40-27-W4')).toBe('NE-12-40-27-W4')
  })
})

describe('a seed report bin onto the generic record', () => {
  const report = { crop_year: 2026, company: 'Nutrien', legal_land: 'NE-12-40-27-W4', grower_name: 'A Grower' } as SeedReport
  const bin = { bin_id: 'b1', company_bin_id: 'A1', shipped_on: '2026-11-01' } as SeedReportBin
  const input = {
    report,
    bins: [bin],
    binName: () => 'Main Yard- #20 (Fertilizer Bin)',
    fieldName: 'Home',
    signerName: null,
    cropName: (id: string | null) => (id === 'can' ? 'Canola' : null),
    readings: [
      row({ read_on: '2026-10-05', lot_number: 'L1' }),
      row({ read_on: '2026-10-20', lot_number: 'L2' }),
      row({ read_on: '2026-11-09' }), // after it shipped
      row({ read_on: '2025-10-05', crop_year: 2025 }), // last year
      row({ bin_id: 'b2' }), // another bin
    ],
  }
  it('takes the bin’s readings for the year, until it shipped', () => {
    const r = binTempRecord(input, bin)
    expect(r.readings.map((x) => x.date)).toEqual(['2026-10-05', '2026-10-20'])
    expect(r).toMatchObject({ bin: 'Main Yard #20', companyBin: 'A1', crop: 'Canola', lot: 'L2', legal: 'NE-12-40-27-W4', company: 'Nutrien' })
  })
})

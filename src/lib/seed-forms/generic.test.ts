import { describe, expect, it } from 'vitest'
import { tableReportToCsv } from '@/lib/table-report'
import type { Level } from '@/lib/bin-monitor'
import { binTempNote, binTempTable, seedReportTable, sensorCount, type BinTempRecord, type GenericSeedReport } from './generic'

const report: GenericSeedReport = {
  company: 'Nutrien',
  cropYear: 2026,
  fieldName: 'Home Pivot',
  grower: 'A Grower',
  fieldNumber: null,
  legal: 'NE-12-40-27-W4',
  spinCode: 'NT-7',
  gpsAcres: 128.456,
  totalKg: 152340.4,
  method: 'grain_cart',
  certified: true,
  signature: 'data:image/png;base64,AAAA',
  signatureSize: { width: 300, height: 100 },
  signerName: 'A Grower',
  signedOn: '2026-10-20',
  storage: 'other',
  storageOther: 'SW-3-40-27-W4',
  bins: [
    { companyBinId: 'A1', growerBin: 'Main Yard #20', kg: 60000, moisturePct: 7.25, seedTempC: 11, tempCables: true, moistureCables: false, aeration: true, bottom: 'flat' },
    { companyBinId: null, growerBin: '#7', kg: null, moisturePct: null, seedTempC: null, tempCables: false, moistureCables: false, aeration: false, bottom: 'coned' },
  ],
  harvestOn: '2026-10-01',
  weather: 'Sunny, 14 °C, dry',
  acknowledged: false,
}

const metaOf = (r: ReturnType<typeof seedReportTable>) => Object.fromEntries(r.meta)

describe('seed production report', () => {
  it('puts the facts in the panel, with the full legal land', () => {
    const t = seedReportTable(report)
    expect(t.title).toBe('Seed production report')
    expect(metaOf(t)).toMatchObject({
      Company: 'Nutrien',
      'Crop year': '2026',
      Field: 'Home Pivot',
      'Legal land': 'NE-12-40-27-W4',
      'GPS acres': '128.46',
      'Harvest completed': 'October 1, 2026',
      'Weighed on': 'Grain cart scale',
      'Scale certified': 'Yes',
      'Seed stored at': 'Other location: SW-3-40-27-W4',
      'Total seed harvested': '152,340 kg',
      'Company bin labels on the bins': 'No',
      'Company contract or lot code': 'NT-7',
    })
  })
  it('leaves out the company references it was not given', () => {
    expect(metaOf(seedReportTable(report))).not.toHaveProperty('Company field number')
  })
  it('lists the bins with their kit', () => {
    const bins = seedReportTable(report).sections[0]
    expect(bins.rows).toEqual([
      ['A1', 'Main Yard #20', '60,000', '7.3', '11.0', 'Yes', 'No', 'Yes', 'Flat'],
      ['', '#7', '', '', '', 'No', 'No', 'No', 'Coned'],
    ])
  })
  it('signs on a line, picture and all', () => {
    const signed = seedReportTable(report).sections[1]
    expect(signed.rows).toEqual([['', 'A Grower', 'October 20, 2026']])
    expect(signed.cellImages?.[0]).toMatchObject({ row: 0, col: 0, image: { width: 300, height: 100 } })
    const unsigned = seedReportTable({ ...report, signature: null, signerName: null, signedOn: null }).sections[1]
    expect(unsigned.rows).toEqual([['', '', '']])
    expect(unsigned.cellImages).toBeUndefined()
  })
})

const lv = (level: number, temp_c: number | null, o: { m?: number | null; rh?: number; air?: boolean } = {}): Level => ({
  level,
  temp_c,
  rh_pct: o.rh ?? null,
  moisture_pct: o.m ?? null,
  moisture_from: o.m != null ? 'sensor' : null,
  air: o.air,
})

const record = (over: Partial<BinTempRecord> = {}): BinTempRecord => ({
  bin: 'Main Yard #20',
  companyBin: 'A1',
  crop: 'Canola',
  variety: 'L340',
  lot: '77',
  legal: 'NE-12-40-27-W4',
  company: 'Nutrien',
  readings: [
    { date: '2026-10-12', initials: 'TT', levels: [lv(1, 25, { air: true }), lv(2, 10, { m: 7 }), lv(3, 9, { m: 7.2 })], aeration: true, notes: null },
    { date: '2026-10-05', initials: 'JW', levels: [lv(1, 11, { rh: 55 }), lv(2, 10.5, { rh: 60 }), lv(3, 10, { rh: 61 }), lv(4, 9, { rh: 62 })], aeration: null, notes: 'Fan on' },
  ],
  ...over,
})

describe('bin temperature monitoring record', () => {
  it('has as many sensor columns as the longest cable, air left out', () => {
    expect(sensorCount(record().readings)).toBe(4)
    expect(sensorCount([])).toBe(1)
  })
  it('a table a bin, a row a reading, oldest first, top sensor first', () => {
    const t = binTempTable([record()], { cropYear: 2026 })
    const s = t.sections[0]
    expect(s.title).toBe('Main Yard #20 (company bin A1)')
    expect(s.head).toEqual(['Date', 'Read by', '1 (top)', '2', '3', '4 (bottom)', 'Aeration on', 'Notes'])
    expect(s.rows).toEqual([
      ['2026-10-05', 'JW', '11.0°C 55% RH', '10.5°C 60% RH', '10.0°C 61% RH', '9.0°C 62% RH', '', 'Fan on'],
      ['2026-10-12', 'TT', '10.0°C 7.0%', '9.0°C 7.2%', '', '', 'Yes', ''],
    ])
  })
  it('says which way the sensors are numbered', () => {
    const t = binTempTable([record()], { cropYear: 2026, grower: 'A Grower' })
    expect(Object.fromEntries(t.meta)).toMatchObject({ Grower: 'A Grower', 'Crop year': '2026', Bins: 1 })
    expect(String(Object.fromEntries(t.meta)['Sensor numbering'])).toMatch(/1 is the top sensor/)
  })
  it('notes the crop, lot, land and company under the bin', () => {
    expect(binTempNote(record())).toBe('Crop: Canola, L340; Lot: 77; Legal land: NE-12-40-27-W4; Company: Nutrien')
    expect(binTempNote(record({ crop: null, variety: null, lot: null, legal: null, company: null }))).toBe('')
  })
  it('makes a CSV with the same rows', () => {
    const csv = tableReportToCsv(binTempTable([record({ companyBin: null })], { cropYear: 2026 }))
    expect(csv).toContain('Main Yard #20')
    expect(csv).toContain('9.0°C 7.2%')
  })
})

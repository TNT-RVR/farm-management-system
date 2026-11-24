import { describe, expect, it } from 'vitest'
import { accessOf, cropYearOf, optionsLine, storageSafe } from './made-reports'

describe('made reports', () => {
  it('keeps a file name a storage key can hold', () => {
    expect(storageSafe('Handling plan — Home Ranch: east.pdf')).toBe('Handling plan - Home Ranch- east.pdf')
    expect(storageSafe('Drivers’ log 2026.csv')).toBe('Drivers- log 2026.csv')
    expect(storageSafe('')).toBe('report')
  })

  it('reads the choices back as one line', () => {
    expect(optionsLine({ 'Going to': 'BASF', 'Crop year': '2026', Bin: '' }, 'XLSX')).toBe('Going to: BASF · Crop year: 2026 · Excel')
    expect(optionsLine(undefined, 'PDF')).toBe('PDF')
  })

  it('finds the crop year among the choices', () => {
    expect(cropYearOf({ year: '2026' })).toBe(2026)
    expect(cropYearOf({ planYear: '2027' })).toBe(2027)
    expect(cropYearOf({ winter: 'current' })).toBeNull()
    expect(cropYearOf(undefined)).toBeNull()
  })

  it('gives a copy the report’s own access rule', () => {
    expect(accessOf({})).toBe('all')
    expect(accessOf({ managerOnly: true })).toBe('manager')
    expect(accessOf({ financeOnly: true, managerOnly: true })).toBe('finance')
    expect(accessOf({ adminOnly: true })).toBe('admin')
  })
})

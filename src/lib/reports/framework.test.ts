import { describe, expect, it } from 'vitest'
import { dateDefault, fieldLabel, fromExportColumns, pdfValue, reportCsv, reportTable, rowCount, type ReportData } from './framework'

const data = (): ReportData => ({
  title: 'T',
  subtitle: '2026',
  columns: [{ label: 'Field' }, { label: 'Acres', decimals: 1 }, { label: 'Cost', money: true, decimals: 2 }],
  groups: [
    { title: 'North', rows: [['3', 12.345, 1234.5]], totals: ['Total', 12.345, 1234.5] },
    { title: 'South', rows: [['Home, east', 4, -5]] },
  ],
  groupLabel: 'Ranch',
  totals: ['All', 16.345, 1229.5],
  filename: 'f',
})

describe('reportCsv', () => {
  it('is one flat table: the group first, totals rows included, numbers rounded but not grouped', () => {
    expect(reportCsv(data()).split('\r\n')).toEqual([
      '﻿Ranch,Field,Acres,Cost',
      'North,3,12.3,1234.5',
      'North,Total,12.3,1234.5',
      'South,"Home, east",4,-5',
      'All,All,16.3,1229.5',
    ])
  })

  it('adds no group column to a flat list', () => {
    expect(reportCsv({ ...data(), groupLabel: undefined, totals: undefined }).split('\r\n')[0]).toBe('﻿Field,Acres,Cost')
  })
})

describe('reportTable', () => {
  it('makes a table per group, with the grand total as its own last band', () => {
    const t = reportTable(data())
    expect(t.sections.map((s) => s.title)).toEqual(['North', 'South', 'All together'])
    expect(t.sections[0].rows[0]).toEqual(['3', '12.3', '$1,234.50'])
    expect(t.sections[0].foot).toEqual(['Total', '12.3', '$1,234.50'])
    expect(t.sections[1].rows[0][2]).toBe('-$5.00')
    expect(t.sections[2].rows).toEqual([])
    // The name column stays left even when every name is a number.
    expect(t.sections[0].align).toEqual(['left', 'right', 'right'])
  })

  it('puts a one-table report’s totals under it', () => {
    const t = reportTable({ ...data(), groups: [data().groups[1]] })
    expect(t.sections).toHaveLength(1)
    expect(t.sections[0].foot?.[0]).toBe('All')
  })

  it('passes a sectioned report through as it is', () => {
    const s = { title: 'Bin', meta: [], sections: [{ title: 'Loads', head: ['a'], rows: [['1']] }], filename: 'bin' }
    expect(reportTable(s)).toBe(s)
    expect(rowCount(s)).toBe(1)
  })
})

describe('the helpers', () => {
  it('prints numbers for the page', () => {
    expect(pdfValue(1234.5678, undefined)).toBe('1,234.57')
    expect(pdfValue(0.3561, { label: 'Rate', upTo: 3 })).toBe('0.356')
    expect(pdfValue(50, { label: 'Rate', upTo: 3 })).toBe('50')
    expect(pdfValue(Number.NaN, undefined)).toBeNull()
  })

  it('counts a date picker back from today', () => {
    expect(dateDefault({ key: 'from', kind: 'date', label: 'From', daysAgo: 30 }, '2026-10-02')).toBe('2026-09-02')
    expect(dateDefault({ key: 'from', kind: 'date', label: 'From', startOfYear: true }, '2026-10-02')).toBe('2026-01-01')
  })

  it('names a numbered field', () => {
    expect(fieldLabel('3')).toBe('Field 3')
    expect(fieldLabel('5/Creek Flat')).toBe('5/Creek Flat')
  })

  it('adapts a list’s export columns', () => {
    const t = fromExportColumns([{ a: 1 }], [{ key: 'a', label: 'A', value: (r) => r.a }])
    expect(t.columns).toEqual([{ label: 'A' }])
    expect(t.groups[0].rows).toEqual([[1]])
  })
})

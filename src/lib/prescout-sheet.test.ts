import { describe, expect, it } from 'vitest'
import { parsePrescoutRow, sheetDate, sheetParcel, tissueResult, tissueSummary } from './prescout-sheet'

describe('sheetDate', () => {
  it('reads Corteva’s month-first dates', () => {
    expect(sheetDate('6/18/2026')).toBe('2026-06-18')
    expect(sheetDate('5/4/2026')).toBe('2026-05-04')
  })

  it('reads a day-first date, because one column is written that way', () => {
    expect(sheetDate('26/05/2026')).toBe('2026-05-26')
  })

  it('reads a real date cell as the day that was typed', () => {
    // exceljs hands a date cell back as UTC midnight, whatever the time zone.
    expect(sheetDate(new Date(Date.UTC(2026, 4, 26)))).toBe('2026-05-26')
  })

  it('is null for anything it cannot read', () => {
    expect(sheetDate(null)).toBeNull()
    expect(sheetDate('')).toBeNull()
    expect(sheetDate('soon')).toBeNull()
    expect(sheetDate('13/19/2026')).toBeNull()
  })
})

describe('sheetParcel', () => {
  it('leaves a written description alone', () => {
    expect(sheetParcel('SE 16-40-25')).toBe('SE 16-40-25')
    expect(sheetParcel('E1/2 SE 9-40-26')).toBe('E1/2 SE 9-40-26')
  })

  it('turns a parcel Excel ate back into a parcel', () => {
    // "2-12-11" typed with no quarter; Excel stored 11 December 2002, UTC.
    expect(sheetParcel(new Date(Date.UTC(2002, 11, 11)))).toBe('2-12-11')
  })
})

describe('tissueResult', () => {
  it('reports a trait that was found, with the samples', () => {
    expect(tissueResult('75% LL+ | 3/4 Samples', 'LL+')).toBe('75% LL+ (3 of 4)')
  })

  it('says nothing about a trait that was not found', () => {
    expect(tissueResult('0% RR+/TF+ | 0/4 Samples', 'RR+')).toBeNull()
    expect(tissueResult(null, 'RR+')).toBeNull()
  })

  it('joins the traits that were found', () => {
    const row = { AW: '25% RR+/TF+ | 1/4 Samples', AX: '75% LL+ | 3/4 Samples', AY: '0% Gly+ | 0/4 Samples', AZ: '0% Stack | 0/4 Samples' }
    expect(tissueSummary(row)).toBe('25% RR+ (1 of 4), 75% LL+ (3 of 4)')
    expect(tissueSummary({ AW: '0% RR+/TF+ | 0/4 Samples' })).toBeNull()
  })
})

describe('parsePrescoutRow', () => {
  // SE 14-40-26 as Corteva sent it, trimmed to the columns that carry something.
  const row = {
    A: 'Dale Hansen',
    B: 'SE 14-40-26',
    C: 75,
    D: 'Corn',
    E: 'Barley',
    F: 'Durum',
    G: 'Alfalfa',
    H: 'Alfalfa',
    I: 2018,
    J: 'LL',
    K: '5/26/2026',
    L: '2 Leaf',
    M: 10,
    S: 89,
    X: 2.67,
    Y: 'Walked Out. Heavy Kochia and foxtail throughout the field.',
    AA: 'No',
    AO: 9,
    AY: '100% Gly+ | 10/10 Samples',
    BA: '8/11/2026',
    BC: '403-795-5370',
    BD: 'Dean Olsen',
    BJ: true,
    CA: 'Walked',
    CB: 'D',
    CC: 'Tissue test were GLY? Last canola says LL?',
  }

  it('reads the parts the page shows', () => {
    const p = parsePrescoutRow(row)!
    expect(p.parcel).toBe('SE 14-40-26')
    expect(p.acres).toBe(75)
    expect(p.rating).toBe('D')
    expect(p.crop_history).toEqual(['Barley', 'Durum', 'Alfalfa', 'Alfalfa'])
    expect(p.last_canola_year).toBe(2018)
    expect(p.last_canola_tech).toBe('LL')
    expect(p.ps1_on).toBe('2026-05-26')
    expect(p.ps2_required).toBe(false)
    expect(p.vc_per_m2).toBe(2.67)
    expect(p.tissue_on).toBe('2026-08-11')
    expect(p.tissue_summary).toBe('100% Gly+ (10 of 10)')
    expect(p.contact_name).toBe('Dean Olsen')
  })

  it('files each weed count under its walk', () => {
    const p = parsePrescoutRow(row)!
    expect(p.counts.ps1.VC).toEqual({ ic: 10, bc: 89 })
    expect(p.counts.ps1.WO).toEqual({ ic: null, bc: 9 })
    expect(p.counts.ps2.VC).toEqual({ ic: null, bc: null })
  })

  it('keeps every filled cell in raw, so nothing is lost', () => {
    const p = parsePrescoutRow(row)!
    expect(p.raw.CC).toBe('Tissue test were GLY? Last canola says LL?')
    expect(p.raw.BJ).toBe(true)
    expect(p.raw.BB).toBeUndefined()
  })

  it('skips a row with no parcel', () => {
    expect(parsePrescoutRow({ A: 'Dale Hansen' })).toBeNull()
  })
})

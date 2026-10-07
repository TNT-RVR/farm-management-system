import { describe, expect, it } from 'vitest'
import {
  autoMap,
  cropYearOf,
  groupRows,
  guessTarget,
  isTissueRow,
  legalsIn,
  matchField,
  normaliseHeader,
  normaliseLegal,
  parseCsv,
  parseDate,
  parseDepth,
  parseNumber,
  skipReason,
  TEMPLATE_HEADERS,
  templateCsv,
  type FieldLite,
} from './soil-import'

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, CRLF and a BOM', () => {
    const text = '﻿Field,Note,pH\r\n"SE 10-71-13, east","said ""hi""",7.9\r\n\r\nB,,8\r\n'
    expect(parseCsv(text)).toEqual([
      ['Field', 'Note', 'pH'],
      ['SE 10-71-13, east', 'said "hi"', '7.9'],
      ['B', '', '8'],
    ])
  })
  it('keeps a line break inside quotes and reads a last line with no newline', () => {
    expect(parseCsv('a,b\n"x\ny",2')).toEqual([
      ['a', 'b'],
      ['x\ny', '2'],
    ])
  })
})

describe('column names', () => {
  it('ignores case, spacing and the unit in brackets', () => {
    expect(normaliseHeader('NO3-N (ppm)')).toBe(normaliseHeader('no3-n ppm'))
    expect(normaliseHeader('pH (1:2)')).toBe('ph')
    expect(normaliseHeader('CEC meq/100g')).toBe('cec')
  })
  it('maps the reference export and other labs', () => {
    expect(guessTarget('NO3-N ppm')).toBe('no3n_ppm')
    expect(guessTarget('Nitrate-N')).toBe('no3n_ppm')
    expect(guessTarget('NO3-N (ppm)')).toBe('no3n_ppm')
    expect(guessTarget('NO3-N (lb/ac)')).toBe('no3n_lb_ac')
    expect(guessTarget('Olsen P')).toBe('p_bicarb_ppm')
    expect(guessTarget('P (Olsen)')).toBe('p_bicarb_ppm')
    expect(guessTarget('P (Mehlich-3)')).toBe('p_melich3_ppm')
    expect(guessTarget('Potassium')).toBe('k_ppm')
    expect(guessTarget('Sulfate-S')).toBe('so4s_ppm')
    expect(guessTarget('Organic Matter')).toBe('om_pct')
    expect(guessTarget('OM')).toBe('om_pct')
    expect(guessTarget('pH (1:2)')).toBe('ph')
    expect(guessTarget('EC')).toBe('ec_ms_cm')
    expect(guessTarget('Electrical Conductivity')).toBe('ec_ms_cm')
    expect(guessTarget('SS dS/m')).toBe('ec_ms_cm')
    expect(guessTarget('CEC')).toBe('cec_meq')
    expect(guessTarget('BS-K %')).toBe('base_k_pct')
    expect(guessTarget('Event Date')).toBe('date')
    expect(guessTarget('Sample Depth')).toBe('depth')
    expect(guessTarget('Something else')).toBe('ignore')
  })
  it('lets the first of two same columns win', () => {
    expect(autoMap(['K ppm', 'Field', 'Potassium'])).toEqual(['k_ppm', 'label', 'ignore'])
  })
  it('the blank template maps every column', () => {
    const m = autoMap(TEMPLATE_HEADERS)
    expect(m.includes('ignore')).toBe(false)
    expect(templateCsv().startsWith('Field,Sample Date,Depth')).toBe(true)
  })
})

describe('legal land', () => {
  it('reduces the ways a quarter is written to one', () => {
    expect(normaliseLegal('SW 13-71-14 Field 1')).toBe('SW-13-71-14')
    expect(normaliseLegal('#1 SW 13-71-14')).toBe('SW-13-71-14')
    expect(normaliseLegal('SW-13-71-14-W4')).toBe('SW-13-71-14')
    expect(normaliseLegal('#6 SE 10-71-13')).toBe('SE-10-71-13')
    expect(normaliseLegal('Novaks ne 9-70-14')).toBe('NE-9-70-14')
    expect(normaliseLegal('Home quarter')).toBeNull()
  })
  it('finds every quarter in a field description', () => {
    expect(legalsIn('SE 10-71-13; SW 10-71-13 W4M')).toEqual(['SE-10-71-13', 'SW-10-71-13'])
  })
})

describe('dates and crop year', () => {
  it('reads common date shapes', () => {
    expect(parseDate('2025-10-03')).toBe('2025-10-03')
    expect(parseDate('2025/10/3')).toBe('2025-10-03')
    expect(parseDate('10/3/2025')).toBe('2025-10-03')
    expect(parseDate('25/10/2025')).toBe('2025-10-25')
    expect(parseDate('Oct 3, 2025')).toBe('2025-10-03')
    expect(parseDate('2025-02-30')).toBeNull()
    expect(parseDate('')).toBeNull()
  })
  it('counts a fall sample toward the next crop year', () => {
    expect(cropYearOf('2025-10-03')).toBe(2026)
    expect(cropYearOf('2025-07-01')).toBe(2026)
    expect(cropYearOf('2026-04-20')).toBe(2026)
    expect(cropYearOf('2026-06-30')).toBe(2026)
    expect(cropYearOf('nope')).toBeNull()
  })
})

describe('parseDepth', () => {
  it('reads inches', () => {
    expect(parseDepth('0"-6"')).toMatchObject({ top: 0, bottom: 6 })
    expect(parseDepth('6"-24"')).toMatchObject({ top: 6, bottom: 24 })
    expect(parseDepth('0-6 in')).toMatchObject({ top: 0, bottom: 6 })
    expect(parseDepth('6-24')).toMatchObject({ top: 6, bottom: 24 })
  })
  it('converts centimetres', () => {
    expect(parseDepth('0-15 cm')).toMatchObject({ top: 0, bottom: 6 })
    expect(parseDepth('15-60cm')).toMatchObject({ top: 6, bottom: 24 })
    expect(parseDepth('0-15')).toMatchObject({ top: 0, bottom: 6 })
    expect(parseDepth('0-12', 'cm')).toMatchObject({ top: 0, bottom: 5 })
  })
  it('gives up on nonsense', () => {
    expect(parseDepth('topsoil')).toBeNull()
    expect(parseDepth('')).toBeNull()
  })
})

describe('values and tissue', () => {
  it('parses numbers and leaves below-detection empty', () => {
    expect(parseNumber('12.5')).toBe(12.5)
    expect(parseNumber('1,234')).toBe(1234)
    expect(parseNumber('<0.1')).toBeNull()
    expect(parseNumber('n/a')).toBeNull()
    expect(parseNumber('')).toBeNull()
  })
  it('flags anything typed other than soil as tissue', () => {
    expect(isTissueRow('Soil')).toBe(false)
    expect(isTissueRow('soil ')).toBe(false)
    expect(isTissueRow('')).toBe(false)
    expect(isTissueRow('Plant Tissue')).toBe(true)
  })
})

describe('groupRows', () => {
  const csv = [
    'Field,Event Date,Sample Depth,Sample ID,Report,Sample Type,NO3-N ppm,P ppm,K ppm,Crop',
    '#6 SE 10-71-13,2025-10-03,"0""-6""",1A,R1,Soil,12,18,300,Canola',
    '#6 SE 10-71-13,2025-10-03,"6""-24""",1B,R1,Soil,8,,,Canola',
    '#6 SE 10-71-13,2025-10-03,"0""-6""",1A,R1,Soil,13,19,310,Canola',
    'SW 13-71-14,2025-07-20,,,R2,Tissue,2.2,0.3,2.2,Wheat',
    ',2025-10-03,0-6,,,Soil,1,1,1,',
  ].join('\n')
  const [header, ...rows] = parseCsv(csv)
  const out = groupRows(rows, autoMap(header))

  it('makes one report per label and date with every depth in it', () => {
    expect(out.groups).toHaveLength(1)
    const g = out.groups[0]
    expect(g).toMatchObject({ label: '#6 SE 10-71-13', date: '2025-10-03', cropYear: 2026, crop: 'Canola', reportRef: 'R1' })
    expect(g.samples).toHaveLength(3)
    expect(g.samples[0]).toMatchObject({ sample_code: '1A', depth_top_in: 0, depth_bottom_in: 6, values: { no3n_ppm: 12, p_bicarb_ppm: 18, k_ppm: 300 } })
    expect(g.samples[1].values).toEqual({ no3n_ppm: 8 })
  })
  it('keeps sample codes unique within a report', () => {
    const codes = out.groups[0].samples.map((s) => s.sample_code)
    expect(new Set(codes).size).toBe(codes.length)
  })
  it('skips tissue and incomplete rows and counts them', () => {
    expect(out.tissue).toBe(1)
    expect(out.incomplete).toBe(1)
  })
})

describe('matchField', () => {
  const fields: FieldLite[] = [
    { id: 'a', name: 'Home', legal_land_description: 'SE 10-71-13 W4M', active: true },
    { id: 'a-old', name: 'Home old', legal_land_description: 'SE 10-71-13', active: false },
    { id: 'b', name: 'River Flats', legal_land_description: null, active: true },
    { id: 'c', name: 'River', legal_land_description: null, active: true },
    { id: 'd1', name: 'Twin', legal_land_description: 'NW 1-62-3', active: true },
    { id: 'd2', name: 'Twin B', legal_land_description: 'NW 1-62-3', active: true },
    { id: 'x', name: 'N', legal_land_description: null, active: true },
  ]
  it('matches on the quarter first, active field winning', () => {
    expect(matchField('#6 SE 10-71-13', fields)).toEqual({ fieldId: 'a', how: 'legal' })
  })
  it('falls back to the longest whole field name in the label', () => {
    expect(matchField('River Flats north', fields)).toEqual({ fieldId: 'b', how: 'name' })
    expect(matchField('river - east', fields)).toEqual({ fieldId: 'c', how: 'name' })
  })
  it('never guesses: a tie or nothing is no match', () => {
    expect(matchField('NW 1-62-3', fields)).toBeNull()
    expect(matchField('Riverside', fields)).toBeNull()
    expect(matchField('N block', fields)).toBeNull()
  })
})

describe('skipReason', () => {
  const plan = { fieldId: 'a', cropYear: 2026, label: 'L', date: '2025-10-03', sourceFile: 'f.csv' }
  it('skips a re-import of the same file', () => {
    expect(skipReason(plan, [{ field_id: 'a', crop_year: 2026, part_label: 'L', report_date: '2025-10-03', source_file: 'f.csv' }])).toBe('imported')
  })
  it('flags a clash with the unique field / year / label', () => {
    expect(skipReason(plan, [{ field_id: 'a', crop_year: 2026, part_label: 'L', report_date: '2025-09-01', source_file: 'g.csv' }])).toBe('clash')
  })
  it('lets anything else through', () => {
    expect(skipReason(plan, [{ field_id: 'a', crop_year: 2026, part_label: '', report_date: null, source_file: null }])).toBeNull()
    expect(skipReason(plan, [])).toBeNull()
  })
})

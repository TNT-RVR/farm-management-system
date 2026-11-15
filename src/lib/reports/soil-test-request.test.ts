import { describe, expect, it } from 'vitest'
import { cropAndYield, fieldGps, manureText, manureYear, soilTestRow, summaryColumns } from './soil-test-request'
import { lastTestedBefore, requestYearOf } from '@/lib/soil-test-requests'

describe('soil test request', () => {
  it('files a fall list under next year’s crop, the way the results are filed', () => {
    expect(requestYearOf('2026-11-13')).toBe(2027)
    expect(requestYearOf('2026-04-20')).toBe(2026)
  })

  it('reads the newest test before the year asked for', () => {
    const reports = [
      { field_id: 'a', crop_year: 2022 },
      { field_id: 'a', crop_year: 2025 },
      { field_id: 'a', crop_year: 2027 },
      { field_id: 'b', crop_year: 2024 },
    ]
    const last = lastTestedBefore(reports, 2027)
    expect(last.get('a')).toBe(2025)
    expect(last.get('b')).toBe(2024)
    expect(last.has('c')).toBe(false)
  })

  it('puts a fall spread with the crop it feeds', () => {
    expect(manureYear({ applied_on: '2026-11-06', crop_year: 2027 })).toBe(2027)
    expect(manureYear({ applied_on: '2026-04-21', crop_year: 2026 })).toBe(2026)
    expect(manureYear({ applied_on: null, crop_year: 2025 })).toBe(2025)
  })

  it('says so when a spread has no rate', () => {
    const t = manureText({ applied_on: '2026-11-06', source: 'solid_beef', manure_type: 'straw_bedded', rate_tons_per_acre: null, acres: 39.24 })
    expect(t).toContain('solid beef, straw bedded')
    expect(t).toContain('rate not recorded on 39.2 ac')
    expect(manureText({ applied_on: '2026-04-21', source: 'solid_beef', manure_type: null, rate_tons_per_acre: 15.2, acres: null })).toContain('15.2 t/ac')
  })

  it('reads a year’s test as one, across its parts', () => {
    const reports = [
      { id: 'r1', field_id: 'f', crop_year: 2025, report_date: '2024-10-03', lab: 'Lab A' },
      { id: 'r2', field_id: 'f', crop_year: 2025, report_date: '2024-10-01', lab: 'Lab A' },
    ]
    const samples = [
      { report_id: 'r1', sample_code: '1A', depth_top_in: 0, no3n_lb_ac: 20, p_bicarb_ppm: 10, k_ppm: 300, so4s_ppm: 8, ph: 7.8, om_pct: 2.4, ec_ms_cm: 0.5 },
      { report_id: 'r2', sample_code: '2A', depth_top_in: 0, no3n_lb_ac: 30, p_bicarb_ppm: 20, k_ppm: 400, so4s_ppm: 12, ph: 8.0, om_pct: 2.6, ec_ms_cm: 0.7 },
      { report_id: 'other', sample_code: '9A', depth_top_in: 0, no3n_lb_ac: 999, p_bicarb_ppm: 999, k_ppm: 999, so4s_ppm: 999, ph: 5, om_pct: 9, ec_ms_cm: 9 },
    ]
    const row = soilTestRow(2025, reports, samples)
    expect(row[0]).toBe('2025')
    expect(row[2]).toBe('Lab A')
    expect(row[4]).toBe(15) // Olsen P, the two topsoil cores averaged
    expect(row[5]).toBe(350)
    expect(row[7]).toBe(7.9)
    expect(row[8]).toBe(2.5)
  })

  it('names last year’s crop column by its year, after the GPS point', () => {
    const head = summaryColumns(2027)
    expect(head).toEqual(['Field', 'Legal land', 'Acres', 'Water', 'GPS (lat, long)', '2026 crop'])
  })

  it('reads last year’s crop off the plan, falling back to what was harvested', () => {
    const basics = {
      year: 2026,
      areas: [{ fieldId: 'a', cropId: 'c1', crop: 'Durum', variety: null, acres: 120, expectedYield: null }],
      history: [{ field_id: 'b', crop_id: 'c2', yield_per_acre: 55, yield_unit: 'bu' }],
      crops: [
        { id: 'c1', name: 'Durum', yield_unit: 'bu' },
        { id: 'c2', name: 'Canola', yield_unit: 'bu' },
      ],
    } as unknown as Parameters<typeof cropAndYield>[1]
    expect(cropAndYield('a', basics).crop).toBe('Durum')
    expect(cropAndYield('b', basics).crop).toBe('Canola')
    expect(cropAndYield('c', basics).crop).toBeNull()
  })

  it('names the crop of a year that has no yield, the way the rotation sheet left 2023', () => {
    const basics = {
      year: 2023,
      areas: [],
      history: [
        { field_id: 'a', crop_id: 'c2', yield_per_acre: null, yield_unit: null },
        { field_id: 'b', crop_id: 'c1', yield_per_acre: null, yield_unit: null },
        { field_id: 'b', crop_id: 'c2', yield_per_acre: 55, yield_unit: 'bu' },
      ],
      crops: [
        { id: 'c1', name: 'Durum', yield_unit: 'bu' },
        { id: 'c2', name: 'Canola', yield_unit: 'bu' },
      ],
    } as unknown as Parameters<typeof cropAndYield>[1]
    expect(cropAndYield('a', basics)).toEqual({ crop: 'Canola', yield: null })
    // A record that has a yield is still the one to read.
    expect(cropAndYield('b', basics)).toEqual({ crop: 'Canola', yield: '55 bu/ac' })
  })

  it('puts the GPS point at the centre of the field’s largest piece', () => {
    const square = (x: number, y: number, d: number) => [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]]
    expect(fieldGps({ type: 'Polygon', coordinates: square(-113.21, 52.46, 0.01) })).toBe('52.46500, -113.20500')
    // A sliver beside a quarter section: the point stays on the quarter.
    expect(fieldGps({ type: 'MultiPolygon', coordinates: [square(-113.3, 52.4, 0.001), square(-113.21, 52.46, 0.02)] })).toBe('52.47000, -113.20000')
    expect(fieldGps(null)).toBeNull()
  })
})

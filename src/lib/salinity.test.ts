import { describe, expect, it } from 'vitest'
import { fieldSalinity, saltColour, SALT_NO_DATA } from './salinity'

const rep = (field_id: string, crop_year: number) => ({ field_id, crop_year, report_date: `${crop_year}-04-01` })

describe('salinity', () => {
  it('uses the latest report, topsoil only, mean and worst', () => {
    const m = fieldSalinity([
      { ec_ms_cm: 3, base_na_pct: 1, depth_top_in: 0, depth_label: '0-6', soil_test_reports: rep('a', 2024) },
      { ec_ms_cm: 0.4, base_na_pct: 1, depth_top_in: 0, depth_label: '0-6', soil_test_reports: rep('a', 2026) },
      { ec_ms_cm: 1.2, base_na_pct: 3, depth_top_in: null, depth_label: '0" - 6"', soil_test_reports: rep('a', 2026) },
      { ec_ms_cm: 9, base_na_pct: 3, depth_top_in: 6, depth_label: '6-24', soil_test_reports: rep('a', 2026) },
    ])
    const a = m.get('a')!
    expect(a.year).toBe(2026)
    expect(a.samples).toBe(2)
    expect(a.ec).toBeCloseTo(0.8)
    expect(a.worst).toBe(1.2)
    expect(a.naPct).toBe(2)
  })
  it('colours by class', () => {
    expect(saltColour(null)).toBe(SALT_NO_DATA)
    expect(saltColour(0.5)).toBe('#16a34a')
    expect(saltColour(5)).toBe('#f97316')
  })
})

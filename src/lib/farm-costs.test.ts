import { describe, expect, it } from 'vitest'
import { breakdownPerAcre, fixedSettingFor, linePerAcre, type FixedSetting } from './farm-costs'

const row = (crop_year: number, per_acre: number): FixedSetting => ({
  id: String(crop_year),
  crop_year,
  mode: 'lump',
  lump_per_acre: per_acre,
  spread_acres: null,
  per_acre,
  note: null,
  updated_by: null,
  updated_at: '2026-10-01',
})

describe('fixedSettingFor', () => {
  const rows = [row(2026, 530), row(2028, 560)]

  it('uses the year’s own setting', () => {
    expect(fixedSettingFor(rows, 2026)).toEqual({ setting: rows[0], carriedFrom: null })
  })

  it('carries the latest earlier setting forward, and says from when', () => {
    expect(fixedSettingFor(rows, 2027)).toEqual({ setting: rows[0], carriedFrom: 2026 })
    expect(fixedSettingFor(rows, 2030)?.setting.per_acre).toBe(560)
  })

  it('has nothing before the first setting', () => {
    expect(fixedSettingFor(rows, 2025)).toBeNull()
  })
})

describe('the breakdown', () => {
  it('takes a $/ac as entered and divides a farm total by the acres it is spread over', () => {
    expect(linePerAcre({ basis: 'per_acre', amount: 210 }, 2878)).toBe(210)
    expect(linePerAcre({ basis: 'farm_total', amount: 287800 }, 2878)).toBe(100)
  })

  it('cannot spread a farm total over no acres', () => {
    expect(linePerAcre({ basis: 'farm_total', amount: 100000 }, null)).toBeNull()
    expect(linePerAcre({ basis: 'farm_total', amount: 100000 }, 0)).toBeNull()
  })

  it('adds the parts to the cent, leaving blanks out', () => {
    const total = breakdownPerAcre(
      [
        { basis: 'per_acre', amount: 210 },
        { basis: 'farm_total', amount: 400000 },
        { basis: 'farm_total', amount: 150000 },
        { basis: 'per_acre', amount: null },
      ],
      2878,
    )
    expect(total).toBe(Math.round((210 + 550000 / 2878) * 100) / 100)
  })
})

describe('the land share on land rented out (CFO, 6 Oct 2026)', () => {
  // 2026 after the answers: cash only, the management fee off labour and overhead.
  const lines = [
    { category: 'labour' as const, basis: 'farm_total' as const, amount: 611937.43 },
    { category: 'machinery' as const, basis: 'farm_total' as const, amount: 481932.77 },
    { category: 'overhead' as const, basis: 'farm_total' as const, amount: 462316.86 },
    { category: 'land' as const, basis: 'farm_total' as const, amount: 393504.11 },
  ]
  it('spreads only the land part over Hytech\'s 39 ac as well, matching the database', () => {
    expect(breakdownPerAcre(lines, 2458.04, 39)).toBe(790.69)
    expect(linePerAcre(lines[3], 2458.04, 39)).toBeCloseTo(157.59, 2)
    expect(linePerAcre(lines[0], 2458.04, 39)).toBeCloseTo(611937.43 / 2458.04, 6)
  })
  it('is the plain spread with no land rented out', () => {
    expect(breakdownPerAcre(lines, 2458.04)).toBe(Math.round((1949691.17 / 2458.04) * 100) / 100)
  })
})

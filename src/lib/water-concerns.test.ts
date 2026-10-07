import { describe, expect, it } from 'vitest'
import { ANALYTES, ANALYTE_BY_AEPA, ANALYTE_BY_IDWQ } from './water-analytes'
import { GUIDELINES, bandsFor, concernsFrom, fmtWq, overGuidelines, seasonGramsPerHa, testedClear, type SummaryRow } from './water-concerns'

const row = (p: Partial<SummaryRow> & { parameter: string }): SummaryRow => ({
  station_id: 'S1',
  tested: 10,
  detected: 0,
  max_value: null,
  max_at: null,
  irr_max_value: null,
  irr_max_at: null,
  min_dl: null,
  max_dl: null,
  latest_value: null,
  latest_below: null,
  latest_at: null,
  max_season_geomean: null,
  unit: 'µg/L',
  ...p,
})

describe('the catalogue', () => {
  it('has one entry per key and maps both programmes to the same chemical', () => {
    expect(new Set(ANALYTES.map((a) => a.key)).size).toBe(ANALYTES.length)
    expect(ANALYTE_BY_IDWQ.get('Dicm')?.key).toBe('p_dicamba')
    expect(ANALYTE_BY_AEPA.get('DICAMBA (BANVEL)')?.analyte.key).toBe('p_dicamba')
    expect(ANALYTE_BY_AEPA.get('CARBAMATE (EPTC)')?.analyte.key).toBe(ANALYTE_BY_IDWQ.get('EPTC')?.key)
  })
  it('puts metals in µg/L from both units', () => {
    expect(ANALYTE_BY_IDWQ.get('As_')?.idwqScale).toBe(1000)
    expect(ANALYTE_BY_AEPA.get('MERCURY TOTAL')?.scale).toBe(0.001)
  })
  it('every guideline names a chemical the catalogue knows', () => {
    const keys = new Set(ANALYTES.map((a) => a.key))
    for (const g of GUIDELINES) expect(keys.has(g.key), g.key).toBe(true)
  })
})

describe('judging', () => {
  it('never calls a non-detect over', () => {
    const g = GUIDELINES.find((x) => (x.basis ?? 'sample') === 'sample' && x.max != null)
    if (!g) return
    expect(overGuidelines(g.key, g.max! * 10, true)).toEqual([])
    expect(overGuidelines(g.key, g.max! * 10, false).length).toBeGreaterThan(0)
  })
  it('lists a pesticide found with no guideline as found, and counts the rest clear', () => {
    const rows = [
      row({ parameter: 'p_boscalid', detected: 3, max_value: 0.3, max_at: '2025-07-08T16:00:00Z', irr_max_value: 0.3, irr_max_at: '2025-07-08T16:00:00Z' }),
      row({ parameter: 'p_aldrin' }),
    ]
    const c = concernsFrom(rows, () => 'Canal')
    expect(c.map((x) => [x.analyte.key, x.level])).toEqual([['p_boscalid', 'found']])
    expect(testedClear(rows, c)).toBe(1)
  })
  it('judges irrigation guidelines only on irrigation-season samples, livestock all year', () => {
    // 6,950 µg/L iron in a March runoff sample: not irrigation water.
    expect(overGuidelines('m_iron', 6950, false, '2026-03-17T18:00:00Z')).toEqual([])
    expect(overGuidelines('m_iron', 6950, false, '2026-07-17T18:00:00Z').map((g) => g.use)).toEqual(['irrigation'])
    // 5,220 µg/L aluminium in March is still over the livestock guideline.
    expect(overGuidelines('m_aluminium', 5220, false, '2026-03-17T18:00:00Z').map((g) => g.use)).toEqual(['livestock'])
  })
  it('names the crop groups a banded guideline is over and under', () => {
    const g = GUIDELINES.find((x) => x.key === 'p_dicamba' && x.use === 'irrigation')!
    const b = bandsFor(g, 0.05)
    expect(b.over).toHaveLength(1)
    expect(b.under.map((x) => x.max)).toEqual([0.08, 0.8])
  })
  it('works out the dose a season carries', () => {
    // 0.1 µg/L × 300 mm × 10,000 L/ha·mm = 0.3 g/ha
    expect(seasonGramsPerHa(0.1)).toBeCloseTo(0.3)
    expect(fmtWq(0.0056)).toBe('0.0056')
    expect(fmtWq(26)).toBe('26')
  })
})

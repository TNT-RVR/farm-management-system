import { describe, expect, it } from 'vitest'
import { asInches, buildFieldSeason, hasSeasonFacts, type SeasonHistory } from '@/lib/field-season'

const CROPS: Record<string, string> = { c1: 'Beans-Pinto', c2: 'Grain Corn' }
const cropName = (id: string) => CROPS[id] ?? '…'

const base = {
  year: 2026,
  plans: [],
  history: [] as SeasonHistory[],
  estimates: [],
  cropName,
  water: { events: [], balance: null },
}

// 6-Kellers, 2026: the one field of ours that has a real clean-out.
const kellers: SeasonHistory = {
  crop_year: 2026,
  crop_id: 'c1',
  variety: null,
  acres: 122.46,
  yield_unit: 'lbs',
  yield_per_acre: 3562.7,
  actual_yield_total: 436284,
  clean_yield_per_acre: 3403.8,
  clean_total: 416829,
}

describe('buildFieldSeason', () => {
  it('reads the year from the history row, dockage included', () => {
    const s = buildFieldSeason({ ...base, history: [kellers] })
    expect(s.areas).toHaveLength(1)
    const a = s.areas[0]
    expect(a.crop).toBe('Beans-Pinto')
    expect(a.unit).toBe('lbs')
    expect(a.yieldPerAcre).toBe(3562.7)
    expect(a.yieldTotal).toBe(436284)
    expect(a.cleanPerAcre).toBe(3403.8)
    // 1 - 3403.8/3562.7 = 4.46%
    expect(a.dockage).toBeCloseTo(4.46, 2)
  })

  it('leaves dockage null when the field has no clean-out', () => {
    const s = buildFieldSeason({
      ...base,
      history: [{ ...kellers, clean_yield_per_acre: null, clean_total: null }],
    })
    expect(s.areas[0].dockage).toBeNull()
    expect(s.areas[0].yieldPerAcre).toBe(3562.7)
  })

  it('names the planned crop on a field with nothing off it yet', () => {
    const s = buildFieldSeason({
      ...base,
      plans: [{ crop_id: 'c2', variety: 'P7005', planned_acres: 80 }],
    })
    expect(s.areas[0]).toMatchObject({ crop: 'Grain Corn', variety: 'P7005', acres: 80, yieldPerAcre: null })
  })

  it('falls back to the boundary acres when the plan has none', () => {
    const s = buildFieldSeason({
      ...base,
      plans: [{ crop_id: 'c2', variety: null, planned_acres: null }],
      boundaryAcres: 54.9,
    })
    expect(s.areas[0].acres).toBe(54.9)
  })

  // The plan is written first so a standing crop still has a name; it must not
  // then blank the yield the history row carries.
  it('does not let the plan overwrite what actually came off', () => {
    const s = buildFieldSeason({
      ...base,
      plans: [{ crop_id: 'c1', variety: null, planned_acres: 120 }],
      history: [kellers],
    })
    expect(s.areas).toHaveLength(1)
    expect(s.areas[0].yieldPerAcre).toBe(3562.7)
    expect(s.areas[0].acres).toBe(122.46)
  })

  it('ignores other years', () => {
    const s = buildFieldSeason({ ...base, history: [{ ...kellers, crop_year: 2025 }] })
    expect(s.areas).toEqual([])
  })

  it('takes the dates from the harvest estimate', () => {
    const s = buildFieldSeason({
      ...base,
      history: [kellers],
      estimates: [{ cropId: 'c1', seeded: '2026-05-12', harvestedOn: '2026-09-28', harvestedFrom: 'scale' }],
    })
    expect(s.areas[0]).toMatchObject({ seeded: '2026-05-12', harvested: '2026-09-28', harvestedFrom: 'scale' })
  })

  it('lists a split field once per crop, sorted', () => {
    const s = buildFieldSeason({
      ...base,
      history: [{ ...kellers, crop_id: 'c2' }, kellers],
    })
    expect(s.areas.map((a) => a.crop)).toEqual(['Beans-Pinto', 'Grain Corn'])
  })
})

describe('water', () => {
  it('totals the gross depth and counts the days it ran', () => {
    const s = buildFieldSeason({
      ...base,
      water: {
        events: [
          { date: '2026-06-01', gross_mm: 25, net_mm: 20 },
          // Two passes on one day is one day of irrigating.
          { date: '2026-06-01', gross_mm: 25, net_mm: 20 },
          { date: '2026-07-02', gross_mm: 30, net_mm: 24 },
        ],
        balance: { rain_mm: 181.4, stress_days: 3 },
      },
    })
    expect(s.irrigationMm).toBe(80)
    expect(s.irrigationDays).toBe(2)
    expect(s.rainMm).toBe(181.4)
    expect(s.stressDays).toBe(3)
  })

  it('uses the net depth only where no gross was recorded', () => {
    const s = buildFieldSeason({
      ...base,
      water: { events: [{ date: '2026-06-01', gross_mm: null, net_mm: 20 }], balance: null },
    })
    expect(s.irrigationMm).toBe(20)
  })

  // Nought millimetres on a dryland field is a fact; no events at all is not.
  it('says nothing rather than nought when no pass was recorded', () => {
    const s = buildFieldSeason(base)
    expect(s.irrigationMm).toBeNull()
    expect(s.irrigationDays).toBe(0)
    expect(s.rainMm).toBeNull()
  })

  it('keeps a recorded nought', () => {
    const s = buildFieldSeason({
      ...base,
      water: { events: [{ date: '2026-06-01', gross_mm: 0, net_mm: 0 }], balance: null },
    })
    expect(s.irrigationMm).toBe(0)
  })
})

describe('hasSeasonFacts', () => {
  it('is false for a field with nothing to say', () => {
    expect(hasSeasonFacts(buildFieldSeason(base))).toBe(false)
  })

  it('is false for a crop named but nothing done yet', () => {
    const s = buildFieldSeason({ ...base, plans: [{ crop_id: 'c2', variety: null, planned_acres: 80 }] })
    expect(hasSeasonFacts(s)).toBe(false)
  })

  it('is true once something has been seeded, harvested, yielded or watered', () => {
    expect(hasSeasonFacts(buildFieldSeason({ ...base, history: [kellers] }))).toBe(true)
    expect(
      hasSeasonFacts(
        buildFieldSeason({
          ...base,
          water: { events: [{ date: '2026-06-01', gross_mm: 25, net_mm: 20 }], balance: null },
        }),
      ),
    ).toBe(true)
  })
})

describe('asInches', () => {
  it('converts to one decimal, the way a licence is written', () => {
    expect(asInches(254)).toBe(10)
    expect(asInches(310)).toBe(12.2)
    expect(asInches(null)).toBeNull()
  })
})

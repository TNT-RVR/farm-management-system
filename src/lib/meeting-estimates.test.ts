import { describe, expect, it } from 'vitest'
import type { HarvestEstimateRow } from './harvest-estimate-data'
import type { Estimate } from './harvest-estimate'
import type { CropPlanRow, CropRow } from './queries'
import type { YieldRecord } from './forecast'
import { harvestedYields, upcomingHarvests } from './meeting-estimates'

const est = (mature: string, notReached = false) => ({ mature, notReached }) as Estimate
const row = (fieldName: string, over: Partial<HarvestEstimateRow>): HarvestEstimateRow =>
  ({ key: fieldName, fieldId: fieldName, fieldName, zoneId: null, cropId: 'c', cropName: 'Oats', variety: null, harvestedOn: null, harvestedFrom: null, estimate: null, reasons: null, basis: null, missing: null, daysFrom: 'crop', ...over }) as HarvestEstimateRow

describe('upcomingHarvests', () => {
  it('keeps the next two weeks, not yet off, soonest first', () => {
    const rows = [
      row('B', { estimate: est('2030-09-10') }),
      row('A', { estimate: est('2030-09-03') }),
      row('C', { estimate: est('2030-09-20') }), // past the window
      row('D', { estimate: est('2030-08-30') }), // before it
      row('E', { estimate: est('2030-09-05'), harvestedOn: '2030-09-04' }),
      row('F', { estimate: est('2030-09-06', true) }), // heat target not reached
      row('G', { missing: 'days' }),
    ]
    expect(upcomingHarvests(rows, '2030-09-01').map((r) => r.fieldName)).toEqual(['A', 'B'])
    expect(upcomingHarvests(rows, '2030-09-01', 7).map((r) => r.fieldName)).toEqual(['A'])
  })
})

describe('harvestedYields', () => {
  const crop = { id: 'oats', name: 'Oats', yield_unit: 'bu', default_yield_per_acre: 100, goal_yield_per_acre: 120, land_rent_only: false } as unknown as CropRow
  const plan = (field_id: string) => ({ id: `p-${field_id}`, field_id, crop_id: 'oats', crop_year: 2030, goal_yield: null, yield_per_acre_override: null, yield_basis: null }) as unknown as CropPlanRow
  const rec = (field_id: string, crop_year: number, y: number): YieldRecord => ({ field_id, crop_id: 'oats', crop_year, acres: 100, yield_per_acre: y, clean_yield_per_acre: null, yield_unit: 'bu', source: 'scale' })

  it('scores only crops with a harvest, furthest below the estimate first', () => {
    const lines = harvestedYields({
      cropYear: 2030,
      fields: [
        { id: 'f1', name: '1' },
        { id: 'f2', name: '2' },
        { id: 'f3', name: '3' },
      ],
      crops: [crop],
      plans: [plan('f1'), plan('f2'), plan('f3')],
      zones: [],
      history: [rec('f1', 2030, 110), rec('f2', 2030, 80)],
      cuts: [],
      typedBefore: new Map(),
    })
    expect(lines.map((l) => l.fieldId)).toEqual(['f2', 'f1'])
    expect(lines[0].score.vsEstimate?.dir).toBe('below')
    expect(lines[1].score.vsGoal?.dir).toBe('below')
  })

  it('leaves land rented out', () => {
    const lines = harvestedYields({
      cropYear: 2030,
      fields: [{ id: 'f1', name: '1' }],
      crops: [{ ...crop, land_rent_only: true }],
      plans: [plan('f1')],
      zones: [],
      history: [rec('f1', 2030, 110)],
      cuts: [],
      typedBefore: new Map(),
    })
    expect(lines).toEqual([])
  })
})

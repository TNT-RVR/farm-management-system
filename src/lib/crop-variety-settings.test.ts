import { describe, expect, it } from 'vitest'
import {
  applyVarietyToPlanter,
  cropForVariety,
  figuresToStore,
  knownVarieties,
  planVarieties,
  varietyFigures,
  varietyLookup,
  settingsFor,
  varietyOverrides,
  varietySettingFor,
  varietySummary,
  type VarietySettingRow,
} from './crop-variety-settings'
import type { Database } from './database.types'

type Planter = Database['public']['Tables']['crop_planter_profiles']['Row']

const blank: Omit<VarietySettingRow, 'id' | 'crop_id' | 'variety'> = {
  default_yield_per_acre: null,
  days_to_maturity: null,
  test_weight_lb_per_bu: null,
  moisture_dry_min: null,
  moisture_dry_max: null,
  moisture_tough_max: null,
  moisture_damp_max: null,
  moisture_moist_max: null,
  seeds_per_acre_min: null,
  seeds_per_acre_max: null,
  seed_spacing_in: null,
  depth_in_min: null,
  depth_in_max: null,
  row_spacing_in: null,
  planting_speed_mph: null,
  plate_holes: null,
  notes: null,
  updated_at: '',
}
const vrow = (variety: string, over: Partial<VarietySettingRow> = {}, crop_id = 'beans'): VarietySettingRow => ({
  id: `v-${variety}`,
  crop_id,
  variety,
  ...blank,
  ...over,
})

const crop = {
  id: 'beans',
  name: 'Test beans',
  default_yield_per_acre: 30,
  days_to_maturity: 100,
  test_weight_lb_per_bu: 60,
  moisture_dry_min: 14,
  moisture_dry_max: 18,
  moisture_tough_max: 18,
  moisture_damp_max: null,
  moisture_moist_max: null,
}

const planter: Planter = {
  id: 'p1',
  crop_id: 'beans',
  depth_setting: 'C',
  depth_in_min: 1.5,
  depth_in_max: 2,
  singulator: '+2',
  seed_spacing_in: null,
  seeds_per_acre_min: 90000,
  seeds_per_acre_max: 110000,
  planting_speed_mph: 5,
  plate_holes: 60,
  disc_number: 'D-1',
  row_spacing_in: 22,
  passes: 1,
  seeds_per_m2: null,
  notes: null,
  updated_by: null,
  updated_at: '',
}

describe('varietySettingFor', () => {
  const rows = [vrow('First'), vrow('Second Kind'), vrow('First', {}, 'corn')]
  it('matches by crop and name, ignoring case and outer spaces', () => {
    expect(varietySettingFor(rows, 'beans', '  second kind ')?.id).toBe('v-Second Kind')
    expect(varietySettingFor(rows, 'corn', 'FIRST')?.crop_id).toBe('corn')
  })
  it('is null with no variety, no crop, or no match', () => {
    expect(varietySettingFor(rows, 'beans', null)).toBeNull()
    expect(varietySettingFor(rows, 'beans', '  ')).toBeNull()
    expect(varietySettingFor(rows, null, 'First')).toBeNull()
    expect(varietySettingFor(rows, 'beans', 'Third')).toBeNull()
    expect(varietySettingFor(undefined, 'beans', 'First')).toBeNull()
  })
})

describe('settingsFor', () => {
  const rows = [vrow('First', { moisture_dry_max: 16, seeds_per_acre_min: 80000, plate_holes: 48 })]

  it('falls back to the crop for anything the variety leaves blank', () => {
    const s = settingsFor({ crop, planter, variety: 'first', rows })
    expect(s.crop.moisture_dry_max).toBe(16)
    expect(s.crop.moisture_tough_max).toBe(18)
    expect(s.crop.test_weight_lb_per_bu).toBe(60)
    expect(s.crop.name).toBe('Test beans')
    expect(s.planter?.plate_holes).toBe(48)
    expect(s.planter?.row_spacing_in).toBe(22)
    expect(s.planter?.disc_number).toBe('D-1')
    expect(s.overrides).toEqual(['moisture_dry_max', 'seeds_per_acre_min', 'plate_holes'])
  })

  it('is the crop unchanged when the variety has no settings or is unknown', () => {
    for (const variety of [null, 'Other']) {
      const s = settingsFor({ crop, planter, variety, rows })
      expect(s.crop).toBe(crop)
      expect(s.planter).toBe(planter)
      expect(s.variety).toBeNull()
      expect(s.overrides).toEqual([])
    }
  })

  it('does not change the crop row it was given', () => {
    settingsFor({ crop, planter, variety: 'First', rows })
    expect(crop.moisture_dry_max).toBe(18)
    expect(planter.plate_holes).toBe(60)
  })

  it('treats a range as one setting: one end on the variety replaces both', () => {
    const p = settingsFor({ crop, planter, variety: 'First', rows }).planter!
    expect(p.seeds_per_acre_min).toBe(80000)
    expect(p.seeds_per_acre_max).toBeNull()
    // The crop's depth range is untouched, since the variety sets neither end.
    expect([p.depth_in_min, p.depth_in_max]).toEqual([1.5, 2])
  })

  it('gives a variety its own planter sheet when the crop has none', () => {
    const p = applyVarietyToPlanter(null, vrow('First', { plate_holes: 30 }), 'beans')
    expect(p?.crop_id).toBe('beans')
    expect(p?.plate_holes).toBe(30)
    expect(p?.row_spacing_in).toBeNull()
    expect(applyVarietyToPlanter(null, vrow('First', { moisture_dry_max: 15 }), 'beans')).toBeNull()
  })
})

describe('knownVarieties', () => {
  it('joins the crop list with recorded names, one spelling each, sorted', () => {
    const list = [{ crop_id: 'beans', name: 'Second' }, { crop_id: 'corn', name: 'Elsewhere' }]
    const plans = [{ crop_id: 'beans', variety: ' second ' }, { crop_id: 'beans', variety: 'Alpha' }, { crop_id: 'beans', variety: null }]
    expect(knownVarieties('beans', list, plans, undefined)).toEqual(['Alpha', 'Second'])
  })
})

describe('varietySummary', () => {
  it('says only what the variety sets', () => {
    expect(varietySummary(vrow('First'))).toBe('')
    expect(varietyOverrides(vrow('First'))).toEqual([])
    expect(
      varietySummary(vrow('First', { moisture_dry_max: 16, seeds_per_acre_min: 80000, seeds_per_acre_max: 90000, depth_in_min: 2 }), 'bu'),
    ).toBe('dry ≤ 16% · 80,000–90,000 seeds/ac · 2 in deep')
    expect(varietySummary(vrow('First', { default_yield_per_acre: 35 }), 'bu')).toBe('35 bu/ac normal')
  })
})

describe('days to maturity', () => {
  it("is the variety's, else the crop's", () => {
    const rows = [vrow('Early', { days_to_maturity: 85 }), vrow('Plain')]
    expect(settingsFor({ crop, variety: 'early', rows }).days_to_maturity).toBe(85)
    expect(settingsFor({ crop, variety: 'Plain', rows }).days_to_maturity).toBe(100)
    expect(settingsFor({ crop, variety: null, rows }).days_to_maturity).toBe(100)
    expect(settingsFor({ crop: { ...crop, days_to_maturity: null }, variety: 'Plain', rows }).days_to_maturity).toBeNull()
  })
})

describe('cropForVariety / varietyLookup / planVarieties', () => {
  const rows = [vrow('First', { default_yield_per_acre: 40, test_weight_lb_per_bu: 58 })]
  it('lays the variety over the crop, and leaves the crop alone without one', () => {
    expect(cropForVariety(crop, ' FIRST', rows).default_yield_per_acre).toBe(40)
    expect(cropForVariety(crop, ' FIRST', rows).moisture_dry_max).toBe(18)
    expect(cropForVariety(crop, 'Other', rows)).toBe(crop)
  })
  it('finds a row by crop and name in a loop', () => {
    const own = varietyLookup(rows)
    expect(own('beans', 'first')?.id).toBe('v-First')
    expect(own('corn', 'First')).toBeNull()
    expect(own('beans', null)).toBeNull()
  })
  it('reads the variety a field plan names for a crop', () => {
    const of = planVarieties([{ field_id: 'f1', crop_id: 'beans', variety: 'First' }, { field_id: 'f2', crop_id: 'beans', variety: '  ' }])
    expect(of('f1', 'beans')).toBe('First')
    expect(of('f1', 'corn')).toBeNull()
    expect(of('f2', 'beans')).toBeNull()
  })
})

describe("a variety's own figures", () => {
  const base = varietyFigures(crop, planter, null)

  it("starts as the crop's, every one filled in", () => {
    expect(base.default_yield_per_acre).toBe(30)
    expect(base.seeds_per_acre_max).toBe(110000)
    expect(varietyFigures(crop, planter, vrow('First', { moisture_dry_max: 16 })).moisture_dry_max).toBe(16)
  })

  it("stores only what was changed from the crop's", () => {
    const typed = { ...base, moisture_dry_max: 16 }
    const out = figuresToStore(base, null, typed)
    expect(out.moisture_dry_max).toBe(16)
    expect(out.default_yield_per_acre).toBeNull()
    expect(out.plate_holes).toBeNull()
  })

  it("keeps a figure that was already the variety's own, even at the crop's value", () => {
    const before = vrow('First', { default_yield_per_acre: 30 })
    expect(figuresToStore(base, before, base).default_yield_per_acre).toBe(30)
  })

  it("an emptied box goes back to the crop's", () => {
    const before = vrow('First', { default_yield_per_acre: 42 })
    expect(figuresToStore(base, before, { ...base, default_yield_per_acre: null }).default_yield_per_acre).toBeNull()
  })

  it('a range changed at one end keeps both ends as typed', () => {
    const out = figuresToStore(base, null, { ...base, seeds_per_acre_min: 80000 })
    expect([out.seeds_per_acre_min, out.seeds_per_acre_max]).toEqual([80000, 110000])
    expect([out.depth_in_min, out.depth_in_max]).toEqual([null, null])
  })
})

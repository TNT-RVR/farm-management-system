import { describe, expect, it } from 'vitest'
import { cornStubbleLbPerAcre, cornWeatherLossPct, fieldForage, grazingSeason, residueKind, type PastureFieldRow } from './field-residue'
import { computePasture, FORAGE_YIELD_IRRIGATION, forageYieldPerAcre, type PastureRow } from './forage-yield'
import { stubbleCowDays } from './cattle-nutrition'

const row = (over: Partial<PastureFieldRow> = {}): PastureFieldRow => ({
  grazing_pasture_id: 'gp',
  field_id: 'f0',
  field_name: '0',
  open_to_pasture: true,
  grazed_after_harvest: true,
  acres_in: 100,
  crop_year: 2026,
  crop_name: 'Grain Corn',
  crop_share: 1,
  yield_per_acre: 150,
  yield_unit: 'bu',
  harvest_on: '2026-10-20',
  harvest_source: 'finished',
  last_harvest_on: '2026-10-20',
  tilled_on: null,
  tilled_how: null,
  stubble_grazing_id: null,
  ...over,
})
const opts = { irrigatedLbAc: 3500, utilization: 0.8 }
const summer = { from: '2026-06-01', to: '2026-06-30' }
const november = { from: '2026-11-01', to: '2026-11-30' }

describe('residueKind', () => {
  it('sorts the farm crops', () => {
    expect(residueKind('Grain Corn')).toBe('corn')
    expect(residueKind('High-Moisture Corn')).toBe('corn')
    expect(residueKind('Silage Corn')).toBe('silage')
    expect(residueKind('Beans-Yellow')).toBe('bean')
    expect(residueKind('Faba Beans')).toBe('pulse')
    expect(residueKind('Peas')).toBe('pulse')
    expect(residueKind('Potato-Creamer')).toBe('potato')
    expect(residueKind('Nutrien Canola')).toBe('canola')
    expect(residueKind('Barley')).toBe('cereal')
    expect(residueKind('Green Feed')).toBe('green_feed')
    expect(residueKind('Alfalfa')).toBe('legume')
    expect(residueKind('Carrot')).toBe('other')
  })
})

describe('corn stubble', () => {
  it('is the Feed tab figure: 8 lb DM a bushel, nothing lost the first month', () => {
    expect(cornStubbleLbPerAcre(150, 10)).toBe(stubbleCowDays(1, 150, 0, 1000).perAcreLb)
    expect(cornStubbleLbPerAcre(150, 10)).toBe(1200)
  })
  it('weathers away after a month, at most half', () => {
    expect(cornWeatherLossPct(30)).toBe(0)
    expect(cornWeatherLossPct(80)).toBeCloseTo(10, 6)
    expect(cornWeatherLossPct(1000)).toBe(50)
  })
})

describe('fieldForage', () => {
  it('gives nothing from a corn field in summer — the crop is growing', () => {
    const f = fieldForage(row(), summer, opts)
    expect(f.status).toBe('growing')
    expect(f.lb).toBe(0)
  })

  it('gives corn stubble in November with its feed value', () => {
    const f = fieldForage(row(), november, opts)
    expect(f.status).toBe('stubble')
    expect(f.availableFrom).toBe('2026-11-01')
    expect(f.lb).toBeCloseTo(100 * 1200, 6)
    expect(f.tdnPct).toBe(58)
    expect(f.cpPct).toBe(7)
  })

  it('counts nothing until harvest is recorded', () => {
    expect(fieldForage(row({ harvest_on: null }), november, opts).status).toBe('growing')
  })

  it('counts nothing once the field is disked after harvest', () => {
    const f = fieldForage(row({ tilled_on: '2026-10-25', tilled_how: 'Disking' }), november, opts)
    expect(f.status).toBe('tilled')
    expect(f.lb).toBe(0)
    expect(f.note).toContain('disked 25 Oct')
  })

  it('still counts stubble grazed before the tillage day', () => {
    const f = fieldForage(row({ tilled_on: '2026-11-15' }), { from: '2026-10-21', to: '2026-11-30' }, opts)
    expect(f.status).toBe('stubble')
  })

  it('waits for a spray hold to lift, and gives nothing if it covers the dates', () => {
    const late = fieldForage(row(), november, { ...opts, spray: { until: '2026-12-15', product: 'X' } })
    expect(late.status).toBe('sprayed')
    expect(late.lb).toBe(0)
    const partway = fieldForage(row(), november, { ...opts, spray: { until: '2026-11-10', product: 'X' } })
    expect(partway.status).toBe('stubble')
    expect(partway.availableFrom).toBe('2026-11-10')
  })

  it('gives one-pass beans nothing, and canola and peas little', () => {
    const beans = fieldForage(row({ crop_name: 'Beans-Pinto' }), november, opts)
    expect(beans.lb).toBe(0)
    expect(beans.note).toContain('one-pass')
    expect(fieldForage(row({ crop_name: 'Peas' }), november, opts).lbPerAc).toBe(300)
    expect(fieldForage(row({ crop_name: 'Nutrien Canola' }), november, opts).lbPerAc).toBe(250)
  })

  it('counts the cull potatoes left in a dug field, rotting after a month', () => {
    const spud = row({ crop_name: 'Potato-Creamer', yield_per_acre: 160, yield_unit: 'cwt', harvest_on: '2026-10-10' })
    // 16,000 lb × 6% left × 21% DM × 75% found.
    const nov = fieldForage(spud, november, opts)
    expect(nov.lbPerAc).toBeCloseTo(16000 * 0.06 * 0.21 * 0.75, 6)
    expect(nov.tdnPct).toBe(80)
    // Grazed from 1 Jan, 83 days after digging: 53% gone.
    expect(fieldForage(spud, { from: '2027-01-01', to: '2027-01-31' }, opts).lbPerAc).toBeCloseTo(16000 * 0.06 * 0.21 * 0.75 * 0.47, 6)
    // No dug date recorded: taken as 15 Oct, and said so.
    const unrecorded = fieldForage({ ...spud, harvest_on: null }, november, opts)
    expect(unrecorded.availableFrom).toBe('2026-11-01')
    expect(unrecorded.note).toContain('taken as 15 Oct')
    expect(fieldForage({ ...spud, harvest_on: null }, summer, opts).status).toBe('growing')
  })

  it('leaves a field with Feed-tab stubble grazing to the winter plan', () => {
    expect(fieldForage(row({ stubble_grazing_id: 's1' }), november, opts).status).toBe('winter_plan')
  })

  it('ignores a field fenced off from the pasture', () => {
    expect(fieldForage(row({ open_to_pasture: false, grazed_after_harvest: false }), november, opts).status).toBe('fenced')
  })

  it('grazes perennial forage as irrigated pasture, or regrowth after a cut', () => {
    const grazed = fieldForage(row({ crop_name: 'Alfalfa', harvest_on: null, last_harvest_on: null }), summer, opts)
    expect(grazed.lbPerAc).toBeCloseTo(3500 * 0.8, 6)
    const cut = fieldForage(row({ crop_name: 'Alfalfa', last_harvest_on: '2026-09-01' }), november, opts)
    expect(cut.lbPerAc).toBeCloseTo(3500 * 0.8 * 0.25, 6)
  })
})

describe('grazingSeason', () => {
  it('spans the classes’ dates in the given year, else 1 May – 16 Nov', () => {
    expect(grazingSeason([{ graze_start: '2025-05-15', graze_end: '2025-12-15' }, { graze_start: null, graze_end: null }], 2026)).toEqual({ from: '2026-05-15', to: '2026-12-15' })
    expect(grazingSeason([], 2026)).toEqual({ from: '2026-05-01', to: '2026-11-16' })
  })
})

const pasture = (over: Partial<PastureRow> = {}): PastureRow =>
  ({ id: 'gp', name: 'B', km2: 1, non_grazeable_ac: 0, irrigated_ac: 100, grazeable_irrigated_ac: 100, grass_quality: 'Fair', ...over }) as PastureRow

describe('computePasture with crop fields', () => {
  const fields = [row(), row({ field_id: 'f2', field_name: '2', crop_name: 'Silage Corn', acres_in: 50 })]

  it('takes the fields out of the native grass and stops crediting irrigated grass', () => {
    const p = computePasture(pasture(), 300, 0.8, { fields, window: summer })
    expect(p.fieldsLinked).toBe(true)
    expect(p.fieldAc).toBe(150)
    expect(p.nativeGrassAc).toBeCloseTo(247.105 - 150, 2)
    expect(p.fieldLbs).toBe(0)
    expect(p.totalLbs).toBeCloseTo((247.105 - 150) * forageYieldPerAcre(300, 'Fair') * 0.8, 3)
  })

  it('adds corn stubble for a November stay', () => {
    const summerP = computePasture(pasture(), 300, 0.8, { fields, window: summer })
    const fallP = computePasture(pasture(), 300, 0.8, { fields, window: november })
    expect(fallP.fieldLbs).toBeCloseTo(100 * 1200, 3)
    expect(fallP.auds - summerP.auds).toBeCloseTo((100 * 1200) / 26, 3)
    expect(fallP.fields.map((f) => f.status)).toEqual(['stubble', 'none'])
  })

  it('counts each field’s AUDs, which add up to the pasture’s own figure', () => {
    const fallP = computePasture(pasture(), 300, 0.8, { fields, window: november })
    // The corn field: 100 ac of stubble at 1,200 lb/ac, 26 lb an animal unit a day.
    const corn = fallP.fields.find((f) => f.fieldId === 'f0')!
    expect(corn.lb / 26).toBeCloseTo((100 * 1200) / 26, 6)
    // Silage corn gives nothing, so it is not quietly counted.
    expect(fallP.fields.find((f) => f.fieldId === 'f2')!.lb).toBe(0)
    expect(fallP.fieldAuds).toBeCloseTo(fallP.fields.reduce((a, f) => a + f.lb, 0) / 26, 6)
    expect(fallP.nativeAuds + fallP.fieldAuds).toBeCloseTo(fallP.auds, 6)
  })

  it('keeps the typed irrigated acres for a pasture with no field mapped, labelled as manual', () => {
    const p = computePasture(pasture({ id: 'other' }), 300, 0.8, { fields, window: november })
    expect(p.fieldsLinked).toBe(false)
    expect(p.fieldLbs).toBeCloseTo(100 * FORAGE_YIELD_IRRIGATION.Fair * 0.8, 3)
  })
})

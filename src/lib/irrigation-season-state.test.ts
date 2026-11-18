import { describe, expect, it } from 'vitest'
import { defaultIrrigationField, irrigationSeasonState, noModelDataNote } from './irrigation-season-state'

const season = (field_id: string, planting_date: string | null, active = true) => ({ field_id, planting_date, active })

describe('irrigationSeasonState', () => {
  it('is none for a field with no season, or only an inactive one', () => {
    expect(irrigationSeasonState('a', [])).toBe('none')
    expect(irrigationSeasonState('a', undefined)).toBe('none')
    expect(irrigationSeasonState('a', [season('a', '2026-05-01', false), season('b', '2026-05-01')])).toBe('none')
  })
  it('wants a planting date when the season has none', () => {
    expect(irrigationSeasonState('a', [season('a', null)])).toBe('no_planting')
  })
  it('is ready when any active season (a zone) has one', () => {
    expect(irrigationSeasonState('a', [season('a', null), season('a', '2026-05-10')])).toBe('ready')
  })
})

describe('defaultIrrigationField', () => {
  const fields = [{ id: 'canola-dry' }, { id: 'potatoes' }, { id: 'wheat' }]
  it('skips a dryland field to the first with a season', () => {
    expect(defaultIrrigationField(fields, [season('wheat', '2026-05-01'), season('potatoes', '2026-05-01')])).toBe('potatoes')
  })
  it('ignores inactive seasons', () => {
    expect(defaultIrrigationField(fields, [season('potatoes', '2026-05-01', false), season('wheat', null)])).toBe('wheat')
  })
  it('falls back to the first field, then to nothing', () => {
    expect(defaultIrrigationField(fields, [])).toBe('canola-dry')
    expect(defaultIrrigationField([], [])).toBe('')
  })
})

describe('noModelDataNote', () => {
  const lead = 'No 2026 model data for this field yet.'
  it('names the missing season, linking to Setup', () => {
    const n = noModelDataNote('none', 'f1', 2026, lead)
    expect(n.text).toBe('No irrigation season for this field in 2026.')
    expect(n.link?.to).toBe('/irrigation?view=setup&field=f1')
  })
  it('asks for a planting date only when the season lacks one', () => {
    expect(noModelDataNote('no_planting', 'f1', 2026, lead)).toEqual({
      text: `${lead} It needs a planting date, then Sync.`,
      link: { to: '/irrigation?view=setup&field=f1', label: 'Set the planting date' },
    })
    expect(noModelDataNote('ready', 'f1', 2026, lead)).toEqual({ text: `${lead} It fills in at the next Sync.`, link: null })
  })
})

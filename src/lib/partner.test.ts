import { describe, expect, it } from 'vitest'
import { isPartnerPath, suggestFromPlans } from './partner'

describe('isPartnerPath', () => {
  it('opens his fields, each field tab, his crops, his account and his company', () => {
    expect(isPartnerPath('/fields')).toBe(true)
    expect(isPartnerPath('/fields/abc/settings')).toBe(true)
    expect(isPartnerPath('/crops')).toBe(true)
    expect(isPartnerPath('/crops/abc')).toBe(true)
    expect(isPartnerPath('/settings/people')).toBe(true)
    expect(isPartnerPath('/settings/farm')).toBe(true)
    expect(isPartnerPath('/dashboard')).toBe(true)
    expect(isPartnerPath('/map')).toBe(true)
    expect(isPartnerPath('/fertilizer/soil?tab=tests')).toBe(true)
    expect(isPartnerPath('/fertilizer/manure')).toBe(true)
    expect(isPartnerPath('/plan?tab=budget')).toBe(true)
    expect(isPartnerPath('/rotation?tab=rules')).toBe(true)
    expect(isPartnerPath('/fields/abc')).toBe(true)
    expect(isPartnerPath('/fields/abc/irrigation')).toBe(true)
    expect(isPartnerPath('/fields/abc/history')).toBe(true)
    expect(isPartnerPath('/settings/account')).toBe(true)
    expect(isPartnerPath('/scouting')).toBe(true)
    for (const p of ['/chemicals?tab=reentry', '/hail', '/spray-restrictions', '/irrigation', '/irrigation-info', '/weigh-scale', '/pre-harvest', '/harvest-reports', '/contracts', '/field-progress', '/equipment', '/equipment/abc', '/fuel?tab=trucking', '/tasks', '/calendar', '/events', '/grants', '/weather', '/reports']) {
      expect(isPartnerPath(p)).toBe(true)
    }
  })

  it('keeps him off the farm, our connections and the import tool', () => {
    for (const p of ['/', '/plan?tab=farm costs', '/plan?tab=actuals', '/map?tab=profit', '/map?tab=topography', '/fertilizer/prices?tab=retailer', '/fertilizer', '/harvest', '/rotation?tab=advice', '/chemicals?tab=inventory', '/chemicals?tab=prices', '/weigh-scale?tab=trucks', '/fuel?tab=tanks', '/cattle', '/harvest-reports?tab=seed-report', '/contracts?tab=cashflow', '/contracts?tab=position', '/grain-marketing', '/financials', '/livestock', '/settings', '/settings/connections', '/search', '/fieldsx', '/cropsx']) {
      expect(isPartnerPath(p)).toBe(false)
    }
    expect(isPartnerPath('/fields/import')).toBe(false)
  })

  it("follows his company's ticks over the preset", () => {
    const a = { preset: 'crop-share', views: { '/map?tab=profit': true, '/fuel': false, '/cattle': true, '/plan?tab=budget': false } }
    expect(isPartnerPath('/map?tab=profit', a)).toBe(true)
    expect(isPartnerPath('/map?tab=topography', a)).toBe(false)
    expect(isPartnerPath('/fuel?tab=trucking', a)).toBe(false)
    expect(isPartnerPath('/cattle/herd', a)).toBe(true)
    expect(isPartnerPath('/plan?tab=budget', a)).toBe(false)
    expect(isPartnerPath('/plan?tab=plan', a)).toBe(true)
    // A tab ticked on a page that is off stays shut.
    expect(isPartnerPath('/fuel?tab=tanks', { preset: 'crop-share', views: { '/fuel': false, '/fuel?tab=tanks': true } })).toBe(false)
    // An unknown preset falls back to crop share.
    expect(isPartnerPath('/fields', { preset: 'gone', views: {} })).toBe(true)
  })
})

describe('suggestFromPlans', () => {
  const crops = [
    { id: 'p1', name: 'Potato-Creamer' },
    { id: 'p2', name: 'Potato' },
    { id: 'w', name: 'Wheat' },
  ]
  const plans = [
    { field_id: 'a', crop_id: 'p1' },
    { field_id: 'b', crop_id: 'p2' },
    { field_id: 'a', crop_id: 'p1' },
    { field_id: 'c', crop_id: 'w' },
    { field_id: 'd', crop_id: null },
  ]

  it('finds every field planned to a matching crop, once', () => {
    expect(suggestFromPlans(plans, crops, 'potato').sort()).toEqual(['a', 'b'])
  })

  it('suggests nothing for an empty match', () => {
    expect(suggestFromPlans(plans, crops, ' ')).toEqual([])
  })
})

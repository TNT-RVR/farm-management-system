import { describe, expect, it } from 'vitest'
import { fertilizerRedirect, oldFertilizerTab } from './fertilizer-views'

describe('old /fertilizer links', () => {
  // Every ?tab= key the one-page Fertilizer ever had, and where it went.
  const OLD: [string, string][] = [
    ['Soil Sampling', '/fertilizer/soil?tab=tests'],
    ['Sampling Map', '/fertilizer/soil?tab=map'],
    ['Nutrient History', '/fertilizer/soil?tab=history'],
    ['Tissue Tests', '/fertilizer/soil?tab=tissue'],
    ['Requirements', '/fertilizer/plan?tab=requirements'],
    ['Productivity Zones', '/fertilizer/plan?tab=zones'],
    ['Prescriptions', '/fertilizer/plan?tab=rx'],
    ['Blends', '/fertilizer/plan?tab=blends'],
    ['Pricing', '/fertilizer/prices?tab=pricing'],
    ['Market', '/fertilizer/prices?tab=market'],
    ['ICI', '/fertilizer/prices?tab=retailer'],
    ['Manure', '/fertilizer/manure'],
    ['Savings', '/fertilizer/savings'],
    // The group names, which opened the group's last view.
    ['Soil', '/fertilizer/soil'],
    ['Plan', '/fertilizer/plan'],
    ['Prices', '/fertilizer/prices'],
  ]

  it.each(OLD)('?tab=%s lands on %s', (tab, to) => {
    expect(fertilizerRedirect(`?tab=${encodeURIComponent(tab)}`, null, null)).toBe(to)
  })

  it('reads + for a space and ignores case', () => {
    expect(fertilizerRedirect('?tab=Soil+Sampling', null, null)).toBe('/fertilizer/soil?tab=tests')
    expect(fertilizerRedirect('?tab=nutrient%20history', null, null)).toBe('/fertilizer/soil?tab=history')
  })

  it('keeps the other params', () => {
    expect(fertilizerRedirect('?tab=Soil%20Sampling&field=abc', null, null)).toBe('/fertilizer/soil?field=abc&tab=tests')
    expect(fertilizerRedirect('?tab=Savings&tool=5', null, null)).toBe('/fertilizer/savings?tool=5')
  })

  it('with no tab, opens the last view, then the old remembered tab, then soil tests', () => {
    expect(fertilizerRedirect('', 'prices', 'Blends')).toBe('/fertilizer/prices')
    expect(fertilizerRedirect('', null, 'Blends')).toBe('/fertilizer/plan?tab=blends')
    expect(fertilizerRedirect('', 'gone', null)).toBe('/fertilizer/soil')
    expect(fertilizerRedirect('?tab=nonsense', null, null)).toBe('/fertilizer/soil')
  })

  it('maps an old key to its view and tab', () => {
    expect(oldFertilizerTab('ICI')).toEqual({ view: 'prices', tab: 'retailer' })
    expect(oldFertilizerTab('')).toBeNull()
  })
})

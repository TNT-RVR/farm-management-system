import { describe, expect, it } from 'vitest'
import { nextCode, sitesForYear, type SampleSite } from './soil-sites'

const site = (over: Partial<SampleSite>): SampleSite =>
  ({
    id: Math.random().toString(),
    field_id: 'f1',
    code: '1',
    lat: 52.4,
    lng: -108.7,
    crop_year: null,
    depth_label: null,
    notes: null,
    active: true,
    created_by: null,
    created_at: '',
    updated_at: '',
    ...over,
  }) as SampleSite

describe('sitesForYear', () => {
  it('shows a benchmark site in every year', () => {
    const sites = [site({ code: 'BM', crop_year: null })]
    expect(sitesForYear(sites, 2024).map((s) => s.code)).toEqual(['BM'])
    expect(sitesForYear(sites, 2026).map((s) => s.code)).toEqual(['BM'])
  })

  it('shows a dated site only in its own year', () => {
    const sites = [site({ code: '3', crop_year: 2024 })]
    expect(sitesForYear(sites, 2024)).toHaveLength(1)
    expect(sitesForYear(sites, 2026)).toHaveLength(0)
  })

  it('lets a dated site take the place of the benchmark with the same code', () => {
    // Somebody who moved site 3 for one year meant that year, not "there are
    // now two site 3s in this field".
    const sites = [site({ code: '3', crop_year: null }), site({ code: '3', crop_year: 2026 })]
    const out = sitesForYear(sites, 2026)
    expect(out).toHaveLength(1)
    expect(out[0].crop_year).toBe(2026)
  })

  it('keeps a same-code benchmark from another field', () => {
    // Every field numbers its sites from 1; they must not shadow each other.
    const sites = [
      site({ code: '1', field_id: 'f1', crop_year: null }),
      site({ code: '1', field_id: 'f2', crop_year: 2026 }),
    ]
    expect(sitesForYear(sites, 2026)).toHaveLength(2)
  })
})

describe('nextCode', () => {
  it('counts on from the highest number in the field', () => {
    expect(nextCode(['1', '2', '3'])).toBe('4')
    expect(nextCode(['1', '10', '2'])).toBe('11')
  })

  it('starts at 1 in an empty field', () => {
    expect(nextCode([])).toBe('1')
  })

  it('ignores codes that are not numbers', () => {
    expect(nextCode(['NE benchmark', 'knoll'])).toBe('1')
    expect(nextCode(['2', 'knoll'])).toBe('3')
  })
})

import { describe, expect, it } from 'vitest'
import { reportMatches } from './report-search'

const r = { name: 'Combine boundary files', what: 'Field boundaries for the combine display.', from: { label: 'Combines' }, section: 'harvest' }

describe('reportMatches', () => {
  it('matches every word, in any order, ignoring case', () => {
    expect(reportMatches('BOUNDARY combine', r)).toBe(true)
    expect(reportMatches('boundary spray', r)).toBe(false)
  })
  it('looks at the section title and the data source too', () => {
    expect(reportMatches('grain', r, 'Harvest, grain & storage')).toBe(true)
    expect(reportMatches('combines', r)).toBe(true)
  })
  it('shows everything for an empty box', () => {
    expect(reportMatches('   ', r)).toBe(true)
  })
  it('ignores accents', () => {
    expect(reportMatches('displáy', r)).toBe(true)
  })
})

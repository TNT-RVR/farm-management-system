import { describe, expect, it } from 'vitest'
import { contactLinkSummary, parseTags } from './contact-links'

describe('contactLinkSummary', () => {
  it('names each table in use, singular or plural', () => {
    expect(contactLinkSummary({ contracts: 2, input_items: 1, pumps: 0, land_leases: null })).toBe('2 grain contracts, 1 input')
  })
  it('is empty when nothing uses the contact', () => {
    expect(contactLinkSummary({})).toBe('')
  })
})

describe('parseTags', () => {
  it('splits on commas, trims, drops blanks and duplicates', () => {
    expect(parseTags('grain, canola  , ,seed,grain')).toEqual(['grain', 'canola', 'seed'])
  })
  it('handles null', () => {
    expect(parseTags(null)).toEqual([])
  })
})

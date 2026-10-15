import { describe, expect, it } from 'vitest'
import { companiesFor, companyLookup, companyOf, cropLabel } from './crop-label'

const varieties = [
  { crop_id: 'canola', name: 'Specialty - BASF', company: 'BASF' },
  { crop_id: 'canola', name: 'Specialty - Corteva', company: 'Corteva' },
  { crop_id: 'canola', name: 'Open market', company: null },
  { crop_id: 'beans', name: 'Specialty - BASF', company: null },
]

describe('cropLabel', () => {
  it('puts the company ahead of the crop', () => {
    expect(cropLabel('Canola', 'BASF')).toBe('BASF Canola')
    expect(cropLabel('Canola', 'Corteva')).toBe('Corteva Canola')
  })

  it('falls back to the plain crop where no company is known', () => {
    // A field nobody recorded a variety for must not be claimed for a contract.
    expect(cropLabel('Canola', null)).toBe('Canola')
    expect(cropLabel('Canola', '')).toBe('Canola')
    expect(cropLabel('Canola', '   ')).toBe('Canola')
  })

  it('does not say the company twice', () => {
    expect(cropLabel('BASF Canola', 'BASF')).toBe('BASF Canola')
    expect(cropLabel('basf canola', 'BASF')).toBe('basf canola')
  })
})

describe('companyOf', () => {
  it('finds the company behind a plan’s variety', () => {
    expect(companyOf(varieties, 'canola', 'Specialty - BASF')).toBe('BASF')
  })

  it('will not hand one crop’s contract to another', () => {
    // Variety names are not unique across crops — the beans have a
    // "Specialty - BASF" too, and it carries no company.
    expect(companyOf(varieties, 'beans', 'Specialty - BASF')).toBeNull()
  })

  it('is unbothered by case and stray spaces', () => {
    expect(companyOf(varieties, 'canola', '  specialty - basf ')).toBe('BASF')
  })

  it('says nothing when there is nothing to say', () => {
    expect(companyOf(varieties, 'canola', null)).toBeNull()
    expect(companyOf(varieties, 'canola', 'Open market')).toBeNull()
    expect(companyOf(undefined, 'canola', 'Specialty - BASF')).toBeNull()
  })
})

describe('companyLookup', () => {
  const lookup = companyLookup(varieties)

  it('answers the same as companyOf', () => {
    expect(lookup('canola', 'Specialty - BASF')).toBe('BASF')
    expect(lookup('beans', 'Specialty - BASF')).toBeNull()
    expect(lookup(null, 'Specialty - BASF')).toBeNull()
  })
})

describe('companiesFor', () => {
  const lookup = companyLookup(varieties)

  it('counts the contracts, not the fields', () => {
    // Three canola fields on two contracts is two things to keep apart.
    const plans = [
      { crop_id: 'canola', variety: 'Specialty - BASF' },
      { crop_id: 'canola', variety: 'Specialty - BASF' },
      { crop_id: 'canola', variety: 'Specialty - Corteva' },
    ]
    expect(companiesFor(plans, 'canola', lookup)).toEqual(['BASF', 'Corteva'])
  })

  it('ignores plans for other crops', () => {
    const plans = [
      { crop_id: 'beans', variety: 'Specialty - BASF' },
      { crop_id: 'canola', variety: 'Specialty - Corteva' },
    ]
    expect(companiesFor(plans, 'canola', lookup)).toEqual(['Corteva'])
  })

  it('returns nothing when no variety carries a company', () => {
    expect(companiesFor([{ crop_id: 'canola', variety: null }], 'canola', lookup)).toEqual([])
  })
})

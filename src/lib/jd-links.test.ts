import { describe, expect, it } from 'vitest'
import { opsCenterIds, templateFromExample, workLink } from './jd-links'

const raw = {
  links: [
    { rel: 'field', uri: 'https://api.deere.com/platform/organizations/1234567/fields/c64100b0-5e0f-4f40-b29d-cf39ba4d64b9' },
    { rel: 'organization', uri: 'https://api.deere.com/platform/organizations/1234567' },
    { rel: 'self', uri: 'https://api.deere.com/platform/fieldOperations/d04ae48a-ddef-4dd1-bd4c-3c8abc3c9c05' },
  ],
}
const op = { jd_id: 'd04ae48a-ddef-4dd1-bd4c-3c8abc3c9c05', raw }

describe('opsCenterIds', () => {
  it('reads the org, field and operation off the API links', () => {
    expect(opsCenterIds(op)).toEqual({
      org: '1234567',
      field: 'c64100b0-5e0f-4f40-b29d-cf39ba4d64b9',
      operation: 'd04ae48a-ddef-4dd1-bd4c-3c8abc3c9c05',
    })
  })

  it('copes with a pass that has no field link', () => {
    expect(opsCenterIds({ jd_id: 'x', raw: { links: [] } })).toEqual({ org: null, field: null, operation: 'x' })
  })
})

describe('templateFromExample', () => {
  const known = {
    orgs: ['1234567'],
    fields: ['c64100b0-5e0f-4f40-b29d-cf39ba4d64b9'],
    operations: ['d04ae48a-ddef-4dd1-bd4c-3c8abc3c9c05', 'other-op'],
  }

  it('swaps every id it recognises for a placeholder', () => {
    const r = templateFromExample(
      'https://example.deere.com/org/1234567/fields/c64100b0-5e0f-4f40-b29d-cf39ba4d64b9/work/d04ae48a-ddef-4dd1-bd4c-3c8abc3c9c05?tab=map',
      known,
    )
    expect(r?.template).toBe('https://example.deere.com/org/{org}/fields/{field}/work/{operation}?tab=map')
    expect(r?.operation).toBe('d04ae48a-ddef-4dd1-bd4c-3c8abc3c9c05')
  })

  it('refuses an address with no operation in it', () => {
    expect(templateFromExample('https://example.deere.com/org/1234567', known)).toBeNull()
    expect(templateFromExample('not a link', known)).toBeNull()
  })
})

describe('workLink', () => {
  it('fills a pass back into the template', () => {
    expect(workLink('https://x.deere.com/{org}/{field}/{operation}', opsCenterIds(op))).toBe(
      'https://x.deere.com/1234567/c64100b0-5e0f-4f40-b29d-cf39ba4d64b9/d04ae48a-ddef-4dd1-bd4c-3c8abc3c9c05',
    )
  })

  it('gives nothing when the template wants an id the pass lacks', () => {
    expect(workLink('https://x.deere.com/{field}/{operation}', { org: null, field: null, operation: 'x' })).toBeNull()
    expect(workLink(null, opsCenterIds(op))).toBeNull()
  })
})

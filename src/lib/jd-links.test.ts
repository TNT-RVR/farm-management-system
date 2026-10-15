import { describe, expect, it } from 'vitest'
import { opsCenterIds, templateFromExample, workLink } from './jd-links'

const raw = {
  links: [
    { rel: 'field', uri: 'https://api.deere.com/platform/organizations/1234567/fields/00000000-0000-4000-8000-0000000000f1' },
    { rel: 'organization', uri: 'https://api.deere.com/platform/organizations/1234567' },
    { rel: 'self', uri: 'https://api.deere.com/platform/fieldOperations/00000000-0000-4000-8000-0000000000e1' },
  ],
}
const op = { jd_id: '00000000-0000-4000-8000-0000000000e1', raw }

describe('opsCenterIds', () => {
  it('reads the org, field and operation off the API links', () => {
    expect(opsCenterIds(op)).toEqual({
      org: '1234567',
      field: '00000000-0000-4000-8000-0000000000f1',
      operation: '00000000-0000-4000-8000-0000000000e1',
    })
  })

  it('copes with a pass that has no field link', () => {
    expect(opsCenterIds({ jd_id: 'x', raw: { links: [] } })).toEqual({ org: null, field: null, operation: 'x' })
  })
})

describe('templateFromExample', () => {
  const known = {
    orgs: ['1234567'],
    fields: ['00000000-0000-4000-8000-0000000000f1'],
    operations: ['00000000-0000-4000-8000-0000000000e1', 'other-op'],
  }

  it('swaps every id it recognises for a placeholder', () => {
    const r = templateFromExample(
      'https://example.deere.com/org/1234567/fields/00000000-0000-4000-8000-0000000000f1/work/00000000-0000-4000-8000-0000000000e1?tab=map',
      known,
    )
    expect(r?.template).toBe('https://example.deere.com/org/{org}/fields/{field}/work/{operation}?tab=map')
    expect(r?.operation).toBe('00000000-0000-4000-8000-0000000000e1')
  })

  it('refuses an address with no operation in it', () => {
    expect(templateFromExample('https://example.deere.com/org/1234567', known)).toBeNull()
    expect(templateFromExample('not a link', known)).toBeNull()
  })
})

describe('workLink', () => {
  it('fills a pass back into the template', () => {
    expect(workLink('https://x.deere.com/{org}/{field}/{operation}', opsCenterIds(op))).toBe(
      'https://x.deere.com/1234567/00000000-0000-4000-8000-0000000000f1/00000000-0000-4000-8000-0000000000e1',
    )
  })

  it('gives nothing when the template wants an id the pass lacks', () => {
    expect(workLink('https://x.deere.com/{field}/{operation}', { org: null, field: null, operation: 'x' })).toBeNull()
    expect(workLink(null, opsCenterIds(op))).toBeNull()
  })
})

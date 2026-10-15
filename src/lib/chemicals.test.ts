import { describe, expect, it } from 'vitest'
import { isExcludedType, parseCsv, toAgriculturalRows } from '../../netlify/shared/chemicals-sync-core'
import { englishLabelDocId, labelPdfUrl, mergeMatches } from './chemicals'

// The registry extract quotes any field containing a comma and escapes a quote
// by doubling it. Real product names contain both — `"""103"" SIESTA"` is an
// actual row — so a naive split on commas silently shifts every later column.

const HEAD =
  'Registration number,Product name - English,Product name - French,Registration Status,Expiry date,' +
  'Marketing type,Date first registered,Exclusive period start date,Active ingredients - English,' +
  'Active ingredients - French,Product Type,Registrant name,Use Site Category,Sites of Use,Pests,' +
  'Current / Historical'

const row = (
  reg: string,
  name: string,
  marketing: string,
  sites: string,
  current: string,
  type = 'HERBICIDE',
) =>
  `${reg},${name},,Full Registration,2030-12-31,${marketing},2020-01-01,,GLYPHOSATE,GLYPHOSATE,${type},` +
  `SOME REGISTRANT,${sites},"WHEAT, BARLEY","WILD OATS",${current}`

describe('parseCsv', () => {
  it('keeps commas inside quoted fields', () => {
    const rows = parseCsv('a,b,c\n1,"two, and a half",3\n')
    expect(rows[1]).toEqual(['1', 'two, and a half', '3'])
  })

  it('unescapes doubled quotes', () => {
    const rows = parseCsv('a\n"""103"" SIESTA"\n')
    expect(rows[1][0]).toBe('"103" SIESTA')
  })
})

describe('toAgriculturalRows', () => {
  const csv = [
    HEAD,
    row('1001', 'FARM HERBICIDE', 'COMMERCIAL', '"14-TERRESTRIAL FOOD CROPS"', 'Current'),
    row('1002', 'POOL STUFF', 'COMMERCIAL', '"29-SWIMMING POOLS"', 'Current'),
    row('1003', 'OLD PRODUCT', 'COMMERCIAL', '"14-TERRESTRIAL FOOD CROPS"', 'Historical'),
    row('1004', 'FACTORY FEEDSTOCK', 'TECHNICAL ACTIVE', '"14-TERRESTRIAL FOOD CROPS"', 'Current'),
    row('1005', 'BIN TREATMENT', 'RESTRICTED', '"12-STORED FOOD & FEED"', 'Current', 'RODENTICIDE'),
  ].join('\n')

  const rows = toAgriculturalRows(csv)
  const regs = rows.map((r) => r.registration_number)

  it('keeps current, purchasable, agricultural products', () => {
    expect(regs).toContain('1001')
    expect(regs).toContain('1005')
  })

  it('drops non-agricultural use sites', () => {
    expect(regs).not.toContain('1002')
  })

  it('drops historical registrations', () => {
    expect(regs).not.toContain('1003')
  })

  it('drops technical actives and manufacturing concentrates', () => {
    expect(regs).not.toContain('1004')
  })

  it('maps the columns onto the right fields', () => {
    const r = rows.find((x) => x.registration_number === '1001')!
    expect(r.name).toBe('FARM HERBICIDE')
    expect(r.product_type).toBe('HERBICIDE')
    expect(r.active_ingredients).toBe('GLYPHOSATE')
    expect(r.sites_of_use).toBe('WHEAT, BARLEY')
    expect(r.expiry_date).toBe('2030-12-31')
  })

  it('returns nothing rather than guessing when the header changes', () => {
    expect(toAgriculturalRows('some,other,csv\n1,2,3\n')).toEqual([])
  })
})

// Prairie Creek has no use for fumigants, bactericides, bird and animal repellents,
// algaecides or acaricides. The trap is that PMRA's `Product Type` is a list of
// roles and the useful ones come bundled with the unwanted ones — 58 products
// are "ACARICIDE, INSECTICIDE" and 12 are "CROP BACTERICIDE, FUNGICIDE". A
// substring match would silently delete 70-odd real insecticides and fungicides.
describe('isExcludedType', () => {
  it('excludes a product whose only role is unwanted', () => {
    for (const t of [
      'ACARICIDE',
      'FUMIGANT',
      'CROP BACTERICIDE',
      'BIRD REPELLENT',
      'ALGAECIDE (AGRICULTURAL)',
      'acaricide',
    ]) {
      expect(isExcludedType(t), t).toBe(true)
    }
  })

  it('keeps a product that also does something useful', () => {
    for (const t of [
      'ACARICIDE, INSECTICIDE',
      'CROP BACTERICIDE, FUNGICIDE',
      'ACARICIDE, FUNGICIDE, INSECTICIDE',
      'FUMIGANT, NEMATICIDE, FUNGICIDE, HERBICIDE',
      'ALGAECIDE (AGRICULTURAL), CROP BACTERICIDE, FUNGICIDE',
    ]) {
      expect(isExcludedType(t), t).toBe(false)
    }
  })

  it('excludes a bundle that is unwanted all the way through', () => {
    expect(isExcludedType('ACARICIDE, ALGAECIDE (AGRICULTURAL)')).toBe(true)
  })

  it('keeps the ordinary crop products', () => {
    for (const t of ['HERBICIDE', 'FUNGICIDE', 'INSECTICIDE', 'ADJUVANT, SURFACTANT']) {
      expect(isExcludedType(t), t).toBe(false)
    }
  })

  // A blank type is not evidence of anything; dropping those would lose products
  // on a missing field rather than on what they are.
  it('keeps a product with no type recorded', () => {
    expect(isExcludedType('')).toBe(false)
    expect(isExcludedType(null)).toBe(false)
  })
})

describe('mergeMatches', () => {
  const c = (id: string, name: string) => ({ id, name }) as never

  it('dedupes a product found by more than one column', () => {
    const a = c('1', 'Roundup')
    expect(mergeMatches([[a], [a], []])).toHaveLength(1)
  })

  it('sorts by name across the sets', () => {
    const out = mergeMatches([[c('1', 'Zidua')], [c('2', 'Armory')], [c('3', 'Merge')]])
    expect(out.map((r) => r.name)).toEqual(['Armory', 'Merge', 'Zidua'])
  })

  it('caps the merged list', () => {
    const many = Array.from({ length: 300 }, (_, i) => c(String(i), `P${String(i).padStart(3, '0')}`))
    expect(mergeMatches([many], 200)).toHaveLength(200)
  })

  it('handles empty sets', () => {
    expect(mergeMatches([[], []])).toEqual([])
  })
})

/**
 * Shaped like a real reply from
 * /pesticide-registry-api/api/search/product-labels/{reg}?lang=en — the type
 * column is HTML, and the links column holds both a PDF and an HTML link.
 */
const labelRow = (type: string, id: string) => ({
  DOC_EPR_TYPE_E: `<a href='/pesticide-registry/en/document-request.html?q=${id}'>${type}</a>`,
  links: ` <a target='_blank' rel='noopener' href='https://pest-control.canada.ca/pesticide-registry-api/api/pdf/inline/en/${id}'>PDF</a> <a href='https://pest-control.canada.ca/pesticide-registry-api/api/pdf-to-html/en/${id}'>HTML</a>`,
})

describe('englishLabelDocId', () => {
  it('picks the English approved label', () => {
    const body = { data: [labelRow('APPROVED LABEL - English', '437323817')] }
    expect(englishLabelDocId(body)).toBe('437323817')
  })

  it('does not take the French label just because it came first', () => {
    // The French row's PDF link also says /en/ in the path, so matching on the
    // link alone returns whichever is first in the array. It is the type
    // column that says which language the document is.
    const body = {
      data: [labelRow('APPROVED LABEL - French', '437335747'), labelRow('APPROVED LABEL - English', '437323817')],
    }
    expect(englishLabelDocId(body)).toBe('437323817')
  })

  it('returns null when a product has no English approved label', () => {
    // Some older registrations only ever had a French one. That is a fact
    // about the product, not a failure.
    expect(englishLabelDocId({ data: [labelRow('APPROVED LABEL - French', '1')] })).toBeNull()
    expect(englishLabelDocId({ data: [] })).toBeNull()
    expect(englishLabelDocId({})).toBeNull()
  })

  it('accepts a bare array as well as a wrapped one', () => {
    expect(englishLabelDocId([labelRow('APPROVED LABEL - English', '99')])).toBe('99')
  })

  it('does not invent an id when the links column has no PDF', () => {
    expect(
      englishLabelDocId({ data: [{ DOC_EPR_TYPE_E: 'APPROVED LABEL - English', links: '' }] }),
    ).toBeNull()
  })
})

describe('labelPdfUrl', () => {
  it('addresses the registry API', () => {
    expect(labelPdfUrl('437323817')).toBe(
      'https://pest-control.canada.ca/pesticide-registry-api/api/pdf/inline/en/437323817',
    )
  })
})

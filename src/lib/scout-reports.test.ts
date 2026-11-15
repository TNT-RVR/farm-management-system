import { describe, expect, it } from 'vitest'
import { matchParcel, parcelKey, passReason, scoutPassed, seedCompanyOf, verdictsFor, SCOUT_COMPANIES, type ScoutReport } from './scout-reports'

const report = (o: Partial<ScoutReport>): ScoutReport =>
  ({
    id: 'r', company: 'corteva', crop_year: 2027, scouted_year: 2026, field_id: null, parcel: 'SE 16-40-25',
    grower_name: null, acres: null, rating: null, passed: null, crop_this_year: null, crop_history: null,
    last_canola_year: null, last_canola_tech: null, scouting_method: null, ps1_on: null, ps1_stage: null,
    ps1_notes: null, ps2_required: null, ps2_on: null, ps2_by: null, ps2_notes: null, vc_per_m2: null,
    tissue_on: null, tissue_summary: null, agronomist_note: null, contact_name: null, contact_phone: null,
    counts: {}, raw: {}, source: null, ...o,
  })

describe('whether a field passed', () => {
  it('reads Corteva’s rule: A and B grow, C and D do not', () => {
    expect(scoutPassed({ company: 'corteva', rating: 'A', passed: null })).toBe(true)
    expect(scoutPassed({ company: 'corteva', rating: 'B', passed: null })).toBe(true)
    expect(scoutPassed({ company: 'corteva', rating: 'C', passed: null })).toBe(false)
    expect(scoutPassed({ company: 'corteva', rating: 'D', passed: null })).toBe(false)
  })

  it('is unknown, not a fail, when there is no grade', () => {
    expect(scoutPassed({ company: 'corteva', rating: null, passed: null })).toBeNull()
    expect(scoutPassed({ company: 'corteva', rating: '  ', passed: null })).toBeNull()
  })

  it('takes a company’s own pass or fail over the grade', () => {
    expect(scoutPassed({ company: 'bayer', rating: 'D', passed: true })).toBe(true)
    expect(scoutPassed({ company: 'bayer', rating: 'A', passed: false })).toBe(false)
  })

  it('treats a company nobody has set up like the rest', () => {
    expect(scoutPassed({ company: 'someone-else', rating: 'B', passed: null })).toBe(true)
  })

  it('only Corteva’s rule is on the record; the others are assumed', () => {
    expect(SCOUT_COMPANIES.find((c) => c.key === 'corteva')!.rule).toMatch(/Kathryn Bilcik/)
    expect(SCOUT_COMPANIES.filter((c) => c.key !== 'corteva').every((c) => c.rule == null)).toBe(true)
  })
})

describe('matching a scouted quarter to one of our fields', () => {
  const fields = [
    { id: 'coulee', legal_land_description: 'SE-16-40-25-W4' },
    { id: 'eastranch', legal_land_description: '2-41-23-W4' },
    { id: 'halfsection', legal_land_description: 'N-35-40-23-W4' },
    { id: 'westhalf', legal_land_description: 'W1/2 SE-9-40-26-W4' },
    { id: 'nolegal', legal_land_description: null },
  ]

  it('matches however the company punctuated it, with or without the meridian', () => {
    expect(matchParcel('SE 16-40-25', fields)?.id).toBe('coulee')
    expect(matchParcel('se16-40-25w4', fields)?.id).toBe('coulee')
    expect(parcelKey('SE 16-40-25')).toBe(parcelKey('SE-16-40-25-W4'))
  })

  it('matches a quarter the sheet wrote without one', () => {
    // Taken from the fixture rather than written out again: the public copy
    // moves every legal description in our township block, and a second copy
    // of it here without the meridian would be left where it was.
    const noMeridian = fields[1].legal_land_description!.replace(/-W4$/, '')
    expect(noMeridian).not.toMatch(/W4/)
    expect(matchParcel(noMeridian, fields)?.id).toBe('eastranch')
  })

  it('will not match a quarter to the half section around it', () => {
    expect(matchParcel('NE 35-40-23', fields)).toBeNull()
  })

  it('will not match the east half to the west half', () => {
    expect(matchParcel('E1/2 SE 9-40-26', fields)).toBeNull()
    expect(matchParcel('W1/2 SE 9-40-26', fields)?.id).toBe('westhalf')
  })

  it('matches nothing on an empty or unreadable description', () => {
    expect(matchParcel('', fields)).toBeNull()
    expect(matchParcel('the home quarter', fields)).toBeNull()
  })

  it('refuses to choose when two fields share a description', () => {
    const two = [
      { id: 'a', legal_land_description: 'SE 16-40-25' },
      { id: 'b', legal_land_description: 'SE-16-40-25-W4' },
    ]
    expect(matchParcel('SE 16-40-25', two)).toBeNull()
  })
})

describe('the seed company behind a crop', () => {
  it('reads it off the crop name', () => {
    expect(seedCompanyOf('Corteva Canola')).toBe('corteva')
    expect(seedCompanyOf('BASF Canola')).toBe('basf')
    expect(seedCompanyOf('Nutrien Canola')).toBe('nutrien')
  })

  it('is null where there is no company to read', () => {
    expect(seedCompanyOf('Seed Canola (company not chosen)')).toBeNull()
    expect(seedCompanyOf('Canola')).toBeNull()
    expect(seedCompanyOf('Durum Wheat')).toBeNull()
    expect(seedCompanyOf(null)).toBeNull()
  })

  it('does not read a company off a crop that is not canola', () => {
    expect(seedCompanyOf('Bayer Soybeans')).toBeNull()
  })
})

describe('a field’s standing with every company', () => {
  const rows = [
    report({ id: '1', field_id: 'f', company: 'corteva', rating: 'B' }),
    report({ id: '2', field_id: 'f', company: 'basf', rating: 'D' }),
    report({ id: '3', field_id: 'g', company: 'corteva', rating: 'A' }),
    report({ id: '4', field_id: 'f', company: 'corteva', crop_year: 2026, rating: 'D' }),
  ]

  it('lists a company with no report rather than leaving it out', () => {
    const v = verdictsFor(rows, 'f', 2027, SCOUT_COMPANIES)
    expect(v.map((x) => x.company)).toEqual(['corteva', 'basf', 'bayer', 'nutrien'])
    expect(v.map((x) => x.passed)).toEqual([true, false, null, null])
  })

  it('keeps the years apart', () => {
    expect(verdictsFor(rows, 'f', 2026, SCOUT_COMPANIES)[0].passed).toBe(false)
  })
})

describe('why a field passed or did not', () => {
  it('names the rule and the grade it was applied to', () => {
    expect(passReason({ company: 'corteva', rating: 'B', passed: null })).toBe(
      'Corteva grows on A and B fields, and this one graded B.',
    )
    expect(passReason({ company: 'corteva', rating: 'D', passed: null })).toBe(
      'Corteva grows on A and B fields only, and this one graded D.',
    )
  })

  it('says when the rule is an assumption rather than the company’s own', () => {
    expect(passReason({ company: 'bayer', rating: 'D', passed: null })).toMatch(
      /Nobody has told us Bayer's own rule, so Corteva's is assumed\./,
    )
    expect(passReason({ company: 'corteva', rating: 'D', passed: null })).not.toMatch(/assumed/)
  })

  it('does not pretend to a reason when there is no grade', () => {
    expect(passReason({ company: 'corteva', rating: null, passed: null })).toMatch(/has not graded this field/)
    expect(passReason({ company: 'corteva', rating: null, passed: true })).toBe('Corteva says yes to this field.')
  })

  it('says so when the company overrode its own grade', () => {
    expect(passReason({ company: 'corteva', rating: 'D', passed: true })).toBe('Corteva will grow here in spite of the D.')
    expect(passReason({ company: 'corteva', rating: 'A', passed: false })).toBe('Corteva will not grow here in spite of the A.')
  })
})

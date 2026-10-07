import { describe, expect, it } from 'vitest'
import {
  legalMatches,
  matchField,
  parseHailReport,
  parseLegal,
  toISODate,
  type TextItem,
} from './hail-report'

/**
 * The real thing: positioned text from AFSC inspection 00100200, the Pinto bean
 * hail report for SE-10-71-13-W4M, 07 Aug 2026. Coordinates as the PDF draws
 * them, duplicated overlapping fragments and all — those are what the parser
 * has to survive, so removing them would test a document that does not exist.
 */
const REPORT: TextItem[] = [
  { x: 276, y: 681, s: 'August 07, 2026' },
  { x: 240, y: 713, s: 'Inspection Summary Report' },
  { x: 237, y: 663, s: 'Business Name:' },
  { x: 237, y: 681, s: 'Date:' },
  { x: 18, y: 681, s: 'Inspection Number:' },
  { x: 18, y: 663, s: 'InspectionType:' },
  { x: 120, y: 681, s: '00100200' },
  { x: 102, y: 663, s: 'Hail Endorsement' },
  { x: 324, y: 663, s: 'Prairie Creek Farm Ltd & Hansen Sam' },
  { x: 102, y: 639, s: 'Crop' },
  { x: 90, y: 639, s: ':' },
  { x: 21, y: 577, s: 'Application Date:' },
  { x: 549, y: 484, s: '%Loss' },
  { x: 416, y: 484, s: 'Acres' },
  { x: 420, y: 496, s: 'Current Assessment' },
  { x: 18, y: 496, s: 'Land Location' },
  { x: 21, y: 520, s: 'Adjuster:' },
  { x: 21, y: 544, s: 'Loss notice Date:' },
  { x: 117, y: 578, s: '06-Mar-2026' },
  { x: 21, y: 598, s: 'Initiated by:' },
  { x: 102, y: 562, s: '07-Jul-2026' },
  { x: 117, y: 544, s: '10-Jul-2026' },
  { x: 78, y: 520, s: 'Pat Adjuster' },
  { x: 96, y: 598, s: 'Client' },
  { x: 162, y: 496, s: 'Crop' },
  { x: 348, y: 496, s: 'Life cycle' },
  { x: 18, y: 562, s: 'Damage Date:' },
  { x: 18, y: 465, s: 'SE-10-71-13-W4M' },
  { x: 340, y: 465, s: 'Beans, Dry - Pinto' },
  { x: 509, y: 465, s: 'Complete' },
  { x: 441, y: 465, s: '0' },
  { x: 463, y: 465, s: 'not claimed' },
  { x: 162, y: 465, s: 'Beans, Dry - Pinto' },
  { x: 518, y: 465, s: 'SE-10-71-13-W4MCo' },
  { x: 348, y: 465, s: 'Complete' },
  { x: 528, y: 465, s: 'Beans, Dry - PintoS' },
  { x: 463, y: 451, s: 'Under 10%' },
  { x: 430, y: 437, s: '125' },
  { x: 463, y: 437, s: '10% - 70%' },
  { x: 572, y: 437, s: '17' },
  { x: 463, y: 423, s: '71% - 89%' },
  { x: 463, y: 409, s: '90% and over' },
  { x: 430, y: 395, s: '125' },
  { x: 463, y: 395, s: 'Total' },
  { x: 528, y: 24, s: 'Page 1 of 2' },
]

describe('parseHailReport, against the real 00100200', () => {
  const r = parseHailReport(REPORT)

  it('reads the identifiers', () => {
    expect(r.inspectionNumber).toBe('00100200')
    expect(r.inspectionType).toBe('Hail Endorsement')
    expect(r.businessName).toBe('Prairie Creek Farm Ltd & Hansen Sam')
    expect(r.adjuster).toBe('Pat Adjuster')
  })

  it('reads the land location past the duplicated copies', () => {
    // The report draws this string three times at different x. Only the one at
    // the left margin is the table cell; the others are rendering artifacts.
    expect(r.landLocation).toBe('SE-10-71-13-W4M')
  })

  it('takes the crop from its own column', () => {
    // "Beans, Dry - Pinto" also appears at x=340 and x=528 on the same line.
    expect(r.crop).toBe('Beans, Dry - Pinto')
  })

  it('gets the dates, and keeps them apart', () => {
    // Four dates on one page, all meaning different things. The damage date is
    // the one that matters agronomically — when the hail actually fell.
    expect(r.damageDate).toBe('2026-07-07')
    expect(r.lossNoticeDate).toBe('2026-07-10')
    expect(r.applicationDate).toBe('2026-03-06')
    expect(r.reportDate).toBe('2026-08-07')
  })

  it('reads the assessment band', () => {
    const band = r.bands.find((b) => b.band === '10% - 70%')!
    expect(band.acres).toBe(125)
    expect(band.lossPct).toBe(17)
  })

  it('leaves the empty bands empty rather than zero', () => {
    // A band with no acres is not a band assessed at 0%, and averaging the
    // zeros in would report 4% loss on a 17% claim.
    const under10 = r.bands.find((b) => b.band === 'Under 10%')!
    expect(under10.acres).toBeNull()
    expect(under10.lossPct).toBeNull()
  })

  it('gets the total acres and the headline loss', () => {
    expect(r.totalAcres).toBe(125)
    expect(r.lossPct).toBe(17)
  })
})

describe('lossPct across several bands', () => {
  it('weights by acres rather than summing or averaging', () => {
    // 100 ac at 20% and 50 ac at 80% is 40%, not 100% and not 50%.
    const items: TextItem[] = [
      { x: 430, y: 437, s: '100' },
      { x: 463, y: 437, s: '10% - 70%' },
      { x: 572, y: 437, s: '20' },
      { x: 430, y: 423, s: '50' },
      { x: 463, y: 423, s: '90% and over' },
      { x: 572, y: 423, s: '80' },
    ]
    expect(parseHailReport(items).lossPct).toBe(40)
  })
})

describe('toISODate', () => {
  it('takes both forms the report uses', () => {
    expect(toISODate('07-Jul-2026')).toBe('2026-07-07')
    expect(toISODate('August 07, 2026')).toBe('2026-08-07')
  })

  it('returns null rather than guessing', () => {
    expect(toISODate('sometime last week')).toBeNull()
    expect(toISODate(null)).toBeNull()
  })
})

describe('parseLegal', () => {
  it('reads every shape this farm actually uses', () => {
    expect(parseLegal('SE-10-71-13-W4M')).toEqual({ quarter: 'SE', section: 10, township: 71, range: 13 })
    expect(parseLegal('SE 14-71-14')).toEqual({ quarter: 'SE', section: 14, township: 71, range: 14 })
    expect(parseLegal('SW-13-71-14-W4')).toEqual({ quarter: 'SW', section: 13, township: 71, range: 14 })
    expect(parseLegal('W1/2 SE-9-71-14-W4')).toEqual({ quarter: 'SE', section: 9, township: 71, range: 14 })
  })

  it('handles the ones with no quarter', () => {
    expect(parseLegal('2-72-11-W4')).toEqual({ quarter: null, section: 2, township: 72, range: 11 })
    expect(parseLegal('N-35-71-11-W4')).toEqual({ quarter: null, section: 35, township: 71, range: 11 })
  })

  it('returns null on anything it cannot read', () => {
    expect(parseLegal('the home quarter')).toBeNull()
    expect(parseLegal(null)).toBeNull()
  })
})

describe('legalMatches', () => {
  const se10 = parseLegal('SE-10-71-13-W4M')

  it('ignores the meridian suffix', () => {
    // Ours are written without it and AFSC always writes it. Requiring it would
    // fail to match every field over a letter nobody typed.
    expect(legalMatches(se10, parseLegal('SE-10-71-13-W4'))).toBe('exact')
    expect(legalMatches(se10, parseLegal('SE 10-71-13'))).toBe('exact')
  })

  it('refuses a different quarter of the same section', () => {
    // The failure that would put a hail claim on the wrong field.
    expect(legalMatches(se10, parseLegal('NE-10-71-13-W4'))).toBe('none')
    expect(legalMatches(se10, parseLegal('SE-11-71-13-W4'))).toBe('none')
  })

  it('reports a quarterless match as weaker rather than as a yes', () => {
    expect(legalMatches(se10, parseLegal('10-71-13-W4'))).toBe('section')
  })
})

describe('matchField', () => {
  const fields = [
    { id: 'a', name: '6/Kellers', legal_land_description: 'SE-10-71-13-W4' },
    { id: 'b', name: '3', legal_land_description: 'NW-18-71-13-W4' },
    { id: 'c', name: 'East Ranch Main', legal_land_description: '2-72-11-W4' },
  ]

  it('finds the field the report is about', () => {
    const m = matchField(fields, 'SE-10-71-13-W4M')
    expect(m?.field.name).toBe('6/Kellers')
    expect(m?.confidence).toBe('exact')
  })

  it('matches a quarterless field on its section, and says so', () => {
    const m = matchField(fields, 'SE-2-72-11-W4M')
    expect(m?.field.name).toBe('East Ranch Main')
    expect(m?.confidence).toBe('section')
  })

  it('returns nothing rather than a guess', () => {
    expect(matchField(fields, 'SE-22-71-13-W4M')).toBeNull()
    expect(matchField(fields, null)).toBeNull()
  })

  it('refuses when two fields claim the same quarter', () => {
    // A data problem worth stopping on, not one to pick a winner from.
    const dupes = [...fields, { id: 'd', name: 'Other', legal_land_description: 'SE-10-71-13-W4' }]
    expect(matchField(dupes, 'SE-10-71-13-W4M')).toBeNull()
  })
})

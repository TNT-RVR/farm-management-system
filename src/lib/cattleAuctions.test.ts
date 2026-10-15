import { describe, expect, it } from 'vitest'
// ?raw keeps this a browser-target module — the app tsconfig has no node types.
import mhfcListHtml from './__fixtures__/mhfc-report-list.html?raw'
import mhfcSep30 from './__fixtures__/mhfc-2026-09-30.json?raw'
import perlich727 from './__fixtures__/perlich-entries-727.json?raw'
import perlich644 from './__fixtures__/perlich-entries-644.json?raw'
import perlichComments727 from './__fixtures__/perlich-comments-727.json?raw'
import perlichReports from './__fixtures__/perlich-reports.json?raw'
import calgaryHtml from './__fixtures__/calgary-stockyards-2026-10-02.html?raw'
import teamHtml from './__fixtures__/team-market-report-2026-10-04.html?raw'
import {
  combineSameDay,
  dateWithoutYear,
  fridayOnOrBefore,
  jsonFromReply,
  mhfcClass,
  mhfcRows,
  parseCalgaryStockyards,
  parseMhfcListing,
  parseTeamReport,
  perlichComment,
  perlichRows,
  perlichSaleDate,
  validateMhfcReply,
  type AuctionRow,
  type MhfcReply,
  type ParsedReport,
  type PerlichEntry,
  type PerlichReport,
} from '../../netlify/shared/cattle-auctions-parse'
import {
  bandPrice,
  explainHeadline,
  headlinePrice,
  headlineSub,
  normaliseBand,
  parseSeriesCode,
  type AuctionQuote,
  type MarketKey,
} from './auction-markets'

const byCode = (rows: AuctionRow[], code: string) => rows.find((r) => r.code === code)
const entries = (raw: string) =>
  (JSON.parse(raw) as { data: { market_report_entries: PerlichEntry[] } }).data.market_report_entries
const parsed = <T extends object>(r: T | { problem: string }): T => {
  if ('problem' in r) throw new Error(r.problem)
  return r
}

describe('weight bands', () => {
  it('reads every market’s way of writing the same 100 lb class as one band', () => {
    // Medicine Hat "501 to 600", Calgary and Team "500-599", Perlich "500 - 600".
    expect(normaliseBand(501, 600)).toEqual({ lo: 500, hi: 600 })
    expect(normaliseBand(500, 599)).toEqual({ lo: 500, hi: 600 })
    expect(normaliseBand(500, 600)).toEqual({ lo: 500, hi: 600 })
  })

  it('rounds Medicine Hat’s wide heavy classes the same way', () => {
    expect(normaliseBand(1001, 1250)).toEqual({ lo: 1000, hi: 1250 })
    expect(normaliseBand(1251, 1499)).toEqual({ lo: 1250, hi: 1500 })
    expect(normaliseBand(1500, 3999)).toEqual({ lo: 1500, hi: 4000 })
  })

  it('keeps an open-topped class open', () => {
    expect(normaliseBand(1000, null)).toEqual({ lo: 1000, hi: null })
  })
})

describe('series codes', () => {
  it('reads the four markets’ codes, open-topped bands included', () => {
    expect(parseSeriesCode('ab.feeder.steers.400-500.lethbridge')).toEqual({
      cls: 'feeder',
      kind: 'steers',
      band: { lo: 400, hi: 500 },
      market: 'lethbridge',
    })
    expect(parseSeriesCode('ab.feeder.heifers.1000-plus.team-online')?.band).toEqual({ lo: 1000, hi: null })
    expect(parseSeriesCode('ab.cows.d1-d2.all.calgary')).toMatchObject({ cls: 'cows', kind: 'd1-d2', band: null })
  })

  it('does not treat the Alberta review’s markets as one of the four', () => {
    // Clyde, Ponoka, Strathmore and Ontario are still stored but no longer
    // drawn or used on the cattle tab.
    expect(parseSeriesCode('ab.feeder.steers.500-600.clyde')).toBeNull()
    expect(parseSeriesCode('ab.feeder.steers.500-600.strathmore')).toBeNull()
  })
})

// ── Medicine Hat ────────────────────────────────────────────────────────────

describe('Medicine Hat report list', () => {
  const list = parseMhfcListing(mhfcListHtml)

  it('reads each report’s id, date and file, newest first', () => {
    expect(list[0]).toEqual({
      reportId: 1090,
      saleDate: '2026-09-30',
      url: 'https://mhfc.ca/uploads/reports/1090_088a751102d911539fabfb1e6009b664.pdf',
      title: 'Regular/ Presort Market Report',
      mediaType: 'application/pdf',
    })
    expect(list[1]).toMatchObject({ reportId: 1089, saleDate: '2026-09-23' })
  })

  it('knows a JPG report is an image, not a PDF', () => {
    expect(list.find((l) => l.reportId === 1036)).toMatchObject({ saleDate: '2025-11-19', mediaType: 'image/jpeg' })
  })

  it('keeps both reports when one date has two', () => {
    expect(list.filter((l) => l.saleDate === '2025-05-14').map((l) => l.reportId).sort()).toEqual([993, 994])
  })
})

describe('Medicine Hat transcription — 30 Sep 2026, checked against Sam’s own reading', () => {
  const reply = JSON.parse(mhfcSep30) as MhfcReply
  const v = validateMhfcReply(reply, '2026-09-30')

  it('passes every check', () => {
    expect(v).toEqual({ ok: true, reply })
  })

  const { rows, skipped } = mhfcRows(reply)

  it('stores every row, and nothing as a calf price', () => {
    expect(rows).toHaveLength(20)
    expect(skipped).toEqual([])
    // A regular sale in September sells no calves. None of these rows may
    // turn up as a feeder calf price.
    expect(rows.filter((r) => r.code.startsWith('ab.feeder.'))).toEqual([])
  })

  it('stores the light "slaughter" heifers as yearling heifers, with the heading as printed', () => {
    expect(byCode(rows, 'ab.yearling.heifers.500-600.medicine-hat')).toMatchObject({
      value: 439.31,
      low: 400,
      high: 480,
      head: 4,
      avgWeightLb: 582,
      weightMinLb: 572,
      weightMaxLb: 592,
      classLabel: 'SLAUGHTER HEIFER 501 to 600 lbs',
    })
    expect(byCode(rows, 'ab.yearling.heifers.800-900.medicine-hat')).toMatchObject({ value: 437.17, head: 76, avgWeightLb: 870 })
  })

  it('keeps heifers over 900 lb as slaughter heifers', () => {
    expect(byCode(rows, 'ab.slaughter.heifers.900-1000.medicine-hat')).toMatchObject({ value: 432.01, head: 92 })
    expect(byCode(rows, 'ab.slaughter.heifers.1000-1250.medicine-hat')).toMatchObject({ value: 403.33, head: 115 })
    expect(byCode(rows, 'ab.slaughter.heifers.1250-1500.medicine-hat')).toMatchObject({ value: 302.92, head: 4 })
  })

  it('files yearling steers, bulls, cows and heiferettes under their own codes', () => {
    expect(byCode(rows, 'ab.yearling.steers.700-800.medicine-hat')).toMatchObject({ value: 414.85, head: 4 })
    expect(byCode(rows, 'ab.yearling.steers.800-900.medicine-hat')).toMatchObject({ value: 465.31, head: 9 })
    expect(byCode(rows, 'ab.yearling.steers.1000-1250.medicine-hat')).toMatchObject({ value: 411.39, head: 22 })
    expect(byCode(rows, 'ab.bulls.mature.1500-4000.medicine-hat')).toMatchObject({ value: 239, head: 33, avgWeightLb: 1919 })
    expect(byCode(rows, 'ab.cows.slaughter.900-1000.medicine-hat')).toMatchObject({ value: 175, low: 175, high: 175, head: 1 })
    expect(byCode(rows, 'ab.cows.slaughter.1250-1500.medicine-hat')).toMatchObject({ value: 192.15, head: 35 })
    expect(byCode(rows, 'ab.heiferettes.all.1000-1250.medicine-hat')).toMatchObject({ value: 301.52 })
    expect(byCode(rows, 'ab.heiferettes.all.1250-1500.medicine-hat')).toMatchObject({ value: 293.92 })
  })

  it('adds back up to the report’s 477 head', () => {
    expect(rows.reduce((s, r) => s + (r.head ?? 0), 0)).toBe(477)
  })
})

describe('refusing a misread Medicine Hat report', () => {
  const good = () => JSON.parse(mhfcSep30) as MhfcReply
  const problems = (r: unknown, date = '2026-09-30') => {
    const v = validateMhfcReply(r, date)
    return v.ok ? [] : v.problems
  }

  it('catches an average outside its own range (a misread digit)', () => {
    const r = good()
    r.sections[1].rows[0].avg = 489.31 // printed 439.31, range 400-480
    expect(problems(r).join(' ')).toMatch(/average 489.31 is outside 400-480/)
  })

  it('catches rows that no longer add up to the printed total', () => {
    const r = good()
    r.sections[4].rows[1].head = 8 // printed 9
    expect(problems(r).join(' ')).toMatch(/rows add to 476 head, the report's total is 477/)
  })

  it('catches a lot weight outside its class', () => {
    const r = good()
    r.sections[1].rows[0].lot_min = 472
    expect(problems(r).join(' ')).toMatch(/outside the class/)
  })

  it('catches one head with two prices', () => {
    const r = good()
    r.sections[2].rows[0].high = 185
    expect(problems(r).join(' ')).toMatch(/one head but more than one price/)
  })

  it('refuses a figure the reader said it could not make out', () => {
    const r = good()
    r.unreadable = ['YR STEER 901 to 1000 lbs: HIGH']
    expect(problems(r).join(' ')).toMatch(/could not read/)
  })

  it('refuses a number written as text, and a report dated another week', () => {
    const r = good() as unknown as { sections: { rows: Record<string, unknown>[] }[] }
    r.sections[0].rows[0].avg = '366.24'
    expect(problems(r).join(' ')).toMatch(/avg not a number/)
    expect(problems(good(), '2026-09-16').join(' ')).toMatch(/is not the listed 2026-09-16/)
  })

  it('refuses something that is not a report at all', () => {
    expect(problems(null)).toEqual(['reply is not an object'])
    expect(problems({ sale_date: '2026-09-30', sections: [], unreadable: [] })).toContain('no sections')
  })

  it('finds the JSON in a reply with words around it', () => {
    expect(jsonFromReply('Here it is:\n{"a":1}\nDone.')).toEqual({ a: 1 })
    expect(jsonFromReply('no json')).toBeNull()
  })
})

describe('Medicine Hat class mapping', () => {
  it('reads plain STEER rows by weight: light ones are feeders, heavy ones fed cattle', () => {
    // January 2026's regular sale had "STEER 901 to 1000 lbs" at $360 — fat
    // cattle, not feeders.
    expect(mhfcClass('STEER', { lo: 500, hi: 600 })).toEqual({ cls: 'feeder', kind: 'steers' })
    expect(mhfcClass('STEER', { lo: 900, hi: 1000 })).toEqual({ cls: 'slaughter', kind: 'steers' })
    expect(mhfcClass('HEIFER CALF', { lo: 400, hi: 500 })).toEqual({ cls: 'feeder', kind: 'heifers' })
  })

  it('knows bull calves, yearling bulls and bulls apart', () => {
    expect(mhfcClass('BULL CALF', { lo: 300, hi: 400 })).toEqual({ cls: 'feeder', kind: 'bulls' })
    expect(mhfcClass('YEARLING BULL', { lo: 700, hi: 800 })).toEqual({ cls: 'bulls', kind: 'yearling' })
    expect(mhfcClass('BULL', { lo: 1500, hi: 4000 })).toEqual({ cls: 'bulls', kind: 'mature' })
  })

  it('stores nothing for a heading it does not know', () => {
    expect(mhfcClass('BRED COW', { lo: 1000, hi: 1250 })).toBeNull()
  })

  it('skips a section priced per head', () => {
    const reply: MhfcReply = {
      sale_date: '2026-02-04',
      total_head: 2,
      unreadable: [],
      sections: [
        {
          class: 'BRED COW',
          price_unit: 'head',
          rows: [{ weight_class: '1251 to 1499 lbs', class_lo: 1251, class_hi: 1499, lot_min: 1300, lot_max: 1400, low: 4000, high: 5000, head: 2, avg: 4500, avg_weight: 1350 }],
        },
      ],
    }
    expect(mhfcRows(reply)).toEqual({ rows: [], skipped: ['BRED COW (priced per head)'] })
  })

  it('merges two reports for one day by head, never letting the second overwrite the first', () => {
    const a = byCode(mhfcRows(JSON.parse(mhfcSep30) as MhfcReply).rows, 'ab.bulls.mature.1500-4000.medicine-hat')!
    const b = { ...a, value: 260, low: 250, high: 270, head: 11, avgWeightLb: 1700, classLabel: 'BULL 1500 to 3999 lbs' }
    const [m] = combineSameDay([a, b])
    // (239 × 33 + 260 × 11) / 44 = 244.25
    expect(m).toMatchObject({ value: 244.25, low: 190, high: 270, head: 44 })
  })
})

// ── Lethbridge ──────────────────────────────────────────────────────────────

describe('Perlich Bros, Lethbridge', () => {
  it('dates a week by the day it was published', () => {
    const reports = (JSON.parse(perlichReports) as { data: { market_reports: PerlichReport[] } }).data.market_reports
    const r727 = reports.find((r) => r.id === 727)!
    expect(perlichSaleDate(r727)).toBe('2026-10-02')
    // Keyed in months late: still dated inside its own week.
    expect(perlichSaleDate({ ...r727, published_at: '2026-12-15 10:00:00' })).toBe('2026-10-03')
  })

  it('stores the middle of the range, with the range and the top sale', () => {
    const { rows } = perlichRows(entries(perlich727))
    expect(byCode(rows, 'ab.yearling.steers.600-700.lethbridge')).toMatchObject({
      value: 590,
      low: 575,
      high: 605,
      top: 607,
      head: null,
      classLabel: 'Yearlings / 600 - 700 - Steers',
    })
  })

  it('uses a Yearlings row as the feeder price for its weight when no calves sold', () => {
    // 2 Oct 2026: "Too few calves to quote this week" — yearlings only.
    const { rows } = perlichRows(entries(perlich727))
    expect(byCode(rows, 'ab.feeder.steers.600-700.lethbridge')).toMatchObject({ value: 590 })
    expect(byCode(rows, 'ab.feeder.heifers.900-1000.lethbridge')).toMatchObject({ value: 402.5 })
  })

  it('reads November 2025’s mislabelled calves as feeder calves', () => {
    // Filed under "Yearlings", but 400-500 lb in November are calves.
    const { rows, skipped } = perlichRows(entries(perlich644))
    expect(byCode(rows, 'ab.feeder.steers.400-500.lethbridge')).toMatchObject({ value: 682.5, low: 625, high: 740, top: 745 })
    expect(byCode(rows, 'ab.feeder.heifers.300-400.lethbridge')).toMatchObject({ value: 667.5 })
    expect(byCode(rows, 'ab.bulls.mature.1900-plus.lethbridge')).toMatchObject({ value: 242.5 })
    expect(byCode(rows, 'ab.heiferettes.all.all.lethbridge')).toMatchObject({ value: 300, top: 350 })
    expect(byCode(rows, 'ab.cows.feeder.all.lethbridge')).toMatchObject({ value: 250 })
    // Bred heifers are priced per head; Holstein feeders are not this farm's market.
    expect(skipped).toContain('Bred Cows/Heifers / Bred Heifers - Good Quality')
    expect(skipped).toContain('Holsteins / 800 - 900')
    expect(rows.some((r) => r.value > 2500)).toBe(false)
  })

  it('reads cull cows by grade', () => {
    const { rows } = perlichRows(entries(perlich727))
    expect(byCode(rows, 'ab.cows.d1-d2.all.lethbridge')).toMatchObject({ value: 205, low: 200, high: 210, top: 215 })
    expect(byCode(rows, 'ab.cows.d3-d4.all.lethbridge')).toMatchObject({ value: 190 })
    expect(byCode(rows, 'ab.cows.holstein.all.lethbridge')).toMatchObject({ value: 162.5 })
  })

  it('keeps the week’s own note', () => {
    const c = (JSON.parse(perlichComments727) as { data: { market_report_comments: { comment: string }[] } }).data
      .market_report_comments
    expect(perlichComment(c)).toMatch(/^Calves: Too few calves to quote this week\./)
  })
})

// ── Calgary Stockyards ──────────────────────────────────────────────────────

describe('Calgary Stockyards weekly report', () => {
  const r = parsed(parseCalgaryStockyards(calgaryHtml, '2026-10-05'))

  it('reads the week and the head count', () => {
    expect(r).toMatchObject({ market: 'calgary', saleDate: '2026-10-02', reportKey: 'week-ending-2026-10-02', totalHead: 5811 })
  })

  it('reads each class with its low, high and average', () => {
    expect(byCode(r.rows, 'ab.feeder.steers.400-500.calgary')).toMatchObject({ value: 780, low: 690, high: 832, classLabel: 'Steers 400-499' })
    expect(byCode(r.rows, 'ab.feeder.steers.500-600.calgary')).toMatchObject({ value: 643, low: 575, high: 693 })
    expect(byCode(r.rows, 'ab.feeder.steers.900-plus.calgary')).toMatchObject({ value: 431 })
    expect(byCode(r.rows, 'ab.feeder.heifers.400-500.calgary')).toMatchObject({ value: 640, low: 575, high: 760 })
    expect(byCode(r.rows, 'ab.cows.d1-d2.all.calgary')).toMatchObject({ value: 223, low: 202, high: 234 })
    expect(byCode(r.rows, 'ab.bulls.mature.all.calgary')).toMatchObject({ value: 240 })
  })

  it('skips a class nobody sold rather than reading it as zero', () => {
    // 800-899 steers and 700-799 heifers are empty cells that week.
    expect(byCode(r.rows, 'ab.feeder.steers.800-900.calgary')).toBeUndefined()
    expect(byCode(r.rows, 'ab.feeder.heifers.700-800.calgary')).toBeUndefined()
    // Two cow grades, bulls, five steer and five heifer classes.
    expect(r.rows).toHaveLength(13)
  })

  it('puts a date with no year in the right year', () => {
    expect(dateWithoutYear(10, 2, '2026-10-05')).toBe('2026-10-02')
    expect(dateWithoutYear(12, 31, '2027-01-03')).toBe('2026-12-31')
  })

  it('says so when the table is not there', () => {
    expect(parseCalgaryStockyards('<p>Week Ending: October 2nd</p>', '2026-10-05')).toEqual({
      problem: 'no market table (no "Wght Rng" heading)',
    })
  })
})

// ── Team online ─────────────────────────────────────────────────────────────

describe('Team online market report', () => {
  const r = parsed(parseTeamReport(teamHtml))

  it('dates the report to the Friday sale it covers', () => {
    // "Updated: 10/4/2026" is a Sunday; the sale was Friday 2 Oct.
    expect(fridayOnOrBefore('2026-10-04')).toBe('2026-10-02')
    expect(fridayOnOrBefore('2026-10-02')).toBe('2026-10-02')
    expect(r).toMatchObject({ market: 'team-online', saleDate: '2026-10-02', totalHead: 6826 })
  })

  it('reads the feeder block, with a single sale as its own range', () => {
    expect(byCode(r.rows, 'ab.feeder.steers.400-500.team-online')).toMatchObject({ value: 686, low: 686, high: 686 })
    expect(byCode(r.rows, 'ab.feeder.steers.500-600.team-online')).toMatchObject({ value: 670, low: 626, high: 693 })
    expect(byCode(r.rows, 'ab.feeder.steers.1000-plus.team-online')).toMatchObject({ value: 440 })
    expect(byCode(r.rows, 'ab.feeder.heifers.500-600.team-online')).toMatchObject({ value: 585 })
  })

  it('leaves out what is not a live feeder price', () => {
    // N/A classes, the rail-priced finished cattle and the per-head bred heifers.
    expect(byCode(r.rows, 'ab.feeder.heifers.400-500.team-online')).toBeUndefined()
    expect(r.rows.every((x) => x.code.startsWith('ab.feeder.'))).toBe(true)
    expect(r.rows).toHaveLength(11)
    expect(r.comment).toMatch(/^Feeder cattle were fully steady/)
  })
})

// ── The headline ────────────────────────────────────────────────────────────

/** Feeder quotes for one sex, as the tab builds them from stored rows. */
function quotesOf(reports: ParsedReport[], sex: 'steers' | 'heifers'): AuctionQuote[] {
  return reports.flatMap((p) =>
    p.rows
      .map((x) => ({ x, parts: parseSeriesCode(x.code) }))
      .filter(({ parts }) => parts?.cls === 'feeder' && parts.kind === sex && parts.band)
      .map(({ x, parts }) => ({ market: parts!.market, band: parts!.band!, perCwt: x.value, on: p.saleDate })),
  )
}

const q = (market: MarketKey, lo: number, perCwt: number, on: string): AuctionQuote => ({
  market,
  band: { lo, hi: lo + 100 },
  perCwt,
  on,
})

describe('the headline: what 450 lb calves are worth today', () => {
  const calgary = parsed(parseCalgaryStockyards(calgaryHtml, '2026-10-05'))
  const team = parsed(parseTeamReport(teamHtml))
  const today = '2026-10-05'

  it('is a quote when a market sold the class — here the average of the two that did that week', () => {
    const h = headlinePrice(quotesOf([calgary, team], 'steers'), 450, today)!
    expect(h.kind).toBe('quote')
    expect(h.band).toEqual({ lo: 400, hi: 500 })
    // Calgary $780, Team $686: neither nearest market sold calves that week.
    expect(h.perCwt).toBe(733)
    expect(h.perLb).toBeCloseTo(7.33, 6)
    expect(h.from[0].basis).toBe('week')
    expect(headlineSub(h)).toBe('400–500 lb class · average of Calgary Stockyards 2 Oct, Team online 2 Oct')
  })

  it('gives heifers their own figure', () => {
    const h = headlinePrice(quotesOf([calgary, team], 'heifers'), 450, today)!
    expect(h).toMatchObject({ kind: 'quote', perCwt: 640 })
    expect(h.from[0].sources.map((s) => s.market)).toEqual(['calgary'])
  })

  it('prefers Medicine Hat when it sold the class in the last fortnight', () => {
    const quotes = [...quotesOf([calgary, team], 'steers'), q('medicine-hat', 400, 760, '2026-09-30')]
    const h = headlinePrice(quotes, 450, today)!
    expect(h).toMatchObject({ kind: 'quote', perCwt: 760 })
    expect(h.from[0]).toMatchObject({ basis: 'nearest' })
    expect(headlineSub(h)).toBe('400–500 lb class · Medicine Hat 30 Sep')
  })

  it('averages Medicine Hat and Lethbridge when both sold it', () => {
    const quotes = [q('medicine-hat', 400, 760, '2026-09-30'), q('lethbridge', 400, 720, '2026-10-02'), q('calgary', 400, 780, '2026-10-02')]
    expect(headlinePrice(quotes, 450, today)).toMatchObject({ kind: 'quote', perCwt: 740 })
  })

  it('ignores a nearest-market sale older than a fortnight', () => {
    const quotes = [q('medicine-hat', 400, 900, '2026-09-16'), q('calgary', 400, 780, '2026-10-02')]
    expect(headlinePrice(quotes, 450, today)).toMatchObject({ perCwt: 780 })
  })

  it('averages only the markets that sold it in the newest week', () => {
    const quotes = [q('calgary', 400, 780, '2026-10-02'), q('team-online', 400, 600, '2026-09-23')]
    const b = bandPrice(quotes, today)!
    expect(b.perCwt).toBe(780)
    expect(b.sources.map((s) => s.market)).toEqual(['calgary'])
  })

  it('is extrapolated, and says so, when the farm’s weight is lighter than every class sold', () => {
    const quotes = [q('calgary', 500, 643, '2026-10-02'), q('calgary', 600, 612, '2026-10-02')]
    const h = headlinePrice(quotes, 450, today)!
    expect(h.kind).toBe('extrapolated')
    expect(h.direction).toBe('below')
    expect(h.slope).toBeCloseTo(-0.31, 6)
    // 643 + (450 − 550) × −0.31 = 674
    expect(h.perCwt).toBeCloseTo(674, 6)
    expect(headlineSub(h)).toBe('extrapolated below the lightest class sold (500–600 lb, Calgary Stockyards 2 Oct)')
    const text = explainHeadline(h, 'steers').join(' ')
    expect(text).toContain('$643.00 + 100 × $0.31 = $674.00/cwt, or $6.74/lb')
    expect(text).toContain('extrapolated below the lightest class sold')
  })

  it('is derived, not extrapolated, between two classes that sold', () => {
    const quotes = [q('calgary', 300, 800, '2026-10-02'), q('calgary', 500, 640, '2026-10-02')]
    const h = headlinePrice(quotes, 450, today)!
    expect(h.kind).toBe('derived')
    expect(h.perCwt).toBeCloseTo(720, 6)
  })

  it('has nothing to say when nothing sold lately', () => {
    expect(headlinePrice([q('calgary', 400, 780, '2026-08-01')], 450, today)).toBeNull()
    expect(headlinePrice([], 450, today)).toBeNull()
  })

  it('explains a quote with the live numbers', () => {
    const h = headlinePrice(quotesOf([calgary, team], 'steers'), 450, today)!
    const text = explainHeadline(h, 'steers').join(' ')
    expect(text).toContain('Calgary Stockyards $780.00/cwt (2 Oct), Team online $686.00/cwt (2 Oct)')
    expect(text).toContain('Average $733.00/cwt')
    expect(text).toContain('$7.33/lb')
  })
})

describe('older Medicine Hat layout (to mid-2025)', () => {
  // One weight a row (no lot range), the class in a DESCRIPTION column, a
  // "0 TO 1099" class, and the grand total used when two totals are printed.
  const older = {
    sale_date: '2025-06-04',
    total_head: 13,
    sections: [
      { class: 'FEEDER HEIFERS', price_unit: 'cwt', rows: [{ weight_class: '400 TO 499', class_lo: 400, class_hi: 499, lot_min: null, lot_max: null, low: 480, high: 520, head: 6, avg: 501.5, avg_weight: 455 }] },
      { class: 'FEEDER BULLS', price_unit: 'cwt', rows: [{ weight_class: '0 TO 1099', class_lo: 0, class_hi: 1099, lot_min: null, lot_max: null, low: 300, high: 340, head: 7, avg: 322, avg_weight: 880 }] },
    ],
    unreadable: [],
    notes: ['no lot weight range is printed', 'two TOTAL SOLD figures; the grand total is used'],
  }

  it('validates without a lot range, and maps FEEDER classes to feeders', () => {
    const v = validateMhfcReply(older, '2025-06-04')
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const { rows } = mhfcRows(v.reply)
    expect(rows.map((r) => r.code).sort()).toEqual(['ab.feeder.bulls.0-1100.medicine-hat', 'ab.feeder.heifers.400-500.medicine-hat'])
  })

  it('still rejects an average weight outside its class', () => {
    const bad = structuredClone(older)
    bad.sections[0].rows[0].avg_weight = 620
    expect(validateMhfcReply(bad, '2025-06-04').ok).toBe(false)
  })
})

describe('Medicine Hat buybacks and per-head sections', () => {
  it('counts their head toward the total but checks no price', () => {
    const r = {
      sale_date: '2024-11-13',
      total_head: 12,
      sections: [
        { class: 'FEEDER STEERS', price_unit: 'cwt', rows: [{ weight_class: '500 TO 599', class_lo: 500, class_hi: 599, lot_min: null, lot_max: null, low: 400, high: 460, head: 8, avg: 431, avg_weight: 560 }] },
        { class: 'BUYBACKS', price_unit: 'cwt', rows: [{ weight_class: '0 TO 9999', class_lo: 0, class_hi: 9999, lot_min: null, lot_max: null, low: 0, high: 0, head: 2, avg: 0, avg_weight: null }] },
        { class: 'BRED COWS', price_unit: 'head', rows: [{ weight_class: '0 TO 9999', class_lo: 0, class_hi: 9999, lot_min: null, lot_max: null, low: 3100, high: 3400, head: 2, avg: 3250, avg_weight: null }] },
      ],
      unreadable: [],
    }
    const v = validateMhfcReply(r, '2024-11-13')
    expect(v.ok).toBe(true)
    if (v.ok) expect(mhfcRows(v.reply).rows.map((x) => x.code)).toEqual(['ab.feeder.steers.500-600.medicine-hat'])
  })
})

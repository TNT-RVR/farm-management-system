import { describe, expect, it } from 'vitest'
// ?raw keeps this a browser-target module — the app tsconfig has no node types.
import livestock from './__fixtures__/ab-livestock-review.txt?raw'
import {
  contractDate,
  parseCattleFutures,
  parseFeederQuotes,
  parseIssueDate,
  parseLivestockReview,
  parseSpotFx,
} from '../../netlify/shared/market-alberta'

// The fixture is the real 7 August 2026 issue, text-extracted exactly as the
// ingester sees it. Every expectation below was read off the PDF by hand first.
describe('Alberta livestock market review', () => {
  const parsed = parseLivestockReview(livestock)

  it('reads the issue date', () => {
    expect(parsed.observedOn).toBe('2026-08-07')
  })

  it('parses cleanly, with nothing to warn about', () => {
    expect(parsed.warnings).toEqual([])
  })

  it('pulls the CME feeder curve in the right months', () => {
    const feeder = parsed.futures.filter((f) => f.code === 'cme.feeder')
    expect(feeder.map((f) => [f.contractMonth, f.value])).toEqual([
      ['2026-08-01', 351.65],
      ['2026-09-01', 345.23],
      ['2026-10-01', 334.93],
      ['2026-11-01', 326.63],
      // JAN and MAR are quoted in August, so they belong to NEXT year. Getting
      // this wrong would put the January contract five months in the past.
      ['2027-01-01', 317.9],
      ['2027-03-01', 313.65],
    ])
  })

  it('separates live cattle from feeders, and both from the dollar', () => {
    const at = (code: string, month: string) =>
      parsed.futures.find((f) => f.code === code && f.contractMonth === month)?.value
    expect(at('cme.live', '2026-12-01')).toBe(224.15)
    expect(at('cme.feeder', '2026-10-01')).toBe(334.93)
    expect(at('cme.cad', '2026-12-01')).toBe(0.7178)
  })

  it('does not mistake the lean hog curve for cattle', () => {
    // Hogs are quoted on the same lines at 73-95. Nothing in that band should
    // have been picked up as a cattle contract.
    const hogRange = parsed.futures.filter((f) => f.value > 60 && f.value < 150)
    expect(hogRange).toEqual([])
  })

  it('reads feeder quotes with their weight class and market', () => {
    const q = parsed.quotes.find((x) => x.code === 'ab.feeder.steers.500-600.strathmore')
    expect(q).toMatchObject({ low: 615, high: 700, unit: '$/cwt', region: 'Strathmore' })
    expect(q?.value).toBe(657.5)
  })

  it('skips a market with no sale that week rather than recording a zero', () => {
    // Clyde and Ponoka show N/A right through the August issue — no sales, not
    // a price of nothing.
    expect(parsed.quotes.some((q) => /clyde|ponoka/.test(q.code))).toBe(false)
  })

  it('reads the spot exchange rate, converted out of US cents', () => {
    expect(parseSpotFx(livestock)?.value).toBe(0.7134)
  })
})

describe('contractDate', () => {
  const august = new Date('2026-08-07T12:00:00Z')

  it('keeps a month at or after the issue in the same year', () => {
    expect(contractDate('AUG', august)).toBe('2026-08-01')
    expect(contractDate('DEC', august)).toBe('2026-12-01')
  })

  it('rolls an earlier month into next year', () => {
    expect(contractDate('JAN', august)).toBe('2027-01-01')
    expect(contractDate('MAR', august)).toBe('2027-03-01')
  })

  it('gives null for something that is not a month', () => {
    expect(contractDate('LBS', august)).toBeNull()
  })
})

describe('refusing to guess', () => {
  it('warns rather than inventing quotes when the layout changes', () => {
    const r = parseFeederQuotes('WEEKLY LIVESTOCK MARKET REVIEW\nnothing familiar here')
    expect(r.quotes).toEqual([])
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('warns when a futures block is missing', () => {
    const r = parseCattleFutures('no futures in here at all', new Date('2026-08-07T12:00:00Z'))
    expect(r.futures).toEqual([])
    expect(r.warnings).toContain('no cme.feeder contracts parsed')
  })

  it('reads no issue date out of text that has none', () => {
    expect(parseIssueDate('no dates here')).toBeNull()
  })
})

import crop from './__fixtures__/ab-crop-review.txt?raw'
import {
  parseCropReview,
  parseElevatorBids,
  parseFraction,
  parseIceCanola,
  parseUsFutures,
} from '../../netlify/shared/market-alberta'

describe('Alberta crop market review', () => {
  const parsed = parseCropReview(crop)

  it('parses cleanly', () => {
    expect(parsed.observedOn).toBe('2026-08-07')
    expect(parsed.warnings).toEqual([])
  })

  it('reads the elevator bid for our own region, not a provincial average', () => {
    // "DURUM -South 278.23" is the number Prairie Creek would actually sell into.
    const durum = parsed.quotes.find((q) => q.code === 'ab.elevator.durum.south')
    expect(durum).toMatchObject({ value: 278.23, unit: '$/tonne', region: 'South' })
  })

  it('finds every elevator bid on the page', () => {
    const bids = parsed.quotes.filter((q) => q.code.startsWith('ab.elevator.'))
    expect(bids.map((b) => b.code).sort()).toEqual([
      'ab.elevator.canola.central',
      'ab.elevator.cps.central',
      'ab.elevator.durum.south',
      'ab.elevator.feed-barley.central',
      'ab.elevator.feed-oats.central',
      'ab.elevator.feed-wheat.central',
      'ab.elevator.flaxseed.central',
      'ab.elevator.sws-wheat.central',
    ])
  })

  it('does not swallow the neighbouring column into a commodity name', () => {
    // The flattened text really does read "MONTH FEED WHEAT -*Central 252.20",
    // and an earlier version recorded the commodity as "MONTH FEED WHEAT".
    expect(parsed.quotes.some((q) => /month/.test(q.code))).toBe(false)
  })

  it('gives us a corn price, which StatCan does not publish for Alberta at all', () => {
    const corn = parsed.futures.filter((f) => f.code === 'us.corn.cbt')
    expect(corn.map((c) => [c.contractMonth, c.value])).toEqual([
      ['2026-09-01', 4.52],
      ['2026-12-01', 4.7525],
    ])
  })

  it('carries the commodity down continuation lines', () => {
    // "-CBT DEC26" names no commodity; it belongs to the CORN above it.
    const minn = parsed.futures.filter((f) => f.code === 'us.wheat.minn')
    expect(minn).toHaveLength(4)
  })

  it('pairs the ICE canola curve, whose prices are orphaned at the foot of the page', () => {
    const canola = parsed.futures.filter((f) => f.code === 'ice.canola')
    expect(canola.map((c) => [c.contractMonth, c.value])).toEqual([
      ['2026-11-01', 801.6],
      ['2027-01-01', 805.4],
      ['2027-03-01', 788.8],
      ['2027-05-01', 795.8],
      ['2027-07-01', 779.8],
    ])
  })

  it('refuses to pair canola when the counts disagree', () => {
    // A wrong futures curve is worse than none: you would act on it.
    const trimmed = crop.replace('-SASK JUL27', '')
    const r = parseIceCanola(trimmed)
    expect(r.futures).toEqual([])
    expect(r.warnings[0]).toMatch(/not paired/)
  })
})

describe('parseFraction', () => {
  it('reads eighths of a cent as hundredths of a dollar', () => {
    // 6.59 1/2 is $6.595 a bushel. Reading it as 6.59 is half a cent out on
    // every contract — small money on a bushel, real money on a crop.
    expect(parseFraction('6.59 1/2')).toBeCloseTo(6.595, 6)
    expect(parseFraction('6.26 3/4')).toBeCloseTo(6.2675, 6)
    expect(parseFraction('7.54')).toBe(7.54)
  })

  it('gives null for anything that is not a price', () => {
    expect(parseFraction('N/A')).toBeNull()
    expect(parseFraction('')).toBeNull()
  })
})

describe('crop parser refusing to guess', () => {
  it('warns rather than inventing bids', () => {
    expect(parseElevatorBids('nothing here').warnings).toContain('no elevator bids parsed')
    expect(parseUsFutures('nothing here').warnings).toContain('no US futures block found')
  })
})

import { describe, it, expect } from 'vitest'
import {
  lookupWco,
  monthDay,
  periodFor,
  periodLabel,
  supplyVerdict,
  type WcoBand,
  type WcoSegment,
} from './river-wco'

const SEGMENT: WcoSegment = {
  id: 'seg-1',
  slug: 'oldman-seg4',
  label: 'Oldman River, Segment 4',
  bounds: 'LNID weir to the Rocky Coulee confluence',
  gauge_station: '05AD007',
  gauge_label: 'Oldman River near Lethbridge',
  paper_id: 'paper-1',
  published: '2013',
  winter_wco_cms: 7.15,
  winter_window: 'December 3 to April 1 inclusive',
  note: 'the reach the district diverts from',
  created_at: '2026-11-04T00:00:00Z',
}

let seq = 0
const band = (period_md: string, band_seq: number, natural_flow_cms: number | null, wco_cms: number): WcoBand => ({
  id: `b${seq++}`,
  segment_id: 'seg-1',
  period_md,
  band_seq,
  natural_flow_cms,
  wco_cms,
})

/**
 * The July 16 column of Schedule 1, as the PDF prints it: the "<" row then the
 * bands, with the first two sharing a threshold (which the schedule's own note
 * says resolves to the first).
 */
const JUL16: WcoBand[] = [
  band('07-16', 1, null, 9.35),
  band('07-16', 2, 26.3, 9.35),
  band('07-16', 3, 27.7, 9.9),
  band('07-16', 4, 32.1, 11.0),
  band('07-16', 5, 39.6, 12.1),
  band('07-16', 6, 41.3, 13.2),
  band('07-16', 7, 42.8, 14.3),
  band('07-16', 8, 46.1, 15.4),
]
const JUL23: WcoBand[] = [band('07-23', 1, null, 9.35), band('07-23', 2, 21.2, 9.35), band('07-23', 3, 22.3, 9.9)]
const BANDS = [...JUL16, ...JUL23]
const PERIODS = ['04-02', '07-16', '07-23', '11-26']

describe('periodFor', () => {
  it('picks the seven-day period a date falls in', () => {
    expect(periodFor(PERIODS, '07-16')).toBe('07-16')
    expect(periodFor(PERIODS, '07-20')).toBe('07-16')
    expect(periodFor(PERIODS, '07-23')).toBe('07-23')
  })

  it('reads the winter window as having no period', () => {
    expect(periodFor(PERIODS, '04-01')).toBeNull()
    expect(periodFor(PERIODS, '01-15')).toBeNull()
    expect(periodFor(PERIODS, '12-03')).toBeNull()
    expect(periodFor(PERIODS, '12-31')).toBeNull()
  })

  it('keeps the last period through the days before December 3', () => {
    expect(periodFor(PERIODS, '11-30')).toBe('11-26')
    expect(periodFor(PERIODS, '12-02')).toBe('11-26')
  })
})

describe('monthDay', () => {
  it('pads to MM-DD', () => {
    expect(monthDay(new Date(2026, 6, 4))).toBe('07-04')
    expect(monthDay(new Date(2026, 10, 26))).toBe('11-26')
  })
})

describe('lookupWco', () => {
  it('gives the period’s floor and ceiling', () => {
    const l = lookupWco(SEGMENT, BANDS, '2026-07-18', null)
    expect(l.periodMd).toBe('07-16')
    expect(l.floorCms).toBe(9.35)
    expect(l.ceilingCms).toBe(15.4)
    expect(l.impliedCms).toBeNull()
  })

  it('lands a measured flow in the band at or below it', () => {
    expect(lookupWco(SEGMENT, BANDS, '2026-07-18', 45).impliedCms).toBe(14.3)
    expect(lookupWco(SEGMENT, BANDS, '2026-07-18', 42.8).impliedCms).toBe(14.3)
    expect(lookupWco(SEGMENT, BANDS, '2026-07-18', 42.7).impliedCms).toBe(13.2)
    expect(lookupWco(SEGMENT, BANDS, '2026-07-18', 100).impliedCms).toBe(15.4)
  })

  it('falls to the driest band below the schedule’s first threshold', () => {
    const l = lookupWco(SEGMENT, BANDS, '2026-07-18', 10)
    expect(l.impliedCms).toBe(9.35)
    expect(l.impliedBandCms).toBeNull()
  })

  it('returns the flat winter objective inside the winter window', () => {
    const l = lookupWco(SEGMENT, BANDS, '2026-01-20', 8)
    expect(l.winter).toBe(true)
    expect(l.impliedCms).toBe(7.15)
    expect(l.floorCms).toBe(7.15)
    expect(l.periodMd).toBeNull()
  })

  it('has nothing to say without a segment', () => {
    expect(lookupWco(null, BANDS, '2026-07-18', 45).impliedCms).toBeNull()
  })
})

describe('supplyVerdict', () => {
  it('is below when the reach carries less than the objective', () => {
    expect(supplyVerdict(9.0, 9.35)).toBe('below')
  })

  it('is tight under one and a half times the objective', () => {
    expect(supplyVerdict(10, 9.35)).toBe('tight')
    expect(supplyVerdict(14.02, 9.35)).toBe('tight')
    expect(supplyVerdict(14.03, 9.35)).toBe('ok')
  })

  it('knows nothing without a reading', () => {
    expect(supplyVerdict(null, 9.35)).toBe('unknown')
    expect(supplyVerdict(45, null)).toBe('unknown')
  })
})

describe('periodLabel', () => {
  it('names the period in words', () => {
    expect(periodLabel('07-16')).toBe('July 16')
    expect(periodLabel(null)).toBeNull()
  })
})

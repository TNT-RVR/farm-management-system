import { describe, expect, it } from 'vitest'
import { daysInPeriod, describeQuantity, poundsFor, summarise, type FeedLine } from './feedRecords'

const lb = (feedTypeName: string, quantity: number): FeedLine => ({
  feedTypeName,
  quantity,
  unit: 'lb',
  purpose: 'feed',
})

// The cattle manager writes his own average in the margin of every month. These
// are his numbers, off the East Ranch cows sheet, 167 head. If this file stops
// reproducing them, the model has drifted from what he actually records.
//
// He rounds to the nearest half pound — 61.60 is written 61.5, 73.55 is 73.5 —
// so that is what these compare. Asserting his exact decimal would be asserting
// his rounding, and asserting ours to two places would fail on a habit rather
// than on a mistake.
const toNearestHalf = (n: number) => Math.round(n * 2) / 2
describe('against the handwritten sheets', () => {
  it('February 2025 comes to his 61.5 lb per cow per day', () => {
    const s = summarise(
      { periodStart: '2025-02-01', periodEnd: '2025-02-28', headCount: 167 },
      [
        lb('Silage', 233_100),
        lb('Green feed', 38_550),
        lb('2nd Cut Alfalfa', 4_500),
        lb('Grain Corn', 11_900),
        // 8 big squares and 3 rounds of straw, which must not reach the average.
        { feedTypeName: 'Straw for Bedding', quantity: 8, unit: 'big_square', lbPerBale: 1200, purpose: 'bedding' },
        { feedTypeName: 'Straw for Bedding', quantity: 3, unit: 'round', lbPerBale: 1500, purpose: 'bedding' },
      ],
    )
    expect(s.feedLb).toBe(288_050)
    expect(toNearestHalf(s.lbPerHeadPerDay!)).toBe(61.5)
    expect(s.beddingLb).toBe(14_100)
  })

  it('April 2025 comes to his 73.5', () => {
    const s = summarise(
      { periodStart: '2025-04-01', periodEnd: '2025-04-30', headCount: 167 },
      [lb('Silage', 282_163), lb('Green feed', 38_417), lb('Durum Silage', 47_900)],
    )
    expect(toNearestHalf(s.lbPerHeadPerDay!)).toBe(73.5)
  })

  it('May 2025 comes to his 71.5', () => {
    const s = summarise(
      { periodStart: '2025-05-01', periodEnd: '2025-05-31', headCount: 167 },
      [lb('Silage', 330_600), lb('Green feed', 39_900)],
    )
    expect(toNearestHalf(s.lbPerHeadPerDay!)).toBe(71.5)
  })

  it('handles a period cut short by a sale, which is why periods are not months', () => {
    // 78 heifers sold on 14 April, so he split the month and averaged each half.
    const s = summarise(
      { periodStart: '2025-04-15', periodEnd: '2025-04-30', headCount: 100 },
      [lb('Silage', 68_500), lb('3rd Cut Alfalfa', 17_800)],
    )
    expect(s.days).toBe(16)
    expect(s.feedLb).toBe(86_300)
  })
})

describe('poundsFor', () => {
  it('takes pounds at face value', () => {
    expect(poundsFor({ quantity: 233_100, unit: 'lb' })).toBe(233_100)
  })

  it('multiplies a bale count by what a bale weighs', () => {
    // "Sainfoin Selffeeder = 5 Rounds x 1,300 LBs = 6,500", off the calves sheet.
    expect(poundsFor({ quantity: 5, unit: 'round', lbPerBale: 1300 })).toBe(6_500)
  })

  it('returns null, NOT zero, for a bale of unknown weight', () => {
    // Zero would shrink the total silently and make a partial record look like
    // a light month. Null makes the caller admit the number is incomplete.
    expect(poundsFor({ quantity: 3, unit: 'round', lbPerBale: null })).toBeNull()
    expect(poundsFor({ quantity: 3, unit: 'big_square' })).toBeNull()
  })
})

describe('summarise', () => {
  it('counts self-feeder as intake but never bedding', () => {
    const s = summarise({ periodStart: '2025-03-01', periodEnd: '2025-03-31', headCount: 10 }, [
      lb('Silage', 1000),
      { feedTypeName: 'Sainfoin', quantity: 2, unit: 'round', lbPerBale: 1300, purpose: 'self_feeder' },
      { feedTypeName: 'Straw', quantity: 1, unit: 'round', lbPerBale: 1500, purpose: 'bedding' },
    ])
    expect(s.feedLb).toBe(3_600)
    expect(s.beddingLb).toBe(1_500)
  })

  it('reports lines it could not weigh rather than absorbing them', () => {
    const s = summarise({ periodStart: '2025-03-01', periodEnd: '2025-03-31', headCount: 10 }, [
      lb('Silage', 1000),
      { feedTypeName: 'Sainfoin', quantity: 2, unit: 'round', lbPerBale: null, purpose: 'feed' },
    ])
    expect(s.feedLb).toBe(1000)
    expect(s.incompleteLines).toBe(1)
  })

  it('gives no average without a head count', () => {
    const s = summarise({ periodStart: '2025-03-01', periodEnd: '2025-03-31', headCount: null }, [
      lb('Silage', 1000),
    ])
    expect(s.lbPerHeadPerDay).toBeNull()
  })
})

describe('daysInPeriod', () => {
  it('counts both ends', () => {
    expect(daysInPeriod('2025-01-01', '2025-01-31')).toBe(31)
    expect(daysInPeriod('2025-02-01', '2025-02-28')).toBe(28)
    expect(daysInPeriod('2025-04-01', '2025-04-14')).toBe(14)
  })

  it('is zero for nonsense rather than negative', () => {
    expect(daysInPeriod('2025-04-30', '2025-04-01')).toBe(0)
    expect(daysInPeriod('nope', '2025-04-01')).toBe(0)
  })
})

describe('describeQuantity', () => {
  it('reads the way the sheet is written', () => {
    expect(describeQuantity({ quantity: 8, unit: 'big_square' })).toBe('8 Big Squares')
    expect(describeQuantity({ quantity: 1, unit: 'round' })).toBe('1 Round')
    expect(describeQuantity({ quantity: 233100, unit: 'lb' })).toBe('233,100 lb')
  })
})

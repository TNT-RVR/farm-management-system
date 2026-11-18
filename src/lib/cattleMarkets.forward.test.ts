import { describe, expect, it } from 'vitest'
import { forwardBidPerLb } from './cattleMarkets'

describe('forwardBidPerLb', () => {
  // 18 Nov 2026, the farm's own quotes: 750 lb steers 4.65/lb, CME Nov 339.02 and
  // Jan 335.35 USD/cwt at 1.4255. The old arithmetic read 6.37/lb.
  const fx = 1.4255
  it('is this week’s price at our weight when the sale month is the nearby contract', () => {
    expect(forwardBidPerLb(4.65, 339.02 * fx, 339.02 * fx)).toBeCloseTo(4.65, 6)
  })
  it('moves by the board’s change to the sale month, in CAD/lb', () => {
    // (335.35 − 339.02) × 1.4255 ÷ 100 = −0.0523
    expect(forwardBidPerLb(4.65, 339.02 * fx, 335.35 * fx)).toBeCloseTo(4.598, 3)
  })
})

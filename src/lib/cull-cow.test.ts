import { describe, expect, it } from 'vitest'
import { cullCowPrice, cullCowSourceLine, type CowQuote } from './auction-markets'

const q = (market: CowQuote['market'], kind: string, perCwt: number, on: string, band: CowQuote['band'] = null): CowQuote => ({ market, kind, perCwt, on, band })

describe('cull cow price from the auction markets', () => {
  it('averages the nearest markets: Lethbridge D1-D2 and Medicine Hat slaughter cows in the cows’ weight class', () => {
    const p = cullCowPrice(
      [
        q('lethbridge', 'd1-d2', 205, '2026-10-01'),
        q('lethbridge', 'd1-d2', 199, '2026-09-24'),
        q('medicine-hat', 'slaughter', 175, '2026-09-30', { lo: 900, hi: 1000 }),
        q('medicine-hat', 'slaughter', 192.15, '2026-09-30', { lo: 1250, hi: 1500 }),
        q('calgary', 'd1-d2', 223, '2026-10-02'),
      ],
      1350,
      '2026-10-05',
    )!
    expect(p.basis).toBe('nearest')
    expect(p.perCwt).toBeCloseTo((205 + 192.15) / 2, 2)
    expect(cullCowSourceLine(p)).toContain('Medicine Hat slaughter cows 1250–1500 lb $192.15/cwt 30 Sep')
  })

  it('falls back to the other markets that week when neither near one sold cows', () => {
    const p = cullCowPrice([q('calgary', 'd1-d2', 223, '2026-10-02'), q('lethbridge', 'd1-d2', 205, '2026-09-01')], 1500, '2026-10-05')!
    expect(p.basis).toBe('week')
    expect(p.perCwt).toBe(223)
  })

  it('is null with nothing in the last two weeks', () => {
    expect(cullCowPrice([q('lethbridge', 'd1-d2', 205, '2026-09-01')], 1400, '2026-10-05')).toBeNull()
  })
})

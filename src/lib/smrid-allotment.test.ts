import { describe, expect, it } from 'vitest'
import { latestAllocations, readAllocation } from '../../netlify/shared/smrid-allotment'

const post = (date: string, text: string) => ({ date, title: 't', link: 'l', text })

describe('SMRID allotment from the notices', () => {
  it('reads the allocation a notice sets, with its season', () => {
    const a = readAllocation(
      post(
        '2026-07-30',
        'Based on modelling supplied by Alberta Agriculture and Irrigation’s Water Basin Management Branch, SMRID’s Board of Directors has approved a motion to raise allocation to 17 inches at the farm gate for the 2026 irrigation season, effective immediately. Contracts remain 18 inches.',
      ),
    )
    expect(a).toMatchObject({ year: 2026, inches: 17 })
  })

  it('ignores the contract figure and posts with no allocation', () => {
    expect(readAllocation(post('2026-08-27', 'SMRID breaks ground on Phase 1 of the Chin expansion, adding storage.'))).toBeNull()
    expect(readAllocation(post('2026-03-01', 'Each acre is contracted for 18 inches.'))).toBeNull()
  })

  it('keeps the newest per season, and the trail', () => {
    const got = latestAllocations([
      post('2026-06-25', 'The Board of Directors has decided to raise the water allocation to 16 inches at the farm gate for the 2026 irrigation season, effective immediately.'),
      post('2026-06-05', 'The Board of Directors has motioned to raise the water allocation to 15 inches at the farm gate for the 2026 irrigation season.'),
      post('2026-07-30', 'SMRID’s Board has approved a motion to raise allocation to 17 inches at the farm gate for the 2026 irrigation season.'),
      post('2025-04-10', 'The initial allocation for the 2025 irrigation season is 12 inches.'),
    ])
    expect(got.map((g) => [g.year, g.latest.inches])).toEqual([
      [2025, 12],
      [2026, 17],
    ])
    expect(got[1].trail.map((t) => t.inches)).toEqual([15, 16, 17])
  })
})

import { describe, expect, it } from 'vitest'
import { GAUGE_GAP_FLAG, daysInWindow, gaugeGap, gaugeTotal, gaugeUsable, nearestStation } from './ranch-gauge'

const STATIONS = [
  { id: 'gl', name: 'Home Ranch IMCIN', lat: 52.3737, lon: -113.5328 },
  { id: 'fc', name: 'Westfield IMCIN', lat: 52.3023, lon: -113.8459 },
  { id: 'bi', name: 'East Ranch (ACIS)', lat: 52.234186, lon: -113.250278 },
]

describe('nearestStation', () => {
  it('picks each ranch its own gauge', () => {
    // The two ranch locations as they sit in `ranches`.
    expect(nearestStation(STATIONS, 52.4106, -113.5024)?.name).toBe('Home Ranch IMCIN')
    expect(nearestStation(STATIONS, 52.3686, -113.1689)?.name).toBe('East Ranch (ACIS)')
  })

  it('reports a distance worth showing on screen', () => {
    // Home Ranch's gauge is next door; East Ranch's is 16 km off, which is
    // far enough that the number belongs beside the reading.
    expect(nearestStation(STATIONS, 52.4106, -113.5024)!.km).toBeCloseTo(4.6, 0)
    expect(nearestStation(STATIONS, 52.3686, -113.1689)!.km).toBeCloseTo(16, 0)
  })

  it('has nothing to say with no stations', () => {
    expect(nearestStation([], 52.4, -113.5)).toBeNull()
  })
})

describe('daysInWindow', () => {
  it('counts both ends', () => {
    expect(daysInWindow('2026-04-01', '2026-04-01')).toBe(1)
    expect(daysInWindow('2026-04-01', '2026-10-31')).toBe(214)
  })

  it('refuses a backwards or unparseable window', () => {
    expect(daysInWindow('2026-10-31', '2026-04-01')).toBe(0)
    expect(daysInWindow('', '2026-04-01')).toBe(0)
  })
})

describe('gaugeTotal', () => {
  it('sums the days that reported', () => {
    const g = gaugeTotal([
      { date: '2026-04-01', precip_mm: 2.5 },
      { date: '2026-04-02', precip_mm: 0 },
      { date: '2026-04-03', precip_mm: 11.25 },
    ])
    expect(g.mm).toBe(13.8)
    expect(g.days).toBe(3)
  })

  it('does not count a missing day as a dry one', () => {
    // A null is an absent reading. Treating it as zero would turn a gap in the
    // record into a drought, which is the whole reason coverage is checked.
    const g = gaugeTotal([
      { date: '2026-04-01', precip_mm: 5 },
      { date: '2026-04-02', precip_mm: null },
    ])
    expect(g.mm).toBe(5)
    expect(g.days).toBe(1)
  })
})

describe('gaugeUsable', () => {
  it('wants nine days in ten', () => {
    expect(gaugeUsable({ days: 214, expected: 214 })).toBe(true)
    expect(gaugeUsable({ days: 193, expected: 214 })).toBe(true)
    expect(gaugeUsable({ days: 192, expected: 214 })).toBe(false)
  })

  it('is false with no window at all', () => {
    expect(gaugeUsable({ days: 0, expected: 0 })).toBe(false)
  })
})

describe('gaugeGap', () => {
  it('is negative when the gauge is the drier one', () => {
    expect(gaugeGap(281, 387)).toBeCloseTo(-0.274, 3)
    expect(gaugeGap(400, 380)).toBeCloseTo(0.0526, 3)
  })

  it('claims nothing without a grid total', () => {
    expect(gaugeGap(281, null)).toBeNull()
    expect(gaugeGap(281, 0)).toBeNull()
    expect(gaugeGap(281, undefined)).toBeNull()
  })

  /*
   * The 2026 season as the two instruments actually measured it, which is why
   * the flag exists at all. Home Ranch's ordinary 8% disagreement stays
   * quiet; East Ranch's 27% does not, and at East Ranch the gap is the
   * difference between 131% of a normal season and 95% over 2,923 acres.
   */
  it('flags East Ranch and leaves Home Ranch alone', () => {
    const homeRanch = gaugeGap(352.8, 384.5)!
    const eastRanch = gaugeGap(280.7, 386.9)!
    expect(Math.abs(homeRanch)).toBeLessThan(GAUGE_GAP_FLAG)
    expect(Math.abs(eastRanch)).toBeGreaterThan(GAUGE_GAP_FLAG)
    expect(Math.round(eastRanch * 100)).toBe(-27)
  })
})

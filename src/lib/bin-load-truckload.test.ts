import { describe, expect, it } from 'vitest'
import { overATruckload } from './bin-loads'

/** The loads weighed on 26–27 Oct 2026, the day this went wrong. */
const weighed = [16_190, 44_150, 52_720, 43_740, 48_710, 35_480, 44_900].map((net) => ({
  entry_kind: 'weighed' as const,
  net_kg: net,
}))

describe('a weight that is the loaded truck, not the grain', () => {
  it('catches the 67,980 kg saved as a net on 27 Oct 2026', () => {
    expect(overATruckload(67_980, weighed)).toEqual({ biggest: 52_720 })
  })

  it('leaves the real loads of that day alone', () => {
    for (const l of weighed) expect(overATruckload(l.net_kg, weighed)).toBeNull()
  })

  it('leaves room above the biggest load they have hauled', () => {
    // 15% over the biggest (52,720 → 60,628) still goes through.
    expect(overATruckload(60_000, weighed)).toBeNull()
    expect(overATruckload(61_000, weighed)).toEqual({ biggest: 52_720 })
  })

  it('still catches a truckload-and-a-half with no history to go on', () => {
    expect(overATruckload(67_980, [])).toEqual({ biggest: null })
    expect(overATruckload(44_000, [])).toBeNull()
  })

  it('says nothing about a missing weight', () => {
    expect(overATruckload(null, weighed)).toBeNull()
    expect(overATruckload(undefined, weighed)).toBeNull()
  })

  it('ignores one-number entries when working out the biggest load', () => {
    // A bin total of a whole bin is not a truckload, so it must not raise the bar.
    const withBinTotal = [...weighed, { entry_kind: 'bin_total' as const, net_kg: 120_000 }]
    expect(overATruckload(67_980, withBinTotal)).toEqual({ biggest: 52_720 })
  })
})

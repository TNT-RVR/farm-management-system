import { describe, expect, it } from 'vitest'
import { SAVINGS_HOMES, savingsToolHref } from './homes'

describe('savings tools that live on another tab', () => {
  it('forwards an old ?tool= to the card on its home tab', () => {
    expect(savingsToolHref(4)).toBe('/fertilizer/plan?tab=requirements&tool=4')
    expect(savingsToolHref(9)).toBe('/fertilizer/manure?tool=9')
    expect(savingsToolHref(22)).toBe('/grants?tool=22')
  })

  it('sends the record pack to its report, and leaves the rest on Savings', () => {
    expect(savingsToolHref(36)).toBe('/reports?open=nerp')
    expect(savingsToolHref(1)).toBeNull()
    expect(savingsToolHref(NaN)).toBeNull()
  })

  it('names each tool once', () => {
    const ns = SAVINGS_HOMES.map((h) => h.n)
    expect(new Set(ns).size).toBe(ns.length)
  })
})

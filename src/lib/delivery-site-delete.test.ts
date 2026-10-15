import { describe, expect, it } from 'vitest'
import { siteDeleteBlocker } from './delivery-site-delete'

describe('siteDeleteBlocker', () => {
  it('lets an unused site go', () => {
    expect(siteDeleteBlocker({ loads: 0, haulPlans: 0 })).toBeNull()
  })
  it('names what keeps it', () => {
    expect(siteDeleteBlocker({ loads: 1, haulPlans: 0 })).toBe('Used by 1 load')
    expect(siteDeleteBlocker({ loads: 12, haulPlans: 2 })).toBe('Used by 12 loads and 2 field haul plans')
  })
})

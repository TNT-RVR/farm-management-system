import { describe, expect, it } from 'vitest'
import { fleetAlerts } from './fleet-alerts'

/*
 * The strip above the equipment list. Tested rather than looked at, because
 * there is nothing on the farm to make it appear: all 59 machines in
 * jd_equipment have no warranty date and none carry both a warranty-hour limit
 * and an engine-hour reading, so both counts are a true zero today. The day
 * somebody fills a warranty date in is the day this has to read properly.
 */

describe('what the fleet needs doing', () => {
  it('says nothing when there is nothing to do', () => {
    expect(fleetAlerts({ endingSoon: 0, servicesDue: 0 })).toEqual([])
  })

  it('counts one of each in the singular', () => {
    expect(fleetAlerts({ endingSoon: 1, servicesDue: 1 })).toEqual([
      { key: 'warranty', text: '1 warranty running out' },
      { key: 'service', text: '1 service due' },
    ])
  })

  it('counts several in the plural', () => {
    expect(fleetAlerts({ endingSoon: 4, servicesDue: 11 })).toEqual([
      { key: 'warranty', text: '4 warranties running out' },
      { key: 'service', text: '11 services due' },
    ])
  })

  it('leaves out the half that has nothing to say', () => {
    expect(fleetAlerts({ endingSoon: 2, servicesDue: 0 })).toEqual([
      { key: 'warranty', text: '2 warranties running out' },
    ])
    expect(fleetAlerts({ endingSoon: 0, servicesDue: 3 })).toEqual([
      { key: 'service', text: '3 services due' },
    ])
  })

  it('gives each line its own key, so the strip can pick an icon', () => {
    const keys = fleetAlerts({ endingSoon: 1, servicesDue: 1 }).map((a) => a.key)
    expect(keys).toEqual(['warranty', 'service'])
    expect(new Set(keys).size).toBe(keys.length)
  })
})

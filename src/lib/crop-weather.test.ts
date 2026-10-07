import { describe, expect, it } from 'vitest'
import { cropAlerts } from './crop-weather'

const day = (date: string, tmax: number | null, tmin: number | null) => ({ date, tmax, tmin })

describe('frost and heat by crop stage', () => {
  it('warns of heat only while the crop is in its sensitive window', () => {
    // Canola planted 11 May: flowering ~25 Jun–24 Jul.
    const a = cropAlerts({ crop: 'Canola', plantedOn: '2026-05-11', harvestStarted: false, forecast: [day('2026-07-05', 31, 12), day('2026-08-10', 33, 12)] })
    expect(a).toEqual([{ kind: 'heat', date: '2026-07-05', temp: 31, dap: 55, why: expect.any(String) }])
  })

  it('warns of frost on standing beans, and says nothing once harvest has started', () => {
    const f = [day('2026-09-29', 12, -1)]
    expect(cropAlerts({ crop: 'Beans-Pinto', plantedOn: '2026-05-19', harvestStarted: false, forecast: f })[0].kind).toBe('frost')
    expect(cropAlerts({ crop: 'Beans-Pinto', plantedOn: '2026-05-19', harvestStarted: true, forecast: f })).toEqual([])
  })

  it('lets a mature crop and a crop with no rule alone', () => {
    // Corn planted 15 Apr is past black layer by late September.
    expect(cropAlerts({ crop: 'Corn', plantedOn: '2026-04-15', harvestStarted: false, forecast: [day('2026-09-29', 10, -3)] })).toEqual([])
    expect(cropAlerts({ crop: 'Green Feed', plantedOn: '2026-06-25', harvestStarted: false, forecast: [day('2026-09-29', 10, -3)] })).toEqual([])
    expect(cropAlerts({ crop: 'Canola', plantedOn: null, harvestStarted: false, forecast: [day('2026-07-05', 35, 12)] })).toEqual([])
  })
})

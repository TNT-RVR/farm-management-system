import { describe, expect, it } from 'vitest'
import { asOfDay, nearestPerSubject, systemsOn, type PivotPass } from './map-as-of'
import type { Database } from './database.types'

type Sys = Database['public']['Tables']['fieldnet_systems']['Row']

describe('the map on a past day', () => {
  it('takes only a well-formed day before today from the address', () => {
    expect(asOfDay('2026-09-15', '2026-10-29')).toBe('2026-09-15')
    expect(asOfDay('2026-10-29', '2026-10-29')).toBeNull()
    expect(asOfDay('2026-11-02', '2026-10-29')).toBeNull()
    expect(asOfDay('15/09/2026', '2026-10-29')).toBeNull()
    expect(asOfDay(null, '2026-10-29')).toBeNull()
  })

  it('picks each field’s image nearest the day, either side, the earlier on a tie', () => {
    const rows = [
      { subject_id: 'a', sensed_on: '2026-08-04' },
      { subject_id: 'a', sensed_on: '2026-09-10' },
      { subject_id: 'a', sensed_on: '2026-09-20' },
      { subject_id: 'b', sensed_on: '2026-10-21' },
    ]
    const got = nearestPerSubject(rows, '2026-09-15')
    expect(got.find((r) => r.subject_id === 'a')?.sensed_on).toBe('2026-09-10')
    expect(got.find((r) => r.subject_id === 'b')?.sensed_on).toBe('2026-10-21')
    expect(nearestPerSubject(rows, '2026-09-18').find((r) => r.subject_id === 'a')?.sensed_on).toBe('2026-09-20')
  })

  it('shows a pivot running on a day a pass ran, its arm where the last pass left it', () => {
    const sys = { fieldnet_id: 'p1', comms_status: 'offline', is_water_on: false, operational_status: 'fault-x', direction: 'reverse', raw: { pivot_angle: 10 } } as unknown as Sys
    const passes: PivotPass[] = [
      { fieldnet_id: 'p1', started_at: '2026-09-01T10:00:00Z', ended_at: '2026-09-01T20:00:00Z', start_deg: 0, end_deg: 90, direction: 'forward' },
      { fieldnet_id: 'p1', started_at: '2026-09-03T10:00:00Z', ended_at: '2026-09-04T02:00:00Z', start_deg: 90, end_deg: 200, direction: 'forward' },
    ]
    // A farm day in Alberta summer: 06:00 UTC to 05:59:59 the next morning.
    const on = (d: string) => {
      const start = new Date(`${d}T06:00:00Z`)
      return systemsOn([sys], passes, start, new Date(start.getTime() + 86_400_000 - 1))[0]
    }
    // The 2nd: no pass that day; the arm where the 1st's pass stopped.
    expect(on('2026-09-02')).toMatchObject({ is_water_on: false, comms_status: 'online', operational_status: 'powered-off', raw: { pivot_angle: 90 } })
    // The 3rd (and the small hours of the 4th): running.
    expect(on('2026-09-03')).toMatchObject({ is_water_on: true, operational_status: 'running', direction: 'forward', raw: { pivot_angle: 200 } })
    // Before any pass: off, today's arm left alone.
    expect(on('2026-08-01')).toMatchObject({ is_water_on: false, raw: { pivot_angle: 10 } })
  })
})

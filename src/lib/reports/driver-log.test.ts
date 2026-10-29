import { describe, expect, it } from 'vitest'
import { daysOf, driverOf, sameDayTime, tripOf, type LogLoad } from './driver-log'

const T = { payloadT: 42, lPerKm: 0.55, loadMin: 20, unloadMin: 15, timeFactor: 1.15 }
const TZ = 'America/Edmonton'
const load = (o: Partial<LogLoad>): LogLoad => ({
  id: 'l',
  loaded_on: '2026-10-20',
  created_at: '2026-10-20T21:15:13Z',
  driver_id: 'u1',
  driver: 'Paul',
  field_id: 'f4',
  bin_id: 'b1',
  delivery_site_id: null,
  entry_kind: 'weighed',
  load_count: null,
  net_kg: 47850,
  estimated: false,
  truck: null,
  trailer: null,
  ...o,
})

describe('driverOf', () => {
  it('the person on file, else the name typed, else nobody', () => {
    expect(driverOf(load({}), () => 'Paul Lena')).toEqual({ key: 'id:u1', name: 'Paul Lena' })
    expect(driverOf(load({ driver_id: null, driver: ' John ' }), () => null)).toEqual({ key: 'name:john', name: 'John' })
    expect(driverOf(load({ driver_id: null, driver: null }), () => null).key).toBe('none')
  })
  it('a typed name that is a person’s name is that person, not a second driver', () => {
    const byName = (n: string) => (n === 'sam example' ? 'u9' : null)
    expect(driverOf(load({ driver_id: null, driver: 'Sam  Example' }), () => 'Sam Example', byName)).toEqual({ key: 'id:u9', name: 'Sam Example' })
    expect(driverOf(load({ driver_id: null, driver: 'Sam' }), () => null, byName).key).toBe('name:sam')
  })
})

describe('sameDayTime', () => {
  it('the farm’s clock time when saved on the day hauled, else nothing', () => {
    // 21:15 UTC on 20 Oct is 15:15 in Alberta (MDT).
    expect(sameDayTime('2026-10-20T21:15:13Z', '2026-10-20', TZ)).toBe('15:15')
    // Typed in days later.
    expect(sameDayTime('2026-10-14T21:28:49Z', '2026-10-09', TZ)).toBeNull()
    // 02:06 UTC on the 21st is still the evening of the 20th on the farm.
    expect(sameDayTime('2026-10-21T02:06:01Z', '2026-10-20', TZ)).toBe('20:06')
  })
})

describe('tripOf and daysOf', () => {
  const route = { km: 10, min: 15 }
  it('a load is a round trip; on duty adds filling and dumping', () => {
    const t = tripOf(load({}), { key: 'id:u1', name: 'Paul' }, route, T, TZ)
    expect(t.km).toBe(20)
    expect(t.driveMin).toBeCloseTo(34.5, 5)
    expect(t.dutyMin).toBeCloseTo(69.5, 5)
  })
  it('a bin total over three loads is three round trips; no route counts duty only', () => {
    const t = tripOf(load({ entry_kind: 'bin_total', load_count: 3 }), { key: 'x', name: 'x' }, route, T, TZ)
    expect(t.trips).toBe(3)
    expect(t.km).toBe(60)
    const none = tripOf(load({ field_id: null }), { key: 'x', name: 'x' }, null, T, TZ)
    expect(none.km).toBeNull()
    expect(none.dutyMin).toBe(35)
  })
  it('a day with clock times runs from before the first load to after the last', () => {
    const d = { key: 'id:u1', name: 'Paul' }
    const trips = [
      tripOf(load({ created_at: '2026-10-20T15:00:00Z' }), d, route, T, TZ), // 09:00
      tripOf(load({ created_at: '2026-10-20T22:00:00Z' }), d, route, T, TZ), // 16:00
    ]
    const [day] = daysOf(trips)
    expect(day.loads).toBe(2)
    expect(day.km).toBe(40)
    // Out empty 17.25 + filling 20 + in loaded 17.25 before 09:00; dumping 15 after 16:00.
    // 09:00 less 54.5 minutes is 08:05:30, shown as 08:06.
    expect(day.start).toBe('08:06')
    expect(day.end).toBe('16:15')
    expect(day.dutyMin).toBeCloseTo(489.5, 1)
  })
  it('a day typed in later is the trips added up', () => {
    const [day] = daysOf([tripOf(load({ loaded_on: '2026-10-09', created_at: '2026-10-14T21:28:49Z' }), { key: 'a', name: 'a' }, route, T, TZ)])
    expect(day.start).toBeNull()
    expect(day.dutyMin).toBeCloseTo(69.5, 5)
  })
})

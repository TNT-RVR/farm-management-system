import { describe, expect, it } from 'vitest'
import { NONE, scaleStats, type ScaleLoad } from './weigh-scale'

const load = (o: Partial<ScaleLoad>): ScaleLoad => ({
  truck: 'Teal Kenworth 76-P843',
  trailer: 'Trailer #1 (White)',
  driver: 'Lane',
  loaded_on: '2026-10-21',
  entry_kind: 'weighed',
  load_count: null,
  gross_kg: 70000,
  tare_kg: 20000,
  net_kg: 50000,
  bushels: 1968.4,
  estimated: false,
  ...o,
})

describe('scaleStats', () => {
  it('a truck: loads, total, averages, heaviest and last day; a load waiting for its empty is only waiting', () => {
    const [kw] = scaleStats(
      [
        load({}),
        load({ loaded_on: '2026-10-22', gross_kg: 74000, tare_kg: 21000, net_kg: 53000, bushels: 2086.5 }),
        load({ loaded_on: '2026-10-23', tare_kg: null, net_kg: null, bushels: null }),
      ],
      'truck',
    )
    expect(kw).toEqual({
      key: 'Teal Kenworth 76-P843',
      loads: 2,
      waiting: 1,
      netKg: 103000,
      bushels: 4054.9,
      avgNetKg: 51500,
      avgTareKg: 20500,
      maxGrossKg: 74000,
      lastOn: '2026-10-23',
    })
  })
  it('a bin total counts its loads; nobody recorded comes last', () => {
    const stats = scaleStats(
      [load({ truck: null, entry_kind: 'bin_total', load_count: 3, gross_kg: 120000, tare_kg: 0, net_kg: 120000 }), load({ truck: 'White Paulbilt 14-R665' })],
      'truck',
    )
    expect(stats.map((s) => s.key)).toEqual(['White Paulbilt 14-R665', NONE.truck])
    expect(stats[1].loads).toBe(3)
    expect(stats[1].avgTareKg).toBeNull()
  })
  it('groups by trailer or driver the same way', () => {
    expect(scaleStats([load({}), load({ trailer: 'Trailer #2 (White)' })], 'trailer').map((s) => s.key).sort()).toEqual(['Trailer #1 (White)', 'Trailer #2 (White)'])
    expect(scaleStats([load({}), load({ driver: null })], 'driver').map((s) => s.key)).toEqual(['Lane', NONE.driver])
  })
})

describe('filterTickets', () => {
  const row = (o: Partial<import('./weigh-scale').TicketRow>) => ({ id: 'x', when: '2026-10-21T14:00:00Z', out: null as string | null, day: '2026-10-21', field: '4', crop: 'Grain Corn', netKg: 50000, driver: 'Lane', truck: 'Volvo #1', to: '#5', ...o })
  const rows = [
    row({ id: 'a', when: '2026-10-20T15:00:00Z', day: '2026-10-20', netKg: 47000, driver: 'Sam Hansen' }),
    row({ id: 'b', when: '2026-10-22T16:00:00Z', day: '2026-10-22', netKg: 56000, truck: 'Teal Kenworth 96-P836' }),
    row({ id: 'c', when: '2026-10-21T10:00:00Z', netKg: null, field: '0' }),
  ]
  it('filters by field, driver, truck, dates and words', async () => {
    const { filterTickets } = await import('./weigh-scale')
    expect(filterTickets(rows, { driver: 'Lane' }, 'when', true).map((r) => r.id)).toEqual(['b', 'c'])
    expect(filterTickets(rows, { truck: 'Volvo #1', field: '4' }, 'when', true).map((r) => r.id)).toEqual(['a'])
    expect(filterTickets(rows, { from: '2026-10-21', to: '2026-10-21' }, 'when', true).map((r) => r.id)).toEqual(['c'])
    expect(filterTickets(rows, { q: 'kenworth' }, 'when', true).map((r) => r.id)).toEqual(['b'])
  })
  it('sorts by weigh-out time, one not weighed out last', async () => {
    const { filterTickets } = await import('./weigh-scale')
    const outs = [{ ...rows[0], out: '2026-10-20T16:00:00Z' }, { ...rows[1], out: '2026-10-22T17:00:00Z' }, rows[2]]
    expect(filterTickets(outs, {}, 'out', true).map((r) => r.id)).toEqual(['b', 'a', 'c'])
    expect(filterTickets(outs, {}, 'out', false).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
  it('sorts either way; a ticket with no net yet is last', async () => {
    const { filterTickets } = await import('./weigh-scale')
    expect(filterTickets(rows, {}, 'netKg', true).map((r) => r.id)).toEqual(['b', 'a', 'c'])
    expect(filterTickets(rows, {}, 'netKg', false).map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(filterTickets(rows, {}, 'when', false).map((r) => r.id)).toEqual(['a', 'c', 'b'])
  })
})

describe('driverName', () => {
  it('the account’s name today, else the name the load stored', async () => {
    const { driverName } = await import('./weigh-scale')
    const nameOf = (id: string) => (id === 'u1' ? 'Lane Hansen' : null)
    expect(driverName({ driver: 'lhansen', driver_id: 'u1' }, nameOf)).toBe('Lane Hansen')
    expect(driverName({ driver: 'John', driver_id: null }, nameOf)).toBe('John')
    expect(driverName({ driver: 'Gone', driver_id: 'u9' }, nameOf)).toBe('Gone')
    expect(driverName({ driver: null, driver_id: null }, nameOf)).toBeNull()
  })
})

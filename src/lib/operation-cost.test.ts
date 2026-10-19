import { describe, expect, it } from 'vitest'
import {
  acresPerHourFrom,
  chooseFuel,
  chooseWorkRate,
  deereKindFor,
  fuelKindFor,
  handHistory,
  inputCost,
  operationCost,
  opByMachine,
  travelFor,
  workHistory,
  type HistoryOp,
  type RateChoice,
} from './operation-cost'

const op = (o: Partial<HistoryOp>): HistoryOp => ({
  id: 'x',
  operation_type: 'tillage',
  products: [],
  machine_id: null,
  machine_vin: null,
  work_minutes: null,
  sessions: null,
  ...o,
})

describe('work types', () => {
  it('maps to the Deere kind it is logged as', () => {
    expect(deereKindFor('spraying')).toBe('application')
    expect(deereKindFor('seeding')).toBe('seeding')
    expect(deereKindFor('discing')).toBe('tillage')
    expect(deereKindFor('baling')).toBeNull()
    expect(fuelKindFor('baling')).toBe('other')
    expect(fuelKindFor('harvesting')).toBe('harvest')
  })
})

describe('opByMachine', () => {
  const m = { jd_id: 'J1', platform_machine_id: 'P1', serial_number: 'vin123' }
  it('matches the telematics id or the VIN', () => {
    expect(opByMachine({ machine_id: 'P1', machine_vin: null }, m)).toBe(true)
    expect(opByMachine({ machine_id: null, machine_vin: 'VIN123' }, m)).toBe(true)
    expect(opByMachine({ machine_id: 'J1', machine_vin: null }, m)).toBe(true)
    expect(opByMachine({ machine_id: 'other', machine_vin: 'nope' }, m)).toBe(false)
  })
})

describe('workHistory', () => {
  it('is acres over logged hours, fuel only over the passes that logged it', () => {
    const h = workHistory(
      [
        op({ id: 'a', work_minutes: 120, fuel_l: 50 }),
        op({ id: 'b', work_minutes: '60', fuel_l: null }),
        op({ id: 'c', work_minutes: null }), // no minutes: left out
        op({ id: 'd', work_minutes: 60, not_ours: 'custom_work' }), // not ours
      ],
      () => 30,
    )!
    expect(h.passes).toBe(2)
    expect(h.acres).toBe(60)
    expect(h.hours).toBe(3)
    expect(h.acPerHour).toBeCloseTo(20, 6)
    expect(h.lPerHour).toBeCloseTo(25, 6)
    expect(h.fuelPasses).toBe(1)
  })
  it('works out hours a day from the days the sessions fall on', () => {
    const h = workHistory(
      [
        op({
          work_minutes: 600,
          sessions: [
            { start: '2026-05-01T15:00:00Z', end: '2026-05-01T20:00:00Z', minutes: 300, points: 10 },
            { start: '2026-05-02T15:00:00Z', end: '2026-05-02T20:00:00Z', minutes: 300, points: 10 },
          ],
        }),
      ],
      () => 100,
    )!
    expect(h.days).toBe(2)
    expect(h.hoursPerDay).toBeCloseTo(5, 6)
  })
  it('is null with nothing usable', () => {
    expect(workHistory([op({ work_minutes: 0 })], () => 10)).toBeNull()
  })
})

describe('handHistory', () => {
  const recs = [
    { work_type: 'baling', machine_ids: ['m1'], hours: 4, acres: 40, started_at: null, finished_at: null },
    { work_type: 'baling', machine_ids: ['m2'], hours: null, acres: 20, started_at: '2026-07-01T10:00:00Z', finished_at: '2026-07-01T12:00:00Z' },
    { work_type: 'mowing', machine_ids: ['m1'], hours: 1, acres: 50, started_at: null, finished_at: null },
  ]
  it('uses typed hours, else start to finish, for the type and machine', () => {
    expect(handHistory(recs, 'baling', null)!.acPerHour).toBeCloseTo(60 / 6, 6)
    expect(handHistory(recs, 'baling', 'm2')!.acPerHour).toBeCloseTo(10, 6)
    expect(handHistory(recs, 'raking', null)).toBeNull()
  })
})

describe('chooseWorkRate', () => {
  const machine = { passes: 2, acres: 100, hours: 5, acPerHour: 20, fuelPasses: 0, fuelL: 0, fuelHours: 0, lPerHour: null, days: 1, hoursPerDay: 5 }
  it('prefers typed, then speed × width, then the machine, then the kind, then hand records', () => {
    expect(chooseWorkRate({ typedAcPerHour: 33, machine }).basis).toBe('typed')
    const s = chooseWorkRate({ widthFt: 100, speedKmh: 10, efficiencyPct: 50, machine })
    expect(s.basis).toBe('speed')
    expect(s.acPerHour).toBeCloseTo(acresPerHourFrom(100, 10, 50)!, 6)
    expect(chooseWorkRate({ machine, kind: { ...machine, acPerHour: 9 } }).acPerHour).toBe(20)
    expect(chooseWorkRate({ kind: { ...machine, acPerHour: 9 } }).basis).toBe('kind')
    expect(chooseWorkRate({ hand: { ...machine, acPerHour: 7 } }).basis).toBe('hand')
    expect(chooseWorkRate({}).acPerHour).toBeNull()
  })
  it('speed × width: 100 ft at 10 km/h flat out', () => {
    // 30.48 m × 10 km/h ÷ 10 = 30.48 ha/h = 75.32 ac/h
    expect(acresPerHourFrom(100, 10, null)).toBeCloseTo(75.3177, 3)
    expect(acresPerHourFrom(100, 10, 50)).toBeCloseTo(75.3177 / 2, 3)
  })
})

describe('chooseFuel', () => {
  const machine = { passes: 3, acres: 300, hours: 10, acPerHour: 30, fuelPasses: 3, fuelL: 200, fuelHours: 10, lPerHour: 20, days: 2, hoursPerDay: 5 }
  it('typed L/h, then the machine per hour, then the farm per acre, then the default', () => {
    expect(chooseFuel({ acres: 10, hours: 2, typedLPerHour: 5, machine, defaultLPerAc: 1 }).litres).toBe(10)
    expect(chooseFuel({ acres: 10, hours: 2, machine, defaultLPerAc: 1 }).litres).toBe(40)
    expect(chooseFuel({ acres: 10, hours: null, machine, farm: { lPerAc: 3, passes: 5, acres: 100 }, defaultLPerAc: 1 }).basis).toBe('farm')
    expect(chooseFuel({ acres: 10, hours: 2, farm: { lPerAc: 3, passes: 1, acres: 10 }, defaultLPerAc: 1.5 })).toMatchObject({ litres: 15, basis: 'default' })
  })
})

describe('inputCost', () => {
  it('rate × acres × price, null where something is missing', () => {
    expect(inputCost({ name: 'A', unit: 'L', ratePerAc: 0.5, pricePerUnit: 10, priceSource: '' }, 100)).toMatchObject({ quantity: 50, cost: 500 })
    expect(inputCost({ name: 'B', unit: 'L', ratePerAc: 0.5, pricePerUnit: null, priceSource: '' }, 100).cost).toBeNull()
    expect(inputCost({ name: 'C', unit: 'kg', ratePerAc: null, pricePerUnit: 2, priceSource: '' }, 100).quantity).toBeNull()
  })
})

describe('travelFor', () => {
  it('one round trip a day per machine', () => {
    const t = travelFor({ oneWayKm: 10, days: 1.2, machines: 2, roadLPerKm: 0.5, roadKmh: 40 })
    expect(t.trips).toBe(4)
    expect(t.km).toBe(80)
    expect(t.litres).toBe(40)
    expect(t.hours).toBe(2)
  })
})

describe('operationCost', () => {
  const rate: RateChoice = { acPerHour: 50, basis: 'typed', note: 'typed' }
  const base = {
    acres: 100,
    rate,
    machines: 1,
    hoursPerDay: 10,
    fuel: (h: number | null) => ({ litres: (h ?? 0) * 10, basis: 'typed' as const, note: '' }),
    dieselPerL: 1,
    dieselSource: 'test',
    wage: 20,
    wageSource: 'test',
    inputs: [inputCost({ name: 'A', unit: 'L', ratePerAc: 1, pricePerUnit: 3, priceSource: '' }, 100)],
    travel: null,
  }
  it('adds inputs, fuel and labour', () => {
    const c = operationCost(base)
    expect(c.hours).toBe(2)
    expect(c.days).toBeCloseTo(0.2, 6)
    // inputs 300 + fuel 20 L × $1 + labour 2 h × $20
    expect(c.total).toBeCloseTo(360, 6)
    expect(c.perAcre).toBeCloseTo(3.6, 6)
    expect(c.missing).toEqual([])
  })
  it('two machines halve the hours but not the machine-hours', () => {
    const c = operationCost({ ...base, machines: 2 })
    expect(c.hours).toBe(1)
    expect(c.lines.find((l) => l.key === 'labour')!.dollars).toBe(40)
  })
  it('adds the road, and its hours to labour', () => {
    const c = operationCost({ ...base, travel: { oneWayKm: 5, roadLPerKm: 1, roadKmh: 10 } })
    const road = c.lines.find((l) => l.key === 'travel')!
    expect(road.dollars).toBe(10) // 10 km × 1 L/km × $1
    expect(c.lines.find((l) => l.key === 'labour')!.dollars).toBeCloseTo((2 + 1) * 20, 6)
    expect(c.litres).toBe(30)
  })
  it('says what is missing rather than guessing', () => {
    const c = operationCost({ ...base, rate: { acPerHour: null, basis: 'none', note: '' }, wage: null, hoursPerDay: null })
    expect(c.hours).toBeNull()
    expect(c.missing).toContain('a work rate (ac/h)')
    expect(c.missing).toContain('a wage rate')
    expect(c.lines.find((l) => l.key === 'labour')!.dollars).toBeNull()
  })
})

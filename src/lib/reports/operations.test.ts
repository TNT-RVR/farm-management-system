import { describe, expect, it } from 'vitest'
import { FUEL_DEFAULTS } from '@/lib/fuel'
import type { Equipment, ServicePlanRow } from '@/lib/equipment'
import type { FuelOpRow } from '@/lib/hauling-data'
import type { FuelModel } from '@/lib/operating-costs'
import type { SeasonResult } from '@/lib/winter-feeding'
import { alertStatus, dedupeAlerts, localStamp, pivotLogGroups, type PassRow } from './pivot-log'
import { pumpingGroups } from './pumping'
import { creditMedians, summariseSamples, waterQualityGroups, type WqSampleRow } from './water-quality'
import { herdAsOf, herdGroups, mobClass, type HerdRow } from './herd'
import { daysGrazed, grazingGroups, restAfter } from './grazing'
import { budgetRows, winterWindow } from './feed-budget'
import { mobLine, readHerd } from './pregnancy'
import { benchmarkLines, costsFor, cowCostGroup } from './cow-cost'
import { fuelGroups } from './fuel'
import { equipmentGroups, serviceDue } from './equipment'
import { truckingGroups } from './trucking'

const TZ = 'America/Edmonton'

describe('pivot operation log', () => {
  const pass = (over: Partial<PassRow> = {}): PassRow => ({
    id: 'p1',
    fieldnet_id: 'fn1',
    field_id: 'f1',
    started_at: '2026-07-01T16:00:00Z',
    ended_at: '2026-07-02T04:00:00Z',
    start_deg: 10,
    end_deg: 190,
    swept_deg: 180,
    direction: 'forward',
    depth_mm: 12.7,
    end_status: 'stopped',
    completed: true,
    ...over,
  })

  it('reads the status out of an alert and counts each alert once', () => {
    expect(alertStatus('#3 - NW 18-71-13 is reporting "alignment fault".')).toBe('alignment fault')
    const a = { link: '/fields/x', body: null, created_at: '2026-08-10T21:20:18.039Z' }
    expect(dedupeAlerts([a, { ...a, created_at: '2026-08-10T21:20:18.5Z' }])).toHaveLength(1)
    expect(localStamp('2026-07-01T16:00:00Z', TZ)).toBe('2026-07-01 10:00')
  })

  it('writes an alert on the pass it came during, and gives a stray alert its own line', () => {
    const field = '11111111-1111-1111-1111-111111111111'
    const r = pivotLogGroups({
      passes: [pass({ field_id: field }), pass({ id: 'p2', field_id: field, started_at: '2026-07-05T16:00:00Z', ended_at: '2026-07-05T18:00:00Z', end_status: 'alignment-fault', completed: false })],
      systems: [{ fieldnet_id: 'fn1', name: '#3', field_id: field }],
      fieldNames: new Map([[field, '3']]),
      alerts: [
        { link: `/fields/${field}`, body: 'is reporting "alignment fault".', created_at: '2026-07-05T19:00:00Z' },
        { link: `/fields/${field}`, body: 'is reporting "low pressure".', created_at: '2026-07-20T12:00:00Z' },
      ],
      tz: TZ,
      units: 'imperial',
    })
    expect(r.groups).toHaveLength(1)
    const g = r.groups[0]
    expect(g.title).toBe('#3 (field 3)')
    expect(g.rows).toHaveLength(3)
    expect(g.rows[0][2]).toBeCloseTo(12)
    expect(g.rows[0][7]).toBeCloseTo(0.5)
    expect(g.rows[1][8]).toBe('alignment fault — stopped short (fault)')
    expect(g.rows[1][9]).toBe('07-05 13:00 alignment fault')
    expect(g.rows[2][8]).toBe('fault alert with no pass near it')
    expect(r.hours).toBeCloseTo(14)
    expect(r.faults).toBe(1)
    expect(r.alerts).toBe(2)
  })
})

describe('pumping energy', () => {
  it('charges a FieldNET pivot its pass hours and a hand-logged one the hours its water takes', () => {
    const r = pumpingGroups({
      pivots: [
        { field_id: 'a', acres_irrigated: 100, gpm: 1000, system_capacity_ls: null, pump_id: 'P' },
        { field_id: 'b', acres_irrigated: 100, gpm: 1000, system_capacity_ls: null, pump_id: 'P' },
        { field_id: 'c', acres_irrigated: 50, gpm: 500, system_capacity_ls: null, pump_id: null },
      ],
      pumps: [{ id: 'P', name: 'North', horse_power: 200, gpm: 2000 }],
      flows: new Map(),
      passes: [{ field_id: 'a', started_at: '2026-07-01T16:00:00Z', ended_at: '2026-07-02T02:00:00Z' }],
      // 1 in on b: 100 acre-inches × 27,154 ÷ (1000 × 60) = 45.26 h.
      events: [{ field_id: 'b', date: '2026-08-03', gross_mm: 25.4, net_mm: null }, { field_id: 'c', date: '2026-08-03', gross_mm: 25.4, net_mm: null }],
      fieldNames: new Map([['a', '1'], ['b', '2'], ['c', '3']]),
      pricePerKwh: 0.35,
      tz: TZ,
    })
    expect(r.groups.map((g) => g.title)).toEqual(['North · 200 hp · 2,000 gpm', 'No pump linked'])
    const [a, b] = r.groups[0].rows
    // Half the pump's flow, so half its horsepower.
    expect(a.slice(0, 4)).toEqual(['1', 'July', 10, 'FieldNET passes'])
    expect(a[5]).toBe(100)
    expect(Number(a[6])).toBeCloseTo((100 * 0.7457 * 10) / 0.9)
    expect(Number(b[2])).toBeCloseTo(45.26, 1)
    expect(r.groups[1].rows[0][6]).toBeNull()
    expect(r.unpriced).toBe(1)
  })
})

describe('water quality', () => {
  const s = (over: Partial<WqSampleRow>): WqSampleRow => ({ station_id: 'S1', sampled_at: '2025-07-01T18:00:00Z', parameter: 'ec_us_cm', value: 300, below_dl: false, unit: 'µS/cm', ...over })

  it('summarises a station as the view does: highest found, its irrigation-season highest, the season geometric mean', () => {
    const rows = summariseSamples(
      [
        s({ value: 1500, sampled_at: '2025-03-01T18:00:00Z' }),
        s({ value: 1200 }),
        s({ value: 5, below_dl: true }),
        s({ parameter: 'ecoli', value: 10, unit: null }),
        s({ parameter: 'ecoli', value: 1000, unit: null, sampled_at: '2025-08-01T18:00:00Z' }),
      ],
      TZ,
    )
    const ec = rows.find((r) => r.parameter === 'ec_us_cm')!
    expect(ec).toMatchObject({ tested: 3, detected: 2, max_value: 1500, irr_max_value: 1200, max_dl: 5 })
    expect(rows.find((r) => r.parameter === 'ecoli')!.max_season_geomean).toBeCloseTo(100)
  })

  it('takes the sulphur credit from May–September at the credit stations, and flags EC over the guideline', () => {
    const samples = [s({ parameter: 'so4_mg_l', value: 40 }), s({ parameter: 'so4_mg_l', value: 60, sampled_at: '2025-06-01T18:00:00Z' }), s({ parameter: 'so4_mg_l', value: 500, sampled_at: '2025-11-01T18:00:00Z' }), s({ value: 1200 })]
    const c = creditMedians(samples, new Set(['S1']), TZ)
    expect(c.so4).toBe(50)
    expect(c.lbSPerInch).toBeCloseTo(3.78)
    const r = waterQualityGroups({ samples, stations: [{ station_id: 'S1', name: 'Canal', water_source: 'smrid', for_credit: true, active: true }], district: 'SMRID', tz: TZ })
    expect(r.groups[0].title).toBe('SMRID canal')
    expect(r.groups[0].rows[0].slice(0, 3)).toEqual(['Sulphur credit', 'median sulphate × 0.0756', 3.78])
    const ec = r.groups[0].rows.find((x) => x[1] === 'over the irrigation guideline')!
    expect(ec[0]).toBe('Conductivity (EC)')
    expect(ec[2]).toBe(1200)
    expect(r.over).toBe(1)
  })
})

describe('herd inventory', () => {
  const h = (over: Partial<HerdRow>): HerdRow => ({ id: 'h1', ranch_id: 'R', class_name: 'Cows', head_count: 100, avg_weight_lb: 1400, au_equivalent: 1.4, feed_class: 'cow', sort_order: 1, updated_at: '2026-09-01', ...over })

  it('undoes every edit after the date, newest first', () => {
    const now = [h({ head_count: 127 }), h({ id: 'h2', class_name: 'Bulls', feed_class: 'bull', head_count: 7 })]
    const audit = [
      { record_id: 'h1', action: 'update', changed_at: '2026-10-01T00:00:00Z', old_values: { head_count: 120 }, new_values: { head_count: 127 } },
      { record_id: 'h1', action: 'update', changed_at: '2026-09-01T00:00:00Z', old_values: { head_count: 110 }, new_values: { head_count: 120 } },
      { record_id: 'h2', action: 'insert', changed_at: '2026-09-15T00:00:00Z', old_values: null, new_values: { id: 'h2' } },
    ]
    const then = herdAsOf(now, audit, '2026-09-10T00:00:00Z')
    expect(then).toHaveLength(1)
    expect(then[0].head_count).toBe(120)
  })

  it('finds the class a mob is named for, and values calves only', () => {
    const classes = [h({}), h({ id: 'b', class_name: 'Bulls', feed_class: 'bull' }), h({ id: 'c', class_name: 'Backgrounded calves', feed_class: 'backgrounder', head_count: 10, avg_weight_lb: 650, au_equivalent: 0.7 })]
    expect(mobClass('Home Ranch Herd', classes)?.id).toBe('h1')
    expect(mobClass('Home Ranch Bulls', classes)?.id).toBe('b')
    expect(mobClass('Whitfields', classes)).toBeNull()
    const r = herdGroups({ rows: classes, ranches: [{ id: 'R', name: 'Home Ranch' }], mobs: [{ mob: 'Home Ranch Herd', head: 98 }, { mob: 'Whitfields', head: 15 }], calfPricePerLb: 3 })
    const row = (name: string) => r.groups[0].rows.find((x) => x[0] === name)!
    const cows = row('Cows')
    const calves = row('Backgrounded calves')
    expect(cows[6]).toBe(98)
    expect(cows[7]).toBeNull()
    expect(calves[7]).toBe(1950)
    expect(calves[8]).toBe(19500)
    expect(r.unplacedMobs).toEqual(['Whitfields (15)'])
    expect(r.au).toBeCloseTo(140 + 140 + 7)
  })
})

describe('grazing record', () => {
  it('counts rest to the next mob in, and none while another is still in', () => {
    expect(restAfter('2026-07-10', [{ in: '2026-08-01', out: null }], '2026-10-02')).toEqual({ days: 22, resting: false })
    expect(restAfter('2026-07-10', [{ in: '2026-07-01', out: '2026-07-20' }], '2026-10-02')).toEqual({ days: 0, resting: false })
    expect(restAfter('2026-09-17', [], '2026-10-02')).toEqual({ days: 15, resting: true })
    expect(daysGrazed([{ in: '2026-07-01', out: '2026-07-11' }, { in: '2026-07-05', out: '2026-07-15' }, { in: '2026-08-01', out: '2026-08-03' }], '2026-01-01', '2026-10-02')).toBe(16)
  })

  it('takes AUMs at the class AU, 30 AU-days to the AUM', () => {
    const r = grazingGroups({
      year: 2026,
      today: '2026-10-02',
      events: [{ id: 'e1', pasture_id: 'N', head_count: 290, avg_animal_weight_lb: null, turned_in_on: '2026-09-07', moved_out_on: '2026-09-12', notes: 'eShepherd · Home Ranch Herd', eshepherd_activation_id: null }],
      activations: [{ id: 'a1', mob: 'Home Ranch Bulls', paddock_name: 'Bull Pasture- 1', pasture_id: null, started_at: '2026-06-01T12:00:00Z', ended_at: '2026-06-11T12:00:00Z', head_count: 9 }],
      pastures: [{ id: 'N', name: 'Pasture N', area_acres: 498, min_rest_days: 21 }],
      pastureRanch: new Map([['N', 'R']]),
      ranches: [{ id: 'R', name: 'Home Ranch' }],
      herd: [{ id: 'h', ranch_id: 'R', class_name: 'Cows', head_count: 320, avg_weight_lb: 1400, au_equivalent: 1.4, feed_class: 'cow', sort_order: 1, updated_at: null }],
      ranchId: null,
    })
    expect(r.groups[0].title).toBe('Home Ranch · Pasture N')
    const row = r.groups[0].rows[0]
    expect(row.slice(4, 8)).toEqual([5, 290, 1.4, 406])
    expect(Number(row[8])).toBeCloseTo((406 * 5) / 30)
    expect(row[9]).toBe(20)
    expect(r.groups[1].title).toBe('eShepherd paddocks not on the pasture map')
    // No bull class on the herd: counted at 1 AU a head.
    expect(r.groups[1].rows[0][6]).toBe(1)
  })
})

describe('winter feed budget', () => {
  it('finds the winter after this one', () => {
    const plan = { start_month: 12, start_day: 15, end_month: 3, end_day: 15 }
    const now = winterWindow(plan, new Date(2026, 9, 2), 'current')
    expect([now.from.getFullYear(), now.from.getMonth(), now.to.getFullYear()]).toEqual([2026, 11, 2027])
    const next = winterWindow(plan, new Date(2026, 9, 2), 'next')
    expect([next.from.getFullYear(), next.to.getFullYear()]).toEqual([2027, 2028])
  })

  it('sets the need with the reserve against the yard, and says when a feed is not counted', () => {
    const season = { days: 90, needLb: new Map([['hay', 220_462], ['silage', 110_231]]), extraGrainLb: 0, dmLb: 0, stubbleCowDays: 0, stubbleSavedLb: new Map(), runsOut: new Map(), bindingDays: null, bindingFeed: null } as SeasonResult
    const r = budgetRows({ season, usable: new Map([['hay', 220_462]]), reservePct: 15, feedName: (id) => id, bale: (id) => (id === 'hay' ? { unit: 'round', lb: 1300 } : { unit: 'lb', lb: null }) })
    expect(r.rows[0].slice(0, 5)).toEqual(['hay', 100, 115, '170 rounds', 100])
    expect(r.rows[0][5]).toBeCloseTo(-15)
    expect(r.rows[1][4]).toBe('not counted')
    expect(r.short).toEqual(['hay'])
  })
})

describe('pregnancy summary', () => {
  it('reads each cow against her ranch’s bull date, heifers against theirs, and leaves bulls out', () => {
    const ranches = [{ id: 'R', name: 'Home Ranch', bulls_in_on: '2026-07-27', heifer_bulls_in_on: '2026-05-04' }]
    const a = (tag: string, mob: string, state: string, last: string | null, heats: string[]) => ({ animal_id: tag, tag, mob, state, last_heat: last, days_since_heat: 10, observed_on: '2026-09-29', heats })
    const reads = readHerd(
      [a('1', 'Home Ranch Herd', 'NO_CYCLING_DETECTED', '2026-05-20', ['2026-05-20']), a('2', 'Home Ranch Replacement Heifer', 'NO_CYCLING_DETECTED', '2026-06-01', ['2026-06-01']), a('3', 'Home Ranch Bulls', 'CYCLING', null, [])],
      ranches,
    )
    expect(reads.map((r) => r.tag)).toEqual(['1', '2'])
    // Stopped before these bulls went in: not theirs.
    expect(reads[0].call).toBe('unsure')
    expect(reads[1].call).toBe('pregnant')
    expect(reads[1].due?.likely).toBe('2027-03-11')
    const line = mobLine('Heifers', [reads[1]])
    expect(line.slice(1, 8)).toEqual([1, 1, 0, 0, 0, 1, '2026-05-04'])
  })
})

describe('cost per cow', () => {
  it('carries the newest earlier year, takes the rent out of the benchmark, and totals by the herd', () => {
    const rows = [{ id: 'x', ranch: 'Home Ranch', crop_year: 2026, cow_cost_per_head: '34', feed_cost_per_head: '3', pasture_cost_per_head: '24', vet_cost_per_head: '34', other_cost_per_head: '25', death_loss_pct: '2', weaning_rate_pct: '92', cost_of_gain_per_lb: '1.4' }]
    const c = costsFor(rows, 'Home Ranch', 2027)!
    expect(c.carriedFrom).toBe(2026)
    expect(costsFor(rows, 'East Ranch', 2027)).toBeNull()
    const bench = benchmarkLines(null)
    expect(bench.pasture_cost_per_head).toBe(79)
    const g = cowCostGroup({ ranch: 'Home Ranch', costs: c, bench, cows: 320, saleWeightLb: 450, year: 2027 })
    expect(g.totals).toEqual(['Total per cow', 120, 464 + 612 + 79 + 34 + 563, 120 - 1752, 120 * 320])
    expect(g.note).toContain('2026’s costs, carried to 2027')
    expect(g.note).toContain('0.90 calves sold a cow')
  })
})

describe('fuel by field', () => {
  it('splits a field by kind of work, logged against estimated, with the road', () => {
    const op = (id: string, type: string, fuel: number | null): FuelOpRow =>
      ({ id, jd_id: id, field_id: 'f', operation_type: type, crop_season: 2026, started_at: '2026-05-01T16:00:00Z', ended_at: null, products: null, as_applied: null, applied_area_ha: null, sessions: null, cost_acres_override: null, not_ours: null, fuel_l: fuel, fuel_read_at: null }) as FuelOpRow
    const model: FuelModel = {
      settings: { ...FUEL_DEFAULTS, dieselPerL: 2 },
      farm: {},
      acresOf: () => 100,
      tripTo: () => ({ km: 5, minutes: 6, basis: 'road', note: null }),
      ready: true,
    }
    const r = fuelGroups({ ops: [op('1', 'seeding', 140), op('2', 'tillage', null)], fields: [{ id: 'f', name: '3' }], model })
    const [seeding, tillage] = r.groups[0].rows
    expect(seeding.slice(0, 7)).toEqual(['Seeding / planting', 1, 1, 100, 140, 140, 0])
    expect(tillage[6]).toBeCloseTo(260)
    // One round trip of 10 km at 0.7 L/km.
    expect(tillage[7]).toBeCloseTo(7)
    expect(r.groups[0].totals?.[10]).toBeCloseTo((140 + 260 + 10 * 0.6 + 7) * 2)
  })
})

describe('equipment service', () => {
  const plan = (over: Partial<ServicePlanRow>): ServicePlanRow => ({ id: 'p', equipment_id: 'm', name: 'Engine oil', interval_hours: 500, interval_months: 12, last_done_hours: null, last_done_on: null, warn_within_hours: 50, notes: null, active: true, ...over })

  it('names what is due, or why nothing can be judged', () => {
    const now = new Date(2026, 9, 2, 12)
    expect(serviceDue([plan({})], 2600, now)).toEqual({ text: 'no service logged yet, so nothing to measure from', urgent: 0 })
    expect(serviceDue([plan({ last_done_hours: 2000 })], 2600, now).text).toBe('Engine oil: 100 h past due')
  })

  it('lists each machine with its hours, cost logged and alerts', () => {
    const m = { id: 'm', jd_id: 'J', name: '9560', category: 'machine', make: 'John Deere', model: '9560', engine_hours: 5269, engine_hours_at: '2026-09-30T00:00:00Z', warranty_expires_on: null, warranty_hours: null } as unknown as Equipment
    const r = equipmentGroups({
      machines: [m],
      plans: [plan({ last_done_hours: 5000, warn_within_hours: 300 })],
      logs: [{ equipment_id: 'm', done_on: '2026-04-01', cost: '850' }, { equipment_id: 'm', done_on: '2025-04-01', cost: '999' }],
      alerts: [{ equipment_jd_id: 'J', severity: 'HIGH', occurred_at: '2026-08-25T00:00:00Z', ignored: false }, { equipment_jd_id: 'J', severity: 'NONE', occurred_at: '2026-08-25T00:00:00Z', ignored: true }],
      year: 2026,
      now: new Date(2026, 9, 2, 12),
    })
    expect(r.groups[0].title).toBe('Machines')
    expect(r.groups[0].rows[0]).toEqual(['9560', 'John Deere 9560', 5269, '2026-09-30', 1, 'Engine oil: in 231 h', 1, 850, '1 high', 'not recorded'])
    expect(r.cost).toBe(850)
    expect(r.due).toBe(1)
  })
})

describe('trucking', () => {
  it('groups fields by where the crop goes and costs each load', () => {
    const r = truckingGroups({
      fields: [{ id: 'a', name: '1' }, { id: 'b', name: '2' }],
      crops: new Map([
        ['a', { fieldId: 'a', cropId: 'c', cropName: 'Silage', unit: 't', lbPerBu: null, acres: 100, quantity: 840, quantitySource: 'scale' as const, ownUse: true }],
        ['b', { fieldId: 'b', cropId: 'c', cropName: 'Silage', unit: 't', lbPerBu: null, acres: 100, quantity: 420, quantitySource: 'plan' as const, ownUse: true }],
      ]),
      plans: new Map([['a', { id: 'p', field_id: 'a', crop_year: 2026, mode: 'bin_yard' as const, delivery_site_id: null, notes: null }]]),
      op: {
        sites: [],
        trip: () => ({ km: 10, minutes: 10, basis: 'road', note: null }),
        truck: { field: { payloadT: 42, lPerKm: 0.5, loadMin: 20, unloadMin: 10, timeFactor: 1 }, highway: { payloadT: 42, lPerKm: 0.5, loadMin: 20, unloadMin: 10, timeFactor: 1 } },
        basics: { dieselPerL: 2, dieselSource: '', dieselFrom: 'override', wage: 30, wageSource: '', dieselSet: true, wageSet: true },
      },
    })
    expect(r.groups.map((g) => g.title)).toEqual(['Our bin yard (stays)', 'No haul plan set'])
    // 840 t ÷ 42 = 20 loads × 20 km = 400 km; 20 × (20 + 30) min = 16.7 h.
    const a = r.groups[0].rows[0]
    expect(a.slice(5, 10)).toEqual([20, 400, 50 / 3, 200, 400])
    expect(a[11]).toBeCloseTo(400 + 500)
    expect(r.groups[1].rows[0][13]).toBe('no haul plan set')
  })
})

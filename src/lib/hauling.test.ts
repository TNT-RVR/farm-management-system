import { describe, expect, it } from 'vitest'
import { metresBetween, parseLatLng, parseSnapTable, planSnapRequests, snapTableUrl, startFor, tripFor, type Place } from './road-routes'
import { FUEL_DEFAULTS, farmAverages, opFuel, tripsFor, type FuelOp } from './fuel'
import { haulCost, tonnesOf, TRUCK_DEFAULTS } from './trucking'
import { customCost, fitCustomModel, ownCost, spreadAcresPerHour, tractorFuel, OWN_MANURE_DEFAULTS } from './manure-haul'
import { SPREADER_DEFAULTS, spreadingCost } from './spreading'

const shop: Place = { key: 'shop', lat: 52.3740399, lng: -108.7426578 }
const bins: Place = { key: 'bins', lat: 52.374149, lng: -108.744874 }
const f1 = { lat: 52.4064, lng: -108.7958 }
const roy = { lat: 52.362, lng: -108.749 }

describe('road routes', () => {
  it('starts field work, spraying and manure at the shop, and grain at the bins', () => {
    expect(startFor('field_work')).toBe('shop')
    expect(startFor('spraying')).toBe('shop')
    expect(startFor('spreading')).toBe('shop')
    expect(startFor('manure')).toBe('shop')
    expect(startFor('grain')).toBe('bins')
  })

  it('asks about every point from both starts in as few requests as the size limit allows', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ lat: 52.4 + i / 1000, lng: -108.7 }))
    // The same point twice is asked once.
    const reqs = planSnapRequests([shop, bins], [...pts, pts[0]])
    expect(reqs).toHaveLength(2)
    expect(reqs[0].points).toHaveLength(88)
    expect(reqs[1].points).toHaveLength(12)
    expect(snapTableUrl(reqs[1])).toContain('sources=0;1&destinations=2;3;4;5;6;7;8;9;10;11;12;13&annotations=distance,duration')
  })

  it('reads where the router met the road, and keeps a pair it could not join', () => {
    const req = { origins: [shop], points: [f1, roy] }
    const out = parseSnapTable(
      {
        code: 'Ok',
        distances: [[6892, null]],
        durations: [[992.7, null]],
        destinations: [
          { location: [-108.795, 52.4027], distance: 259.04 },
          { location: [-108.749, 52.3625], distance: 40 },
        ],
      },
      req,
    )
    expect(out).toHaveLength(2)
    expect(out[0].snap).toMatchObject({ snapLat: 52.4027, snapLng: -108.795, snapM: 259, roadKm: 6.892, roadMin: 16.5 })
    expect(out[1].snap).toMatchObject({ snapM: 40, roadKm: null, roadMin: null })
    expect(() => parseSnapTable({ code: 'NoRoute' }, req)).toThrow(/NoRoute/)
  })

  it('says how each distance was made', () => {
    const flat = { lat: 52.4136, lng: -108.8032 }
    const trail = tripFor({ distance_km: 7.4, duration_min: 19, source: 'osrm', method: 'road+trail', road_km: 6.1, trail_km: 1.2, connector_km: 0.1, note: null }, shop, flat)!
    expect(trail).toMatchObject({ basis: 'trail', km: 7.4, parts: { road: 6.1, trail: 1.2, connector: 0.1 } })
    const straight = tripFor({ distance_km: 8.1, duration_min: 20, source: 'osrm', method: 'road+straight', road_km: 6.8, trail_km: 0, connector_km: 1.3, note: null }, shop, flat)!
    expect(straight.basis).toBe('straight')
    expect(straight.note).toMatch(/no trail drawn/)
    expect(tripFor({ distance_km: 9, duration_min: 20, source: 'manual', method: 'typed' }, shop, flat)!.basis).toBe('manual')
  })

  it('does not believe an old route that went round the river', () => {
    // #9 Maple Flat: 6 km away as the crow flies, 84 km by the router.
    const flat = { lat: 52.4136, lng: -108.8032 }
    const t = tripFor({ distance_km: 84.3, duration_min: 89, source: 'osrm' }, bins, flat)!
    expect(t.basis).toBe('straight')
    expect(t.km).toBeCloseTo((metresBetween(bins, flat) / 1000) * 1.3, 5)
    expect(tripFor({ distance_km: 6.892, duration_min: 16.5, source: 'osrm' }, bins, f1)!.basis).toBe('road')
    expect(tripFor({ distance_km: 9, duration_min: 20, source: 'manual' }, bins, flat)!.km).toBe(9)
  })

  it('takes a pasted Google Maps link or a lat, lng pair', () => {
    expect(parseLatLng('https://www.google.com/maps/@52.3697,-108.3794,15z')).toEqual({ lat: 52.3697, lng: -108.3794 })
    expect(parseLatLng('52.29, -109.15')).toEqual({ lat: 52.29, lng: -109.15 })
    expect(parseLatLng('somewhere')).toBeNull()
  })
})

describe('fuel', () => {
  const settings = { dieselPerL: 1.4, ...FUEL_DEFAULTS }
  const trip = { km: 6.9, minutes: 16.5, basis: 'road' as const, note: null }
  const base: FuelOp = { id: 'a', operation_type: 'tillage', products: [], started_at: '2026-04-18T16:38:00Z' }

  it('uses what the machine logged, and adds a round trip per day worked', () => {
    const op = { ...base, fuel_l: 40.7, sessions: [{ start: '2026-04-18T16:47:00Z', end: '2026-04-18T17:30:00Z', minutes: 40, points: 1 }, { start: '2026-04-19T16:00:00Z', end: '2026-04-19T17:00:00Z', minutes: 60, points: 1 }] }
    const f = opFuel(op, { fieldAcres: 19.3, trip, settings, farm: {} })
    expect(f.inField).toMatchObject({ litres: 40.7, basis: 'logged' })
    expect(f.travel!.trips).toBe(2)
    expect(f.travel!.km).toBeCloseTo(27.6)
    expect(f.travel!.litres).toBeCloseTo(27.6 * FUEL_DEFAULTS.roadLPerKm.tillage)
    expect(f.dollars).toBeCloseTo(f.litres * 1.4)
  })

  it("estimates an unlogged pass at the farm's own L/ac once there are enough logged passes", () => {
    const logged = [1, 2, 3].map((i) => ({ ...base, id: `l${i}`, fuel_l: 50 }))
    const farm = farmAverages(logged, () => 20)
    expect(farm.tillage!.lPerAc).toBeCloseTo(2.5)
    const f = opFuel(base, { fieldAcres: 100, trip: null, settings, farm })
    expect(f.inField).toMatchObject({ basis: 'farm', litres: 250 })
    expect(opFuel(base, { fieldAcres: 100, trip: null, settings, farm: {} }).inField.basis).toBe('default')
  })

  it('costs nothing for a pass Deere logged no points for', () => {
    const f = opFuel({ ...base, sessions: [] }, { fieldAcres: 100, trip, settings, farm: {} })
    expect(f.litres).toBe(0)
    expect(f.travel).toBeNull()
  })

  it('counts days on the farm calendar, not UTC', () => {
    // 8 pm and 10 pm Alberta on one evening straddle UTC midnight.
    const op = { sessions: [{ start: '2026-06-02T02:00:00Z', minutes: 30 }, { start: '2026-06-02T04:00:00Z', minutes: 30 }, { start: '2026-06-01T20:00:00Z', minutes: 0 }], started_at: null }
    expect(tripsFor(op)).toBe(1)
  })
})

describe('trucking', () => {
  const t = (km: number) => ({ km, minutes: km, basis: 'road' as const, note: null })
  it('weighs the crop', () => {
    expect(tonnesOf(10000, 'bu', 56)).toBeCloseTo(254.0, 0)
    expect(tonnesOf(5.5, 'MT', null)).toBe(5.5)
    expect(tonnesOf(100, 'bu', null)).toBeNull()
  })

  it('costs loads × round trips at the truck burn plus the driver', () => {
    const c = haulCost({ tonnes: 100, mode: 'direct', trips: { fieldYard: t(5), fieldSite: t(40), yardSite: t(37) }, siteName: 'Viterra Taber', truck: TRUCK_DEFAULTS, dieselPerL: 1.4, wage: 25 })
    expect(c.legs).toHaveLength(1)
    expect(c.legs[0].loads).toBe(3)
    expect(c.legs[0].km).toBe(240)
    expect(c.fuel).toBeCloseTo(240 * 0.55 * 1.4)
    // 3 loads × (80 min × 1.15 + 20 + 15) ÷ 60
    expect(c.hours).toBeCloseTo((3 * (80 * 1.15 + 35)) / 60)
    expect(c.total).toBeCloseTo(c.fuel + c.hours * 25)
  })

  it('stops at the yard when the buyer collects, and goes on when it is bin yard then elevator', () => {
    const args = { tonnes: 84, trips: { fieldYard: t(5), fieldSite: t(40), yardSite: t(37) }, siteName: 'Viterra Taber', truck: TRUCK_DEFAULTS, dieselPerL: 1.4, wage: 25 }
    expect(haulCost({ ...args, mode: 'buyer_pickup' }).legs.map((l) => l.label)).toEqual(['Field → bin yard'])
    expect(haulCost({ ...args, mode: 'bin_yard_then_elevator' }).legs.map((l) => l.label)).toEqual(['Field → bin yard', 'Bin yard → Viterra Taber'])
    expect(haulCost({ ...args, mode: 'direct', siteName: null }).missing).toMatch(/which elevator/)
  })
})

describe('manure hauling', () => {
  // N & K Custom, invoice #1160.
  const lines = [
    { hours: 26, rate: 157.5, amount: 4095, loads: 55, tonnes: 922.9, oneWayKm: 6.892 },
    { hours: 25.5, rate: 157.5, amount: 4016.25, loads: 91, tonnes: 1441.44, oneWayKm: 2.183 },
  ]
  it('fits load time and road speed to the invoice and reproduces it', () => {
    const m = fitCustomModel(lines)!
    expect(m.fitted).toBe(true)
    expect(m.rate).toBeCloseTo(157.5)
    expect(m.tonnesPerLoad).toBeCloseTo(2364.34 / 146, 2)
    expect(1 / m.hoursPerKm).toBeGreaterThan(40)
    expect(1 / m.hoursPerKm).toBeLessThan(60)
    // Two points, two unknowns: each line's hours come back exactly.
    expect(55 * (m.fixedHours + m.hoursPerKm * 2 * 6.892)).toBeCloseTo(26, 6)
    expect(91 * (m.fixedHours + m.hoursPerKm * 2 * 2.183)).toBeCloseTo(25.5, 6)
    expect(4095 / 922.9).toBeCloseTo(4.44, 2)
  })

  it('prices custom and ourselves on the same trip', () => {
    const m = fitCustomModel(lines)!
    const trip = { km: 6.892, minutes: 16.5, basis: 'road' as const, note: null }
    const c = customCost(m, 1000, trip)
    expect(c.perTonne).toBeGreaterThan(3)
    const o = ownCost(OWN_MANURE_DEFAULTS, 1000, trip, 1.4, 25, 15)
    expect(o.total).toBeCloseTo(o.fuel + o.labour + o.machine)
    expect(o.loads).toBe(Math.ceil(1000 / 16.2))
  })

  it('times the spreading from the width, the speed and the rate', () => {
    // 60 ft × 8 mph ÷ 8.25 = 58.2 ac/h flat out.
    expect(spreadAcresPerHour({ widthFt: 60, speedMph: 8, efficiency: 1 })).toBeCloseTo(58.18, 2)
    const s = { ...OWN_MANURE_DEFAULTS, efficiency: 1, tonnesPerLoad: 15, turnMin: 0, loaderMinPerLoad: 0 }
    const trip = { km: 0, minutes: 0, basis: 'road' as const, note: null }
    // 15 t at 15 t/ac is one acre: 60 ÷ 58.18 ≈ 1.03 min.
    const o = ownCost(s, 15, trip, 2, 32, 15)
    expect(o.loads).toBe(1)
    expect(o.spreadMin).toBeCloseTo(60 / 58.18, 2)
    // Half the rate covers twice the ground with the same load.
    expect(ownCost(s, 15, trip, 2, 32, 7.5).spreadMin).toBeCloseTo(2 * o.spreadMin, 6)
    // Two people for every tractor hour.
    expect(o.labour).toBeCloseTo(2 * o.tractorHours * 32)
  })

  it('reads the tractor burn off what Deere logged', () => {
    const f = tractorFuel([
      { operation_type: 'tillage', fuel_l: 300, work_minutes: 600, machines: [{ name: '8R 250' }] },
      { operation_type: 'seeding', fuel_l: '100', work_minutes: '300', machines: [{ name: 'JD 8100' }] },
      // Another machine, and a pass with no time logged, are left out.
      { operation_type: 'tillage', fuel_l: 500, work_minutes: 300, machines: [{ name: '9RX 640' }] },
      { operation_type: 'tillage', fuel_l: 50, work_minutes: 0, machines: [{ name: '8R 250' }] },
      { operation_type: 'harvest', fuel_l: 80, work_minutes: 60, machines: [{ name: 'S790 81000' }] },
    ])!
    expect(f.passes).toBe(2)
    expect(f.tractors).toEqual(['8R 250', 'JD 8100'])
    expect(f.lph).toBeCloseTo(400 / 15, 6)
    expect(f.byKind[0]).toMatchObject({ kind: 'tillage', passes: 1 })
    expect(f.byKind[0].lph).toBeCloseTo(30, 6)
    expect(tractorFuel([])).toBeNull()
  })

  it('assumes a road speed when there is only one distance to fit', () => {
    const m = fitCustomModel([lines[0]])!
    expect(m.fitted).toBe(false)
    expect(m.hoursPerKm).toBeCloseTo(1 / 50)
  })
})

describe('spreading', () => {
  it('works out acres an hour from width, speed and efficiency', () => {
    const c = spreadingCost({ ...SPREADER_DEFAULTS, rateLbAc: 0 }, 1.4, 25)
    // 60 ft = 18.288 m × 16 km/h ÷ 10 = 29.26 ha/h × 0.7 × 2.471
    expect(c.acresPerHour).toBeCloseTo(18.288 * 1.6 * 0.7 * 2.4710538, 3)
    expect(c.perAcre.total).toBeCloseTo(c.perHour.total / c.acresPerHour, 6)
  })

  it('adds refills and the drive to the field', () => {
    const c = spreadingCost(SPREADER_DEFAULTS, 1.4, 25, { acres: 100, travelDollars: 50 })
    expect(c.effectiveAcresPerHour).toBeLessThan(c.acresPerHour)
    expect(c.perAcre.travel).toBeCloseTo(0.5)
  })
})

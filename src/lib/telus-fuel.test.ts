import { describe, expect, it } from 'vitest'
import { gaugeInfo, gaugeInfoText, gaugeReplacesLevel, horizontalFill, matchGauges, productOf, readGauges, type TankForMatch } from './telus-fuel'

// Shapes as the farm's own account returned them, 19 Oct 2026 (trimmed).
const devices = [
  { id: 22161, name: 'NO NAME', type: 'default', status: 'unknown' },
  { id: 21476, name: 'Tall Diesel Tanks (Prairie Creek Farm)', type: 'farmHub_diesel', status: 'online' },
  { id: 22342, name: 'Gas Tank (Prairie Creek Farm)', type: 'farmHub_gasoline', status: 'unknown' },
  { id: 27030, name: 'Horizontal Diesel Tank', type: 'farmHub_diesel', status: 'online' },
]
const positions = [
  { deviceId: 22161, fixTime: '2025-05-26T21:14:17Z', latitude: 0, longitude: 0, attributes: { Port2adc: '53' } },
  { deviceId: 21476, fixTime: '2026-10-19T22:31:20Z', latitude: 52.3744, longitude: -113.5434, attributes: { Port2adc: '48.02' } },
  { deviceId: 22342, fixTime: '2026-10-17T21:04:33Z', latitude: 52.37, longitude: -113.54, attributes: { Port2adc: '5' } },
  { deviceId: 27030, fixTime: '2026-10-19T21:49:57Z', latitude: 0, longitude: 0, attributes: { Port2adc: '74' } },
]
const ports = [
  { deviceId: 21476, portNumber: 2, capacity: 13627, tankType: 'regularTank', deletedAt: null },
  { deviceId: 22342, portNumber: 2, capacity: 4460, tankType: 'horizontalCylinderTank', deletedAt: null },
  { deviceId: 27030, portNumber: 2, capacity: 4500, tankType: 'horizontalCylinderTank', deletedAt: null },
]

describe('readGauges', () => {
  const g = readGauges(devices, positions, ports)

  it('drops the spare gauge with no sensor set up', () => {
    expect(g.map((x) => x.deviceId)).toEqual([21476, 22342, 27030])
  })

  it('upright tank: litres are the height share of capacity', () => {
    expect(g[0].litres).toBeCloseTo(6543.7, 0)
  })

  it('horizontal tanks match what the Telus page shows', () => {
    expect(g[1].litres).toBeCloseTo(83.37, 0) // 5 % up a 4,460 L tank
    expect(g[2].litres).toBeCloseTo(3570.3, 0) // 74 % up a 4,500 L tank
  })

  it('a 0,0 position is no fix', () => {
    expect(g[2].lat).toBeNull()
    expect(g[0].lat).toBeCloseTo(52.3744)
  })

  it('reads the fuel and whether the gauge is online', () => {
    expect(g.map((x) => x.product)).toEqual(['farm_diesel', 'farm_gasoline', 'farm_diesel'])
    expect(g.map((x) => x.online)).toEqual([true, false, true])
  })
})

describe('horizontalFill', () => {
  it('is empty, half and full at the ends and middle', () => {
    expect(horizontalFill(0)).toBe(0)
    expect(horizontalFill(0.5)).toBeCloseTo(0.5)
    expect(horizontalFill(1)).toBeCloseTo(1)
  })
})

describe('productOf', () => {
  it('propane and unknowns are other', () => {
    expect(productOf('farmHub_propane')).toBe('other')
    expect(productOf(null)).toBe('other')
  })
})

describe('matchGauges', () => {
  const gauges = readGauges(devices, positions, ports)
  // The tanks Sam typed in before the sync existed.
  const tanks: TankForMatch[] = [
    { id: 'dv', name: 'Double Vertical Diesel Tanks', product: 'farm_diesel', capacity_l: 13627, telus_device_id: null },
    { id: 'ft', name: 'Fuel Truck', product: 'farm_diesel', capacity_l: 7000, telus_device_id: null },
    { id: 'hd', name: 'Horizontal Diesel Tank', product: 'farm_diesel', capacity_l: 4500, telus_device_id: null },
    { id: 'hg', name: 'Horizontal Gas Tank', product: 'farm_gasoline', capacity_l: 4460, telus_device_id: null },
  ]

  it('pairs by name, then by fuel and size', () => {
    const m = matchGauges(gauges, tanks)
    expect(m.get(21476)).toBe('dv') // size: 13,627 L diesel
    expect(m.get(22342)).toBe('hg') // size: 4,460 L gasoline
    expect(m.get(27030)).toBe('hd') // name
  })

  it('a linked tank stays linked and is not given to another gauge', () => {
    const m = matchGauges(gauges, tanks.map((t) => (t.id === 'hd' ? { ...t, telus_device_id: 21476 } : t)))
    expect(m.get(21476)).toBe('hd')
    expect(m.get(27030)).toBeNull() // 4,500 L diesel, but that tank is taken
  })

  it('no single match: null', () => {
    const twins = [...tanks, { id: 'dv2', name: 'Spare', product: 'farm_diesel' as const, capacity_l: 13600, telus_device_id: null }]
    expect(matchGauges(gauges, twins).get(21476)).toBeNull()
  })
})

describe('what a gauge says about itself', () => {
  it('keeps battery, power and signal, not the fuel ports', () => {
    expect(gaugeInfo({ Port2adc: '5', batteryLevel: 12, power: 3.6, rssi: -97, motion: false, distance: 0 })).toEqual({ batteryLevel: 12, power: 3.6, rssi: -97 })
    expect(gaugeInfo(undefined)).toEqual({})
  })
  it('passes on Telus status and when it last heard from the gauge', () => {
    const g = readGauges(
      [{ id: 22342, name: 'Gas Tank', type: 'farmHub_gasoline', status: 'unknown', lastUpdate: '2026-10-17T21:05:00Z' }],
      [{ deviceId: 22342, fixTime: '2026-10-17T21:04:33Z', attributes: { Port2adc: '5', batteryLevel: 4 } }],
      [{ deviceId: 22342, portNumber: 2, capacity: 4460, tankType: 'horizontalCylinderTank', deletedAt: null }],
    )[0]
    expect(g).toMatchObject({ online: false, status: 'unknown', seenAt: '2026-10-17T21:05:00Z', info: { batteryLevel: 4 } })
  })
})

describe('the gauge replaces a typed level', () => {
  const read = '2026-10-20T15:00:00Z'
  it('a new report from the gauge goes on', () => {
    expect(gaugeReplacesLevel({ level_source: 'telus', level_at: '2026-10-20T14:00:00Z' }, read)).toBe(true)
    expect(gaugeReplacesLevel({ level_source: 'telus', level_at: read }, read)).toBe(false)
  })
  it('a typed level gives way to the next report', () => {
    expect(gaugeReplacesLevel({ level_source: 'typed', level_at: '2026-10-20T09:00:00Z' }, read)).toBe(true)
  })
  it('an older report from a gauge gone quiet does not undo a newer typed level', () => {
    expect(gaugeReplacesLevel({ level_source: 'typed', level_at: '2026-10-20T16:00:00Z' }, read)).toBe(false)
  })
  it('a level with no source or time (typed before this) gives way', () => {
    expect(gaugeReplacesLevel({ level_source: null, level_at: null }, read)).toBe(true)
  })
})

describe('gaugeInfoText', () => {
  it('puts the gas gauge report of 17 Oct in volts and signal out of 31', () => {
    expect(gaugeInfoText({ battery: '5788.5', cellsignal: '21', solarPanelV: '6563.64' })).toEqual(['battery 5.79 V', 'cell signal 21 of 31', 'solar panel 6.56 V'])
    expect(gaugeInfoText(null)).toEqual([])
  })
})

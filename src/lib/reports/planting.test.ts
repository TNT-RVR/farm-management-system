import { describe, expect, it } from 'vitest'
import { machineNamer, passesOf, plantingReport, plantingRows, type MachineRow, type Pass, type SeedOp } from './planting'
import type { CropArea, SeasonCrop, SeasonFieldRow } from './field-season'

const field = (id: string, name: string, active = true): SeasonFieldRow => ({ id, name, legal_land_description: null, active })
const crop = (id: string, name: string): SeasonCrop => ({ id, name, yield_unit: 'bu', default_yield_per_acre: null, renter_only: null, land_rent_only: null, counts_for_seeding: null })
const area = (fieldId: string, cropId: string, name: string, o: Partial<CropArea> = {}): CropArea => ({
  fieldId,
  cropId,
  crop: name,
  variety: null,
  acres: 100,
  renters: false,
  seeded: true,
  zone: false,
  expectedYield: null,
  ...o,
})
const pass = (fieldId: string, day: string, c: string | null, machine: string | null, operator: string | null = 'Sam Hansen'): Pass => ({ fieldId, day, crop: c, machine, operator })

const CROPS = [crop('corn', 'Grain Corn'), crop('canola', 'BASF Canola'), crop('carrot', 'Carrot'), crop('fallow', 'Fallow')]
const run = (o: { fields?: SeasonFieldRow[]; areas: CropArea[]; seeded?: [string, { date: string; from: string }][]; rentedOut?: [string, string][]; passes?: Pass[] }) =>
  plantingRows(
    {
      fields: o.fields ?? [field('f1', '1'), field('f2', '2')],
      areas: o.areas,
      crops: CROPS,
      seeded: new Map(o.seeded ?? []),
      rentedOut: new Map(o.rentedOut ?? []),
    },
    o.passes ?? [],
  )

describe('machineNamer', () => {
  const fleet: MachineRow[] = [
    { name: '8R 250 Prairie Creek Farm', platform_machine_id: '200002', serial_number: '1RW8250DPMC183549', archived: false },
    { name: '9560', platform_machine_id: '197972', serial_number: '1RW9560RTEP904264', archived: false },
    { name: '9560RT', platform_machine_id: null, serial_number: '1RW9560RTEP904264', archived: true },
  ]
  it('names the machine by the telematics id Deere puts on the pass', () => {
    expect(machineNamer(fleet)({ machine_id: '200002', machine_vin: null })).toBe('8R 250 Prairie Creek Farm')
  })
  it('falls back to the VIN when Deere left the id off', () => {
    expect(machineNamer(fleet)({ machine_id: null, machine_vin: ' 1rw8250dpmc183549 ' })).toBe('8R 250 Prairie Creek Farm')
  })
  it('prefers a machine still in the fleet over an archived copy of it', () => {
    expect(machineNamer(fleet)({ machine_id: null, machine_vin: '1RW9560RTEP904264' })).toBe('9560')
  })
  it('is null for a pass with no machine on it', () => {
    expect(machineNamer(fleet)({ machine_id: null, machine_vin: null })).toBeNull()
  })
})

describe('passesOf', () => {
  const op = (o: Partial<SeedOp>): SeedOp => ({ field_id: 'f1', started_at: '2026-05-08T14:00:00Z', machine_id: '200002', machine_vin: null, operator_name: null, raw: {}, ...o })
  const fleet: MachineRow[] = [{ name: '8R 250', platform_machine_id: '200002', serial_number: null, archived: false }]
  it('reads the day in farm time, Deere’s crop name and the machine, oldest first', () => {
    const r = passesOf([op({ started_at: '2026-05-12T14:00:00Z', raw: { cropName: 'CANOLA' } }), op({ raw: { cropName: 'CORN_WET' } })], fleet)
    expect(r.map((p) => [p.day, p.crop, p.machine])).toEqual([
      ['2026-05-08', 'CORN_WET', '8R 250'],
      ['2026-05-12', 'CANOLA', '8R 250'],
    ])
  })
  it('leaves out a pass with no field or no start', () => {
    expect(passesOf([op({ field_id: null }), op({ started_at: null })], fleet)).toEqual([])
  })

  it('takes every operator off raw, not just the one Deere flattened onto the row', () => {
    const raw = { fieldOperationMachines: [{ operators: [{ name: 'Sam Hansen' }, { name: 'Derek Olsen' }] }] }
    expect(passesOf([op({ raw, operator_name: 'Sam Hansen' })], fleet)[0].operator).toBe('Sam Hansen, Derek Olsen')
  })

  it('falls back to the flattened operator when raw carries none', () => {
    expect(passesOf([op({ operator_name: ' Dean Olsen ' })], fleet)[0].operator).toBe('Dean Olsen')
  })

  it('is null when nobody was signed in to the machine', () => {
    expect(passesOf([op({ raw: { fieldOperationMachines: [{ operators: [] }] } })], fleet)[0].operator).toBeNull()
  })
})

describe('plantingRows', () => {
  it('is a row a field and crop, with the day and the machine', () => {
    const r = run({
      areas: [area('f1', 'corn', 'Grain Corn', { variety: 'Grain corn', acres: 54.9 })],
      seeded: [['f1', { date: '2026-05-01', from: 'John Deere' }]],
      passes: [pass('f1', '2026-05-01', 'CORN_WET', '8R 250')],
    })
    expect(r.rows).toEqual([{ fieldId: 'f1', field: '1', crop: 'Grain Corn', variety: 'Grain corn', acres: 54.9, day: '2026-05-01', dayFrom: 'John Deere', machine: '8R 250', operator: 'Sam Hansen' }])
    expect([r.acres, r.noDay, r.noMachine]).toEqual([54.9, 0, 0])
  })

  it('adds up two map areas of the one crop into one row', () => {
    const r = run({
      areas: [area('f1', 'corn', 'Grain Corn', { acres: 10.1, zone: true }), area('f1', 'corn', 'Grain Corn', { acres: 31.4, zone: true, variety: 'P7211' })],
      seeded: [['f1', { date: '2026-05-08', from: 'John Deere' }]],
    })
    expect(r.rows).toHaveLength(1)
    expect([r.rows[0].acres, r.rows[0].variety]).toEqual([41.5, 'P7211'])
  })

  it('keeps the renter’s pass off our crop’s row on a field carrying both', () => {
    const r = run({
      areas: [area('f1', 'corn', 'Grain Corn'), area('f1', 'carrot', 'Carrot', { renters: true })],
      seeded: [['f1', { date: '2026-05-07', from: 'John Deere' }]],
      passes: [pass('f1', '2026-04-15', 'CARROTS', 'Carrot rig'), pass('f1', '2026-05-07', 'CORN_WET', '8R 250')],
    })
    expect(r.rows.map((x) => [x.crop, x.day, x.machine])).toEqual([['Grain Corn', '2026-05-07', '8R 250']])
    expect(r.left).toEqual(['Carrot on Field 1 (the renter’s crop)'])
  })

  it('leaves the machine empty rather than guess when a two-crop field’s passes cannot be placed', () => {
    const r = run({
      areas: [area('f1', 'corn', 'Grain Corn'), area('f1', 'canola', 'BASF Canola')],
      seeded: [['f1', { date: '2026-05-07', from: 'entered by hand' }]],
      passes: [pass('f1', '2026-05-07', null, '8R 250')],
    })
    expect(r.rows.map((x) => [x.crop, x.day, x.machine])).toEqual([
      ['BASF Canola', '2026-05-07', null],
      ['Grain Corn', '2026-05-07', null],
    ])
    expect(r.noMachine).toBe(2)
  })

  it('takes a two-crop field’s day from the crop’s own passes', () => {
    const r = run({
      areas: [area('f1', 'corn', 'Grain Corn'), area('f1', 'canola', 'BASF Canola')],
      seeded: [['f1', { date: '2026-05-07', from: 'John Deere' }]],
      passes: [pass('f1', '2026-05-07', 'CORN_WET', '8R 250'), pass('f1', '2026-05-20', 'CANOLA', '9560')],
    })
    expect(r.rows.map((x) => [x.crop, x.day, x.machine])).toEqual([
      ['BASF Canola', '2026-05-20', '9560'],
      ['Grain Corn', '2026-05-07', '8R 250'],
    ])
  })

  it('names everyone who drove the crop in, once each', () => {
    const r = run({
      areas: [area('f1', 'corn', 'Grain Corn')],
      passes: [pass('f1', '2026-05-09', 'CORN_WET', '8R 250', 'Sam Hansen'), pass('f1', '2026-05-10', 'CORN_WET', '8R 250', 'Derek Olsen, Sam Hansen')],
    })
    expect(r.rows.map((x) => [x.machine, x.operator])).toEqual([['8R 250', 'Sam Hansen, Derek Olsen']])
    expect(r.noOperator).toBe(0)
  })

  it('counts a row whose pass had nobody signed in', () => {
    const r = run({ areas: [area('f1', 'corn', 'Grain Corn')], passes: [pass('f1', '2026-05-09', 'CORN_WET', '8R 250', null)] })
    expect(r.rows.map((x) => x.operator)).toEqual([null])
    expect(r.noOperator).toBe(1)
  })

  it('falls back to the first Deere pass where the field’s season has no date', () => {
    const r = run({ areas: [area('f1', 'corn', 'Grain Corn')], passes: [pass('f1', '2026-05-09', 'CORN_WET', null), pass('f1', '2026-05-11', 'CORN_WET', '8R 250')] })
    expect(r.rows.map((x) => [x.day, x.dayFrom, x.machine])).toEqual([['2026-05-09', 'John Deere', '8R 250']])
  })

  it('counts a row with neither a date nor a machine instead of dropping it', () => {
    const r = run({ areas: [area('f1', 'corn', 'Grain Corn')] })
    expect(r.rows.map((x) => [x.day, x.machine])).toEqual([[null, null]])
    expect([r.noDay, r.noMachine]).toEqual([1, 1])
  })

  it('leaves off fallow, a field rented out whole, and an archived field, and says so once', () => {
    const r = run({
      fields: [field('f1', '1'), field('f2', '2'), field('f3', '3', false)],
      areas: [area('f1', 'fallow', 'Fallow', { seeded: false }), area('f2', 'corn', 'Grain Corn'), area('f2', 'canola', 'BASF Canola'), area('f3', 'corn', 'Grain Corn')],
      rentedOut: [['f2', 'a local farmer']],
    })
    expect(r.rows).toEqual([])
    expect(r.left).toEqual(['Fallow on Field 1 (not seeded)', 'Field 2 (rented out to a local farmer)'])
  })
})

describe('plantingReport', () => {
  const r = run({
    areas: [area('f1', 'corn', 'Grain Corn', { acres: 54.9 }), area('f2', 'canola', 'BASF Canola', { acres: 110.3 })],
    seeded: [['f1', { date: '2026-05-01', from: 'John Deere' }]],
    passes: [pass('f1', '2026-05-01', 'CORN_WET', '8R 250')],
  })

  it('says what it covers, how complete the machines are, and totals the acres', () => {
    const d = plantingReport(r, { year: 2026, fieldName: null })
    expect(d.subtitle).toBe('Crop year 2026 · All fields')
    expect(d.meta).toEqual([
      ['Fields', 2],
      ['Crops planted', 2],
      ['Acres', '165.2 ac'],
      ['Machine known', '1 of 2 rows'],
    ])
    expect(d.totals).toEqual(['All fields', null, null, 165.2, null, null, null])
    expect(d.groups[0].rows).toEqual([
      ['Field 1', 'Grain Corn', null, 54.9, 'May 1, 2026', '8R 250', 'Sam Hansen'],
      ['Field 2', 'BASF Canola', null, 110.3, '', null, null],
    ])
  })

  it('names the rows with no date and no machine rather than leaving them unexplained', () => {
    const summary = plantingReport(r, { year: 2026, fieldName: null }).summary ?? []
    expect(summary.some((s) => s.startsWith('1 row has no seeding date'))).toBe(true)
    expect(summary.some((s) => s.startsWith('1 row has no machine'))).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { startingPoints } from './combine-manual'
import { ACS_KEYS, DEFAULT_OPERATION_INSTANCE, OPTIONAL_STEPS, START_STEPS, monitorText, operationInstanceFor, pickSettings, startDefaultsOf, suggestHeader, type UsedSettings } from './combine-start'

// Every field, combine and figure here is made up.
const fieldName = (id: string | null) => ({ f1: 'North 40', f2: 'Creek Flat' })[id ?? ''] ?? null
const combineName = (id: string | null) => ({ c1: 'Combine A', c2: 'Combine B' })[id ?? ''] ?? null

const used = (over: Partial<UsedSettings> & { id: string; used_on: string }): UsedSettings => ({ crop_key: 'canola', field_id: 'f1', equipment_id: 'c1', created_at: `${over.used_on}T10:00:00Z`, ...over })

describe('which settings and why', () => {
  const by = (r: ReturnType<typeof pickSettings>) => Object.fromEntries(r.map((p) => [p.key, [p.value, p.source, p.why]]))

  it('takes each setting from the last time the crop was combined, setting by setting', () => {
    const r = by(
      pickSettings({
        cropKey: 'canola',
        cropYear: 2027,
        used: [
          used({ id: 'old', used_on: '2027-09-01', field_id: 'f2', rotor_rpm: 600, fan_rpm: 480 }),
          used({ id: 'new', used_on: '2027-09-10', rotor_rpm: 650, fan_rpm: null }),
          used({ id: 'wheat', used_on: '2027-09-20', crop_key: 'wheat', rotor_rpm: 1000 }),
        ],
        saved: [{ crop_key: 'canola', crop_year: 2027, concave_mm: 20 }],
        fieldName,
        combineName,
      }),
    )
    expect(r.rotor_rpm).toEqual([650, 'used', 'Last used on North 40, 10 Sep 2027'])
    // The newest row left the fan blank: the one before it has it.
    expect(r.fan_rpm).toEqual([480, 'used', 'Last used on Creek Flat, 1 Sep 2027'])
    expect(r.concave_mm).toEqual([20, 'saved', 'Your saved 2027 setting'])
    const book = startingPoints('canola')
    expect(r.sieve_mm).toEqual([book.sieve_mm.value, 'manual', 'Manual starting point'])
    expect(r.ground_speed_mph).toEqual([book.ground_speed_mph.value, 'estimate', 'Our starting estimate'])
  })

  it('prefers the picked combine’s last settings and says when a value came off the other one', () => {
    const rows = [used({ id: 'a', used_on: '2027-09-10', equipment_id: 'c2', rotor_rpm: 700, fan_rpm: 520 }), used({ id: 'b', used_on: '2027-09-05', equipment_id: 'c1', rotor_rpm: 640 })]
    const r = by(pickSettings({ cropKey: 'canola', cropYear: 2027, used: rows, saved: [], equipmentId: 'c1', fieldName, combineName }))
    expect(r.rotor_rpm).toEqual([640, 'used', 'Last used on North 40, 5 Sep 2027'])
    expect(r.fan_rpm).toEqual([520, 'used', 'Last used on North 40, 10 Sep 2027 (Combine B)'])
    // No combine picked: simply the newest.
    expect(by(pickSettings({ cropKey: 'canola', cropYear: 2027, used: rows, saved: [], fieldName })).rotor_rpm[0]).toBe(700)
  })

  it('uses the latest saved year up to this one, never a later year', () => {
    const r = by(
      pickSettings({
        cropKey: 'wheat',
        cropYear: 2027,
        used: [],
        saved: [
          { crop_key: 'wheat', crop_year: 2025, fan_rpm: 800 },
          { crop_key: 'wheat', crop_year: 2026, fan_rpm: 820 },
          { crop_key: 'wheat', crop_year: 2028, fan_rpm: 900 },
        ],
        fieldName,
      }),
    )
    expect(r.fan_rpm).toEqual([820, 'saved', 'Your saved 2026 setting'])
  })

  it('lists the work-condition settings apart from ground speed', () => {
    expect(ACS_KEYS).toContain('rotor_rpm')
    expect(ACS_KEYS).not.toContain('ground_speed_mph')
    expect(START_STEPS.map((s) => s.key)).toEqual(['place', 'task', 'operator', 'header', 'instance', 'variety', 'tag', 'settings', 'speed', 'finish'])
  })

  it('puts the variety in Variety (step 6) and keeps Tag optional', () => {
    expect(START_STEPS[5]).toMatchObject({ key: 'variety', title: 'Variety' })
    expect(START_STEPS[5].how).toMatch(/Variety Legend/)
    expect(START_STEPS[6].title).toMatch(/optional/i)
    expect(OPTIONAL_STEPS).toEqual(['tag', 'finish'])
  })
})

describe('header type', () => {
  it('suggests a pickup for a swathed crop and says why', () => {
    expect(suggestHeader('canola', { plan: 'swathed', swathedOn: null })).toEqual({ header: 'Pickup', why: 'Swathed (crop plan): pick up the swaths.' })
    expect(suggestHeader('wheat', { plan: null, swathedOn: '2027-08-30' }).header).toBe('Pickup')
    // The plan says straight-cut: a swathing record does not overrule it.
    expect(suggestHeader('canola', { plan: 'straight', swathedOn: '2027-08-30' }).header).toBe('Draper')
  })

  it('suggests by crop when straight-cut', () => {
    expect(suggestHeader('corn', { plan: 'swathed', swathedOn: null }).header).toBe('Corn')
    expect(suggestHeader('beans', { plan: 'straight', swathedOn: null }).header).toBe('Flex')
    expect(suggestHeader('barley', { plan: null, swathedOn: null })).toEqual({ header: 'Grain', why: 'Straight-cut (no swathing recorded).' })
  })
})

describe('operation instance and names', () => {
  const d = startDefaultsOf({ operation_instance: { crop: { canola: 'Canola Harv 1', wheat: ' ' }, header: { Pickup: 'Pickup Harv 1' } }, junk: 1 })

  it('takes the crop’s default, else the header’s, else the fallback', () => {
    expect(operationInstanceFor(d, 'canola', 'Pickup')).toEqual({ value: 'Canola Harv 1', why: 'The default for this crop.' })
    expect(operationInstanceFor(d, 'wheat', 'Pickup')).toEqual({ value: 'Pickup Harv 1', why: 'The default for the Pickup header.' })
    expect(operationInstanceFor(d, 'wheat', 'Grain')).toEqual({ value: DEFAULT_OPERATION_INSTANCE, why: 'No default set.' })
    expect(startDefaultsOf(null)).toEqual({})
  })

  it('keeps operator and tag names to 18', () => {
    expect(monitorText('Alexandra Montgomery-Smith')!.length).toBeLessThanOrEqual(18)
    expect(monitorText('AAC Example 1/2')).toBe('AAC Example Half')
    expect(monitorText('  ')).toBe('')
  })
})

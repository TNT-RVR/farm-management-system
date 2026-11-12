import { describe, expect, it } from 'vitest'
import { declaredUnit, fuelToLitres, lengthToMetres } from './export-units'

/*
 * The two DataAttributes blocks below are copied out of the real exports of
 * the SAME pass — the 25 Jun 2026 seeding of 11 SE 16-1 — pulled through the
 * old endpoint and through the Operations Data Export on 11 Nov 2026. They are
 * the evidence that an export says what it is, which is the only thing that
 * makes a zip of unknown age safe to read.
 */
const OLD = {
  DataAttributes: [
    { Name: 'Time', Description: 'Timestamp' },
    { Name: 'AppliedRate', Unit: 'lb1ac-1' },
    { Name: 'SWATHWIDTH', Unit: 'ft' },
    { Name: 'DISTANCE', Unit: 'ft' },
    { Name: 'Elevation', Unit: 'ft' },
    { Name: 'FUEL', Unit: 'gal' },
    { Name: 'PRODUCTHASH', Description: 'ProductUseHash' },
  ],
}

const NEW = {
  DataAttributes: [
    { Name: 'DISTANCE', Unit: 'm' },
    { Name: 'SWATHWIDTH', Unit: 'm' },
    { Name: 'APPLIEDRATE', Unit: 'kg1ha-1' },
    { Name: 'ELEVATION', Unit: 'm' },
    { Name: 'ISOTIME', Description: 'Precise Timestamp' },
    { Name: 'FUEL', Unit: 'l' },
    { Name: 'VARIETY', Description: 'Index into the Varieties map' },
  ],
}

describe('declaredUnit', () => {
  it('reads the old export’s feet and gallons', () => {
    expect(declaredUnit(OLD, 'SWATHWIDTH')).toBe('ft')
    expect(declaredUnit(OLD, 'DISTANCE')).toBe('ft')
    expect(declaredUnit(OLD, 'FUEL')).toBe('gal')
  })

  it('reads the new export’s metres and litres', () => {
    expect(declaredUnit(NEW, 'SWATHWIDTH')).toBe('m')
    expect(declaredUnit(NEW, 'DISTANCE')).toBe('m')
    expect(declaredUnit(NEW, 'FUEL')).toBe('l')
  })

  // The new export uppercased every column, and DataAttributes followed. A
  // case-sensitive match would silently find nothing on one of the two.
  it('does not care about case', () => {
    expect(declaredUnit(OLD, 'elevation')).toBe('ft')
    expect(declaredUnit(NEW, 'Elevation')).toBe('m')
  })

  it('is null for a column with no unit, an unknown column, or no metadata', () => {
    expect(declaredUnit(NEW, 'ISOTIME')).toBeNull()
    expect(declaredUnit(NEW, 'NOT_A_COLUMN')).toBeNull()
    expect(declaredUnit(null, 'FUEL')).toBeNull()
    expect(declaredUnit({}, 'FUEL')).toBeNull()
  })

  it('reads DataAttributes as a map too, which one spray arrived as', () => {
    expect(declaredUnit({ DataAttributes: { '1': { Name: 'FUEL', Unit: 'l' } } }, 'FUEL')).toBe('l')
  })
})

describe('the factors', () => {
  it('turns the two exports’ lengths into metres', () => {
    expect(lengthToMetres(declaredUnit(NEW, 'SWATHWIDTH'))).toBe(1)
    expect(lengthToMetres(declaredUnit(OLD, 'SWATHWIDTH'))).toBeCloseTo(0.3048, 9)
  })

  it('turns the two exports’ fuel into litres', () => {
    expect(fuelToLitres(declaredUnit(NEW, 'FUEL'))).toBe(1)
    expect(fuelToLitres(declaredUnit(OLD, 'FUEL'))).toBeCloseTo(3.785411784, 9)
  })

  // The whole point: null, so a caller says "I do not know" rather than
  // multiplying by a number it made up.
  it('refuses a unit it does not know, rather than guessing', () => {
    for (const u of ['furlongs', 'kg1ha-1', '', null, undefined]) {
      expect(lengthToMetres(u)).toBeNull()
      expect(fuelToLitres(u)).toBeNull()
    }
  })

  it('agrees with itself: one swath, read both ways', () => {
    // The drill is 18.542 m wide; the old export wrote the same width as
    // 60.834 ft. Both must land on the same metres.
    const metres = 18.542 * lengthToMetres('m')!
    const feet = 60.8333 * lengthToMetres('ft')!
    expect(feet).toBeCloseTo(metres, 2)
  })
})

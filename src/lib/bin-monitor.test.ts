import { describe, expect, it } from 'vitest'
import { canolaMoisture, CANOLA_TABLE, emcKind, excelRound, flagsFor, moistureFor, sixLevels, type Level } from './bin-monitor'

describe("BASF's canola table", () => {
  it('holds the averaged rows exactly as the sheet computes them', () => {
    // Cached values from the template: 0 °C / 35% = 6.55, 6 °C / 40% = 6.683
    expect(CANOLA_TABLE[1][0]).toBeCloseTo(6.55, 10)
    expect(CANOLA_TABLE[4][1]).toBeCloseTo(6.683, 10)
    expect(CANOLA_TABLE[11][10]).toBeCloseTo(12.2, 10)
  })

  it('reads a straight lookup', () => {
    expect(canolaMoisture(70, 10)).toBe(10.5)
    expect(canolaMoisture(35, 28)).toBe(4.8)
  })

  it('rounds like Excel: temperature to 2 °C, RH to 5 %, halves away from zero', () => {
    expect(excelRound(-0.5)).toBe(-1)
    expect(excelRound(2.5)).toBe(3)
    // 9 °C → 2·ROUND(4.5) = 10; 52.5 % → 5·ROUND(10.5) = 55
    expect(canolaMoisture(52.5, 9)).toBe(8.3)
    // −1 °C → 2·ROUND(−0.5) = −2
    expect(canolaMoisture(35, -1)).toBe(6.7)
  })

  it('reads 24 °C off the 22 °C row, as the sheet does (it has no 24 row)', () => {
    expect(canolaMoisture(50, 24)).toBe(6.7)
  })

  it('leaves it blank outside the table, like the sheet', () => {
    expect(canolaMoisture(34, 10)).toBeNull()
    expect(canolaMoisture(86, 10)).toBeNull()
    expect(canolaMoisture(50, 28.5)).toBeNull()
    expect(canolaMoisture(50, -2.5)).toBeNull()
    expect(canolaMoisture(null, 10)).toBeNull()
    // 34 °C in the screenshot's empty bin: out of the table.
    expect(canolaMoisture(40, 34)).toBeNull()
  })

  it('routes canola to the table', () => {
    expect(moistureFor('BASF CANOLA', 70, 10)).toEqual({ value: 10.5, from: 'table' })
  })
})

describe('the report', () => {
  const lv = (n: number): Level[] => Array.from({ length: n }, (_, i) => ({ level: i + 1, temp_c: 10 + i, rh_pct: 50, moisture_pct: 7, moisture_from: 'table' }))
  it('fills six columns top to bottom, padding a short cable', () => {
    const s = sixLevels(lv(5))
    expect(s.map((x) => x?.level ?? null)).toEqual([1, 2, 3, 4, 5, null])
  })
  it('keeps the top and bottom sensors on a long cable', () => {
    const s = sixLevels(lv(9))
    expect(s[0]!.level).toBe(1)
    expect(s[5]!.level).toBe(9)
  })
})

describe('flags', () => {
  const at = (level: number, temp_c: number, moisture_pct: number | null, air = false): Level => ({ level, temp_c, rh_pct: null, moisture_pct, moisture_from: 'table', air })
  it('flags damp canola, heating and warm levels, and ignores headspace air', () => {
    const now = [at(1, 30, 12, true), at(2, 18, 8.5), at(3, 12, 7)]
    const before = [at(2, 14, 8), at(3, 11, 7)]
    const f = flagsFor('Canola', now, before, 10)
    expect(f.find((x) => x.level === 1)).toBeUndefined()
    expect(f.filter((x) => x.level === 2).map((x) => x.kind).sort()).toEqual(['damp', 'heating'])
    expect(f.find((x) => x.level === 3)).toBeUndefined()
    expect(flagsFor('Canola', [at(1, 10, 10.5)], null, 10)[0].kind).toBe('wet')
  })
})

describe('other crops, by published equation', () => {
  // Wet-basis values the research worked out from each set (25 °C / 70 %, 5 °C / 60 %).
  it.each([
    ['Wheat', 14.5, 14.6],
    ['Durum Wheat', 13.5, 12.8],
    ['Barley', 13.2, 12.2],
    ['Corn', 14.4, 14.5],
    ['Beans-Pinto', 15.8, 14.9],
    ['Beans-Black', 14.8, 15.4],
    ['Beans-Great Northern', 14.6, 14.1],
    ['Oats', 12.4, 12.6],
    ['Flax', 9.3, 9.3],
    ['Soybeans', 13.3, 11.3],
    ['Lentils', 12.5, 12.2],
  ])('%s', (crop, warm, cool) => {
    expect(Math.abs(moistureFor(crop, 70, 25)!.value - warm)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(moistureFor(crop, 60, 5)!.value - cool)).toBeLessThanOrEqual(0.1)
    expect(moistureFor(crop, 70, 25)!.from).toBe('equation')
  })

  it('says when a reading is outside the range the equation was fitted over', () => {
    expect(moistureFor('Beans-Pinto', 60, 5)!.outside).toBe(true)
    expect(moistureFor('Beans-Pinto', 60, 25)!.outside).toBe(false)
  })

  it('computes nothing for peas, which have no published set', () => {
    expect(emcKind('Peas')).toBe('pea')
    expect(moistureFor('Peas', 70, 25)).toBeNull()
  })

  it('does not read beans or sweet corn wrongly', () => {
    expect(emcKind('Beans-Yellow')).toBe('bean')
    expect(emcKind('Buckwheat')).toBeNull()
  })
})

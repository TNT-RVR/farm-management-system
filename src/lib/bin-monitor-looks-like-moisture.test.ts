import { describe, expect, it } from 'vitest'
import { looksLikeMoisture } from './bin-monitor'

/**
 * The 16 Nov 2026 reading of Main Yard - #21: Bin-Sense's own moisture figures
 * typed into the form with the % still set to relative humidity. Canola's
 * table starts at 35 % humidity, so every level saved with no moisture at all.
 */
const theReading = [
  { temp_c: 9, pct: 8.5 },
  { temp_c: 8, pct: 8.3 },
  { temp_c: 8, pct: 8.8 },
  { temp_c: 8.5, pct: 6.9 },
  { temp_c: 11.5, pct: 5.8 },
]

describe('humidity that is really grain moisture', () => {
  it('catches the reading that saved with no moisture', () => {
    expect(looksLikeMoisture('BASF Canola', theReading)).toBe(true)
  })

  it('catches it for a crop read by equation too', () => {
    // Every equation stops at 10 % humidity, so a column of 6–9 % converts
    // for no crop.
    expect(looksLikeMoisture('Grain Corn', theReading)).toBe(true)
    expect(looksLikeMoisture('CWRS Wheat', theReading)).toBe(true)
  })

  it('leaves a real humidity reading alone', () => {
    expect(
      looksLikeMoisture('BASF Canola', [
        { temp_c: 9, pct: 55 },
        { temp_c: 8, pct: 58 },
        { temp_c: 8, pct: 61 },
      ]),
    ).toBe(false)
  })

  it('says nothing on figures that still convert', () => {
    // 12–14 % humidity is a strange reading, but the crop's equation answers
    // it, so the form is not second-guessed.
    expect(
      looksLikeMoisture('Grain Corn', [
        { temp_c: 9, pct: 12 },
        { temp_c: 8, pct: 14 },
      ]),
    ).toBe(false)
  })

  it('says nothing for a crop with no table of its own', () => {
    // Field peas convert nothing, so a null proves nothing about the numbers.
    expect(looksLikeMoisture('Field Peas', theReading)).toBe(false)
    expect(looksLikeMoisture(null, theReading)).toBe(false)
  })

  it('wants more than one figure before it speaks', () => {
    expect(looksLikeMoisture('BASF Canola', [{ temp_c: 9, pct: 8.5 }])).toBe(false)
    expect(looksLikeMoisture('BASF Canola', [])).toBe(false)
  })

  it('ignores the levels nobody typed', () => {
    expect(
      looksLikeMoisture('BASF Canola', [
        { temp_c: 9, pct: 8.5 },
        { temp_c: 8, pct: 8.3 },
        { temp_c: null, pct: null },
      ]),
    ).toBe(true)
  })
})

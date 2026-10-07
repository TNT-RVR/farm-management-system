import { describe, expect, it } from 'vitest'
import { SOIL_TEXTURES } from './et'
import { TEXTURES } from './soil-textures'
import { SETUP_HELP, SOIL_PROFILE_HELP } from './irrigation-help'

// The guide is reference material a person makes a watering decision from, so
// the things that would quietly make it wrong — a texture the engine does not
// know, a class silently missing, FC and WP the wrong way round — are worth
// holding down rather than trusting to review.
describe('soil texture guide', () => {
  it('covers every texture the engine can be set to, and invents none', () => {
    expect([...TEXTURES.map((t) => t.key)].sort()).toEqual(Object.keys(SOIL_TEXTURES).sort())
  })

  it('has compositions that sum to 100%', () => {
    for (const t of TEXTURES) {
      expect(t.sand + t.silt + t.clay, t.label).toBe(100)
    }
  })

  it('orders the classes from coarsest to finest', () => {
    // The cards are read side by side; out of order they stop being a scale.
    const clay = TEXTURES.map((t) => t.clay)
    expect(TEXTURES[0].key).toBe('sand')
    expect(TEXTURES[TEXTURES.length - 1].key).toBe('clay')
    expect(Math.max(...clay)).toBe(TEXTURES[TEXTURES.length - 1].clay)
  })

  it('holds more water as clay content rises', () => {
    // Guards the pairing between a card and the engine capacity printed on it:
    // if a key were mapped to the wrong class this ordering breaks.
    const avail = TEXTURES.map((t) => SOIL_TEXTURES[t.key])
    expect(avail[0].fc).toBeLessThan(avail[avail.length - 1].fc)
    for (const [i, t] of TEXTURES.entries()) {
      expect(avail[i].wp, `${t.label} WP must sit below FC`).toBeLessThan(avail[i].fc)
    }
  })

  it('gives every class the three field tests a person identifies it by', () => {
    for (const t of TEXTURES) {
      expect(t.ribbon.length, t.label).toBeGreaterThan(10)
      expect(t.feel.length, t.label).toBeGreaterThan(10)
      expect(t.ball.length, t.label).toBeGreaterThan(10)
    }
  })
})

describe('setup column help', () => {
  // A mistyped key renders an empty popover rather than throwing, so the only
  // thing that catches it is a check that every entry is actually populated.
  const entries = [...Object.entries(SETUP_HELP), ...Object.entries(SOIL_PROFILE_HELP)]

  it('populates every entry', () => {
    for (const [key, help] of entries) {
      expect(help.title.length, key).toBeGreaterThan(2)
      expect(help.body.length, key).toBeGreaterThan(0)
      for (const para of help.body) expect(para.trim().length, key).toBeGreaterThan(20)
    }
  })

  it('gives every entry that promises a method some lines to follow', () => {
    for (const [key, help] of entries) {
      if (!help.how) continue
      expect(help.how.label.trim().length, key).toBeGreaterThan(2)
      expect(help.how.lines.length, key).toBeGreaterThan(0)
      for (const line of help.how.lines) expect(line.trim().length, key).toBeGreaterThan(10)
    }
  })

  it('covers each column of the setup table', () => {
    for (const key of [
      'field', 'station', 'cropPlan', 'coefficient', 'planted',
      'pivotCap', 'efficiency', 'kcMode', 'soil', 'fcwp', 'done',
    ]) {
      expect(SETUP_HELP[key], key).toBeDefined()
    }
  })
})

import { describe, expect, it } from 'vitest'
import { describeHorizon, parseHorizon } from './soil-glossary'

describe('parseHorizon', () => {
  it('reads the codes this farm actually has', () => {
    // Ap, Ah, Bm, BC and Ck are every horizon in the AGRASID profiles here.
    expect(describeHorizon('Ap')).toBe('Topsoil, ploughed')
    expect(describeHorizon('Ah')).toBe('Topsoil, humus-rich')
    expect(describeHorizon('Bm')).toBe('Subsoil, weathered')
    expect(describeHorizon('Ck')).toBe('Parent material, carbonate present')
  })

  it('reads a transitional horizon as the layer between two', () => {
    // "BC" is not a B with a C suffix — it is subsoil grading into parent
    // material, and treating the second capital as a suffix would drop it.
    const p = parseHorizon('BC')
    expect(p?.master?.name).toBe('Subsoil')
    expect(p?.transitionTo?.name).toBe('Parent material')
    expect(p?.suffixes).toEqual([])
    expect(describeHorizon('BC')).toBe('Subsoil grading into parent material')
  })

  it('takes two-letter suffixes before one-letter ones', () => {
    // "Cca" is carbonate ACCUMULATION. Read letter by letter it becomes
    // c-then-a — a cemented pan — which is a different problem entirely.
    const p = parseHorizon('Cca')
    expect(p?.suffixes.map((s) => s.letter)).toEqual(['ca'])
    expect(describeHorizon('Cca')).toBe('Parent material, carbonate accumulation')
    expect(describeHorizon('Csa')).toBe('Parent material, salt accumulation')
  })

  it('reads several suffixes in order', () => {
    // Solonetzic ground: sodium-affected subsoil with clay moved into it.
    expect(describeHorizon('Bnt')).toBe('Subsoil, sodic (solonetzic), clay accumulation')
  })

  it('ignores a letter it does not know rather than inventing one', () => {
    const p = parseHorizon('Bmx')
    expect(p?.suffixes.map((s) => s.letter)).toEqual(['m'])
  })

  it('gives nothing back for nothing', () => {
    expect(parseHorizon(null)).toBeNull()
    expect(parseHorizon('')).toBeNull()
    expect(describeHorizon('zzz')).toBeNull()
  })
})

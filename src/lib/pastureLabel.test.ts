import { describe, expect, it } from 'vitest'
import { pastureLabel } from './pastureLabel'

// Every name in the pastures table, verbatim.
const REAL_NAMES = [
  'Farm Outer Boundary (Rough)',
  'Pasture A',
  'Pasture B',
  'Pasture C',
  'Pasture D',
  'Pasture E- East',
  'Pasture E- West',
  'Pasture F',
  'Pasture G',
  'Pasture H',
  'Pasture I',
  'Pasture J- East',
  'Pasture J- West',
  'Pasture K',
  'Pasture L',
  'Pasture M',
  'Pasture N',
]

describe('pastureLabel', () => {
  it('reduces a paddock name to the letter people say', () => {
    expect(pastureLabel('Pasture A')?.text).toBe('A')
    expect(pastureLabel('Pasture N')?.letter).toBe('N')
  })

  it('keeps the half a split paddock is, on its own line', () => {
    expect(pastureLabel('Pasture E- West')).toEqual({ letter: 'E', part: 'West', text: 'E\nWest' })
    expect(pastureLabel('Pasture J- East')?.text).toBe('J\nEast')
  })

  it('reads the other separator the data uses', () => {
    expect(pastureLabel('Pasture E (West)')?.text).toBe('E\nWest')
  })

  // The one that would actually be wrong on screen: this row covers the whole
  // ranch, so a label would sit in the middle of every other paddock.
  it('gives the farm outer boundary no letter at all', () => {
    expect(pastureLabel('Farm Outer Boundary (Rough)')).toBeNull()
  })

  it('refuses anything that is not a lettered paddock rather than guessing', () => {
    expect(pastureLabel('Home Quarter')).toBeNull()
    expect(pastureLabel('')).toBeNull()
    expect(pastureLabel(null)).toBeNull()
    expect(pastureLabel(undefined)).toBeNull()
  })

  it('labels every real paddock and nothing else', () => {
    const labelled = REAL_NAMES.filter((n) => pastureLabel(n) !== null)
    expect(labelled).toHaveLength(16)
    expect(labelled).not.toContain('Farm Outer Boundary (Rough)')
    // A through N, with E and J appearing twice.
    const letters = labelled.map((n) => pastureLabel(n)!.letter)
    expect(new Set(letters).size).toBe(14)
  })

  it('handles a bare letter, in case a name is ever tidied up', () => {
    expect(pastureLabel('A')?.text).toBe('A')
    expect(pastureLabel('e- west')?.text).toBe('E\nWest')
  })
})

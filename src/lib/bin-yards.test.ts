import { describe, expect, it } from 'vitest'
import { hiddenYardNames, inHiddenYard, yardRank, type BinYard } from './bin-yards'

const yard = (name: string, shown: boolean, sort: number): BinYard => ({ id: name, name, shown, sort, home: sort === 0, created_at: '', updated_at: '' })
const yards = [yard('Main Yard', true, 0), yard('Creek Yard', false, 1), yard('North Yard', true, 2)]

describe('bin yards', () => {
  it('a hidden yard hides its bins; a bin with no yard is never hidden', () => {
    const hidden = hiddenYardNames(yards)
    expect([...hidden]).toEqual(['Creek Yard'])
    expect(inHiddenYard({ site: 'Creek Yard' }, hidden)).toBe(true)
    expect(inHiddenYard({ site: 'Main Yard' }, hidden)).toBe(false)
    expect(inHiddenYard({ site: null }, hidden)).toBe(false)
  })
  it('ranks yards in the farm’s order, unknown ones last', () => {
    const rank = yardRank(yards)
    expect(['North Yard', 'Somewhere', 'Main Yard'].sort((a, b) => rank(a) - rank(b))).toEqual(['Main Yard', 'North Yard', 'Somewhere'])
  })
})

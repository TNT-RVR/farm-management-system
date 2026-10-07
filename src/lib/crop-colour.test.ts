import { describe, expect, it } from 'vitest'
import { CROP_PALETTE, cropColour, isHexColour, readableOn } from './crop-colour'

describe('cropColour', () => {
  it('uses the colour somebody chose', () => {
    expect(cropColour({ id: 'a', color: '#ff0000' })).toBe('#ff0000')
  })

  it('gives the same crop the same fallback every time', () => {
    const a = cropColour({ id: 'corn-uuid', color: null })
    expect(a).toBe(cropColour({ id: 'corn-uuid' }))
    expect(CROP_PALETTE).toContain(a)
  })

  it('ignores junk in the column rather than handing it to CSS', () => {
    const c = cropColour({ id: 'x', color: 'red; background: url(evil)' })
    expect(CROP_PALETTE).toContain(c)
  })

  it('has a colour for "nothing in this bin" that is not a crop colour', () => {
    expect(CROP_PALETTE).not.toContain(cropColour(null))
  })
})

describe('isHexColour', () => {
  it('takes both short and long form', () => {
    expect(isHexColour('#abc')).toBe(true)
    expect(isHexColour('#AABBCC')).toBe(true)
    expect(isHexColour('abc')).toBe(false)
    expect(isHexColour('#abcd')).toBe(false)
  })
})

describe('readableOn', () => {
  it('puts dark text on pale crops and light text on dark ones', () => {
    expect(readableOn('#ffff00')).toBe('#000000')
    expect(readableOn('#16a34a')).toBe('#ffffff')
    expect(readableOn('#fff')).toBe('#000000')
  })
})

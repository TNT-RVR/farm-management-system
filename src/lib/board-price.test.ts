import { describe, expect, it } from 'vitest'
import { boardPriceIn, fmtUnitPrice, LB_PER_TONNE } from './board-price'

describe('boardPriceIn', () => {
  it('turns a $/tonne canola price into $/bu at the standard 50 lb', () => {
    const p = boardPriceIn(776.8, '$/tonne', { name: 'Canola', unit: 'bu' })!
    expect(p.value).toBeCloseTo((776.8 * 50) / LB_PER_TONNE, 6)
    expect(p.value).toBeCloseTo(17.62, 2)
    expect(p.converted).toBe(true)
    expect(p.lbPerBu).toBe(50)
    expect(p.basis).toContain('standard')
  })

  it("prefers the crop's own test weight", () => {
    const p = boardPriceIn(300, '$/tonne', { name: 'Wheat', unit: 'bu', testWeightLbPerBu: '62' })!
    expect(p.value).toBeCloseTo((300 * 62) / LB_PER_TONNE, 6)
    expect(p.basis).toContain('crop test weight')
  })

  it('converts to pounds and hundredweight', () => {
    expect(boardPriceIn(2204.62262, '$/tonne', { name: 'Beans-Pinto', unit: 'lbs' })!.value).toBeCloseTo(1, 6)
    expect(boardPriceIn(400, '$/tonne', { name: 'Potato', unit: 'cwt' })!.value).toBeCloseTo(400 / 22.0462262, 6)
  })

  it('passes a tonne price through for a crop sold by the tonne', () => {
    const p = boardPriceIn(250, '$/tonne', { name: 'Grain Corn', unit: 'MT' })!
    expect(p.value).toBe(250)
    expect(p.converted).toBe(false)
  })

  it('labels the raw quote and formats per-unit prices with enough decimals', () => {
    const p = boardPriceIn(812.4, '$/tonne', { name: 'Canola', unit: 'bu' })!
    expect(p.quoted).toBe('$812.40/tonne')
    expect(fmtUnitPrice(17.623, 'bu')).toBe('$17.62')
    expect(fmtUnitPrice(0.4512, 'lbs')).toBe('$0.451')
    expect(fmtUnitPrice(-1.5, 'bu')).toBe('-$1.50')
  })

  it('refuses what it cannot convert honestly', () => {
    // US dollars: no exchange rate here.
    expect(boardPriceIn(4.5, 'USD/bu', { name: 'Grain Corn', unit: 'bu' })).toBeNull()
    // No bushel weight for the crop.
    expect(boardPriceIn(500, '$/tonne', { name: 'Alfalfa Seed', unit: 'bu' })).toBeNull()
    // Not a price per weight.
    expect(boardPriceIn(100, 'index', { name: 'Canola', unit: 'bu' })).toBeNull()
    expect(boardPriceIn(100, '$/tonne', { name: 'Fallow', unit: 'ac' })).toBeNull()
    expect(boardPriceIn(100, null, { name: 'Canola', unit: 'bu' })).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { LB_PER_TONNE, type BlendProduct } from './blend'
import { blendTotalsAsPrinted } from './blend-display'

const product = (id: string): BlendProduct => ({ id, name: id, n: 0, p: 0, k: 0, s: 0, zn: 0, pricePerTonne: null, density: null })

describe('blendTotalsAsPrinted', () => {
  it('adds the rates and tonnes as each line prints them', () => {
    // 155.6 + 76.6 + 19.6 = 251.8, which printed "Rate 252" over lines of
    // 156 + 77 + 20 = 253.
    const lines = [
      { product: product('urea'), lbPerAc: 155.6 },
      { product: product('map'), lbPerAc: 76.6 },
      { product: product('ams'), lbPerAc: 19.6 },
    ]
    const acres = 65
    const t = blendTotalsAsPrinted(lines, acres)
    expect(t.rate).toBe(156 + 77 + 20)
    const shown = lines.map((l) => +((l.lbPerAc * acres) / LB_PER_TONNE).toFixed(1))
    expect(t.lineTonnes).toEqual(shown)
    expect(t.tonnes).toBeCloseTo(shown.reduce((a, b) => a + b, 0), 6)
  })

  it('keeps the decimal a small line prints', () => {
    const t = blendTotalsAsPrinted([{ product: product('zn'), lbPerAc: 4.24 }, { product: product('urea'), lbPerAc: 100 }], 0)
    expect(t.rate).toBeCloseTo(104.2, 6)
    expect(t.tonnes).toBe(0)
  })
})

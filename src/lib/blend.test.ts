import { describe, expect, it } from 'vitest'
import { blendsUsing, leastCostBlends, SHEET_PRODUCTS, sheetBlend, type BlendProduct, type Targets } from './blend'

const products: BlendProduct[] = SHEET_PRODUCTS.map((p, i) => ({ ...p, id: String(i) }))
const byName = (s: string) => products.find((p) => p.name.startsWith(s))!
const t = (n: number, p: number, k: number, s: number, zn = 0): Targets => ({ n, p, k, s, zn })

describe('the spreadsheet method', () => {
  it('matches the sheet: 80-40-12-0 with 35 lb N as ESN on 65 ac', () => {
    const esn = byName('ESN')
    const r = sheetBlend(t(80, 40, 12, 0), products, [{ product: esn, lbPerAc: 35 / 0.44 }])
    const rate = (name: string) => r.lines.find((l) => l.product.name.startsWith(name))?.lbPerAc ?? 0
    // MAP = 40/0.52; potash = 12/0.6; urea = (80 - 35 - MAP N)/0.46.
    expect(rate('11-52-0')).toBeCloseTo(40 / 0.52, 6)
    expect(rate('0-0-60')).toBeCloseTo(20, 6)
    expect(rate('46-0-0')).toBeCloseTo((80 - 35 - (40 / 0.52) * 0.11) / 0.46, 6)
    expect(r.supplied.n).toBeCloseTo(80, 6)
    expect(r.supplied.p).toBeCloseTo(40, 6)
    // Sheet cost/ac for these rates and prices.
    const cost = (35 / 0.44) * 960 + (40 / 0.52) * 1068 + 20 * 1000 + rate('46-0-0') * 680
    expect(r.costPerAc).toBeCloseTo(cost / 2204.62, 6)
  })
})

describe('least cost', () => {
  it('finds the cheapest mix that meets every target', () => {
    const opts = leastCostBlends(t(100, 30, 0, 15), products)
    const best = opts[0]
    expect(best.supplied.n).toBeGreaterThanOrEqual(100 - 1e-6)
    expect(best.supplied.p).toBeGreaterThanOrEqual(30 - 1e-6)
    expect(best.supplied.s).toBeGreaterThanOrEqual(15 - 1e-6)
    // No worse than the sheet's fixed recipe.
    expect(best.costPerAc!).toBeLessThanOrEqual(sheetBlend(t(100, 30, 0, 15), products).costPerAc! + 1e-9)
    // Cheapest first, distinct product sets.
    for (let i = 1; i < opts.length; i++) expect(opts[i].costPerAc!).toBeGreaterThanOrEqual(opts[i - 1].costPerAc!)
    expect(new Set(opts.map((o) => o.key)).size).toBe(opts.length)
  })
  it('uses the cheap sulphur source when S is asked for', () => {
    const best = leastCostBlends(t(60, 0, 0, 20), products)[0]
    expect(best.lines.some((l) => l.product.name.startsWith('21-0-0-24'))).toBe(true)
  })
})

describe('blendsUsing', () => {
  it('finds saved blends by product id, or by name where no id was kept', () => {
    const blends = [
      { name: 'A', lines: [{ product_id: 'u', name: 'Urea' }] },
      { name: 'B', lines: [{ name: 'Urea' }] },
      { name: 'C', lines: [{ product_id: 'x', name: 'Urea' }] },
      { name: 'D', lines: null },
    ]
    expect(blendsUsing(blends, { id: 'u', name: 'Urea' })).toEqual(['A', 'B'])
  })
})

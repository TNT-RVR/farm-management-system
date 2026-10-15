import { describe, expect, it } from 'vitest'
import { breakevenYield, cornWetTonnesPerBu, marginPerAcre, payoffGrid, tieYield, yieldFor, type CompareSide } from './crop-compare'

const side = (o: Partial<CompareSide>): CompareSide => ({ yield: 100, price: 5, cost: 300, extraPerAcre: 0, extraPerUnit: 0, revShare: 1, costShare: 1, ...o })

describe('crop compare', () => {
  it('builds the margin from yield, price and every cost', () => {
    expect(marginPerAcre(side({ extraPerAcre: 67, extraPerUnit: 0.5 }))).toBe(100 * 5 - 300 - 67 - 50)
  })

  it('takes our side of a land deal', () => {
    // 50% of the gross, inputs all ours.
    expect(marginPerAcre(side({ revShare: 0.5 }))).toBe(250 - 300)
    // 50/50 net split.
    expect(marginPerAcre(side({ revShare: 0.5, costShare: 0.5 }))).toBe(100)
  })

  it('finds the break-even and tie yields', () => {
    expect(breakevenYield(side({}))).toBe(60)
    const a = side({ price: 8.25, cost: 500 })
    const b = side({ yield: 4.47, price: 270, cost: 500 })
    const y = tieYield(a, b)!
    expect(marginPerAcre(a, y)).toBeCloseTo(marginPerAcre(b), 6)
  })

  it('has no yield when a unit earns nothing', () => {
    expect(yieldFor(side({ price: 1, extraPerUnit: 1 }), 0)).toBeNull()
  })

  it('lays out who wins at each pair of yields', () => {
    const g = payoffGrid(side({}), side({ price: 4 }), 'bu', 'bu')
    expect(g.yieldsA).toEqual([70, 85, 100, 115, 130])
    expect(g.cells[2][2]).toBe(100)
  })

  it('converts dry corn bushels to wet tonnes', () => {
    expect(150 * cornWetTonnesPerBu(28)).toBeCloseTo(4.47, 2)
    expect(cornWetTonnesPerBu(15.5)).toBeCloseTo(0.0254, 4)
  })
})

import { describe, expect, it } from 'vitest'
import {
  basisVerdict,
  cashEquivalent,
  crossUnitBasis,
  sameUnitBasis,
  usdBuToCadTonne,
} from './basis'

describe('usdBuToCadTonne', () => {
  it('converts a CBOT wheat quote into what an elevator would call it', () => {
    // 6.595 USD/bu, 36.744 bu to the tonne, dollar at 1.4018 CAD per USD.
    const cad = usdBuToCadTonne(6.595, 'wheat', 1.4018)
    expect(cad).toBeCloseTo(6.595 * 36.744 * 1.4018, 4)
    // Sanity: that lands near an Alberta bid, in the low 300s.
    expect(cad).toBeGreaterThan(250)
    expect(cad).toBeLessThan(400)
  })

  it('refuses a commodity with no standard bushel weight', () => {
    // Dry beans are sold by the hundredweight under contract; there is no
    // bushel to convert through, and inventing one would be silent nonsense.
    expect(usdBuToCadTonne(20, 'dry beans', 1.4)).toBeNull()
  })

  it('refuses a nonsense exchange rate rather than returning a negative price', () => {
    expect(usdBuToCadTonne(6.6, 'wheat', 0)).toBeNull()
    expect(usdBuToCadTonne(6.6, 'wheat', Number.NaN)).toBeNull()
  })
})

describe('sameUnitBasis', () => {
  it('needs no conversion for canola, which trades in our own units', () => {
    // Elevator 749.18 CAD/t against ICE November at 801.60 CAD/t.
    const b = sameUnitBasis(749.18, 801.6, '$/tonne')
    expect(b.basis).toBeCloseTo(-52.42, 4)
    // Negative: the local bid is under the board, which is normal.
    expect(b.basis).toBeLessThan(0)
  })
})

describe('crossUnitBasis', () => {
  it('subtracts like for like, not dollars-a-bushel from dollars-a-tonne', () => {
    const b = crossUnitBasis(274.87, 6.595, 'wheat', 1.4018)
    expect(b).not.toBeNull()
    expect(b!.unit).toBe('$/tonne')
    // The raw difference would be 274.87 - 6.595 = 268, a number that means
    // nothing at all. The real basis is far smaller.
    expect(Math.abs(b!.basis)).toBeLessThan(120)
  })

  it('gives null rather than a wrong basis when it cannot convert', () => {
    expect(crossUnitBasis(500, 20, 'dry beans', 1.4)).toBeNull()
  })
})

describe('cashEquivalent', () => {
  it('converts the CME feeder board into Alberta dollars', () => {
    // 351.65 USD/cwt at 1.4018 is about 493 CAD/cwt.
    expect(cashEquivalent(351.65, 1.4018)).toBeCloseTo(492.94, 1)
  })

  it('refuses an impossible rate', () => {
    expect(cashEquivalent(351.65, 0)).toBeNull()
  })
})

describe('basisVerdict', () => {
  const history = [-60, -55, -52, -48, -45, -40, -38, -35, -30, -25]

  it('calls a narrow basis narrow', () => {
    const v = basisVerdict(-25, history)
    expect(v!.percentile).toBe(100)
    expect(v!.note).toMatch(/paying up/)
  })

  it('calls a wide basis wide', () => {
    const v = basisVerdict(-60, history)
    expect(v!.percentile).toBeLessThanOrEqual(25)
    expect(v!.note).toMatch(/buying under/)
  })

  it('says nothing at all on too little history', () => {
    // Eight weeks is the floor. A verdict off three observations would be
    // authoritative-sounding noise.
    expect(basisVerdict(-40, [-50, -45, -40])).toBeNull()
  })
})

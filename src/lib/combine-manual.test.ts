import { describe, expect, it } from 'vitest'
import { CROP_BASELINES, SEED_DEFAULTS, SETTINGS, lossFromPan } from './combine'
import {
  HAND_EXAMPLE,
  NH_MANUAL,
  ROTOR_IN,
  inchFraction,
  manualFor,
  startingPoints,
} from './combine-manual'

describe('the manual table', () => {
  it('is the 22 in rotor column for our machines', () => {
    expect(ROTOR_IN).toBe(22)
  })

  it('has every crop the page offers that the book lists, and only once', () => {
    const mapped = NH_MANUAL.filter((r) => r.app).map((r) => r.app)
    expect(new Set(mapped).size).toBe(mapped.length)
    for (const c of CROP_BASELINES) {
      if (c.key === 'sainfoin') expect(manualFor(c.key)).toBeNull()
      else expect(manualFor(c.key)).not.toBeNull()
    }
  })

  it('keeps the baselines in step with the book', () => {
    // The starting-point column shows the manual's number and says so; the
    // baseline must carry the same number or the sanity range means nothing.
    for (const c of CROP_BASELINES) {
      const sp = startingPoints(c.key)
      for (const s of SETTINGS) {
        expect(sp[s.key].value).toBe(c.start[s.key])
        const [lo, hi] = c.range[s.key]
        expect(sp[s.key].value).toBeGreaterThanOrEqual(lo)
        expect(sp[s.key].value).toBeLessThanOrEqual(hi)
      }
    }
  })

  it('says which numbers are the book’s and which are ours', () => {
    const canola = startingPoints('canola')
    expect(canola.rotor_rpm).toEqual({ value: 630, source: 'manual' })
    expect(canola.vane_angle.source).toBe('estimate')
    expect(canola.ground_speed_mph.source).toBe('estimate')
    const sainfoin = startingPoints('sainfoin')
    expect(Object.values(sainfoin).every((p) => p.source === 'estimate')).toBe(true)
  })

  it('puts durum on the hard red wheat row, since the book has no durum', () => {
    expect(manualFor('durum')?.name).toBe('Wheat hard red')
    expect(manualFor('beans')?.name).toBe('Peas / Edible beans')
  })
})

describe('inchFraction', () => {
  it('turns the book’s millimetres into what the monitor shows', () => {
    // The book's 23 mm concave is a shade under 15/16; the Run 4 screen's
    // 15/16 in is 23.8 mm. Both are shown to the nearest sixteenth.
    expect(inchFraction(23)).toBe('7/8 in')
    expect(inchFraction(23.8)).toBe('15/16 in')
    expect(inchFraction(12.7)).toBe('1/2 in')
    expect(inchFraction(4.8)).toBe('3/16 in')
    expect(inchFraction(25.4)).toBe('1 in')
    expect(inchFraction(28.6)).toBe('1 1/8 in')
    expect(inchFraction(0)).toBe('0 in')
  })

  it('says nothing for nothing', () => {
    expect(inchFraction(null)).toBe('')
    expect(inchFraction(Number.NaN)).toBe('')
  })
})

describe('the manual’s hand example', () => {
  it('comes out at one per cent through the app’s own loss check', () => {
    // 17 ft header, 1 m swath, 5000 kg/ha wheat at 23 000 grains/kg: the
    // book says 18 grains under a spread hand is a 1 % loss. Same arithmetic
    // as the drop-pan calculator, so it had better agree.
    const gramsPer1000 = 1000 / (HAND_EXAMPLE.grainsPerKg / 1000)
    const kgPerAcre = HAND_EXAMPLE.yieldKgHa / 2.4711
    const yieldBu = (kgPerAcre * 2.20462) / SEED_DEFAULTS.wheat.lbPerBushel
    const r = lossFromPan({
      seeds: HAND_EXAMPLE.grainsUnderHand,
      panAreaSqFt: HAND_EXAMPLE.handSqFt,
      headerFt: HAND_EXAMPLE.headerFt,
      dischargeFt: HAND_EXAMPLE.swathFt,
      spec: { lbPerBushel: SEED_DEFAULTS.wheat.lbPerBushel, gramsPer1000 },
      yieldBuPerAcre: yieldBu,
    })
    expect(r.pctOfYield).toBeGreaterThan(0.9)
    expect(r.pctOfYield).toBeLessThan(1.1)
  })
})

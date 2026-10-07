import { describe, expect, it } from 'vitest'
import {
  CROP_BASELINES,
  SEED_DEFAULTS,
  SETTINGS,
  SYMPTOMS,
  judgeLoss,
  lossFromPan,
  lossValue,
  recomputeLossCheck,
  seedsPerBushel,
  type CombineCropKey,
} from './combine'

describe('seedsPerBushel', () => {
  it('matches the known figures for the crops we run', () => {
    // Wheat: 60 lb/bu at 35 g per thousand is a shade under a million seeds.
    expect(Math.round(seedsPerBushel(SEED_DEFAULTS.wheat) / 1000)).toBe(778)
    // Corn: 56 lb at 350 g per thousand — about 72,600 kernels, which is close
    // to the 80,000-seed bag figure and a good reality check on the arithmetic.
    expect(Math.round(seedsPerBushel(SEED_DEFAULTS.corn) / 100) * 100).toBe(72600)
    // Canola: millions, which is why loss shows up as seeds per square foot.
    expect(seedsPerBushel(SEED_DEFAULTS.canola)).toBeGreaterThan(6_000_000)
  })

  it('scales inversely with kernel weight', () => {
    const heavy = seedsPerBushel({ lbPerBushel: 60, gramsPer1000: 40 })
    const light = seedsPerBushel({ lbPerBushel: 60, gramsPer1000: 20 })
    expect(light).toBeCloseTo(heavy * 2, 0)
  })

  it('refuses to divide by a zero kernel weight', () => {
    expect(seedsPerBushel({ lbPerBushel: 60, gramsPer1000: 0 })).toBe(0)
  })
})

describe('lossFromPan', () => {
  const base = {
    panAreaSqFt: 1,
    headerFt: 40,
    dischargeFt: 20,
    spec: SEED_DEFAULTS.canola,
  }

  it('corrects for loss being concentrated in the discharge width', () => {
    // The whole point: a 40 ft header discharging over 20 ft doubles the
    // concentration under the machine, so a raw pan count overstates by 2×.
    const wide = lossFromPan({ ...base, seeds: 300 })
    const uncorrected = lossFromPan({ ...base, seeds: 300, dischargeFt: 40 })
    expect(wide.buPerAcre).toBeCloseTo(uncorrected.buPerAcre / 2, 6)
    expect(wide.seedsPerSqFt).toBe(300)
    expect(wide.fieldSeedsPerSqFt).toBe(150)
  })

  it('puts canola loss on a scale a person can use', () => {
    // 150 seeds per square foot of canola, field average, is about a bushel.
    const r = lossFromPan({ ...base, seeds: 300 })
    expect(r.buPerAcre).toBeGreaterThan(0.9)
    expect(r.buPerAcre).toBeLessThan(1.1)
  })

  it('reports loss as a share of the crop when yield is known', () => {
    const r = lossFromPan({ ...base, seeds: 300, yieldBuPerAcre: 50 })
    expect(r.pctOfYield).toBeCloseTo(2, 1)
  })

  it('leaves the share null rather than guessing at a yield', () => {
    expect(lossFromPan({ ...base, seeds: 300 }).pctOfYield).toBeNull()
    expect(lossFromPan({ ...base, seeds: 300, yieldBuPerAcre: 0 }).pctOfYield).toBeNull()
  })

  it('returns zeroes for the empty form rather than NaN', () => {
    // This is on a phone in a field; a blank pan area is a normal thing to have
    // on screen for a moment and must not render as NaN bu/ac.
    for (const bad of [
      { panAreaSqFt: 0 },
      { headerFt: 0 },
      { dischargeFt: 0 },
      { seeds: -1 },
      { spec: { lbPerBushel: 50, gramsPer1000: 0 } },
    ]) {
      const r = lossFromPan({ ...base, seeds: 100, ...bad })
      expect(Number.isFinite(r.buPerAcre)).toBe(true)
      expect(r.buPerAcre).toBe(0)
    }
  })

  it('scales linearly with what is in the pan', () => {
    const one = lossFromPan({ ...base, seeds: 100 })
    const two = lossFromPan({ ...base, seeds: 200 })
    expect(two.buPerAcre).toBeCloseTo(one.buPerAcre * 2, 9)
  })
})

describe('lossValue', () => {
  it('costs the loss out per acre and over the field', () => {
    const v = lossValue(1.5, 14, 160)
    expect(v.perAcre).toBeCloseTo(21)
    expect(v.total).toBeCloseTo(3360)
  })

  it('says nothing rather than zero when there is no price', () => {
    expect(lossValue(1.5, null, 160).perAcre).toBeNull()
    expect(lossValue(1.5, 0, 160).total).toBeNull()
  })

  it('gives a per-acre figure even with no field size', () => {
    const v = lossValue(1.5, 14, null)
    expect(v.perAcre).toBeCloseTo(21)
    expect(v.total).toBeNull()
  })
})

describe('judgeLoss', () => {
  it('does not call an already-low loss a problem', () => {
    // A combine set for zero loss is a combine going too slowly.
    expect(judgeLoss(0.8, 1)).toBe('good')
    expect(judgeLoss(1, 1)).toBe('good')
  })

  it('separates worth-watching from worth-stopping-for', () => {
    expect(judgeLoss(1.6, 1)).toBe('watch')
    expect(judgeLoss(2, 1)).toBe('watch')
    expect(judgeLoss(2.1, 1)).toBe('high')
  })

  it('withholds a verdict when the yield is unknown', () => {
    expect(judgeLoss(null, 1)).toBe('watch')
  })
})

describe('the reference content itself', () => {
  const CROPS: CombineCropKey[] = ['canola', 'corn', 'wheat', 'durum', 'beans', 'barley', 'oats', 'sainfoin']

  it('covers every crop these combines run', () => {
    expect(CROP_BASELINES.map((c) => c.key).sort()).toEqual([...CROPS].sort())
    for (const c of CROPS) expect(SEED_DEFAULTS[c]).toBeTruthy()
  })

  it('gives every crop a starting point inside its own range', () => {
    for (const crop of CROP_BASELINES) {
      for (const s of SETTINGS) {
        const [lo, hi] = crop.range[s.key]
        const start = crop.start[s.key]
        expect(lo).toBeLessThan(hi)
        expect(start).toBeGreaterThanOrEqual(lo)
        expect(start).toBeLessThanOrEqual(hi)
      }
    }
  })

  it('explains both directions of every setting', () => {
    for (const s of SETTINGS) {
      expect(s.does.length).toBeGreaterThan(20)
      expect(s.tooHigh.length).toBeGreaterThan(20)
      expect(s.tooLow.length).toBeGreaterThan(20)
    }
  })

  it('gives every symptom a way to confirm it and something to do', () => {
    for (const sym of SYMPTOMS) {
      expect(sym.confirm.length).toBeGreaterThan(20)
      expect(sym.fixes.length).toBeGreaterThan(0)
      for (const f of sym.fixes) expect(f.why.length).toBeGreaterThan(20)
    }
  })

  it('has the two opposite over-the-back faults, since the fixes conflict', () => {
    const keys = SYMPTOMS.map((s) => s.key)
    expect(keys).toContain('rotor_loss_free_grain')
    expect(keys).toContain('shoe_loss')
    const rotor = SYMPTOMS.find((s) => s.key === 'rotor_loss_free_grain')!
    const shoe = SYMPTOMS.find((s) => s.key === 'shoe_loss')!
    // Rotor loss wants MORE rotor speed; shoe loss wants LESS fan. Getting the
    // diagnosis wrong makes it worse, which is why both carry a confirm step.
    expect(rotor.fixes.some((f) => f.setting === 'rotor_rpm' && f.direction === 'up')).toBe(true)
    expect(shoe.fixes.some((f) => f.setting === 'fan_rpm' && f.direction === 'down')).toBe(true)
  })
})

describe('recomputeLossCheck', () => {
  const row = { crop_key: 'wheat', seeds: 20, pan_area_sqft: 1, header_ft: 40, discharge_ft: 20, grams_per_1000: 35, lb_per_bushel: 60, yield_bu_per_acre: 60 }
  it('matches what the form would have saved', () => {
    const r = lossFromPan({ seeds: 20, panAreaSqFt: 1, headerFt: 40, dischargeFt: 20, spec: { gramsPer1000: 35, lbPerBushel: 60 }, yieldBuPerAcre: 60 })
    expect(recomputeLossCheck(row)).toEqual({ loss_bu_per_acre: Number(r.buPerAcre.toFixed(4)), loss_pct: r.pctOfYield })
  })
  it('falls back to the crop defaults without a seed weight', () => {
    const r = recomputeLossCheck({ ...row, grams_per_1000: null, lb_per_bushel: null })
    const d = lossFromPan({ seeds: 20, panAreaSqFt: 1, headerFt: 40, dischargeFt: 20, spec: SEED_DEFAULTS.wheat, yieldBuPerAcre: 60 })
    expect(r.loss_bu_per_acre).toBe(Number(d.buPerAcre.toFixed(4)))
  })
  it('doubling the count doubles the loss', () => {
    expect(recomputeLossCheck({ ...row, seeds: 40 }).loss_bu_per_acre).toBeCloseTo(recomputeLossCheck(row).loss_bu_per_acre * 2, 3)
  })
})

describe('the farm drop pan', () => {
  it('is 10 × 39½ inches, 2.74 sq ft', async () => {
    const { DROP_PAN } = await import('./combine')
    expect(DROP_PAN.sqFt).toBe(2.74)
  })
})

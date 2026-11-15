import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DAYS_PER_ROTATION,
  fenceDemand,
  fencePlan,
  fenceTotals,
  type FenceMob,
  secondPass,
  type FencePaddockInput,
} from './virtual-fence'

const cows: FenceMob = { id: 'cows', name: 'Home Ranch Herd', head: 100, auPerHead: 1.4 }
const bulls: FenceMob = { id: 'bulls', name: 'Home Ranch Bulls', head: 10, auPerHead: 1.7 }

/** 1,000 grazeable acres at 300 lb/ac: 300,000 lb of grass. */
const flat: FencePaddockInput = {
  id: 'flat',
  name: 'Flat',
  grazeableAc: 1000,
  lbPerAc: 300,
  totalLb: 300_000,
  surfaces: [{ label: 'Native grass', acres: 1000, lb: 300_000 }],
}

/**
 * The fence arithmetic below is pinned to INTAKE (26 lb an animal-unit day) by
 * passing countWaste false, so the worked numbers in each comment stay the
 * numbers the test checks. What the ranch actually runs on is the default,
 * which also charges the trampled share — covered by its own test.
 */
describe('fenceDemand', () => {
  it('adds the animal units of every mob picked', () => {
    const d = fenceDemand([cows, bulls], false)
    expect(d.head).toBe(110)
    expect(d.au).toBeCloseTo(157, 6) // 100 × 1.4 + 10 × 1.7
    expect(d.lbPerDay).toBeCloseTo(157 * 26, 6)
  })

  it('charges the trampled share too by default, so a strip feeds fewer days', () => {
    const mobs = [cows, bulls]
    expect(fenceDemand(mobs).lbPerDay).toBeCloseTo((157 * 1000) / 30, 6)
    expect(fenceDemand(mobs).lbPerDay).toBeGreaterThan(fenceDemand(mobs, false).lbPerDay)
    // The mob is the same size either way; only its daily draw changes.
    expect(fenceDemand(mobs).au).toBeCloseTo(fenceDemand(mobs, false).au, 6)
  })

  it('makes an animal unit one AUM a month, whichever pounds are counted', () => {
    const one = [{ id: 'a', name: 'One', head: 1, auPerHead: 1 }]
    expect(fenceDemand(one).aumsPerMonth).toBeCloseTo(1, 6)
    expect(fenceDemand(one, false).aumsPerMonth).toBeCloseTo(1, 6)
  })

  it('is empty with no mobs, and ignores negative head', () => {
    expect(fenceDemand([])).toEqual({ head: 0, au: 0, lbPerDay: 0, aumsPerMonth: 0 })
    expect(fenceDemand([{ id: 'a', name: 'Bad', head: -5, auPerHead: 1.4 }]).au).toBe(0)
  })
})

describe('fencePlan', () => {
  it('sizes the fence from what the mob eats behind it', () => {
    // 140 AU × 26 lb = 3,640 lb a day; three days is 10,920 lb; at 300 lb/ac
    // that is 36.4 acres.
    const p = fencePlan(flat, fenceDemand([cows], false), 3)
    expect(p.acresPerRotation).toBeCloseTo(36.4, 6)
    expect(p.headPerAcre).toBeCloseTo(100 / 36.4, 6)
    expect(p.auPerAcre).toBeCloseTo(140 / 36.4, 6)
  })

  it('reports the whole rotations and the true total days, which do not multiply out', () => {
    const p = fencePlan(flat, fenceDemand([cows], false), 3)
    // 300,000 lb ÷ 3,640 lb a day = 82.4 days, so 27 whole three-day fences
    // and the 28th comes up short.
    expect(p.totalDays).toBeCloseTo(300_000 / 3_640, 6)
    expect(p.rotations).toBe(27)
    expect(p.rotations * 3).toBeLessThan(p.totalDays)
  })

  it('needs a longer fence for more days and a shorter one for fewer', () => {
    const demand = fenceDemand([cows], false)
    const one = fencePlan(flat, demand, 1)
    const six = fencePlan(flat, demand, 6)
    expect(six.acresPerRotation).toBeCloseTo(one.acresPerRotation * 6, 6)
    expect(six.rotations).toBe(13)
    // The grass does not change with the fence, only how it is cut up.
    expect(six.totalDays).toBeCloseTo(one.totalDays, 6)
  })

  it('a bigger mob eats the same paddock in fewer days behind bigger fences', () => {
    const small = fencePlan(flat, fenceDemand([cows], false), 3)
    const big = fencePlan(flat, fenceDemand([cows, bulls], false), 3)
    expect(big.acresPerRotation).toBeGreaterThan(small.acresPerRotation)
    expect(big.totalDays).toBeLessThan(small.totalDays)
  })

  it('splits a paddock that has a pivot in the fence: the strip over stubble is smaller', () => {
    const mixed: FencePaddockInput = {
      id: 'b',
      name: 'B',
      grazeableAc: 524,
      lbPerAc: 420,
      totalLb: 220_080,
      surfaces: [
        { label: 'Native grass', acres: 450, lb: 141_750 }, // 315 lb/ac
        { label: 'Crop fields', acres: 74, lb: 78_330 }, // ~1,059 lb/ac
      ],
    }
    const p = fencePlan(mixed, fenceDemand([cows], false), 3)
    const [grass, fields] = p.surfaces
    expect(grass.lbPerAc).toBeCloseTo(315, 6)
    expect(grass.acresPerRotation).toBeCloseTo(10_920 / 315, 6)
    expect(fields.acresPerRotation).toBeLessThan(grass.acresPerRotation)
    // Each surface's own days add up to the paddock's.
    expect(grass.days + fields.days).toBeCloseTo(p.totalDays, 6)
  })

  it('leaves out a surface with acres but no feed — a growing crop is not grazed', () => {
    const p = fencePlan(
      { ...flat, surfaces: [...flat.surfaces, { label: 'Crop fields', acres: 130, lb: 0 }] },
      fenceDemand([cows], false),
      3,
    )
    expect(p.surfaces).toHaveLength(1)
  })

  it('says zero rather than infinity with no mob picked', () => {
    const p = fencePlan(flat, fenceDemand([], false), 3)
    expect(p).toMatchObject({ acresPerRotation: 0, rotations: 0, totalDays: 0, headPerAcre: 0 })
  })

  it('says zero rotations for a paddock with no grass, and for nought days a fence', () => {
    expect(fencePlan({ ...flat, lbPerAc: 0, totalLb: 0 }, fenceDemand([cows], false), 3).rotations).toBe(0)
    expect(fencePlan(flat, fenceDemand([cows], false), 0).rotations).toBe(0)
  })

  it('holds no whole rotation when the mob needs more acres than the paddock has', () => {
    const tiny: FencePaddockInput = { ...flat, grazeableAc: 20, totalLb: 6_000 }
    const p = fencePlan(tiny, fenceDemand([cows], false), 3)
    expect(p.rotations).toBe(0)
    expect(p.totalDays).toBeCloseTo(6_000 / 3_640, 6)
    expect(p.acresPerRotation).toBeGreaterThan(tiny.grazeableAc)
  })

  it('starts at three days a fence', () => {
    expect(DEFAULT_DAYS_PER_ROTATION).toBe(3)
  })
})

describe('fenceTotals', () => {
  it('adds the paddocks and weights the pounds an acre by acres', () => {
    const demand = fenceDemand([cows], false)
    const plans = [
      fencePlan(flat, demand, 3),
      fencePlan({ ...flat, id: 'small', name: 'Small', grazeableAc: 100, lbPerAc: 1000, totalLb: 100_000 }, demand, 3),
    ]
    const t = fenceTotals(plans)
    expect(t.grazeableAc).toBe(1100)
    expect(t.totalLb).toBe(400_000)
    expect(t.lbPerAc).toBeCloseTo(400_000 / 1100, 6) // not the (300 + 1,000) / 2 of the rows
    expect(t.rotations).toBe(plans[0].rotations + plans[1].rotations)
    expect(t.totalDays).toBeCloseTo(400_000 / 3_640, 6)
  })

  it('is empty with no paddocks', () => {
    expect(fenceTotals([])).toEqual({ grazeableAc: 0, totalLb: 0, rotations: 0, totalDays: 0, lbPerAc: 0 })
  })
})

describe('secondPass', () => {
  // Intake-only, like the rest of the file, so the dates in the comments hold.
  const demand = fenceDemand([cows], false)
  const plan = fencePlan(flat, demand, 3)
  const base = { seasonPotentialLbPerAc: 375, takePct: 0.8, turnIn: '2026-05-20' }

  it('is worth real extra days when the pass runs through the growing season', () => {
    const sp = secondPass(plan, demand, 3, base)
    expect(sp.strips).toHaveLength(plan.rotations)
    expect(sp.restDays).toBe(plan.rotations * 3)
    expect(sp.backOn).toBe('2026-08-09') // 20 May + 27 fences × 3 days
    expect(sp.days).toBeGreaterThan(0)
    expect(sp.lb).toBeCloseTo(sp.days * demand.lbPerDay, 6)
    // Over the ground the pass covers — the whole fences — not the paddock,
    // which includes the part fence the pass never reaches.
    expect(sp.coveredAc).toBeCloseTo(plan.rotations * plan.acresPerRotation, 6)
    expect(sp.coveredAc).toBeLessThan(plan.grazeableAc)
    expect(sp.lbPerAc).toBeCloseTo(sp.lb / sp.coveredAc, 6)
  })

  it('gives the early strips more than the late ones, because the year runs out', () => {
    const sp = secondPass(plan, demand, 3, base)
    expect(sp.strips[0].lb).toBeGreaterThan(sp.strips[sp.strips.length - 1].lb * 5)
    // The last strip of this pass is grazed in August with a fortnight of the
    // curve still to run, so it is small but not nothing.
    expect(sp.strips[sp.strips.length - 1].lb).toBeGreaterThan(0)
  })

  it('is nothing at all on a pass that starts after the grass has quit', () => {
    const sp = secondPass(plan, demand, 3, { ...base, turnIn: '2026-09-01' })
    expect(sp.lb).toBe(0)
    expect(sp.days).toBe(0)
  })

  it('is bigger in a wet year than a dry one', () => {
    const dry = secondPass(plan, demand, 3, { ...base, rainFactorFor: () => 0.5 })
    const wet = secondPass(plan, demand, 3, { ...base, rainFactorFor: () => 1.5 })
    expect(wet.lb).toBeCloseTo(dry.lb * 3, 6)
  })

  it('grows back more when they are taken off lighter — but they harvest less of it', () => {
    const light = secondPass(plan, demand, 3, { ...base, takePct: 0.4 })
    const hard = secondPass(plan, demand, 3, { ...base, takePct: 0.95 })
    // What the model predicts: a light take leaves more grass behind.
    expect(light.grossLb).toBeGreaterThan(hard.grossLb)
    // And what it does NOT claim: taking it hard still feeds more cattle on
    // this one second pass, because 95 % of a smaller crop beats 40 % of a
    // bigger one. The price of a hard take is the grass left standing, and
    // next year, which nothing here models.
    expect(hard.lb).toBeGreaterThan(light.lb)
  })

  it('is empty rather than wrong for a paddock that holds no whole rotation', () => {
    const tiny = fencePlan({ ...flat, grazeableAc: 20, totalLb: 6_000 }, demand, 3)
    const sp = secondPass(tiny, demand, 3, base)
    expect(sp).toMatchObject({ lb: 0, days: 0, lbPerAc: 0, coveredAc: 0, strips: [] })
  })

  it('is empty with no mob and with no days a fence', () => {
    expect(secondPass(plan, fenceDemand([], false), 3, base).days).toBe(0)
    expect(secondPass(plan, demand, 0, base).strips).toHaveLength(0)
  })
})

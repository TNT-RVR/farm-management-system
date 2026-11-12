import { describe, expect, it } from 'vitest'
import {
  appetitePct,
  coldIntakeFactor,
  conditionPerDay,
  fatIntakeFactor,
  freeChoiceIntake,
  groupNeed,
  solveRation,
  strawToCutSurplus,
  type Conditions,
  type FeedValue,
  type GroupInput,
} from './cattle-nutrition'
import { groupInput, seasonPlan } from './winter-feeding'
import { checkFeeding } from './feed-check'
import { planFromYard, type YardFeed, type YardGroup } from './yard-rations'

/**
 * Free-choice bale feeding (Sam, 2 Nov 2026): cattle with bales in a feeder
 * eat to appetite, need or not; the energy over need goes on as condition.
 */

const day = (d: string, extra: Partial<Conditions> = {}): Conditions => ({
  onDate: new Date(d + 'T12:00:00'),
  calvingMonth: 4,
  calvingDay: 1,
  daysToTurnout: 90,
  cold: 0,
  muddy: false,
  ...extra,
})
const cow = (feeding: GroupInput['feeding'], w = 1350, bcs = 3, targetBcs = 3): GroupInput => ({ feedClass: 'cow', head: 100, weightLb: w, bcs, targetBcs, targetGainLb: null, feeding })
const feed = (id: string, category: FeedValue['category'], tdnPct: number, cpPct: number, extra: Partial<FeedValue> = {}): FeedValue => ({ id, name: id, category, dmPct: 88, tdnPct, cpPct, source: 'book', ...extra })
const straw = feed('straw', 'straw', 42, 4, { unit: 'round', lbPerBale: 1100 })
const greenfeed = feed('greenfeed', 'greenfeed', 58, 10, { unit: 'round', lbPerBale: 1400 })
const alfalfa = feed('alfalfa', 'hay', 60, 17, { unit: 'round', lbPerBale: 1400 })

describe('appetite by feed quality', () => {
  it('follows the extension table: straw 1.5–1.8%, average hay 2.0–2.2%, good legume or green feed 2.5–2.7%', () => {
    expect(appetitePct(42)).toBeGreaterThanOrEqual(1.5)
    expect(appetitePct(45)).toBeLessThanOrEqual(1.8)
    expect(appetitePct(53)).toBeGreaterThanOrEqual(2.0)
    expect(appetitePct(55)).toBeLessThanOrEqual(2.2)
    expect(appetitePct(64)).toBeGreaterThanOrEqual(2.5)
    expect(appetitePct(70)).toBeLessThanOrEqual(2.7)
  })
  it('never extrapolates past the table, and a nursing cow eats more', () => {
    expect(appetitePct(20)).toBe(appetitePct(40))
    expect(appetitePct(90)).toBe(appetitePct(70))
    expect(appetitePct(55, true)).toBeGreaterThan(appetitePct(55) + 0.3)
  })
})

describe('appetite and the weather', () => {
  it('rises modestly in the cold and drops in a blizzard', () => {
    expect(coldIntakeFactor(20)).toBe(1)
    expect(coldIntakeFactor(0)).toBeGreaterThan(1)
    expect(coldIntakeFactor(-20)).toBeGreaterThan(coldIntakeFactor(0))
    expect(coldIntakeFactor(-20)).toBeLessThanOrEqual(1.1)
    expect(coldIntakeFactor(-40)).toBeLessThan(1)
  })
  it('falls as cattle get fat', () => {
    expect(fatIntakeFactor(2.5)).toBe(1)
    expect(fatIntakeFactor(3)).toBe(1)
    expect(fatIntakeFactor(4)).toBeCloseTo(0.9, 6)
    expect(fatIntakeFactor(6)).toBeCloseTo(0.73, 6)
  })
  it('falls in mud and in late pregnancy', () => {
    const g = cow('free_choice')
    const midDec = day('2026-12-15')
    const n = groupNeed(g, midDec)
    const dry = freeChoiceIntake(g, n, 55, midDec)
    expect(dry / g.weightLb).toBeCloseTo(0.021, 3)
    expect(freeChoiceIntake(g, n, 55, { ...midDec, muddy: true })).toBeCloseTo(dry * 0.85, 6)
    const lateMar = day('2027-03-20')
    expect(freeChoiceIntake(g, groupNeed(g, lateMar), 55, lateMar)).toBeLessThan(dry * 0.92)
  })
})

describe('free choice in the ration', () => {
  it('eats to appetite on good feed and shows the surplus as condition', () => {
    const lines = [{ feed: alfalfa, sharePct: 100, wastePct: 10 }]
    const m = solveRation(cow('measured'), day('2026-12-15'), lines)
    const f = solveRation(cow('free_choice'), day('2026-12-15'), lines)
    // Measured eats the need; free choice eats about 2.35% of 1,350 lb.
    expect(m.energyMetPct).toBeCloseTo(100, 0)
    expect(f.dmLb).toBeCloseTo(1350 * 0.0235, 0)
    expect(f.dmLb).toBeGreaterThan(m.dmLb * 1.4)
    expect(f.surplusTdnLb).toBeGreaterThan(3)
    expect(f.bcsPerDay!).toBeGreaterThan(0)
    expect(m.surplusTdnLb).toBeCloseTo(0, 6)
    expect(f.feeding).toBe('free_choice')
  })

  it('prices a condition score by body composition, and gives less back losing it', () => {
    // One score is 14% of body weight at 4.1 lb TDN a pound gained, 2.5 lost.
    const n = groupNeed(cow('free_choice'), day('2026-12-15'))
    expect(conditionPerDay(n, 1350 * 0.14 * 4.1) - conditionPerDay(n, 0)).toBeCloseTo(1, 6)
    expect(conditionPerDay(n, -1350 * 0.14 * 2.5 + n.parts.fatCredit * n.base.tdn * -1)).toBeCloseTo(-1, 6)
    // And a cow being fed to put condition on is credited the planned gain:
    // half a score by calving (the need spreads it over the days to calving).
    const thin = groupNeed(cow('measured', 1350, 2.5, 3), day('2026-12-15'))
    const solved = solveRation(cow('measured', 1350, 2.5, 3), day('2026-12-15'), [{ feed: greenfeed, sharePct: 100, wastePct: 10 }])
    expect(conditionPerDay(thin, solved.surplusTdnLb) * thin.daysToCalving!).toBeCloseTo(0.5, 2)
  })

  it('keeps the shortfall warnings when appetite cannot meet the need', () => {
    // Straw only, close to calving: appetite on 42% feed is far short of energy.
    const r = solveRation(cow('free_choice'), day('2027-03-10', { cold: 0.3 }), [{ feed: straw, sharePct: 100, wastePct: 10 }])
    expect(r.warnings.some((w) => w.code === 'W5' || w.code === 'W6')).toBe(true)
    expect(r.surplusTdnLb).toBeLessThanOrEqual(0.01)
  })

  it('works out the straw that takes a surplus off, inside the straw limits', () => {
    const lines = [{ feed: greenfeed, sharePct: 50, wastePct: 10 }, { feed: alfalfa, sharePct: 50, wastePct: 10 }]
    const g = cow('free_choice')
    const c = day('2026-12-15')
    const cut = strawToCutSurplus(g, c, lines, straw, 12)!
    expect(cut).not.toBeNull()
    expect(cut.sharePct).toBeGreaterThan(0)
    expect(cut.sharePct).toBeLessThanOrEqual(60)
    const strawLine = cut.ration.lines.find((l) => l.feed.id === 'straw')!
    expect(strawLine.dmLb).toBeLessThanOrEqual(0.0125 * 1350 + 1e-6)
    if (cut.cutsAll) expect(cut.ration.surplusTdnLb).toBeLessThan(0.1)
    else expect(cut.ration.surplusTdnLb).toBeLessThan(solveRation(g, c, lines).surplusTdnLb)
    // Measured groups have no surplus to cut.
    expect(strawToCutSurplus(cow('measured'), c, lines, straw, 12)).toBeNull()
  })
})

describe('free choice through the season plan', () => {
  const settings = { calvingMonth: 4, calvingDay: 1, coat: 'winter' as const, sheltered: false, muddy: false, reservePct: 15 }
  const lines = [{ feed: greenfeed, sharePct: 70, wastePct: 12 }, { feed: alfalfa, sharePct: 30, wastePct: 12 }]
  const run = (feeding: GroupInput['feeding']) =>
    seasonPlan({
      groups: [{ id: 'cows', name: 'Cows', group: cow(feeding), lines }],
      settings,
      from: new Date(2026, 11, 15),
      to: new Date(2027, 2, 15),
      coldByMonth: new Map([[12, 0.15], [1, 0.2], [2, 0.15], [3, 0.05]]),
      intakeByMonth: new Map([[12, 1.05], [1, 1.07], [2, 1.05], [3, 1.03]]),
      stubble: [],
      onHand: new Map([['greenfeed', 600_000], ['alfalfa', 300_000]]),
    })

  it('feeds appetite to free-choice groups and the need to measured ones', () => {
    const m = run('measured')
    const f = run('free_choice')
    const total = (s: typeof m) => [...s.needLb.values()].reduce((a, b) => a + b, 0)
    expect(total(f)).toBeGreaterThan(total(m) * 1.15)
    // The same feed lasts fewer days eaten to appetite.
    expect(f.bindingDays!).toBeLessThan(m.bindingDays!)
    const fg = f.groups.get('cows')!
    const mg = m.groups.get('cows')!
    expect(fg.feeding).toBe('free_choice')
    expect(fg.bcsChange!).toBeGreaterThan(0.25)
    expect(fg.energyPct).toBeGreaterThan(110)
    // Condition stays on the 1–5 scale, and fattening slows their appetite.
    expect(3 + fg.bcsChange!).toBeLessThanOrEqual(5)
    // What limiting them to need would save is the measured plan's own feed.
    expect(fg.measuredLb).toBeCloseTo(mg.offeredLb, -2)
    expect(fg.offeredLb).toBeCloseTo(total(f) + f.extraGrainLb, -2)
    expect(mg.bcsChange!).toBeCloseTo(0, 2)
    expect(mg.energyPct).toBeCloseTo(100, 0)
    expect(mg.offeredLb).toBe(mg.measuredLb)
  })

  it('reads a herd row’s feeding method, free choice by default', () => {
    const row = { feed_class: 'cow' as const, class_name: 'Cows', head_count: 100, background_head: null, avg_weight_lb: 1350, bcs: 3, target_bcs: 3, target_gain_lb: null }
    expect(groupInput(row).feeding).toBe('free_choice')
    expect(groupInput({ ...row, feeding_method: 'measured' }).feeding).toBe('measured')
  })
})

describe('the feed-sheet check for a free-choice group', () => {
  // Home Ranch as Sam describes it: about 300 head, 2 straw and 10 bales
  // of green feed, alfalfa and sainfoin a day. The bale weights here are
  // stand-ins — the test is of the logic, not his numbers.
  const cond = day('2026-12-15', { cold: 0.1, effTempC: -5 })
  const hay = feed('mixed', 'greenfeed', 58, 12)
  const lines = [
    { feed: straw, lbAsFed: 2 * 1000, wastePct: 12 },
    { feed: hay, lbAsFed: 10 * 1100, wastePct: 12 },
  ]
  it('reads a day of 150–200% of need as about what they eat, not overfed', () => {
    const f = checkFeeding({ group: cow('free_choice'), head: 300, days: 1, lines, cond })!
    expect(f.ratio).toBeGreaterThan(1.4)
    expect(f.ratio).toBeLessThan(2.1)
    expect(f.appetiteRatio!).toBeGreaterThan(0.85)
    expect(f.appetiteRatio!).toBeLessThan(1.2)
    expect(f.warnings[0].code).toBe('W1')
    expect(f.warnings[0].level).toBe('ok')
    expect(f.warnings.some((w) => w.code === 'W4')).toBe(false)
  })
  it('still calls the same day overfed for a measured group', () => {
    const m = checkFeeding({ group: cow('measured'), head: 300, days: 1, lines, cond })!
    expect(m.warnings[0].code).toBe('W4')
    expect(m.appetiteRatio).toBeNull()
  })
  it('flags far more out than appetite, and still warns when under need', () => {
    const big = checkFeeding({ group: cow('free_choice'), head: 300, days: 1, lines: lines.map((l) => ({ ...l, lbAsFed: l.lbAsFed * 1.6 })), cond })!
    expect(big.warnings[0].code).toBe('W4F')
    const thin = checkFeeding({ group: cow('free_choice'), head: 300, days: 1, lines: lines.map((l) => ({ ...l, lbAsFed: l.lbAsFed * 0.3 })), cond })!
    expect(thin.warnings[0].code).toBe('W3')
  })
})

describe('the yard plan with a free-choice group', () => {
  const yf = (id: string, category: YardFeed['category'], tdn: number, cp: number, lb: number): YardFeed => ({ id, name: id, category, dmPct: 88, tdnPct: tdn, cpPct: cp, source: 'book', usableAsFedLb: lb })
  const yg = (feeding: GroupInput['feeding']): YardGroup => ({ id: 'cows', name: 'cows', group: cow(feeding, 1400), wasteFor: () => 10 })
  const args = {
    from: new Date(2026, 11, 15),
    to: new Date(2027, 2, 15),
    coldByMonth: new Map([[12, 0.2], [1, 0.2], [2, 0.2], [3, 0.1]]),
    intakeByMonth: new Map([[12, 1.05], [1, 1.07], [2, 1.05], [3, 1.03]]),
    calvingMonth: 4,
    calvingDay: 1,
    muddy: false,
    reservePct: 15,
    feeds: [yf('straw', 'straw', 42, 4, 2_000_000), yf('greenfeed', 'greenfeed', 58, 10, 3_000_000), yf('alfalfa', 'hay', 60, 18, 2_000_000)],
  }
  it('fills their appetite: more feed and energy over need when there is no straw to fill it with', () => {
    const noStraw = { ...args, feeds: args.feeds.filter((f) => f.id !== 'straw') }
    const m = planFromYard({ ...noStraw, groups: [yg('measured')] })!
    const f = planFromYard({ ...noStraw, groups: [yg('free_choice')] })!
    const used = (p: typeof m) => p.use.reduce((s, u) => s + u.usedLb, 0)
    expect(used(f)).toBeGreaterThan(used(m) * 1.2)
    expect(f.groups[0].energyPct).toBeGreaterThan(110)
    expect(m.groups[0].energyPct).toBeCloseTo(100, 0)
  })
  it('fills appetite with straw first, keeping energy near need — the straw swap', () => {
    const f = planFromYard({ ...args, groups: [yg('free_choice')] })!
    const share = (id: string) => f.groups[0].shares.find((s) => s.feed.id === id)?.pct ?? 0
    expect(share('straw')).toBeGreaterThan(40)
    expect(share('alfalfa')).toBeLessThan(5)
    expect(f.groups[0].energyPct).toBeLessThan(105)
  })
  it('drops the appetite floor rather than fail when the yard cannot fill it', () => {
    const small = { ...args, feeds: [yf('greenfeed', 'greenfeed', 58, 10, 900_000)] }
    const f = planFromYard({ ...small, groups: [yg('free_choice')] })
    expect(f).not.toBeNull()
    for (const u of f!.use) expect(u.usedLb).toBeLessThanOrEqual(u.haveLb + 1)
  })
})

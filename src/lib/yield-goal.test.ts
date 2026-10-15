import { describe, expect, it } from 'vitest'
import type { YieldRecord } from './forecast'
import type { YieldCut } from './yield-estimate'
import {
  actualYield,
  fertYieldGoal,
  historyEstimate,
  resolveGoal,
  scorePlanRows,
  scoreText,
  scoreYield,
  versus,
  versusText,
  versusTone,
  yieldEstimate,
} from './yield-goal'

// Made-up numbers throughout.
const rec = (o: Partial<YieldRecord>): YieldRecord => ({
  field_id: 'f1',
  crop_id: 'wheat',
  crop_year: 2030,
  acres: 100,
  yield_per_acre: 50,
  clean_yield_per_acre: null,
  yield_unit: 'bu',
  source: 'scale',
  ...o,
})

const crop = { id: 'wheat', yield_unit: 'bu', default_yield_per_acre: 40, yield_low_per_acre: null, yield_high_per_acre: null, goal_yield_per_acre: null as number | null }

describe('resolveGoal', () => {
  it('takes the field’s goal, then the crop’s default, else none', () => {
    expect(resolveGoal({ goal_yield: 70 }, { goal_yield_per_acre: 60 })).toEqual({ value: 70, source: 'field' })
    expect(resolveGoal({ goal_yield: null }, { goal_yield_per_acre: 60 })).toEqual({ value: 60, source: 'crop' })
    expect(resolveGoal(null, { goal_yield_per_acre: '0' })).toEqual({ value: null, source: null })
    expect(resolveGoal(undefined, undefined)).toEqual({ value: null, source: null })
  })
})

describe('fertYieldGoal', () => {
  it('puts the goal first, then the old chain', () => {
    expect(fertYieldGoal({ goal_yield: 80, yield_per_acre_override: 55 }, { default_yield_per_acre: 45 }, 90)).toBe(80)
    expect(fertYieldGoal({ yield_per_acre_override: 55 }, { goal_yield_per_acre: 75, default_yield_per_acre: 45 })).toBe(75)
    expect(fertYieldGoal({ yield_per_acre_override: 55 }, { default_yield_per_acre: 45 })).toBe(55)
    expect(fertYieldGoal(null, { default_yield_per_acre: 45 })).toBe(45)
    expect(fertYieldGoal(null, null, 90)).toBe(90)
    expect(fertYieldGoal(null, null)).toBeNull()
  })
})

describe('historyEstimate', () => {
  it('counts only seasons before the year, so a harvest never grades itself', () => {
    const history = [
      rec({ field_id: 'f2', crop_year: 2028, yield_per_acre: 40 }),
      rec({ field_id: 'f3', crop_year: 2029, yield_per_acre: 60 }),
      rec({ field_id: 'f1', crop_year: 2030, yield_per_acre: 200 }),
    ]
    const e = historyEstimate({ cropId: 'wheat', fieldId: 'f1', year: 2030, unit: 'bu', normal: 40, history })
    expect(e.basis).toBe('farm')
    expect(e.value).toBe(50)
    expect(e.seasons).toBe(2)
    expect(e.label).toContain('2028–2029')
  })

  it('uses the field’s own average once it has five seasons', () => {
    const own = [2025, 2026, 2027, 2028, 2029].map((y, i) => rec({ crop_year: y, yield_per_acre: 50 + i * 2 }))
    const others = [rec({ field_id: 'f9', crop_year: 2029, yield_per_acre: 20 })]
    const e = historyEstimate({ cropId: 'wheat', fieldId: 'f1', year: 2030, unit: 'bu', normal: 40, history: [...own, ...others] })
    expect(e.basis).toBe('field')
    expect(e.value).toBe(54)
    expect(e.label).toContain('5-season')
  })

  it('falls back to the crop’s normal yield with too little history', () => {
    const e = historyEstimate({ cropId: 'wheat', fieldId: 'f1', year: 2030, unit: 'bu', normal: 40, history: [rec({ crop_year: 2029 })] })
    expect(e.basis).toBe('goal')
    expect(e.value).toBe(40)
  })
})

describe('yieldEstimate', () => {
  const history = { value: 50, basis: 'farm' as const, seasons: 2, label: 'farm average' }
  const cut: YieldCut = { id: 'c', field_id: 'f1', crop_year: 2030, crop_id: null, zone_id: null, loss_pct: 20, reason: 'hail' }

  it('a typed figure overrides history', () => {
    const e = yieldEstimate({ typed: 60, history })
    expect(e.value).toBe(60)
    expect(e.typed).toBe(true)
    expect(e.note).toBe('typed on the plan')
    expect(e.history.value).toBe(50)
  })
  it('a plan range with nothing typed expects its midpoint', () => {
    const e = yieldEstimate({ typed: null, plan: { low: 40, high: 80 }, history })
    expect(e.value).toBe(60)
    expect(e.low).toBe(40)
    expect(e.high).toBe(80)
  })
  it('the cut comes off on top', () => {
    const e = yieldEstimate({ typed: null, history, cut })
    expect(e.before).toBe(50)
    expect(e.value).toBe(40)
    expect(e.note).toContain('cut 20% (hail)')
  })
})

describe('actualYield', () => {
  it('acre-weights, prefers clean, and keeps a hailed-out yield', () => {
    const rows = [
      rec({ acres: 100, yield_per_acre: 60, clean_yield_per_acre: 55 }),
      rec({ acres: 300, yield_per_acre: 5 }),
      rec({ crop_year: 2029, yield_per_acre: 99 }),
      rec({ source: 'fah_import', yield_per_acre: 99 }),
      rec({ yield_unit: 'lbs', yield_per_acre: 3000 }),
    ]
    const a = actualYield(rows, { fieldId: 'f1', cropId: 'wheat', year: 2030, unit: 'bu' })
    expect(a?.value).toBeCloseTo((100 * 55 + 300 * 5) / 400)
    expect(a?.clean).toBe(false)
  })
  it('is null with no harvest', () => {
    expect(actualYield([rec({ crop_year: 2029 })], { fieldId: 'f1', cropId: 'wheat', year: 2030, unit: 'bu' })).toBeNull()
  })
})

describe('versus', () => {
  it('above, below and on, per acre and in %', () => {
    expect(versus(62, 55)).toEqual({ diff: 7, pct: (7 / 55) * 100, dir: 'above' })
    const b = versus(62, 65)!
    expect(b.dir).toBe('below')
    expect(b.diff).toBe(-3)
    expect(versus(50.02, 50)?.dir).toBe('on')
  })
  it('needs both figures and a reference above zero', () => {
    expect(versus(null, 50)).toBeNull()
    expect(versus(50, null)).toBeNull()
    expect(versus(50, 0)).toBeNull()
  })
  it('reads as words', () => {
    expect(versusText(versus(62, 55)!, 'estimate')).toBe('7 above estimate (+13%)')
    expect(versusText(versus(62, 65)!, 'goal')).toBe('3 below goal (−5%)')
    expect(versusText(versus(50, 50)!, 'goal')).toBe('on goal')
  })
  it('tones: green above, amber below, red well below', () => {
    expect(versusTone(versus(62, 55))).toBe('above')
    expect(versusTone(versus(62, 65))).toBe('below')
    expect(versusTone(versus(40, 50))).toBe('well-below')
    expect(versusTone(null)).toBeNull()
  })
})

describe('scoreYield', () => {
  const history = [rec({ field_id: 'f2', crop_year: 2028, yield_per_acre: 50 }), rec({ field_id: 'f3', crop_year: 2029, yield_per_acre: 60 })]

  it('grades a harvest against the history estimate and the goal', () => {
    const s = scoreYield({
      fieldId: 'f1',
      year: 2030,
      crop,
      plan: { goal_yield: 65, yield_per_acre_override: 62, yield_basis: 'clean' },
      history: [...history, rec({ crop_year: 2030, yield_per_acre: 64, clean_yield_per_acre: 62 })],
    })
    expect(s.estimate.value).toBe(55)
    expect(s.actual).toEqual({ value: 62, clean: true })
    expect(scoreText(s, 'bu')).toBe('62 bu/ac — 7 above estimate (+13%), 3 below goal (−5%)')
  })

  it('grades against the figure typed before the scale replaced it', () => {
    const s = scoreYield({
      fieldId: 'f1',
      year: 2030,
      crop,
      plan: { yield_per_acre_override: 62, yield_basis: 'pre_clean' },
      typedBeforeHarvest: 70,
      history: [...history, rec({ crop_year: 2030, yield_per_acre: 62 })],
    })
    expect(s.estimate.value).toBe(70)
    expect(s.estimate.note).toBe('typed on the plan')
    expect(s.vsEstimate?.dir).toBe('below')
    expect(s.vsGoal).toBeNull()
    expect(scoreText(s, 'bu')).toBe('62 bu/ac (pre-clean) — 8 below estimate (−11%)')
  })

  it('before harvest: a typed override is the estimate, no actual', () => {
    const s = scoreYield({ fieldId: 'f1', year: 2030, crop: { ...crop, goal_yield_per_acre: 70 }, plan: { yield_per_acre_override: 58, yield_basis: null }, history })
    expect(s.estimate.value).toBe(58)
    expect(s.goal).toEqual({ value: 70, source: 'crop' })
    expect(s.actual).toBeNull()
    expect(scoreText(s, 'bu')).toBe('')
  })

  it('compares against the estimate after a cut', () => {
    const cut: YieldCut = { id: 'c', field_id: 'f1', crop_year: 2030, crop_id: 'wheat', zone_id: null, loss_pct: 50, reason: 'hail' }
    const s = scoreYield({ fieldId: 'f1', year: 2030, crop, plan: { yield_basis: 'clean', yield_per_acre_override: 30 }, cut, history: [...history, rec({ crop_year: 2030, clean_yield_per_acre: 30 })] })
    expect(s.estimate.value).toBe(27.5)
    expect(s.vsEstimate?.dir).toBe('above')
  })

  it('takes the plan’s scale figure when the history row is not in yet', () => {
    const s = scoreYield({ fieldId: 'f1', year: 2030, crop, plan: { yield_basis: 'clean', yield_per_acre_override: 48 }, history })
    expect(s.actual).toEqual({ value: 48, clean: true })
  })
})

describe('scorePlanRows', () => {
  const plan = { crop_id: 'wheat', goal_yield: 66, yield_per_acre_override: null, yield_basis: null, yield_low: null, yield_high: null }
  it('scores planted rows, gives a crop area the plan’s goal for the plan’s crop, and skips land rented out', () => {
    const rows = [
      { field: { id: 'f1' }, plan, crop, cut: null },
      { field: { id: 'f2' }, plan: null, crop: { ...crop, goal_yield_per_acre: 61 }, cut: null, isZone: true },
      { field: { id: 'f1' }, plan: null, crop, cut: null, isZone: true },
      { field: { id: 'f3' }, plan: { ...plan, crop_id: 'rent' }, crop: { ...crop, id: 'rent', land_rent_only: true }, cut: null },
      { field: { id: 'f4' }, plan: null, crop: null, cut: null },
    ]
    const out = scorePlanRows(rows, { cropYear: 2030, history: [], planByField: new Map([['f1', plan]]), typedBefore: new Map() })
    expect(out[0].score?.goal.value).toBe(66)
    expect(out[1].score?.goal).toEqual({ value: 61, source: 'crop' })
    expect(out[2].score?.goal.value).toBe(66)
    expect(out[3].score).toBeNull()
    expect(out[4].score).toBeNull()
  })
})

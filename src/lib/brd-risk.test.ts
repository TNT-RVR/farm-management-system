import { describe, expect, it } from 'vitest'
import { arrivalRisk, BRD_WINDOW_DAYS, isCalfClass, type ArrivalInput } from './brd-risk'

const load = (o: Partial<ArrivalInput> = {}): ArrivalInput => ({
  movedOn: '2026-10-20',
  sourceKind: null,
  commingled: null,
  transportKm: null,
  restStopH: null,
  head: 100,
  avgWeightLb: null,
  classes: [],
  weather: null,
  ...o,
})

const now = new Date('2026-10-25T12:00:00Z')

describe('the 14-day window', () => {
  it('is the window the Canadian work measures the rise over', () => {
    expect(BRD_WINDOW_DAYS).toBe(14)
  })

  it('counts the days on feed and says the window is open', () => {
    const r = arrivalRisk(load(), now)
    expect(r.daysOn).toBe(5)
    expect(r.windowOpen).toBe(true)
    expect(r.headline).toMatch(/Day 5 of the 14-day window/)
  })

  it('closes after fourteen days', () => {
    const r = arrivalRisk(load({ movedOn: '2026-09-20' }), now)
    expect(r.windowOpen).toBe(false)
    expect(r.headline).toMatch(/past the 14-day window/)
  })

  it('handles a load that has not landed yet', () => {
    const r = arrivalRisk(load({ movedOn: '2026-11-20' }), now)
    expect(r.windowOpen).toBe(false)
    expect(r.headline).toMatch(/Not arrived yet/)
  })

  it('handles a manifest with no date', () => {
    const r = arrivalRisk(load({ movedOn: null }), now)
    expect(r.daysOn).toBeNull()
    expect(r.headline).toMatch(/No arrival date/)
  })
})

describe('source, in the categories the Alberta study used', () => {
  const source = (a: ArrivalInput) => arrivalRisk(a, now).factors.find((f) => f.key === 'source')!

  it('raises a backgrounding source, which is the study’s own finding', () => {
    const f = source(load({ sourceKind: 'backgrounding' }))
    expect(f.state).toBe('raises')
    expect(f.says).toMatch(/higher odds/)
  })

  it('raises an auction source and refuses to quote a rest-stop effect', () => {
    const f = source(load({ sourceKind: 'auction' }))
    expect(f.state).toBe('raises')
    expect(f.says).toMatch(/no effect size is quoted/)
  })

  it('leaves a ranch-direct or own-ranch load neutral', () => {
    expect(source(load({ sourceKind: 'ranch_direct' })).state).toBe('neutral')
    expect(source(load({ sourceKind: 'own_ranch' })).state).toBe('neutral')
  })

  it('says it does not know rather than assuming', () => {
    expect(source(load()).state).toBe('unknown')
  })
})

describe('the facts the papers published no threshold for', () => {
  const factor = (a: ArrivalInput, key: string) => arrivalRisk(a, now).factors.find((f) => f.key === key)!

  it('reports transport distance without grading it', () => {
    const f = factor(load({ transportKm: 900 }), 'transport')
    expect(f.value).toBe('900 km')
    expect(f.state).toBe('neutral')
    expect(f.says).toMatch(/not graded/)
  })

  it('reports weight without grading it', () => {
    const f = factor(load({ avgWeightLb: 520 }), 'weight')
    expect(f.value).toBe('520 lb')
    expect(f.state).toBe('neutral')
  })

  it('reports the three weather variables the study recorded', () => {
    const f = factor(load({ weather: { tmaxC: 6, tminC: -3, precipMm: 2.4, windMs: 8 } }), 'weather')
    expect(f.value).toContain('-3 to 6 °C')
    expect(f.value).toContain('2.4 mm')
    expect(f.value).toContain('wind 29 km/h')
    expect(f.state).toBe('neutral')
  })

  it('says there is no station reading rather than guessing the weather', () => {
    expect(factor(load(), 'weather').state).toBe('unknown')
  })
})

describe('age class', () => {
  it('knows a calf line from a yearling line', () => {
    expect(isCalfClass('Steer calves')).toBe(true)
    expect(isCalfClass('Weaned calves')).toBe(true)
    expect(isCalfClass('Yearling steers')).toBe(false)
  })

  it('raises a load of calves, with the 2026 prevalences behind it', () => {
    const f = arrivalRisk(load({ classes: ['Steer calves'] }), now).factors.find((x) => x.key === 'age')!
    expect(f.state).toBe('raises')
    expect(f.says).toMatch(/17 to 51 per cent/)
  })

  it('leaves yearlings neutral and says what they arrive carrying', () => {
    const f = arrivalRisk(load({ classes: ['Yearling heifers'] }), now).factors.find((x) => x.key === 'age')!
    expect(f.state).toBe('neutral')
    expect(f.says).toMatch(/arrived carrying more/)
  })
})

describe('what the note refuses to do', () => {
  it('counts factors and never adds them into a score', () => {
    const r = arrivalRisk(
      load({ sourceKind: 'backgrounding', commingled: true, classes: ['Steer calves'], transportKm: 400, avgWeightLb: 550 }),
      now,
    )
    expect(r.raised).toBe(3)
    expect(r.recorded).toBe(5)
    expect(Object.keys(r)).not.toContain('score')
  })

  it('does not let an ungraded fact raise the count', () => {
    const r = arrivalRisk(load({ transportKm: 2000, avgWeightLb: 400 }), now)
    expect(r.raised).toBe(0)
  })

  it('counts a rest stop as a recorded fact without claiming an effect', () => {
    const r = arrivalRisk(load({ restStopH: 8 }), now)
    const f = r.factors.find((x) => x.key === 'rest')!
    expect(f.value).toBe('8 h')
    expect(f.says).toMatch(/no effect is claimed/)
  })

  it('leaves the rest-stop row off entirely when nothing was recorded', () => {
    expect(arrivalRisk(load(), now).factors.some((f) => f.key === 'rest')).toBe(false)
  })
})

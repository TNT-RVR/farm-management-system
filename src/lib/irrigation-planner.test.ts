import { describe, expect, it } from 'vitest'
import {
  arcFraction,
  edmontonWallMs,
  efficiencyOf,
  findCrossing,
  fmtWallTime,
  lapPlan,
  pickSeries,
  planField,
  plannerSummary,
  pumpClashes,
  rainWindow,
  recentEtc,
  sortPlans,
  thresholdOf,
  wallOfDate,
  watchDay,
  type FieldPlan,
  type PlanBalance,
  type PlanPivot,
} from './irrigation-planner'

const H = 3_600_000
const D = 24 * H

/** TAW 150, RAW 60 → trigger at 90 mm available. */
const row = (date: string, avail: number, o: Partial<PlanBalance> = {}): PlanBalance => ({
  field_id: 'F',
  zone_id: null,
  date,
  is_forecast: false,
  avail_100_mm: avail,
  taw_mm: 150,
  raw_mm: 60,
  etc_mm: 5,
  status: 'ok',
  ...o,
})
const fc = (date: string, avail: number, o: Partial<PlanBalance> = {}) => row(date, avail, { is_forecast: true, ...o })

const NOW = wallOfDate('2026-07-10') + 8 * H // 8 am on Jul 10

const PIVOT: PlanPivot = {
  run100S: 12 * 3600, // 12 h a lap at 100%
  depth100In: 0.2, // 5.08 mm at 100%
  arcStartDeg: null,
  arcEndDeg: null,
  depthCorrection: 1,
  timeToFullCircleH: null,
  efficiency: 0.85,
}

describe('wall clock', () => {
  it('reads Edmonton time whatever zone runs the test', () => {
    // 2026-07-10 18:30 UTC = 12:30 MDT
    expect(edmontonWallMs(new Date('2026-07-10T18:30:00Z'))).toBe(wallOfDate('2026-07-10') + 12.5 * H)
    // after 6 pm local the UTC date is already tomorrow's
    expect(edmontonWallMs(new Date('2026-07-11T02:00:00Z'))).toBe(wallOfDate('2026-07-10') + 20 * H)
  })
  it('formats a start-by rounded down to the hour', () => {
    expect(fmtWallTime(wallOfDate('2026-07-10') + 14.9 * H)).toMatch(/2\s*p\.?m\.?/i)
  })
})

describe('thresholdOf / recentEtc', () => {
  it('is TAW − RAW', () => {
    expect(thresholdOf({ taw_mm: 150, raw_mm: 60 })).toBe(90)
    expect(thresholdOf({ taw_mm: null, raw_mm: 60 })).toBeNull()
  })
  it('averages the last seven actual days, skipping blanks', () => {
    const rows = [
      row('2026-07-01', 100, { etc_mm: 100 }),
      ...[2, 3, 4, 5, 6, 7, 8].map((d) => row(`2026-07-0${d}`, 100, { etc_mm: d === 5 ? null : 4 })),
    ]
    expect(recentEtc(rows)).toBe(4)
    expect(recentEtc([])).toBeNull()
  })
})

describe('pickSeries', () => {
  it('uses whole-field rows and drops stale forecast rows', () => {
    const s = pickSeries([row('2026-07-09', 120), fc('2026-07-09', 118), fc('2026-07-10', 110)])!
    expect(s.zoneId).toBeNull()
    expect(s.actual).toHaveLength(1)
    expect(s.forecast.map((r) => r.date)).toEqual(['2026-07-10'])
  })
  it('on a zoned field picks the zone nearest its trigger', () => {
    const s = pickSeries([row('2026-07-09', 130, { zone_id: 'wet' }), row('2026-07-09', 95, { zone_id: 'dry' })])!
    expect(s.zoneId).toBe('dry')
    expect(s.zoneCount).toBe(2)
  })
  it('prefers whole-field rows over zones', () => {
    expect(pickSeries([row('2026-07-09', 130), row('2026-07-09', 80, { zone_id: 'z' })])!.zoneId).toBeNull()
  })
  it('is null with no actual rows', () => {
    expect(pickSeries([fc('2026-07-10', 100)])).toBeNull()
  })
})

describe('findCrossing', () => {
  it('is now when already at the trigger', () => {
    const s = pickSeries([row('2026-07-09', 90)])!
    expect(findCrossing(s, 5, NOW)).toEqual({ kind: 'now', ms: NOW })
  })
  it('interpolates between forecast days', () => {
    // margins: end Jul 9 = +10, end Jul 10 = +4, end Jul 11 = −2 → crosses 2/3 through Jul 11
    const s = pickSeries([row('2026-07-09', 100), fc('2026-07-10', 94), fc('2026-07-11', 88)])!
    const c = findCrossing(s, 6, NOW)
    expect(c.kind).toBe('forecast')
    expect(c.ms).toBe(wallOfDate('2026-07-11') + 16 * H)
  })
  it('extrapolates past the forecast at the recent ETc', () => {
    const s = pickSeries([row('2026-07-09', 120), fc('2026-07-10', 115), fc('2026-07-16', 100)])!
    const c = findCrossing(s, 5, NOW)
    expect(c.kind).toBe('extrapolated')
    // 10 mm over the trigger at end of Jul 16, 5 mm/day → end of Jul 18
    expect(c.ms).toBe(wallOfDate('2026-07-19'))
  })
  it('gives up without an ETc', () => {
    const s = pickSeries([row('2026-07-09', 120)])!
    expect(findCrossing(s, null, NOW).kind).toBe('none')
  })
})

describe('arcFraction / efficiencyOf', () => {
  it('treats unknown, 0/360 and start=end as a full circle', () => {
    expect(arcFraction(null, 360)).toBe(1)
    expect(arcFraction(0, 360)).toBe(1)
    expect(arcFraction(90, 90)).toBe(1)
  })
  it('measures a part circle clockwise, across north', () => {
    expect(arcFraction(0, 180)).toBe(0.5)
    expect(arcFraction(270, 90)).toBe(0.5)
  })
  it('reads efficiency as a fraction or a percent', () => {
    expect(efficiencyOf(null)).toBe(0.85)
    expect(efficiencyOf(80)).toBe(0.8)
    expect(efficiencyOf(0.75)).toBe(0.75)
  })
})

describe('lapPlan', () => {
  it('slows the pivot to put the target down', () => {
    // 5.08 mm at 100% → 20.32 mm at 25% → lap 48 h
    const l = lapPlan(PIVOT, 20.32)
    expect(l.source).toBe('fieldnet')
    expect(l.speedPct).toBeCloseTo(25, 6)
    expect(l.lapHours).toBeCloseTo(48, 6)
    expect(l.appliedGrossMm).toBeCloseTo(20.32, 6)
  })
  it('applies the depth correction and the arc', () => {
    // real depth at 100% = 5.08 × 0.5 = 2.54 → 25.4 mm at 10%; half circle → 60 h
    const l = lapPlan({ ...PIVOT, depthCorrection: 0.5, arcStartDeg: 0, arcEndDeg: 180 }, 25.4)
    expect(l.speedPct).toBeCloseTo(10, 6)
    expect(l.lapHours).toBeCloseTo(60, 6)
  })
  it('clamps the speed', () => {
    expect(lapPlan(PIVOT, 1).speedPct).toBe(100)
    expect(lapPlan(PIVOT, 1000).speedPct).toBe(5)
  })
  it('falls back to the pivot lap time, then to unknown', () => {
    expect(lapPlan({ ...PIVOT, run100S: null, timeToFullCircleH: 30 }, 20)).toMatchObject({ source: 'pivot', lapHours: 30, speedPct: null })
    expect(lapPlan(null, 20)).toMatchObject({ source: 'unknown', lapHours: null })
  })
})

describe('rainWindow / watchDay', () => {
  const days = [
    { date: '2026-07-10', precip_mm: 10, precip_prob: 50 },
    { date: '2026-07-11', precip_mm: 20, precip_prob: 80 },
    { date: '2026-07-12', precip_mm: 30, precip_prob: 90 },
  ]
  it('weights each day by chance and by how much of it is in the window', () => {
    // 8 am Jul 10 + 48 h: 16/24 of Jul 10, all of Jul 11, 8/24 of Jul 12
    const w = rainWindow(days, NOW, NOW + 48 * H)
    expect(w.expectedMm).toBeCloseTo((16 / 24) * 5 + 16 + (8 / 24) * 27, 6)
    expect(w.maxProb).toBe(90)
    expect(w.lastWetDay).toBe('2026-07-12')
  })
  it('reports an unknown chance rather than guessing', () => {
    const w = rainWindow([{ date: '2026-07-10', precip_mm: 10, precip_prob: null }], NOW, NOW + 48 * H)
    expect(w.expectedMm).toBeNull()
    expect(w.unknown).toBe(true)
  })
  it('watches a likely, wet day before the deadline only', () => {
    expect(watchDay(days, NOW, wallOfDate('2026-07-11') + H)?.date).toBe('2026-07-11')
    expect(watchDay(days, NOW, wallOfDate('2026-07-11'))).toBeNull()
  })
})

describe('planField', () => {
  const rows = [
    ...[3, 4, 5, 6, 7, 8, 9].map((d) => row(`2026-07-0${d}`, 130 - d * 3)), // ends at 103 on Jul 9
    fc('2026-07-10', 97),
    fc('2026-07-11', 91),
    fc('2026-07-12', 85), // margin +1 end Jul 11, −5 end Jul 12 → crosses 4 am Jul 12
  ]
  it('works back from the crossing by one lap', () => {
    const p = planField({ fieldId: 'F', rows, pivot: PIVOT, weather: [], nowMs: NOW })!
    expect(p.crossing).toEqual({ kind: 'forecast', ms: wallOfDate('2026-07-12') + 4 * H })
    // net = max(150 − 103, RAW 60) = 60 → gross 70.6 → capped at 25
    expect(p.targetGrossMm).toBe(25)
    expect(p.targetNetMm).toBeCloseTo(21.25, 6)
    const lapH = 12 / (5.08 / 25)
    expect(p.startByMs).toBeCloseTo(wallOfDate('2026-07-12') + 4 * H - lapH * H, 0)
    expect(p.needsWater).toBe(true)
    expect(p.advice).toEqual({ kind: 'irrigate', rainUnknown: false })
    expect(p.daysLeft).toBeCloseTo(13 / 5, 6)
  })
  it('holds for likely rain covering most of the pass', () => {
    const weather = [{ date: '2026-07-11', precip_mm: 25, precip_prob: 80 }] // 20 mm expected ≥ 0.6 × 21.25
    const p = planField({ fieldId: 'F', rows, pivot: PIVOT, weather, nowMs: NOW })!
    expect(p.advice).toMatchObject({ kind: 'hold', prob: 80, byDay: '2026-07-11' })
  })
  it('watches a wet day before the start-by that is not enough to hold on', () => {
    const weather = [{ date: '2026-07-10', precip_mm: 12, precip_prob: 70 }] // 16/24 × 8.4 = 5.6 < 12.75
    const p = planField({ fieldId: 'F', rows, pivot: { ...PIVOT, run100S: 3600 }, weather, nowMs: NOW })!
    expect(p.advice).toMatchObject({ kind: 'watch', day: '2026-07-10' })
  })
  it('needs no water when the trigger is past the week', () => {
    const wet = [row('2026-07-09', 148)]
    const p = planField({ fieldId: 'F', rows: wet, pivot: PIVOT, weather: [], nowMs: NOW })!
    expect(p.crossing.kind).toBe('extrapolated')
    expect(p.needsWater).toBe(false)
    expect(p.advice.kind).toBe('none')
  })
})

describe('the farm', () => {
  const plan = (fieldId: string, startByMs: number | null, o: Partial<FieldPlan> = {}): FieldPlan =>
    ({
      fieldId,
      startByMs,
      crossing: { kind: 'forecast', ms: startByMs },
      needsWater: startByMs != null,
      status: 'soon',
      daysLeft: 2,
      advice: { kind: 'irrigate', rainUnknown: false },
      ...o,
    }) as FieldPlan
  it('sorts by when the pivot must go on, dry fields first', () => {
    const out = sortPlans([plan('late', NOW + 3 * D), plan('none', null), plan('soon', NOW + D), plan('overdue', NOW - D)], NOW)
    expect(out.map((p) => p.fieldId)).toEqual(['overdue', 'soon', 'late', 'none'])
  })
  it('flags two starts on one pump within 24 h', () => {
    const plans = [plan('A', NOW + 2 * H), plan('B', NOW + 20 * H), plan('C', NOW + 50 * H)]
    const pump = () => 'p1'
    const c = pumpClashes(plans, pump, NOW)
    expect(c.get('A')).toEqual([{ pumpId: 'p1', otherFieldId: 'B' }])
    expect(c.get('B')).toEqual([{ pumpId: 'p1', otherFieldId: 'A' }])
    expect(c.has('C')).toBe(false)
  })
  it('summarises the count and the next start, skipping holds', () => {
    const s = plannerSummary(
      [plan('A', NOW + 2 * H, { advice: { kind: 'hold', prob: 80, mm: 20, byDay: null, expectedMm: 16 } }), plan('B', NOW + 5 * H), plan('C', null)],
      NOW,
    )
    expect(s.count).toBe(2)
    expect(s.next?.fieldId).toBe('B')
  })
})

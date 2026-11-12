import { describe, expect, it } from 'vitest'
import {
  bloomState,
  cropShare,
  forecastStartOn,
  gateFor,
  gddByDate,
  gddOn,
  suggestSettings,
  usableLook,
  DEFAULT_BLOOM_SETTINGS,
  type BloomLook,
} from './canola-bloom'

// Real looks from the 2024-26 backfill: [MM-DD, yellow share, blue].
const looks = (year: number, rows: [string, number, number][]): BloomLook[] =>
  rows.map(([d, yellow, blue]) => ({ sensedOn: `${year}-${d}`, yellow, blue }))

const WHITFIELD_2024 = looks(2024, [
  ['06-13', 0, 0.098], ['06-21', 0.32, 0.063], ['06-23', 0.09, 0.075], ['06-26', 0.04, 0.074],
  ['07-06', 0.5, 0.06], ['07-11', 0.94, 0.057], ['07-13', 0.96, 0.055], ['07-16', 0.89, 0.045],
  ['07-21', 0.11, 0.068], ['07-23', 0, 0.074], ['07-26', 0.02, 0.037], ['08-22', 0.85, 0.059],
])

const KELLERS_2025 = looks(2025, [
  ['06-13', 0, 0.068], ['06-16', 0.69, 0.066], ['06-18', 0.85, 0.059], ['07-01', 0.98, 0.045],
  ['07-08', 1, 0.056], ['07-11', 0.47, 0.04], ['07-13', 0.12, 0.033], ['07-16', 0.02, 0.044],
])

const noGate = () => null

describe('bloomState', () => {
  it("takes back Whitfield 2024's June canopy flash, calls the real bloom on 6 Jul and over on 23 Jul", () => {
    const s = bloomState(WHITFIELD_2024, noGate, null)
    expect(s.falseStarts).toEqual(['2024-06-21'])
    expect(s.startedOn).toBe('2024-07-06')
    expect(s.windowOn).toBe('2024-07-06')
    expect(s.fullOn).toBe('2024-07-06')
    expect(s.fallingOn).toBe('2024-07-21')
    expect(s.endedOn).toBe('2024-07-23')
    expect(s.status).toBe('over')
    expect(s.peakOn).toBe('2024-07-13')
  })

  it('holds 6-Kellers 2025 below 450 degree days, then calls it on its spray day', () => {
    const gdd: Record<string, number> = { '2025-06-13': 380, '2025-06-16': 404, '2025-06-18': 433, '2025-07-01': 584 }
    const s = bloomState(KELLERS_2025, (d) => gdd[d] ?? 700, 700)
    expect(s.startedOn).toBe('2025-07-01')
    expect(s.endedOn).toBe('2025-07-16')
    // Without the gate the canopy closing in mid-June reads as flowers.
    expect(bloomState(KELLERS_2025, noGate, null).startedOn).toBe('2025-06-16')
  })

  it('skips a smoky look rather than reading it as not flowering', () => {
    const s = bloomState(
      looks(2026, [['07-01', 0.61, 0.048], ['07-31', 0, 0.099], ['08-02', 0, 0.188]]),
      noGate,
      null,
    )
    expect(s.status).toBe('flowering')
    expect(s.stage).toBe('full')
    expect(s.lastClearOn).toBe('2026-07-01')
    // The satellite's own aerosol reading counts as haze too.
    expect(usableLook({ sensedOn: '2026-07-02', yellow: 0, blue: 0.05, aot: 0.6 })).toBe(false)
  })

  it('does not call ripening pods in late August a start', () => {
    const late = looks(2026, [['08-04', 0.05, 0.049], ['08-25', 0.91, 0.042]])
    expect(bloomState(late, (d) => (d < '2026-08-10' ? 1300 : 1700), 1777).startedOn).toBeNull()
    expect(bloomState(late, noGate, null).startedOn).toBeNull()
    // Whitfield's real bloom in July is still called with no seeding date.
    expect(bloomState(WHITFIELD_2024, noGate, null).startedOn).toBe('2024-07-06')
  })

  it('ends a seed field that stays yellow into ripening at the cut-off (Moreau W Half 2026)', () => {
    const moreau = looks(2026, [
      ['07-06', 0.43, 0.054], ['07-11', 0.17, 0.06], ['07-16', 0.8, 0.049], ['08-04', 0.78, 0.058],
      ['08-17', 0.32, 0.054], ['08-24', 0.83, 0.046],
    ])
    const s = bloomState(moreau, noGate, null)
    expect(s.startedOn).toBe('2026-07-06')
    expect(s.endedOn).toBe('2026-08-17')
    expect(s.peakOn).toBe('2026-07-16')
  })

  it('waits while degree days are short, and ignores May', () => {
    expect(bloomState(looks(2026, [['05-20', 0.9, 0.05]]), noGate, 200).status).toBe('waiting')
    expect(usableLook({ sensedOn: '2026-05-20', yellow: 0.9, blue: 0.05 })).toBe(false)
  })
})

describe('the 10 % start and the stages', () => {
  const rising = looks(2026, [['07-01', 0.04, 0.05], ['07-03', 0.12, 0.05], ['07-06', 0.3, 0.05], ['07-11', 0.62, 0.05]])

  it('says starting at 10 %, then the fungicide window, then full bloom', () => {
    expect(bloomState(rising.slice(0, 2), noGate, null).stage).toBe('starting')
    expect(bloomState(rising.slice(0, 3), noGate, null).stage).toBe('window')
    const s = bloomState(rising, noGate, null)
    expect(s.stage).toBe('full')
    expect(s.startedOn).toBe('2026-07-03')
    expect(s.windowOn).toBe('2026-07-06')
    expect(s.fullOn).toBe('2026-07-11')
  })

  it('needs two partial looks below 10 % to call it over, one full one', () => {
    const top = rising.slice(1)
    const partial = (d: string): BloomLook => ({ sensedOn: `2026-${d}`, yellow: 0.03, blue: 0.05, quality: 'partial' })
    expect(bloomState([...top, partial('07-20')], noGate, null).endedOn).toBeNull()
    expect(bloomState([...top, partial('07-20'), partial('07-22')], noGate, null).endedOn).toBe('2026-07-22')
    expect(bloomState([...top, { sensedOn: '2026-07-20', yellow: 0.03, blue: 0.05 }], noGate, null).endedOn).toBe('2026-07-20')
  })

  it("takes the share over the crop, and the field's own early yellow off it", () => {
    expect(cropShare({ sensedOn: '2026-07-01', yellow: 0.3, blue: 0.05, plant: 0.6 })).toBe(0.5)
    // Too little crop to divide by: the plain share.
    expect(cropShare({ sensedOn: '2026-07-01', yellow: 0.1, blue: 0.05, plant: 0.2 })).toBe(0.1)
    const weedy = looks(2026, [['06-01', 0.08, 0.05], ['06-05', 0.08, 0.05], ['07-01', 0.15, 0.05], ['07-05', 0.16, 0.05]])
    const s = bloomState(weedy, noGate, null)
    expect(s.baseline).toBe(0.08)
    expect(s.startedOn).toBeNull()
    expect(bloomState([...weedy, ...looks(2026, [['07-08', 0.2, 0.05]])], noGate, null).startedOn).toBe('2026-07-08')
  })

  it('believes a scouting report, even before the gate', () => {
    const s = bloomState([{ sensedOn: '2026-06-28', yellow: 0.15, blue: null, source: 'scout' }], () => 400, 400)
    expect(s.startedOn).toBe('2026-06-28')
    expect(s.confidence).not.toBe('low')
  })

  it("uses a variety's own gate", () => {
    const set = { ...DEFAULT_BLOOM_SETTINGS, varietyGate: { 'InVigor L340PC': 520 } }
    expect(gateFor(set, 'invigor l340pc')).toBe(520)
    expect(gateFor(set, 'other')).toBe(450)
  })
})

describe('forecast and tuning', () => {
  it('finds the day the degree days reach the typical start, past the forecast too', () => {
    const days = Array.from({ length: 10 }, (_, i) => ({ date: `2026-06-${String(i + 11).padStart(2, '0')}`, gdd: 10 }))
    expect(forecastStartOn(500, 560, days)).toBe('2026-06-16')
    expect(forecastStartOn(400, 560, days)).toBe('2026-06-26')
    expect(forecastStartOn(600, 560, days)).toBeNull()
  })

  it('suggests settings from three or more seasons', () => {
    const season = (truthOn: string, g: number, share: number, source: 'scouting' | 'fungicide' = 'scouting') => ({ truthOn, gddAtTruth: g, source, looks: [{ sensedOn: truthOn, share }] })
    expect(suggestSettings([season('2026-07-01', 500, 0.1)])).toBeNull()
    const s = suggestSettings([season('2026-07-01', 500, 0.12), season('2025-07-03', 560, 0.2), season('2024-07-02', 610, 0.08)])
    expect(s).toEqual({ typicalStartGdd: 560, gateGdd: 450, startFraction: 0.1, seasons: 3 })
    // Spray dates move the degree days but never the start share.
    const sprays = suggestSettings([season('2026-07-01', 500, 0.6, 'fungicide'), season('2025-07-03', 560, 0.7, 'fungicide'), season('2024-07-02', 610, 0.8, 'fungicide')])
    expect(sprays?.startFraction).toBeNull()
    expect(sprays?.typicalStartGdd).toBe(560)
  })
})

describe('degree days', () => {
  it('adds the mean above 5 C from seeding on', () => {
    const g = gddByDate(
      [
        { date: '2026-05-10', tmax: 30, tmin: 10 },
        { date: '2026-05-11', tmax: 20, tmin: 10 },
        { date: '2026-05-12', tmax: 4, tmin: -2 },
        { date: '2026-05-13', tmax: 25, tmin: 5 },
      ],
      '2026-05-11',
    )
    expect(g.get('2026-05-11')).toBe(10)
    expect(g.get('2026-05-12')).toBe(10)
    expect(gddOn(g, '2026-05-20')).toBe(20)
    expect(gddOn(g, '2026-05-01')).toBeNull()
  })
})

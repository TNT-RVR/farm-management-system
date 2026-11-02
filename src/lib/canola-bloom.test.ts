import { describe, expect, it } from 'vitest'
import { bloomState, gddByDate, gddOn, usableLook, type BloomLook } from './canola-bloom'

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
  it('calls Whitfield 2024 two days after its first fungicide (4 Jul) and over on 23 Jul', () => {
    const s = bloomState(WHITFIELD_2024, noGate, null)
    expect(s.startedOn).toBe('2024-07-06')
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
    expect(s.lastClearOn).toBe('2026-07-01')
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

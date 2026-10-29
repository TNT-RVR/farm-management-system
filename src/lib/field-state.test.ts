import { describe, expect, it } from 'vitest'
import { fieldState, hailLabel, hailSummary, shortDay } from './field-state'

describe('field state', () => {
  it('says nothing about a field with no crop', () => {
    expect(fieldState({ cropName: null })).toEqual({ key: 'no-crop', label: 'No crop', why: '' })
  })

  it('reads off, with the day of the last load', () => {
    const s = fieldState({ cropName: 'Grain Corn', harvestFinished: true, lastLoadOn: '2026-10-21' })
    expect(s.key).toBe('off')
    expect(s.why).toContain('Oct 21')
  })

  it('reads harvesting while a combine is on it', () => {
    const s = fieldState({ cropName: 'Grain Corn', harvestStarted: true, lastLoadOn: '2026-10-22' })
    expect(s.key).toBe('harvesting')
    expect(s.label).toBe('Harvesting')
  })

  it('puts harvest ahead of the watering flag', () => {
    // A combined field is not still being watered, whatever the flag says.
    const s = fieldState({
      cropName: 'Beans-Pinto',
      harvestFinished: true,
      wateringDoneAt: '2026-08-31',
    })
    expect(s.key).toBe('off')
  })

  it('gives the app’s own reason when the app worked the watering out', () => {
    const s = fieldState({
      cropName: 'Grain Corn',
      wateringDoneAt: '2026-09-15T10:00:00Z',
      wateringDoneSource: 'auto',
      wateringDoneNote: 'Past maturity on 2026-09-03; the pivot has not run since 2026-09-05.',
    })
    expect(s.key).toBe('water-off')
    expect(s.why).toContain('Past maturity')
    expect(s.why).toContain('Sep 15')
  })

  it('says a person marked it when a person did', () => {
    const s = fieldState({ cropName: 'Grain Corn', wateringDoneAt: '2026-08-31', wateringDoneSource: 'person' })
    expect(s.why).toBe('Marked finished Aug 31.')
  })

  it('separates irrigated from dryland while growing', () => {
    expect(fieldState({ cropName: 'Wheat', irrigated: true }).why).toContain('irrigation schedule')
    expect(fieldState({ cropName: 'Wheat', irrigated: false }).why).toContain('not irrigated')
  })

  it('reads a farm day in the farm’s own day, not the day before', () => {
    expect(shortDay('2026-01-01')).toBe('Jan 1')
    expect(shortDay(null)).toBeNull()
    expect(shortDay('not a date')).toBeNull()
  })
})

describe('hail summary', () => {
  const ev = (over: Partial<{ event_date: string | null; loss_pct: number | null; acres: number | null }> = {}) => ({
    event_date: '2026-08-11',
    loss_pct: null,
    acres: null,
    ...over,
  })

  it('is nothing when nothing hailed', () => {
    expect(hailSummary([])).toBeNull()
  })

  it('counts two events and keeps the worst assessed loss', () => {
    // 6-Kellers, 2026: the AFSC inspection on 7 Jul and a bare record on 11 Aug.
    const s = hailSummary([ev({ event_date: '2026-07-07', loss_pct: 17, acres: 125 }), ev()])!
    expect(s.count).toBe(2)
    expect(s.worstLossPct).toBe(17)
    expect(s.worstAcres).toBe(125)
    expect(s.firstOn).toBe('2026-07-07')
    expect(hailLabel(s)).toBe('2 × · 17% on 125 ac')
  })

  it('falls back to the day when nothing is assessed yet', () => {
    const s = hailSummary([ev()])!
    expect(s.worstLossPct).toBeNull()
    expect(hailLabel(s)).toBe('Aug 11')
  })

  it('keeps the bigger of two assessed losses', () => {
    const s = hailSummary([ev({ loss_pct: 40 }), ev({ loss_pct: 17, acres: 125 })])!
    expect(s.worstLossPct).toBe(40)
    expect(s.worstAcres).toBeNull()
  })
})

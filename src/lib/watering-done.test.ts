import { describe, expect, it } from 'vitest'
import { decideWateringDone, QUIET_DAYS } from './watering-done'

const today = '2026-10-29'

describe('watering done', () => {
  it('leaves a field alone while it is still being watered', () => {
    expect(decideWateringDone({ today, maturityOn: null, lastPassOn: '2026-10-28' })).toBeNull()
  })

  it('clears a flag the pivot contradicted', () => {
    // Whitfield, 2026: ticked 31 Aug, pivot ran 8 Oct.
    const d = decideWateringDone({
      today,
      doneAt: '2026-08-31T10:00:00Z',
      doneSource: 'person',
      lastPassOn: '2026-10-08',
    })
    expect(d?.action).toBe('clear')
    expect(d?.note).toContain('2026-10-08')
    expect(d?.note).toContain('2026-08-31')
  })

  it('does not clear a pass that came before the flag', () => {
    expect(
      decideWateringDone({ today, doneAt: '2026-10-08', lastPassOn: '2026-08-31' }),
    ).toBeNull()
  })

  it('does not clear once harvest is recorded', () => {
    // A pass logged after the combine went through is a line being flushed.
    expect(
      decideWateringDone({
        today,
        doneAt: '2026-09-01',
        lastPassOn: '2026-10-20',
        harvestFinished: true,
      }),
    ).toBeNull()
  })

  it('marks a harvested field finished without asking', () => {
    const d = decideWateringDone({ today, harvestFinished: true })
    expect(d).toEqual({ action: 'set', note: 'Harvest is recorded as finished.' })
  })

  it('marks it finished past maturity once the pivot has been quiet a week', () => {
    const quiet = '2026-10-22' // 7 days before today
    const d = decideWateringDone({ today, maturityOn: '2026-09-03', lastPassOn: quiet })
    expect(d?.action).toBe('set')
    expect(d?.note).toContain('maturity on 2026-09-03')
    expect(d?.note).toContain(quiet)
  })

  it('waits while the pivot is still going, however late in the season', () => {
    const d = decideWateringDone({ today, maturityOn: '2026-09-03', lastPassOn: '2026-10-26' })
    expect(d).toBeNull()
  })

  it('marks a past-maturity field with no pivot record at all', () => {
    // Dryland, or a pivot FieldNET does not report: nothing ever runs, so
    // waiting for the pivot to go quiet would wait forever.
    const d = decideWateringDone({ today, maturityOn: '2026-08-26', lastPassOn: null })
    expect(d?.action).toBe('set')
    expect(d?.note).toContain('no pivot pass recorded')
  })

  it('does not mark a field that has not reached maturity', () => {
    expect(decideWateringDone({ today, maturityOn: '2026-11-03', lastPassOn: null })).toBeNull()
  })

  it('counts the quiet days inclusively from the pass', () => {
    const almost = '2026-10-23' // 6 days
    expect(decideWateringDone({ today, maturityOn: '2026-09-03', lastPassOn: almost })).toBeNull()
    expect(QUIET_DAYS).toBe(7)
  })
})

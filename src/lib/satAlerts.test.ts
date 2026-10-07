import { describe, expect, it } from 'vitest'
import {
  buildAlertTask,
  buildCandidateCauses,
  detectFieldWideDecline,
  detectRapidDecline,
  inGrowingWindow,
  FIELD_WIDE_DECLINE_FRACTION,
  MIN_PEERS,
  RAPID_DECLINE_FRACTION,
} from '../../netlify/shared/sat-alerts'

const p = (sensedOn: string, ndvi: number) => ({ sensedOn, ndvi })

describe('inGrowingWindow', () => {
  it('covers the period when a decline means something', () => {
    expect(inGrowingWindow('2026-06-15')).toBe(true)
    expect(inGrowingWindow('2026-08-04')).toBe(true)
  })

  it('excludes senescence, when a 15% drop is the crop doing its job', () => {
    // Alerting every September would put a scouting task on every field until
    // the reader stopped looking at them.
    expect(inGrowingWindow('2026-09-10')).toBe(false)
    expect(inGrowingWindow('2026-08-21')).toBe(false)
  })

  it('excludes emergence, when NDVI is noise about bare soil', () => {
    expect(inGrowingWindow('2026-04-20')).toBe(false)
    expect(inGrowingWindow('2026-05-14')).toBe(false)
  })
})

describe('detectRapidDecline', () => {
  it('fires on a steep drop inside the window', () => {
    const c = detectRapidDecline([p('2026-07-20', 0.80), p('2026-07-27', 0.60)])
    expect(c).not.toBeNull()
    expect(c!.alertType).toBe('rapid_decline')
    expect(c!.magnitude).toBeCloseTo(-0.25, 4)
    expect(c!.detail.days_elapsed).toBe(7)
  })

  it('ignores a drop smaller than the threshold', () => {
    const c = detectRapidDecline([p('2026-07-20', 0.80), p('2026-07-27', 0.72)])
    expect(c).toBeNull()
    expect(RAPID_DECLINE_FRACTION).toBe(0.15)
  })

  it('ignores a drop that took longer than ten days', () => {
    // Slow decline is a trend to watch, not an event to walk out to.
    expect(detectRapidDecline([p('2026-07-01', 0.80), p('2026-07-20', 0.50)])).toBeNull()
  })

  it('never fires on growth', () => {
    expect(detectRapidDecline([p('2026-07-20', 0.50), p('2026-07-27', 0.80)])).toBeNull()
  })

  it('compares against the most recent look, not the best one', () => {
    // The trap this season: a smoke-hit observation reads high or low against
    // its neighbours, and using the window's best as a baseline manufactures a
    // decline out of the return to normal.
    const series = [p('2026-07-18', 0.90), p('2026-07-22', 0.62), p('2026-07-26', 0.60)]
    // Against 0.90 this is -33%; against the actual previous look it is -3%.
    expect(detectRapidDecline(series)).toBeNull()
  })

  it('says nothing from a single observation', () => {
    expect(detectRapidDecline([p('2026-07-20', 0.80)])).toBeNull()
    expect(detectRapidDecline([])).toBeNull()
  })
})

describe('detectFieldWideDecline', () => {
  const own = { magnitude: -0.2, sensedOn: '2026-07-27', baseline: 0.8, observed: 0.64 }

  it('fires when this field fell and its neighbours held', () => {
    const c = detectFieldWideDecline(own, [
      { fieldId: 'a', change: 0.01 },
      { fieldId: 'b', change: -0.02 },
      { fieldId: 'c', change: 0.0 },
    ])
    expect(c).not.toBeNull()
    expect(c!.alertType).toBe('field_wide_decline')
    expect(c!.detail.peer_fields).toBe(3)
  })

  it('stays silent when the neighbours fell too', () => {
    // The whole point of this detector: a regional weather event, or this
    // season's smoke, moves every field at once and is not a field problem.
    const c = detectFieldWideDecline(own, [
      { fieldId: 'a', change: -0.19 },
      { fieldId: 'b', change: -0.22 },
      { fieldId: 'c', change: -0.18 },
    ])
    expect(c).toBeNull()
  })

  it('uses the median so one troubled neighbour cannot mask a real event', () => {
    // A mean of (-0.60, 0.00, 0.01) is -0.20 and would suppress this. The
    // median is 0.00 and does not.
    const c = detectFieldWideDecline(own, [
      { fieldId: 'a', change: -0.60 },
      { fieldId: 'b', change: 0.0 },
      { fieldId: 'c', change: 0.01 },
    ])
    expect(c).not.toBeNull()
  })

  it('declines to judge without enough same-crop neighbours', () => {
    // With one peer there is no regional baseline, only another anecdote.
    expect(detectFieldWideDecline(own, [{ fieldId: 'a', change: 0.0 }])).toBeNull()
    expect(MIN_PEERS).toBe(2)
  })

  it('needs a decline of its own before looking at neighbours', () => {
    const flat = { magnitude: -0.02, sensedOn: '2026-07-27', baseline: 0.8, observed: 0.78 }
    expect(detectFieldWideDecline(flat, [
      { fieldId: 'a', change: 0.01 },
      { fieldId: 'b', change: 0.0 },
    ])).toBeNull()
    expect(FIELD_WIDE_DECLINE_FRACTION).toBe(0.1)
  })
})

describe('what the alert is allowed to say', () => {
  it('ranks water stress first only when the balance independently agrees', () => {
    expect(buildCandidateCauses(true)[0]).toBe('water stress')
    expect(buildCandidateCauses(false)[0]).not.toBe('water stress')
    // Still present either way — it is a candidate, not a verdict.
    expect(buildCandidateCauses(false)).toContain('water stress')
  })

  it('never names a disease', () => {
    // §7.3: a 10 m multispectral pixel cannot tell sclerotinia from drought
    // stress, and copy implying otherwise is a defect, not a feature.
    const { title, description } = buildAlertTask({
      fieldName: '10/Aspen Flat',
      alertType: 'rapid_decline',
      magnitude: -0.28,
      observedOn: '2026-07-27',
      previousOn: '2026-07-20',
      lat: 52.415,
      lon: -108.797,
      waterDeficit: false,
      waterDetail: null,
      peerNote: null,
    })
    const text = `${title} ${description}`.toLowerCase()
    for (const named of ['sclerotinia', 'rust', 'blight', 'aphid', 'fusarium', 'wireworm']) {
      expect(text).not.toContain(named)
    }
    expect(text).toContain('not a diagnosis')
    expect(text).toContain('cannot identify a disease')
  })

  it('carries the magnitude, the waypoint and the two-look assurance', () => {
    const { title, description } = buildAlertTask({
      fieldName: '10/Aspen Flat',
      alertType: 'rapid_decline',
      magnitude: -0.28,
      observedOn: '2026-07-27',
      previousOn: '2026-07-20',
      lat: 52.415,
      lon: -108.797,
      waterDeficit: false,
      waterDetail: null,
      peerNote: null,
    })
    expect(title).toContain('28%')
    expect(title).toContain('10/Aspen Flat')
    expect(description).toContain('52.41500, -108.79700')
    expect(description).toContain('two consecutive clear observations')
  })

  it('says the neighbours held, when that is why it fired', () => {
    const { title, description } = buildAlertTask({
      fieldName: '1',
      alertType: 'field_wide_decline',
      magnitude: -0.19,
      observedOn: '2026-07-27',
      previousOn: '2026-07-22',
      lat: null,
      lon: null,
      waterDeficit: true,
      waterDetail: 'Water balance on the same field: 60 mm depleted of 70 mm readily available (status: now).',
      peerNote: '3 neighbouring fields of the same crop held steady over the same window, so this is not a regional weather effect.',
    })
    expect(title).toContain('neighbours held')
    expect(description).toContain('not a regional weather effect')
    expect(description).toContain('60 mm depleted')
    // Water stress ranked first because the balance says so independently.
    expect(description.indexOf('water stress')).toBeLessThan(description.indexOf('nutrient deficiency'))
  })
})

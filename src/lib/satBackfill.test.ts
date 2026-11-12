import { describe, expect, it } from 'vitest'
import {
  windowsOver,
  UNITS_PER_KIND,
  BACKFILL_KINDS,
  BACKFILL_PHASES,
  MAX_STALLED_RUNS,
  WINDOW_DAYS,
} from '../../netlify/shared/sat-backfill'

describe('windowsOver', () => {
  it('covers the range with no gap and no overlap', () => {
    // The whole point. A gap is a stretch of season nobody asks the catalog
    // about, and it looks exactly like clear sky with nothing growing -- which
    // is the failure this backfill exists to undo, so it must not reproduce it.
    const ws = windowsOver('2026-04-15', '2026-11-01')
    expect(ws[0].from).toBe('2026-04-15')
    expect(ws[ws.length - 1].to).toBe('2026-11-01')
    for (let i = 1; i < ws.length; i++) {
      const prevEnd = Date.parse(`${ws[i - 1].to}T00:00:00Z`)
      const thisStart = Date.parse(`${ws[i].from}T00:00:00Z`)
      expect(thisStart - prevEnd).toBe(86_400_000)
    }
  })

  it('never runs a window past the end of the range', () => {
    // Asking past `to` would buy statistics for days the job was not given,
    // which on a 2024 backfill is a whole extra month nobody approved.
    for (const w of windowsOver('2026-04-15', '2026-05-02')) {
      expect(w.to <= '2026-05-02').toBe(true)
    }
  })

  it('handles a range shorter than one window', () => {
    expect(windowsOver('2026-08-01', '2026-08-03')).toEqual([{ from: '2026-08-01', to: '2026-08-03' }])
  })

  it('handles a single day', () => {
    expect(windowsOver('2026-08-01', '2026-08-01')).toEqual([{ from: '2026-08-01', to: '2026-08-01' }])
  })

  it('keeps each window inside one catalog page', () => {
    // The catalog answers at most 100 features. Over this farm a pass is a
    // couple of scenes and there is one every three or four days, so a 30-day
    // window is about 16 features -- far enough under 100 that a cloudy spell
    // with extra tiles cannot silently truncate the window.
    expect(WINDOW_DAYS).toBeLessThanOrEqual(45)
    for (const w of windowsOver('2024-04-15', '2026-11-01')) {
      const span = (Date.parse(`${w.to}T00:00:00Z`) - Date.parse(`${w.from}T00:00:00Z`)) / 86_400_000
      expect(span).toBeLessThan(45)
    }
  })
})

describe('what a backfilled day costs', () => {
  it('is dominated by the true-colour raster', () => {
    // Measured, not guessed: true colour renders at a fixed 1024 square and
    // costs 4 processing units whatever the paddock's size, while the index
    // rasters render at native 10 m and cost about a tenth of a unit. Any
    // estimate that treats the four kinds as comparable is out by 10x, and the
    // free Copernicus tier is small enough for that to matter.
    const perPair = BACKFILL_KINDS.reduce((a, k) => a + UNITS_PER_KIND[k], 0)
    expect(UNITS_PER_KIND.truecolour / perPair).toBeGreaterThan(0.9)
    expect(perPair).toBeGreaterThan(4)
    expect(perPair).toBeLessThan(4.5)
  })

  it('does not include the canola flower map', () => {
    // `yellow` is only ever drawn for a flowering canola field, never a paddock.
    expect(BACKFILL_KINDS).not.toContain('yellow')
    expect(BACKFILL_KINDS).toEqual(['truecolour', 'ndvi', 'ndvi_field', 'ndre'])
  })
})

describe('the order of the phases', () => {
  it('grades before it draws', () => {
    // The bug this pins. A fresh observation carries only a provisional grade,
    // because the honest valid fraction needs the paddock's clearest look ever
    // to tell pixels outside the boundary from pixels under cloud.
    // sat_rescore_observations settles it, and captureHistory only photographs
    // a look that reads `full`.
    //
    // Drawn first, the pictures are chosen on grades that are about to change:
    // 912 observations landed over the 2026 season, 158 looks read `full` at
    // that moment and got photographed, and the regrade then promoted ~370
    // more -- which the job had already walked past and declared finished.
    // Clear days in May, every paddock above 0.96 valid fraction, four
    // pictures out of seventeen. sat-run.ts says the same thing in its header.
    expect(BACKFILL_PHASES.indexOf('grading')).toBeLessThan(BACKFILL_PHASES.indexOf('images'))
  })

  it('rebuilds the daily series after the grading it reads', () => {
    expect(BACKFILL_PHASES.indexOf('images')).toBeLessThan(BACKFILL_PHASES.indexOf('finishing'))
    expect(BACKFILL_PHASES.indexOf('grading')).toBeLessThan(BACKFILL_PHASES.indexOf('finishing'))
  })

  it('ends in done', () => {
    expect(BACKFILL_PHASES[BACKFILL_PHASES.length - 1]).toBe('done')
    expect(BACKFILL_PHASES[0]).toBe('observations')
  })
})

describe('giving up honestly', () => {
  it('allows a few stalled runs before abandoning a look', () => {
    // Making a failed raster block `done` is right -- counting a failure as
    // finished is how a job reports success over a gap. But alone it creates
    // the opposite fault: a look that can NEVER be drawn keeps the job
    // `running` for ever, the cron restarts it every four hours, and the
    // one-live-job index blocks every other range behind it.
    //
    // The 2026 pasture backfill ended two looks short of ~420, where the index
    // evalscript 400s on one particular scene. More than one attempt, because a
    // rate limit should be retried; few enough that nobody waits a day on it.
    expect(MAX_STALLED_RUNS).toBeGreaterThan(1)
    expect(MAX_STALLED_RUNS).toBeLessThanOrEqual(5)
  })
})

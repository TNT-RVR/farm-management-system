import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CHARTS,
  GRADES,
  GRADE_ADVICE,
  adviceFor,
  bandRanges,
  averageReading,
  gradeFor,
  lookupMoisture,
  needsAir,
  type MoistureBands,
  type MoistureChart,
} from './moisture'

const DIR = path.join(__dirname, '../data/919-charts')

function load(key: string): MoistureChart {
  return JSON.parse(readFileSync(path.join(DIR, `${key}.json`), 'utf8')) as MoistureChart
}

const canola = load('canola6')
const cornHigh = load('cornhighmoist11A')

describe('the shipped charts', () => {
  const keys = readdirSync(DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.replace(/\.json$/, ''))

  it('are all listed in the index, and the index lists nothing else', () => {
    expect(keys.sort()).toEqual(CHARTS.map((c) => c.key).sort())
  })

  it.each(keys)('%s ships the PDF it was read from', (key) => {
    // The calculator offers to open the chart it used. A missing PDF is a dead
    // icon on a screen somebody is using to double-check a number.
    expect(existsSync(path.join(__dirname, '../../public/919-charts', `${key}.pdf`))).toBe(true)
  })

  it.each(keys)('%s obeys the physics the published table obeys', (key) => {
    // The same three invariants the extractor validates against, checked again
    // here against what is actually in the repo — so a hand-edit, a bad merge
    // or a truncated file fails the suite rather than quietly changing what a
    // bin gets graded as.
    const c = load(key)
    expect(c.rows.length).toBeGreaterThan(20)
    expect(c.sample_weight_g).toBeGreaterThan(0)
    expect(c.reading_step).toBe(0.5)

    const grids = c.rows.map((r) => r.split(',').map(Number))
    for (const row of grids) {
      expect(row.length).toBeGreaterThan(0)
      expect(row.length).toBeLessThanOrEqual(c.temperatures_c.length)
      // Warmer grain reads drier along a row.
      for (let i = 1; i < row.length; i++) expect(row[i]).toBeLessThanOrEqual(row[i - 1])
      expect(row.every(Number.isFinite)).toBe(true)
    }
    // A higher dial reading means wetter grain down a column.
    for (let col = 0; col < c.temperatures_c.length; col++) {
      const column = grids.filter((r) => r[col] != null).map((r) => r[col])
      for (let i = 1; i < column.length; i++) {
        expect(column[i]).toBeGreaterThanOrEqual(column[i - 1])
      }
    }
  })
})

describe('lookupMoisture', () => {
  it('reads a cell straight off the published table', () => {
    // Canola, table 6: reading 3.5 is 6.0 % at 11 °C and 5.1 % at 30 °C.
    expect(lookupMoisture(canola, 11, 3.5)).toMatchObject({ ok: true, moisture: 6.0 })
    expect(lookupMoisture(canola, 30, 3.5)).toMatchObject({ ok: true, moisture: 5.1 })
  })

  it('rounds the temperature to the degree the table is written in', () => {
    const a = lookupMoisture(canola, 17.4, 40)
    const b = lookupMoisture(canola, 17, 40)
    expect(a).toEqual(b)
    expect(lookupMoisture(canola, 17.6, 40)).toEqual(lookupMoisture(canola, 18, 40))
  })

  it('refuses grain colder or warmer than the meter is valid for', () => {
    // 10.6 rounds to 11, which is in the table — but the grain is still too
    // cold for the meter, so the rounding must not rescue it.
    const cold = lookupMoisture(canola, 10.6, 40)
    expect(cold.ok).toBe(false)
    expect(cold.ok === false && cold.problem).toMatch(/11 °C and 30 °C/)
    expect(lookupMoisture(canola, 31, 40).ok).toBe(false)
  })

  it('refuses a dial reading off either end of the chart', () => {
    const low = lookupMoisture(canola, 20, 3)
    expect(low.ok).toBe(false)
    expect(low.ok === false && low.problem).toMatch(/off this chart/)
    expect(lookupMoisture(canola, 20, 78.5).ok).toBe(false)
    expect(lookupMoisture(canola, 20, 78).ok).toBe(true)
  })

  it('interpolates between two rows and says that it did', () => {
    const lo = lookupMoisture(canola, 20, 40)
    const hi = lookupMoisture(canola, 20, 40.5)
    const mid = lookupMoisture(canola, 20, 40.25)
    expect(lo.ok && hi.ok && mid.ok).toBe(true)
    if (!lo.ok || !hi.ok || !mid.ok) return
    expect(lo.interpolated).toBe(false)
    expect(mid.interpolated).toBe(true)
    expect(mid.moisture).toBeGreaterThanOrEqual(lo.moisture)
    expect(mid.moisture).toBeLessThanOrEqual(hi.moisture)
  })

  it('will not invent a cell a short row does not have', () => {
    // None of the fourteen charts in the repo is ragged — every row spans all
    // twenty degrees — so this is checked against a table built to be short at
    // the warm end, which is the shape a chart covering a narrow moisture band
    // takes: at a low dial reading the warm columns fall off the bottom of the
    // range the table covers, and there is no cell there to read.
    const ragged: MoistureChart = {
      ...cornHigh,
      first_reading: 20,
      rows: ['21.5,21.2,21.0', '22.0,21.8,21.5,21.2,21.0'],
    }
    const out = lookupMoisture(ragged, 25, 20)
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.problem).toMatch(/does not reach/)
    // The cold end of the same row still reads.
    expect(lookupMoisture(ragged, 12, 20)).toMatchObject({ ok: true, moisture: 21.2 })
  })

  it('rejects a blank entry rather than reading it as zero', () => {
    expect(lookupMoisture(canola, Number.NaN, 40).ok).toBe(false)
    expect(lookupMoisture(canola, 20, Number.NaN).ok).toBe(false)
  })
})

describe('averageReading', () => {
  it('averages the three readings the procedure asks for', () => {
    expect(averageReading([40, 40.5, 41])).toBe(40.5)
  })
  it('ignores the ones not filled in yet', () => {
    expect(averageReading([40, null, null])).toBe(40)
    expect(averageReading([null, null, null])).toBeNull()
  })
})

describe('gradeFor', () => {
  const wheat: MoistureBands = { dry_max: 14.5, tough_max: 17.0, damp_max: null, moist_max: null }
  const corn: MoistureBands = { dry_max: 15.5, tough_max: 17.5, damp_max: 21.0, moist_max: 25.0 }
  // The CGC gives beans no tough range at all: dry to 18.0, damp over 18.0.
  const beans: MoistureBands = { dry_max: 18.0, tough_max: 18.0, damp_max: null, moist_max: null }
  const none: MoistureBands = { dry_max: null, tough_max: null, damp_max: null, moist_max: null }

  it('grades against the recorded bands', () => {
    expect(gradeFor(wheat, 14.5)).toBe('dry')
    expect(gradeFor(wheat, 14.6)).toBe('tough')
    expect(gradeFor(wheat, 17.0)).toBe('tough')
  })

  it('folds everything above the last band into the one after it', () => {
    // Wheat has no moist or wet: over 17.0 is damp and that is the end of it.
    expect(gradeFor(wheat, 17.1)).toBe('damp')
    expect(gradeFor(wheat, 30)).toBe('damp')
    expect(gradeFor(corn, 25.1)).toBe('wet')
  })

  it('skips a band the crop does not have', () => {
    expect(gradeFor(beans, 18.0)).toBe('dry')
    expect(gradeFor(beans, 18.1)).toBe('damp')
    expect(GRADES.indexOf('damp')).toBe(2)
  })

  it('has no opinion about a crop with no bands', () => {
    expect(gradeFor(none, 40)).toBeNull()
    expect(needsAir(null)).toBe(false)
  })

  it('calls for air on anything above a straight grade', () => {
    expect(needsAir('dry')).toBe(false)
    expect(needsAir('tough')).toBe(true)
    expect(needsAir('wet')).toBe(true)
  })
})

describe('bandRanges', () => {
  it('writes the bands the way the CGC writes them', () => {
    expect(bandRanges({ dry_max: 14.5, tough_max: 17.0, damp_max: null, moist_max: null })).toEqual([
      { grade: 'dry', range: 'up to 14.5' },
      { grade: 'tough', range: '14.6 to 17.0' },
      { grade: 'damp', range: 'over 17.0' },
    ])
  })

  it('does not print a band that does not exist', () => {
    expect(bandRanges({ dry_max: 18.0, tough_max: 18.0, damp_max: null, moist_max: null })).toEqual([
      { grade: 'dry', range: 'up to 18.0' },
      { grade: 'damp', range: 'over 18.0' },
    ])
  })

  it('says nothing about a crop with no bands', () => {
    expect(bandRanges({ dry_max: null, tough_max: null, damp_max: null, moist_max: null })).toEqual(
      [],
    )
  })
})

describe('a floor under dry: beans', () => {
  // Prairie Creek's rule, not the CGC's: 14.0–15.5 into our bins, to 16.0 only
  // straight to the plant, under 14 too dry, over 16 too wet.
  const beans: MoistureBands = {
    dry_min: 14.0,
    dry_max: 15.5,
    tough_max: 16.0,
    damp_max: null,
    moist_max: null,
    tough_advice: 'Not for our bins — fine if it goes straight to the bean plant.',
  }

  it('grades below the floor as too dry, and nothing to do with air', () => {
    expect(gradeFor(beans, 13.9)).toBe('too_dry')
    expect(gradeFor(beans, 14.0)).toBe('dry')
    expect(gradeFor(beans, 15.5)).toBe('dry')
    expect(gradeFor(beans, 15.6)).toBe('tough')
    expect(gradeFor(beans, 16.0)).toBe('tough')
    expect(gradeFor(beans, 16.1)).toBe('damp')
    expect(needsAir('too_dry')).toBe(false)
  })

  it('gives the crop its own words for tough', () => {
    expect(adviceFor('tough', beans)).toContain('bean plant')
    expect(adviceFor('dry', beans)).toBe(GRADE_ADVICE.dry)
    expect(adviceFor('tough', { ...beans, tough_advice: null })).toBe(GRADE_ADVICE.tough)
  })

  it('reads the floor as a row and starts dry at it', () => {
    expect(bandRanges(beans)).toEqual([
      { grade: 'too_dry', range: 'below 14.0' },
      { grade: 'dry', range: '14.0 to 15.5' },
      { grade: 'tough', range: '15.6 to 16.0' },
      { grade: 'damp', range: 'over 16.0' },
    ])
  })
})

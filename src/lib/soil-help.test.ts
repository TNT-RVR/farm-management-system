import { describe, expect, it } from 'vitest'
import {
  bandFor,
  rateDepthScaled,
  rateProfileValue,
  rateValue,
  SOIL_COLUMNS,
  SOIL_HELP,
  SOIL_MICRO_COLUMNS,
} from './soil-help'

// A column with no help entry renders an empty popover rather than throwing, so
// nothing catches it at runtime. These tables are the reference a fertiliser
// decision gets made from, and a heading whose info button opens onto nothing
// is worse than no button at all.
describe('soil column help', () => {
  const allColumns = [...SOIL_COLUMNS, ...SOIL_MICRO_COLUMNS]

  it('explains every column shown in either table', () => {
    for (const c of allColumns) {
      expect(SOIL_HELP[c.key], `no help for ${c.key} (${c.label})`).toBeDefined()
    }
  })

  it('populates every entry', () => {
    for (const [key, help] of Object.entries(SOIL_HELP)) {
      // "pH" is a real title at two characters; the bar is "not empty".
      expect(help.title.trim().length, key).toBeGreaterThan(1)
      expect(help.body.length, key).toBeGreaterThan(0)
      for (const para of help.body) expect(para.trim().length, key).toBeGreaterThan(30)
    }
  })

  it('gives a threshold list to every nutrient that claims one', () => {
    for (const [key, help] of Object.entries(SOIL_HELP)) {
      if (!help.how) continue
      expect(help.how.label.trim().length, key).toBeGreaterThan(2)
      expect(help.how.lines.length, key).toBeGreaterThan(0)
      for (const l of help.how.lines) expect(l.trim().length, key).toBeGreaterThan(10)
    }
  })

  it('leaves no gap in any band list — every value lands somewhere', () => {
    // Bands are matched by the first `value <= max`, so an ascending list with
    // an Infinity top is the only shape that always resolves. A descending or
    // capped list would silently return null for real readings.
    for (const [key, help] of Object.entries(SOIL_HELP)) {
      if (!help.ranges) continue
      const maxes = help.ranges.bands.map((band) => band.max)
      expect([...maxes].sort((x, y) => x - y), `${key} bands out of order`).toEqual(maxes)
      expect(maxes.at(-1), `${key} has no open-ended top band`).toBe(Infinity)
      for (const probe of [0, 0.5, 1, 5, 25, 500, 99999]) {
        expect(bandFor(help, probe), `${key} has no band for ${probe}`).not.toBeNull()
      }
    }
  })

  it('marks the band a real reading falls in', () => {
    // Field 0's 2026 topsoil: Olsen P 7 ppm, K 158, pH 8.1, %Na 0.6.
    expect(bandFor(SOIL_HELP.p_bicarb_ppm, 7)?.label).toBe('5 – 10')
    expect(bandFor(SOIL_HELP.k_ppm, 158)?.label).toBe('150 – 250')
    expect(bandFor(SOIL_HELP.ph, 8.1)?.label).toBe('8.0 – 8.5')
    expect(bandFor(SOIL_HELP.base_na_pct, 0.6)?.label).toBe('Under 1%')
  })

  it('returns no band for a missing value rather than the first one', () => {
    expect(bandFor(SOIL_HELP.k_ppm, null)).toBeNull()
    expect(bandFor(SOIL_HELP.k_ppm, undefined)).toBeNull()
    expect(bandFor(SOIL_HELP.sample, 5)).toBeNull()
  })

  it('keeps the table colour and the highlighted band in agreement', () => {
    // They are read from one list now; this is what stops them drifting again.
    for (const key of ['p_bicarb_ppm', 'k_ppm', 'base_na_pct', 'zn_ppm']) {
      for (const probe of [0.2, 3, 12, 160, 300]) {
        expect(rateValue(key, probe), `${key} @ ${probe}`).toBe(bandFor(SOIL_HELP[key], probe)!.rating)
      }
    }
  })

  it('has no help for a column that is not displayed', () => {
    // Keeps the reference honest: an entry nobody can reach is dead copy.
    const shown = new Set(allColumns.map((c) => c.key))
    for (const key of Object.keys(SOIL_HELP)) {
      expect(shown.has(key), `${key} has help but is never shown`).toBe(true)
    }
  })
})

describe('rateValue', () => {
  it('bands phosphorus the way the Olsen guidance reads', () => {
    // 5-10 ppm Olsen is LOW, not marginal. The colour used to disagree with the
    // popover text on exactly this point, which is why the two now share a list.
    expect(rateValue('p_bicarb_ppm', 3)).toBe('low')
    expect(rateValue('p_bicarb_ppm', 8)).toBe('low')
    expect(rateValue('p_bicarb_ppm', 12)).toBe('marginal')
    expect(rateValue('p_bicarb_ppm', 18)).toBe('marginal')
    // Irrigated crops still pay for P up to about Olsen 41 (≈100 lb/ac MK).
    expect(rateValue('p_bicarb_ppm', 30)).toBe('ok')
    expect(rateValue('p_bicarb_ppm', 45)).toBe('high')
  })

  it('treats sodium the right way round — low is good, high is the problem', () => {
    // The one nutrient where a big number is the bad news, so an inverted band
    // here would colour a sodic field green.
    expect(rateValue('base_na_pct', 0.5)).toBe('ok')
    expect(rateValue('base_na_pct', 3)).toBe('marginal')
    expect(rateValue('base_na_pct', 8)).toBe('high')
  })

  it('rates boron high before it is toxic, not after', () => {
    expect(rateValue('b_ppm', 0.3)).toBe('low')
    expect(rateValue('b_ppm', 0.8)).toBe('marginal')
    expect(rateValue('b_ppm', 1.5)).toBe('ok')
    expect(rateValue('b_ppm', 2.5)).toBe('high')
  })

  it('rates nitrate on the profile, never on a bare core', () => {
    // lb/ac is an AMOUNT and its bands describe 0-24in. A topsoil core at
    // 9 lb/ac is not "very low" — the field total may be four times that.
    expect(rateValue('no3n_lb_ac', 9)).toBeNull()
    expect(rateProfileValue('no3n_lb_ac', 9)).toBe('low')
    // Alberta's irrigated scale: 70–100 is marginal, 100–150 adequate.
    expect(rateProfileValue('no3n_lb_ac', 75)).toBe('marginal')
    expect(rateProfileValue('no3n_lb_ac', 120)).toBe('ok')
    expect(rateProfileValue('k_ppm', 150)).toBeNull()
  })

  it('scales a nitrate core to its share of the profile', () => {
    // A 6in layer is a quarter of 24in, so it carries a quarter of each
    // threshold: 5 / 10 / 17.5 / 25 / 37.5.
    expect(rateDepthScaled('no3n_lb_ac', 9, 0, 6)).toBe('low')
    expect(rateDepthScaled('no3n_lb_ac', 20, 0, 6)).toBe('marginal')
    expect(rateDepthScaled('no3n_lb_ac', 30, 0, 6)).toBe('ok')
    // The subsoil carries three quarters of it.
    expect(rateDepthScaled('no3n_lb_ac', 80, 6, 24)).toBe('ok')
    expect(rateDepthScaled('no3n_lb_ac', 10, 6, 24)).toBe('low')
    // Only lb/ac scales this way; a concentration must not be prorated.
    expect(rateDepthScaled('so4s_ppm', 8, 0, 6)).toBeNull()
    expect(rateDepthScaled('k_ppm', 150, 0, 6)).toBeNull()
    expect(rateDepthScaled('no3n_lb_ac', 9, null, null)).toBeNull()
  })

  it('rates sulphate directly, because ppm is a concentration', () => {
    // It reads the same at either depth and is never summed between them.
    expect(rateValue('so4s_ppm', 8)).toBe('low')
    expect(rateValue('so4s_ppm', 15)).toBe('marginal')
    expect(rateValue('so4s_ppm', 30)).toBe('ok')
  })

  it('colours Mehlich-III against its own bands', () => {
    // It reads high on calcareous soil, but the bands ARE Mehlich-III bands, so
    // the colour is meaningful; the popover carries the caveat to trust Olsen.
    expect(rateValue('p_melich3_ppm', 10)).toBe('low')
    expect(rateValue('p_melich3_ppm', 25)).toBe('marginal')
    expect(rateValue('p_melich3_ppm', 40)).toBe('ok')
    expect(rateValue('p_melich3_ppm', 80)).toBe('high')
  })

  it('does not colour the context columns', () => {
    // pH, CEC and %Ca have bands worth reading but are not good or bad; every
    // row on a normal alkaline field would otherwise be flagged.
    expect(rateValue('ph', 8.1)).toBeNull()
    expect(rateValue('cec_meq', 18)).toBeNull()
    expect(rateValue('base_ca_pct', 80)).toBeNull()
  })

  it('is inclusive at a band edge rather than dropping the value', () => {
    expect(rateValue('k_ppm', 100)).toBe('low')
    expect(rateValue('k_ppm', 150)).toBe('marginal')
    expect(rateValue('k_ppm', 250)).toBe('ok')
  })

  it('returns null rather than guessing for an unbanded column or a null value', () => {
    expect(rateValue('gfi', 0)).toBeNull()
    expect(rateValue('p_bicarb_ppm', null)).toBeNull()
    expect(rateValue('p_bicarb_ppm', undefined)).toBeNull()
  })
})

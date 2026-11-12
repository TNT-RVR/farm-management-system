import { describe, expect, it } from 'vitest'
import {
  bloomLean,
  combinedFindings,
  judgeParam,
  judgeWater,
  WATER_PARAMS,
  worst,
  type WaterParam,
} from './livestock-water'

const param = (key: string) => WATER_PARAMS.find((p) => p.key === key) as WaterParam

describe('the Agdex 400/716-2 bands', () => {
  it('runs every parameter’s bands upwards and ends open', () => {
    for (const p of WATER_PARAMS) {
      const ups = p.bands.map((b) => b.upTo)
      expect([...ups].sort((a, b) => a - b), p.key).toEqual(ups)
      expect(p.bands[p.bands.length - 1].upTo, p.key).toBe(Infinity)
    }
  })

  it('reads TDS the way the chart does, class by class', () => {
    const tds = param('tds_mg_l')
    expect(judgeParam(tds, 800).grade).toBe('acceptable')
    expect(judgeParam(tds, 2500).grade).toBe('acceptable')

    // 3,001-5,000: acceptable, but calves are named.
    const mid = judgeParam(tds, 4000)
    expect(mid.grade).toBe('acceptable')
    expect(mid.byClass.dry_cow).toBe('acceptable')
    expect(mid.byClass.calf).toBe('limits')

    // 5,001-7,000: Poor, and the chart says avoid for pregnant or lactating.
    const high = judgeParam(tds, 6000)
    expect(high.grade).toBe('limits')
    expect(high.byClass.dry_cow).toBe('limits')
    expect(high.byClass.pregnant_lactating).toBe('do_not_use')

    // 7,001-10,000: older animals may subsist; not for pregnant, lactating or young.
    const veryHigh = judgeParam(tds, 9000)
    expect(veryHigh.byClass.dry_cow).toBe('limits')
    expect(veryHigh.byClass.calf).toBe('do_not_use')

    expect(judgeParam(tds, 12_000).grade).toBe('do_not_use')
  })

  it('reads sulphate the way the chart does', () => {
    const so4 = param('so4_mg_l')
    expect(judgeParam(so4, 100).grade).toBe('acceptable')
    expect(judgeParam(so4, 450).grade).toBe('acceptable')

    // 501-1,000 is acceptable overall, with calves and feedlot cattle named.
    const band = judgeParam(so4, 700)
    expect(band.grade).toBe('acceptable')
    expect(band.byClass.dry_cow).toBe('acceptable')
    expect(band.byClass.calf).toBe('limits')
    expect(band.byClass.feedlot).toBe('limits')

    expect(judgeParam(so4, 1800).grade).toBe('limits')
    expect(judgeParam(so4, 3000).grade).toBe('do_not_use')
  })

  it('reads nitrate-N against the chart’s own bands, not the 23 mg/L advice line', () => {
    const no3 = param('no3n_mg_l')
    // The chart calls 10-30 acceptable even though it recommends 23 as an
    // upper limit; the band is what is graded and the advice is a note.
    expect(judgeParam(no3, 25).grade).toBe('acceptable')
    expect(judgeParam(no3, 40).grade).toBe('limits')
    expect(judgeParam(no3, 70).grade).toBe('do_not_use')
    expect(no3.note).toMatch(/23 mg\/L/)
  })

  it('leaves the pH gap the chart leaves, and says so', () => {
    const ph = param('ph')
    expect(judgeParam(ph, 5.0).grade).toBe('do_not_use')
    expect(judgeParam(ph, 7.2).grade).toBe('acceptable')
    expect(judgeParam(ph, 9).grade).toBe('limits')
    expect(judgeParam(ph, 10.5).grade).toBe('do_not_use')
    // 5.5 to 6.5 is not a band in the publication.
    expect(judgeParam(ph, 6.0).says).toMatch(/does not grade this gap/)
  })

  it('keeps alkalinity’s mature-dry-cow exception', () => {
    const alk = judgeParam(param('alkalinity_mg_l'), 2000)
    expect(alk.grade).toBe('limits')
    expect(alk.byClass.dry_cow).toBe('acceptable')
    expect(alk.byClass.calf).toBe('do_not_use')
    expect(alk.byClass.pregnant_lactating).toBe('do_not_use')
  })
})

describe('the worst verdict wins, and nothing is added up', () => {
  it('ignores untested parameters', () => {
    expect(worst(['untested', 'acceptable', 'untested'])).toBe('acceptable')
    expect(worst(['untested'])).toBe('untested')
  })

  it('does not turn two "limits" into a "do not use"', () => {
    const j = judgeWater({ so4_mg_l: 1800, tds_mg_l: 6500 })
    expect(j.findings.every((f) => f.grade !== 'do_not_use')).toBe(true)
    expect(j.byClass.dry_cow).toBe('limits')
    // but the pregnant/lactating exception on the TDS band still bites
    expect(j.byClass.pregnant_lactating).toBe('do_not_use')
  })

  it('names what the sheet did not test rather than passing it', () => {
    const j = judgeWater({ so4_mg_l: 300 })
    expect(j.findings).toHaveLength(1)
    expect(j.untested).toContain('Total dissolved solids')
    expect(j.untested).toContain('pH')
  })

  it('takes a trace element over its maximum as limiting every class', () => {
    const j = judgeWater({ so4_mg_l: 100, mo_mg_l: 1.2 })
    expect(j.trace.find((t) => t.key === 'mo_mg_l')?.over).toBe(true)
    expect(j.byClass.dry_cow).toBe('limits')
  })

  it('grades no manganese, because the chart grades none', () => {
    const j = judgeWater({ mn_mg_l: 5 })
    expect(j.trace.some((t) => t.key === 'mn_mg_l')).toBe(false)
  })
})

describe('the combinations the chart insists on', () => {
  it('adds sodium and sulphate together', () => {
    const [f] = combinedFindings({ na_mg_l: 600, so4_mg_l: 900 })
    expect(f.key).toBe('na_so4')
    expect(f.detail).toContain('1500')
    expect(f.verdict).toBe('limits')
  })

  it('flags copper to molybdenum under 2:1', () => {
    const low = combinedFindings({ cu_mg_l: 0.2, mo_mg_l: 0.3 }).find((f) => f.key === 'cu_mo')
    expect(low?.verdict).toBe('limits')
    expect(low?.detail).toMatch(/below that/)
    const ok = combinedFindings({ cu_mg_l: 0.9, mo_mg_l: 0.3 }).find((f) => f.key === 'cu_mo')
    expect(ok?.verdict).toBe('acceptable')
  })

  it('says nothing about a combination it was given half of', () => {
    expect(combinedFindings({ na_mg_l: 600 })).toHaveLength(0)
    expect(combinedFindings({ cu_mg_l: 0.5, mo_mg_l: 0 })).toHaveLength(0)
  })
})

describe('the dugout bloom lean', () => {
  it('leans towards watching a low-sulphate, nitrogen-rich dugout', () => {
    const l = bloomLean({ so4_mg_l: 200, total_n_ug_l: 2200, mo_mg_l: 0.05 })
    expect(l.lean).toBe('watch')
    expect(l.reasons.join(' ')).toMatch(/sulphate is low/)
  })

  it('leans the other way when sulphate is high, which is the thesis’ finding', () => {
    expect(bloomLean({ so4_mg_l: 2200 }).lean).toBe('less likely')
  })

  it('knows nothing from nothing', () => {
    expect(bloomLean({}).lean).toBe('unknown')
  })

  it('reads microcystin against both Health Canada guidelines', () => {
    const l = bloomLean({ microcystin_ug_l: 25 })
    expect(l.microcystin).toEqual({ value: 25, overDrinking: true, overRecreational: true })
    const mild = bloomLean({ microcystin_ug_l: 2 })
    expect(mild.microcystin?.overDrinking).toBe(true)
    expect(mild.microcystin?.overRecreational).toBe(false)
  })
})

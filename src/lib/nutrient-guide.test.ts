import { describe, expect, it } from 'vitest'
import {
  bandFor,
  dryBeanZinc,
  guideCropFor,
  guideNutrients,
  guideRate,
  guideSoil,
  isGuideAnswer,
  softWheatN,
  type GuideSample,
} from './nutrient-guide'
import { olsenToMkLbAc, petioleNitrateBand } from './fert-savings/alberta'
import { GUIDE_TABLES, POTATO_PETIOLE, SOFT_WHEAT_N } from './nutrient-guide-data'

// These numbers are transcribed from government factsheets and then shown
// beside the lab's own recommendation, where they will be used to argue a rate
// up or down. So the things that would quietly make them wrong are held down
// here: a band that overlaps its neighbour, a rate that rises with soil test, a
// crop label matching the wrong sheet, ppm converted at the wrong depth.

const sample = (over: Partial<GuideSample> & { sample_code: string }): GuideSample => ({
  depth_top_in: 0,
  depth_bottom_in: 6,
  no3n_lb_ac: null,
  p_bicarb_ppm: null,
  k_ppm: null,
  so4s_ppm: null,
  zn_ppm: null,
  ...over,
})

describe('the transcribed tables themselves', () => {
  it('has bands that run in order and never overlap', () => {
    for (const t of GUIDE_TABLES) {
      let edge = -1
      for (const b of t.bands) {
        expect(b.from, `${t.crop} ${t.nutrient} ${t.variant}`).toBeGreaterThan(edge)
        if (b.to != null) expect(b.to, `${t.crop} ${t.nutrient} ${t.variant}`).toBeGreaterThan(b.from)
        edge = b.to == null ? Number.POSITIVE_INFINITY : b.to - 1
      }
    }
  })

  it('never recommends more fertilizer as the soil test rises', () => {
    // The whole shape of a rate table: more in the soil means less to buy. A
    // transposed cell shows up here and nowhere else.
    for (const t of GUIDE_TABLES) {
      const rates = t.bands.map((b) => b.rate).filter((r): r is number => r != null)
      for (let i = 1; i < rates.length; i++) {
        expect(rates[i], `${t.crop} ${t.nutrient} ${t.variant} band ${i}`).toBeLessThanOrEqual(
          rates[i - 1],
        )
      }
    }
  })

  it('gives every table a paper to cite', () => {
    for (const t of GUIDE_TABLES) {
      expect(t.paperId, `${t.crop} ${t.nutrient}`).toMatch(/^[0-9a-f-]{36}$/)
      expect(t.method.length).toBeGreaterThan(8)
    }
  })

  it('has exactly one main variant per crop and nutrient', () => {
    // The screen reads the main column; two would make which one it showed
    // depend on array order.
    const seen = new Map<string, number>()
    for (const t of GUIDE_TABLES.filter((x) => x.main)) {
      const key = `${t.crop} ${t.nutrient}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    for (const [key, n] of seen) expect(n, key).toBe(1)
  })
})

describe('matching a crop to a sheet', () => {
  it('knows the crops it has sheets for', () => {
    expect(guideCropFor('Barley')).toBe('barley')
    expect(guideCropFor('Beans-Pinto')).toBe('dry beans')
    expect(guideCropFor('Alfalfa Hay')).toBe('alfalfa')
    expect(guideCropFor('Winter Wheat')).toBe('winter wheat')
  })

  it('refuses a bare wheat rather than guessing which sheet', () => {
    // A soft white sheet against hard red spring wheat would be confident and
    // wrong, which is worse than showing nothing.
    expect(guideCropFor('Wheat')).toBeNull()
    expect(guideCropFor('Spring Wheat')).toBeNull()
    expect(guideCropFor('Durum Wheat')).toBeNull()
    expect(guideCropFor('Hard Red Spring Wheat')).toBeNull()
  })

  it('refuses the crops with no sheet here', () => {
    expect(guideCropFor('Canola')).toBeNull()
    expect(guideCropFor('Potato')).toBeNull()
    expect(guideCropFor('')).toBeNull()
    expect(guideCropFor(null)).toBeNull()
  })
})

describe('turning samples into the numbers a table is indexed by', () => {
  it('adds nitrate down a site and averages the sites', () => {
    const soil = guideSoil([
      sample({ sample_code: '1A', depth_top_in: 0, depth_bottom_in: 6, no3n_lb_ac: 20 }),
      sample({ sample_code: '1B', depth_top_in: 6, depth_bottom_in: 12, no3n_lb_ac: 10 }),
      sample({ sample_code: '2A', depth_top_in: 0, depth_bottom_in: 6, no3n_lb_ac: 40 }),
      sample({ sample_code: '2B', depth_top_in: 6, depth_bottom_in: 12, no3n_lb_ac: 20 }),
    ])
    // Site 1 is 30, site 2 is 60, so the field is 45.
    expect(soil['n-lb-0-12']).toBe(45)
  })

  it('leaves the deeper layer out of the shallower profile', () => {
    const samples = [
      sample({ sample_code: '1A', depth_top_in: 0, depth_bottom_in: 6, no3n_lb_ac: 20 }),
      sample({ sample_code: '1B', depth_top_in: 6, depth_bottom_in: 12, no3n_lb_ac: 10 }),
      sample({ sample_code: '1C', depth_top_in: 12, depth_bottom_in: 24, no3n_lb_ac: 15 }),
    ]
    expect(guideSoil(samples)['n-lb-0-12']).toBe(30)
    expect(guideSoil(samples)['n-lb-0-24']).toBe(45)
  })

  it('converts ppm at 2 lb per ppm per six inches, scaled by the layer', () => {
    const soil = guideSoil([
      sample({ sample_code: '1A', p_bicarb_ppm: 15, k_ppm: 180, zn_ppm: 1.2 }),
    ])
    expect(soil['k-lb-0-6']).toBe(360)
    // Zinc stays in ppm, because its table does.
    expect(soil['zn-ppm-0-6']).toBe(1.2)
  })

  it('puts phosphorus through the Olsen to modified Kelowna regression', () => {
    // The sheets' tables are modified Kelowna and our labs report Olsen, so a
    // flat ppm x 2 would read our soil as poorer in P than the table means.
    const soil = guideSoil([sample({ sample_code: '1A', p_bicarb_ppm: 15 })])
    expect(soil['p-lb-0-6']).toBeCloseTo(olsenToMkLbAc(15), 6)
    expect(soil['p-lb-0-6']).toBeGreaterThan(15 * 2)
  })

  it('counts a twelve inch sulphur layer as twelve inches of soil', () => {
    const thin = guideSoil([
      sample({ sample_code: '1A', depth_top_in: 0, depth_bottom_in: 6, so4s_ppm: 5 }),
      sample({ sample_code: '1B', depth_top_in: 6, depth_bottom_in: 12, so4s_ppm: 5 }),
    ])
    const thick = guideSoil([
      sample({ sample_code: '1A', depth_top_in: 0, depth_bottom_in: 12, so4s_ppm: 5 }),
    ])
    expect(thin['s-lb-0-12']).toBe(20)
    expect(thick['s-lb-0-12']).toBe(20)
  })

  it('reports nothing for a basis the samples do not cover', () => {
    // Missing is not zero: zero sulphate would call for 25 lb/ac.
    const soil = guideSoil([sample({ sample_code: '1A', p_bicarb_ppm: 15 })])
    expect(soil['s-lb-0-12']).toBeUndefined()
    expect(soil['n-lb-0-12']).toBeUndefined()
  })
})

describe('looking a rate up', () => {
  it('reads the band a soil test falls in', () => {
    const bands = [
      { from: 0, to: 10, rate: 60 },
      { from: 10, to: 20, rate: 50 },
      { from: 20, to: null, rate: 0 },
    ]
    expect(bandFor(bands, 0)?.rate).toBe(60)
    expect(bandFor(bands, 9.9)?.rate).toBe(60)
    expect(bandFor(bands, 10)?.rate).toBe(50)
    expect(bandFor(bands, 1000)?.rate).toBe(0)
  })

  it('gives the bean sheet rate for a bean field', () => {
    // Table 1, row cropped: 40 to 50 lb/ac of soil N wants 50 lb/ac of N.
    const soil = guideSoil([
      sample({ sample_code: '1A', depth_top_in: 0, depth_bottom_in: 6, no3n_lb_ac: 25 }),
      sample({ sample_code: '1B', depth_top_in: 6, depth_bottom_in: 12, no3n_lb_ac: 20 }),
    ])
    const got = guideRate('dry beans', 'N', soil)
    expect(isGuideAnswer(got)).toBe(true)
    if (!isGuideAnswer(got)) return
    expect(got.rate).toBe(50)
    expect(got.table.table).toBe('Table 1')
    expect(got.table.variant).toBe('Row cropped')
  })

  it('reads the irrigation column for barley, not the dryland one', () => {
    const soil = { 'n-lb-0-24': 55 }
    const got = guideRate('barley', 'N', soil)
    expect(isGuideAnswer(got) && got.rate).toBe(120)
    expect(isGuideAnswer(got) && got.table.variant).toBe('Irrigation')
  })

  it('says why there is no number instead of returning a blank', () => {
    expect(guideRate(null, 'N', {})).toEqual({ why: 'no table', crop: null })
    expect(guideRate('barley', 'Zn', {})).toEqual({ why: 'no table', crop: 'barley' })
    expect(guideRate('barley', 'N', {})).toEqual({ why: 'no sample', basis: 'n-lb-0-24' })
    const off = guideRate('barley', 'N', { 'n-lb-0-24': 400 })
    expect('why' in off && off.why).toBe('off the table')
  })

  it('knows which nutrients each crop has a sheet for', () => {
    expect(guideNutrients('dry beans').sort()).toEqual(['K2O', 'N', 'P2O5', 'S'])
    expect(guideNutrients('alfalfa').sort()).toEqual(['K2O', 'P2O5'])
    // No nitrogen table for alfalfa: the sheet says fertilizing a healthy
    // stand is not recommended, so there is nothing to show.
    expect(guideNutrients('alfalfa')).not.toContain('N')
  })
})

describe('soft white spring wheat nitrogen, which is indexed the other way', () => {
  it('works the sheet own example: 85 bu/ac intermediate on 60 lb/ac of soil N', () => {
    const got = softWheatN(85, 'intermediate', 60)
    expect(got?.totalN).toBe(150)
    expect(got?.fertilizerN).toBe(90)
  })

  it('flags a total the sheet says can push protein over 10.5 per cent', () => {
    expect(softWheatN(85, 'intermediate', 60)?.overProtein).toBe(false)
    expect(softWheatN(90, 'intermediate', 60)?.overProtein).toBe(true)
    expect(softWheatN(104, 'optimum', 0)?.overProtein).toBe(true)
  })

  it('returns nothing past the end of the table rather than extrapolating', () => {
    expect(softWheatN(120, 'optimum', 50)).toBeNull()
  })

  it('leaves the unreadable cell unreadable', () => {
    const row = SOFT_WHEAT_N.rows.find((r) => r.totalN === 70)
    expect(row?.intermediate).toBeNull()
  })
})

describe('dry bean zinc', () => {
  it('uses a different critical level on coarse soil', () => {
    expect(dryBeanZinc(1.8, false)?.rate).toBe(0)
    expect(dryBeanZinc(1.8, true)?.rate).toBe(3)
  })

  it('recommends the most on the lowest test', () => {
    expect(dryBeanZinc(0.5, false)?.rate).toBe(5)
    expect(dryBeanZinc(1.2, false)?.rate).toBe(3)
  })
})

describe('Russet Burbank petiole targets', () => {
  // The nitrate column of this table is what fert-savings/alberta.ts walks its
  // petiole bands between, so the table being complete matters beyond this file.
  it('keeps the four days the petiole bands are anchored on', () => {
    for (const dap of [60, 80, 85, 125]) {
      const row = POTATO_PETIOLE.rows.find((r) => r.dap === dap)
      expect(row, `${dap} days after planting`).toBeDefined()
      expect(petioleNitrateBand(dap)).toEqual(row!.no3n)
    }
  })

  it('keeps every row complete and the low edge under the high one', () => {
    for (const r of POTATO_PETIOLE.rows) {
      for (const k of ['no3n', 'p', 'k'] as const) {
        expect(r[k][0], `${r.dap} ${k}`).toBeLessThan(r[k][1])
      }
    }
  })

  it('steps back up at 85 days the way the sheet prints it', () => {
    // Not a transcription slip: the sheet re-fits its curves there, and a
    // "fix" that smoothed it would be inventing data.
    const at80 = POTATO_PETIOLE.rows.find((r) => r.dap === 80)!
    const at85 = POTATO_PETIOLE.rows.find((r) => r.dap === 85)!
    expect(at85.no3n[0]).toBeGreaterThan(at80.no3n[0])
  })
})

import { describe, expect, it } from 'vitest'
import {
  flaggedRepeats,
  groupRepeats,
  listNames,
  listYears,
  paperLink,
  phWeighting,
  productGroups,
  repeatPaper,
  sameSeasonOverlap,
  selfOverlap,
  shortGroupName,
  SPRAY_PAPERS,
  timeOfDayNotes,
  type FieldSoil,
  type MoaPass,
  type ProductMoa,
} from './spray-groups'

/**
 * The fixtures are the farm's own: 10-Aspen Flat really did have Cotegra,
 * Proline Gold, Prosaro Pro and Delaro Complete across 2024-2026, all Group 7;
 * Squadron is the metribuzin; the fields test pH 7.1 to 8.2.
 */

const moa = (over: Partial<ProductMoa>): ProductMoa => ({
  product_id: 'p',
  product_name: 'Product',
  active: 'ACTIVE',
  scheme: 'herbicide',
  group_code: '9',
  group_name: 'EPSPS inhibitor',
  ph_sensitive: false,
  time_of_day: null,
  group_note: null,
  ...over,
})

const sdhi = (id: string, name: string, active: string) =>
  moa({ product_id: id, product_name: name, active, scheme: 'fungicide', group_code: '7', group_name: 'SDHI (succinate dehydrogenase inhibitor)' })
const dmi = (id: string, name: string) =>
  moa({ product_id: id, product_name: name, active: 'PROTHIOCONAZOLE', scheme: 'fungicide', group_code: '3', group_name: 'DMI (sterol biosynthesis inhibitor)' })

const PRODUCTS: ProductMoa[] = [
  sdhi('cotegra', 'Cotegra', 'BOSCALID'),
  dmi('cotegra', 'Cotegra'),
  sdhi('delaro', 'Delaro Complete', 'FLUOPYRAM'),
  dmi('delaro', 'Delaro Complete'),
  moa({ product_id: 'delaro', product_name: 'Delaro Complete', active: 'TRIFLOXYSTROBIN', scheme: 'fungicide', group_code: '11', group_name: 'QoI (strobilurin)' }),
  sdhi('priaxor', 'Priaxor 9.6L', 'FLUXAPYROXAD'),
  moa({ product_id: 'roundup', product_name: 'Roundup', active: 'GLYPHOSATE' }),
  moa({ product_id: 'transorb', product_name: 'Roundup Transorb HC', active: 'GLYPHOSATE' }),
  moa({
    product_id: 'squadron',
    product_name: 'Squadron',
    active: 'METRIBUZIN',
    group_code: '5',
    group_name: 'Photosystem II inhibitor (triazinone)',
    ph_sensitive: true,
  }),
  moa({
    product_id: 'liberty',
    product_name: 'Liberty',
    active: 'GLUFOSINATE-AMMONIUM',
    group_code: '10',
    group_name: 'Glutamine synthetase inhibitor',
    time_of_day: 'Spray it in the middle of the day.',
  }),
  // A made-up jug carrying two of one group, to prove the self-overlap rule.
  sdhi('double', 'Double Seven', 'BOSCALID'),
  sdhi('double', 'Double Seven', 'FLUOPYRAM'),
]

const pass = (over: Partial<MoaPass>): MoaPass => ({
  field_id: 'jensen',
  crop_season: 2024,
  applied_on: '2024-07-07',
  operation_id: 'op1',
  product_id: 'proline',
  product_name: 'Proline Gold',
  active: 'FLUOPYRAM',
  scheme: 'fungicide',
  group_code: '7',
  group_name: 'SDHI (succinate dehydrogenase inhibitor)',
  ...over,
})

/** Three seasons of Group 7 on Aspen Flat under four trade names. */
const JENSEN: MoaPass[] = [
  pass({ operation_id: 'o1', crop_season: 2024, applied_on: '2024-07-07', product_id: 'proline', product_name: 'Proline Gold' }),
  pass({ operation_id: 'o2', crop_season: 2024, applied_on: '2024-07-20', product_id: 'cotegra', product_name: 'Cotegra', active: 'BOSCALID' }),
  pass({ operation_id: 'o3', crop_season: 2025, applied_on: '2025-07-31', product_id: 'prosaro', product_name: 'Prosaro Pro' }),
  pass({ operation_id: 'o4', crop_season: 2026, applied_on: '2026-07-22', product_id: 'delaro', product_name: 'Delaro Complete' }),
]

describe('productGroups', () => {
  it('lists one row per group, not per active', () => {
    const got = productGroups(PRODUCTS, 'delaro')
    expect(got.map((g) => g.group_code).sort()).toEqual(['11', '3', '7'])
  })

  it('folds two actives of one group into one row', () => {
    const got = productGroups(PRODUCTS, 'double')
    expect(got).toHaveLength(1)
    expect(got[0].active).toBe('BOSCALID and fluopyram')
  })

  it('is empty for a product with nothing known', () => {
    expect(productGroups(PRODUCTS, 'crimson')).toEqual([])
    expect(productGroups(PRODUCTS, null)).toEqual([])
  })
})

describe('selfOverlap', () => {
  it('catches one jug carrying a group twice', () => {
    const got = selfOverlap(PRODUCTS, 'double')
    expect(got).toHaveLength(1)
    expect(got[0].group_code).toBe('7')
    expect(got[0].active).toBe('BOSCALID and FLUOPYRAM')
  })

  it('says nothing about a three-way mix of three groups', () => {
    expect(selfOverlap(PRODUCTS, 'delaro')).toEqual([])
  })
})

describe('groupRepeats', () => {
  it('counts seasons, not passes, and names every trade name', () => {
    const groups = productGroups(PRODUCTS, 'priaxor')
    const [g7] = groupRepeats(JENSEN, { fieldId: 'jensen', groups, season: 2027 })
    expect(g7.groupCode).toBe('7')
    expect(g7.seasons).toEqual([2024, 2025, 2026])
    expect(g7.passes).toBe(4)
    expect(g7.wouldBeSeason).toBe(4)
    expect(g7.products).toEqual(['Cotegra', 'Delaro Complete', 'Proline Gold', 'Prosaro Pro'])
  })

  it('does not double-count the season being sprayed, and says so', () => {
    const groups = productGroups(PRODUCTS, 'priaxor')
    const [g7] = groupRepeats(JENSEN, { fieldId: 'jensen', groups, season: 2026 })
    expect(g7.wouldBeSeason).toBe(3)
    // 2026 has already had Group 7, so this is still the third season rather
    // than a third one about to happen.
    expect(g7.alreadyThisSeason).toBe(true)
  })

  it('marks a season the field has not had this group in', () => {
    const groups = productGroups(PRODUCTS, 'priaxor')
    const [g7] = groupRepeats(JENSEN, { fieldId: 'jensen', groups, season: 2027 })
    expect(g7.alreadyThisSeason).toBe(false)
  })

  it('ignores another field entirely', () => {
    const groups = productGroups(PRODUCTS, 'priaxor')
    const [g7] = groupRepeats(JENSEN, { fieldId: 'creek flat', groups, season: 2026 })
    expect(g7.seasons).toEqual([])
    expect(g7.wouldBeSeason).toBe(1)
  })

  it('flags the third season and keeps quiet about the first and second', () => {
    const groups = productGroups(PRODUCTS, 'priaxor')
    const two = JENSEN.filter((p) => p.crop_season !== 2026)
    expect(flaggedRepeats(groupRepeats(two, { fieldId: 'jensen', groups, season: 2026 }))).toHaveLength(1)
    const one = JENSEN.filter((p) => p.crop_season === 2024)
    expect(flaggedRepeats(groupRepeats(one, { fieldId: 'jensen', groups, season: 2026 }))).toEqual([])
  })

  it('counts a burn-off and an in-crop pass of one group as one season', () => {
    const groups = productGroups(PRODUCTS, 'roundup')
    const twice: MoaPass[] = [
      pass({ operation_id: 'g1', crop_season: 2026, applied_on: '2026-04-30', product_id: 'transorb', product_name: 'Roundup Transorb HC', active: 'GLYPHOSATE', scheme: 'herbicide', group_code: '9', group_name: 'EPSPS inhibitor', field_id: 'f0' }),
      pass({ operation_id: 'g2', crop_season: 2026, applied_on: '2026-07-18', product_id: 'transorb', product_name: 'Roundup Transorb HC', active: 'GLYPHOSATE', scheme: 'herbicide', group_code: '9', group_name: 'EPSPS inhibitor', field_id: 'f0' }),
    ]
    const [g9] = groupRepeats(twice, { fieldId: 'f0', groups, season: 2026 })
    expect(g9.passes).toBe(2)
    expect(g9.wouldBeSeason).toBe(1)
    expect(flaggedRepeats([g9])).toEqual([])
  })
})

describe('sameSeasonOverlap', () => {
  it('names the other Group 7 product already on the field this season', () => {
    const groups = productGroups(PRODUCTS, 'cotegra')
    const got = sameSeasonOverlap(JENSEN, { fieldId: 'jensen', groups, season: 2026, productId: 'cotegra' })
    const g7 = got.find((o) => o.groupCode === '7')
    expect(g7?.already.map((a) => a.product)).toEqual(['Delaro Complete'])
    expect(g7?.already[0].active).toBe('fluopyram')
  })

  it('says nothing about the same product sprayed twice', () => {
    const groups = productGroups(PRODUCTS, 'delaro')
    const got = sameSeasonOverlap(JENSEN, { fieldId: 'jensen', groups, season: 2026, productId: 'delaro' })
    expect(got).toEqual([])
  })

  it('does not reach across seasons', () => {
    const groups = productGroups(PRODUCTS, 'priaxor')
    expect(sameSeasonOverlap(JENSEN, { fieldId: 'jensen', groups, season: 2027, productId: 'priaxor' })).toEqual([])
  })

  it('reports only the groups that actually overlap', () => {
    // Cotegra is Group 7 and Group 3; Jensen's history here is Group 7 only.
    const groups = productGroups(PRODUCTS, 'cotegra')
    expect(groups.map((g) => g.group_code).sort()).toEqual(['3', '7'])
    const got = sameSeasonOverlap(JENSEN, { fieldId: 'jensen', groups, season: 2026, productId: 'cotegra' })
    expect(got.map((o) => o.groupCode)).toEqual(['7'])
  })
})

describe('repeatPaper', () => {
  it('cites the SDHI cross-resistance work for Group 7 fungicides', () => {
    expect(repeatPaper('fungicide', '7')).toBe(SPRAY_PAPERS.sdhiCrossResistance)
  })
  it('cites the Canadian downy brome report for Group 9', () => {
    expect(repeatPaper('herbicide', '9')).toBe(SPRAY_PAPERS.downyBrome)
  })
  it('cites the Alberta wild oat work for Groups 1, 2, 14 and 15', () => {
    for (const g of ['1', '2', '14', '15']) {
      expect(repeatPaper('herbicide', g)).toBe(SPRAY_PAPERS.triallateWildOat)
    }
  })
  it('falls back to the general resistance review', () => {
    expect(repeatPaper('insecticide', '3A')).toBe(SPRAY_PAPERS.resistanceManagement)
  })
})

const soil = (over: Partial<FieldSoil> = {}): FieldSoil => ({
  field_id: 'f',
  crop_year: 2026,
  ph: 8,
  ph_max: 8.2,
  om_pct: 1.9,
  samples: 3,
  ...over,
})

describe('phWeighting', () => {
  const metribuzin = productGroups(PRODUCTS, 'squadron')

  it('speaks up on pH 8 ground and cites the metribuzin plant-back work', () => {
    const got = phWeighting(metribuzin, soil())
    expect(got?.level).toBe('high')
    expect(got?.lowOm).toBe(true)
    expect(got?.paper).toBe(SPRAY_PAPERS.metribuzinPlantBack)
    expect(got?.actives).toEqual(['metribuzin'])
  })

  it('still speaks at 7.5, more softly', () => {
    expect(phWeighting(metribuzin, soil({ ph: 7.5, om_pct: 2.9 }))?.level).toBe('raised')
    expect(phWeighting(metribuzin, soil({ ph: 7.5, om_pct: 2.9 }))?.lowOm).toBe(false)
  })

  it('is silent below 7.5, and silent with no soil test', () => {
    expect(phWeighting(metribuzin, soil({ ph: 7.1 }))).toBeNull()
    expect(phWeighting(metribuzin, soil({ ph: null }))).toBeNull()
    expect(phWeighting(metribuzin, undefined)).toBeNull()
  })

  it('is silent for a product whose carryover pH does not move', () => {
    expect(phWeighting(productGroups(PRODUCTS, 'roundup'), soil())).toBeNull()
    expect(phWeighting(productGroups(PRODUCTS, 'delaro'), soil())).toBeNull()
  })

  it('cites the sugar-beet bioassay for a Group 14 residue', () => {
    const authority = [moa({ product_id: 'authority', product_name: 'Authority 480', active: 'SULFENTRAZONE', group_code: '14', group_name: 'Protoporphyrinogen oxidase inhibitor', ph_sensitive: true })]
    expect(phWeighting(productGroups(authority, 'authority'), soil())?.paper).toBe(SPRAY_PAPERS.sugarBeetBioassay)
  })
})

describe('timeOfDayNotes', () => {
  it('speaks for glufosinate', () => {
    const got = timeOfDayNotes(productGroups(PRODUCTS, 'liberty'))
    expect(got).toHaveLength(1)
    expect(got[0].active).toBe('glufosinate-ammonium')
    expect(got[0].paper).toBe(SPRAY_PAPERS.glufosinateTimeOfDay)
  })

  it('says nothing for everything else', () => {
    expect(timeOfDayNotes(productGroups(PRODUCTS, 'roundup'))).toEqual([])
    expect(timeOfDayNotes(productGroups(PRODUCTS, 'delaro'))).toEqual([])
  })
})

describe('paperLink', () => {
  it('opens the library search on the paper', () => {
    expect(paperLink(SPRAY_PAPERS.downyBrome)).toBe(
      '/research?tab=search&q=glyphosate-resistant%20downy%20brome',
    )
  })
})

describe('listYears and listNames', () => {
  it('reads as a sentence', () => {
    expect(listYears([2024])).toBe('2024')
    expect(listYears([2024, 2025])).toBe('2024 and 2025')
    expect(listYears([2024, 2025, 2026])).toBe('2024, 2025 and 2026')
    expect(listYears([])).toBe('')
    expect(listNames(['Cotegra', 'Delaro Complete'])).toBe('Cotegra and Delaro Complete')
  })
})

describe('shortGroupName', () => {
  it('drops the chemical family so the sentence does not nest brackets', () => {
    expect(shortGroupName('SDHI (succinate dehydrogenase inhibitor)')).toBe('SDHI')
    expect(shortGroupName('ALS inhibitor (sulfonylurea)')).toBe('ALS inhibitor')
    expect(shortGroupName('Multi-site (copper)')).toBe('Multi-site')
  })

  it('leaves a name that has no bracket alone', () => {
    expect(shortGroupName('EPSPS inhibitor')).toBe('EPSPS inhibitor')
  })
})

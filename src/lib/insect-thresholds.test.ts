import { describe, expect, it } from 'vitest'
import {
  LYGUS_CANOLA_COST_PER_HA,
  LYGUS_CANOLA_K,
  LYGUS_CANOLA_PRICE_PER_T,
  LYGUS_CANOLA_TABLE,
  THRESHOLD_PESTS,
  assess,
  hasThreshold,
  lygusCanolaThreshold,
  thresholdCrop,
  unitFor,
  usesStage,
  type PestInput,
} from './insect-thresholds'

const input = (over: Partial<PestInput>): PestInput => ({
  pest: 'Lygus bugs',
  crop: 'canola',
  stage: 'late_flower',
  count: null,
  ...over,
})

describe('thresholdCrop', () => {
  it('keeps alfalfa grown for seed apart from alfalfa hay', () => {
    expect(thresholdCrop('Alfalfa Seed')).toBe('alfalfa_seed')
    expect(thresholdCrop('Alfalfa')).toBe('other')
  })

  it('reads the farm’s own crop names', () => {
    expect(thresholdCrop('BASF Canola')).toBe('canola')
    expect(thresholdCrop('Seed Canola (company not chosen)')).toBe('canola')
    expect(thresholdCrop('Durum Wheat')).toBe('wheat')
    expect(thresholdCrop('Potato-Chipper')).toBe('potato')
    expect(thresholdCrop('Sainfoin')).toBe('other')
    expect(thresholdCrop(null)).toBe('other')
  })
})

describe('the lygus table, as printed', () => {
  it('is the shape of Alberta’s Table 1', () => {
    for (const stage of ['late_flower', 'pod_ripening'] as const) {
      expect(LYGUS_CANOLA_TABLE[stage]).toHaveLength(LYGUS_CANOLA_COST_PER_HA.length)
      for (const row of LYGUS_CANOLA_TABLE[stage]) expect(row).toHaveLength(LYGUS_CANOLA_PRICE_PER_T.length)
    }
  })

  it('rises with the cost of the pass and falls as canola gets dearer', () => {
    for (const stage of ['late_flower', 'pod_ripening'] as const) {
      const t = LYGUS_CANOLA_TABLE[stage]
      for (let c = 0; c < LYGUS_CANOLA_PRICE_PER_T.length; c++) {
        for (let r = 1; r < t.length; r++) expect(t[r][c]).toBeGreaterThanOrEqual(t[r - 1][c])
      }
      for (const row of t) {
        for (let c = 1; c < row.length; c++) expect(row[c]).toBeLessThanOrEqual(row[c - 1])
      }
    }
  })

  it('tolerates more lygus at pod ripening than at the end of flowering', () => {
    for (let r = 0; r < LYGUS_CANOLA_COST_PER_HA.length; r++) {
      for (let c = 0; c < LYGUS_CANOLA_PRICE_PER_T.length; c++) {
        expect(LYGUS_CANOLA_TABLE.pod_ripening[r][c]).toBeGreaterThan(LYGUS_CANOLA_TABLE.late_flower[r][c])
      }
    }
  })

  it('reproduces the sheet’s own worked example: $26/ha and $260/t gives 14', () => {
    expect(lygusCanolaThreshold('late_flower', 26, 260).threshold).toBe(14)
  })

  it('snaps to the nearest printed row rather than interpolating', () => {
    const r = lygusCanolaThreshold('late_flower', 25.4, 255)
    expect(r.basis).toBe('table')
    expect(r.costPerHa).toBe(26)
    expect(r.pricePerTonne).toBe(260)
    expect(r.threshold).toBe(14)
  })

  it('returns the printed cell for every printed cost and price', () => {
    for (const stage of ['late_flower', 'pod_ripening'] as const) {
      LYGUS_CANOLA_COST_PER_HA.forEach((cost, r) => {
        LYGUS_CANOLA_PRICE_PER_T.forEach((price, c) => {
          const got = lygusCanolaThreshold(stage, cost, price)
          expect(got.basis, `${stage} ${cost}/${price}`).toBe('table')
          expect(got.threshold, `${stage} ${cost}/${price}`).toBe(LYGUS_CANOLA_TABLE[stage][r][c])
        })
      })
    }
  })

  /**
   * The claim that lets a 1999 table be used against a 2026 price: the sheet
   * is threshold = k x cost/price. If this ever stops holding, the extension
   * past $300 a tonne is no longer Alberta's arithmetic and must not be used.
   */
  it('is a ratio law, and k reproduces the printed table', () => {
    for (const stage of ['late_flower', 'pod_ripening'] as const) {
      LYGUS_CANOLA_COST_PER_HA.forEach((cost, r) => {
        LYGUS_CANOLA_PRICE_PER_T.forEach((price, c) => {
          const law = Math.round((LYGUS_CANOLA_K[stage] * cost) / price)
          expect(Math.abs(law - LYGUS_CANOLA_TABLE[stage][r][c]), `${stage} ${cost}/${price}`).toBeLessThanOrEqual(1)
        })
      })
    }
  })

  it('reproduces the pod-ripening table exactly, with no rounding slack', () => {
    LYGUS_CANOLA_COST_PER_HA.forEach((cost, r) => {
      LYGUS_CANOLA_PRICE_PER_T.forEach((price, c) => {
        expect(Math.round((200 * cost) / price)).toBe(LYGUS_CANOLA_TABLE.pod_ripening[r][c])
      })
    })
  })

  it('carries the law past the end of the sheet instead of clamping', () => {
    // This farm's own 2026 canola price, about $790 a tonne.
    const r = lygusCanolaThreshold('late_flower', 30, 792)
    expect(r.basis).toBe('ratio')
    expect(r.threshold).toBe(5)
    expect(r.threshold).toBeLessThan(LYGUS_CANOLA_TABLE.late_flower[4][2])
  })

  it('never asks for fewer than one lygus, however dear the canola', () => {
    expect(lygusCanolaThreshold('late_flower', 5, 5000).threshold).toBe(1)
  })

  it('falls back to the middle of the table rather than dividing by zero', () => {
    expect(lygusCanolaThreshold('late_flower', 26, 0).threshold).toBe(14)
    expect(lygusCanolaThreshold('late_flower', 0, 260).threshold).toBe(14)
  })
})

describe('lygus in canola', () => {
  it('does not spray at bud, and says the research found yields unharmed', () => {
    const a = assess(input({ stage: 'bud_bloom', count: 40 }))!
    expect(a.verdict).toBe('do_not_spray')
    expect(a.threshold).toBeNull()
    expect(a.reasons.join(' ')).toMatch(/counter-productive/)
    expect(a.sources.map((s) => s.year)).toContain(2001)
  })

  it('still does not spray at bud however many were counted', () => {
    for (const count of [0, 5, 50, 500]) {
      expect(assess(input({ stage: 'bud_bloom', count }))!.verdict).toBe('do_not_spray')
    }
  })

  it('asks for the cost and the price before it will give a number', () => {
    const a = assess(input({ count: 20 }))!
    expect(a.verdict).toBe('none')
    expect(a.reasons.join(' ')).toMatch(/moves with what the pass costs/)
  })

  it('compares the count once it has both', () => {
    expect(assess(input({ count: 13, costPerHa: 26, pricePerTonne: 260 }))!.verdict).toBe('below')
    expect(assess(input({ count: 14, costPerHa: 26, pricePerTonne: 260 }))!.verdict).toBe('at_or_over')
    expect(assess(input({ count: 20, costPerHa: 26, pricePerTonne: 260 }))!.verdict).toBe('at_or_over')
  })

  it('needs more lygus to justify a pass at pod ripening than at late flower', () => {
    const at = (stage: 'late_flower' | 'pod_ripening') =>
      assess(input({ stage, count: 18, costPerHa: 26, pricePerTonne: 260 }))!
    expect(at('late_flower').verdict).toBe('at_or_over')
    expect(at('pod_ripening').verdict).toBe('below')
  })

  it('stops once the seed is firm and colouring', () => {
    const a = assess(input({ stage: 'preharvest', count: 60, costPerHa: 26, pricePerTonne: 260 }))!
    expect(a.verdict).toBe('do_not_spray')
    expect(a.reasons.join(' ')).toMatch(/firm and turning yellow or brown/)
  })

  it('counts in ten-sweep samples, not single sweeps', () => {
    expect(unitFor('Lygus bugs', 'canola')).toBe('per_sample_10_sweeps')
  })
})

describe('the same insect, the other crop', () => {
  it('sprays lygus at bud in alfalfa grown for seed, where canola would not', () => {
    const seed = assess(input({ crop: 'alfalfa_seed', stage: 'bud_bloom', count: 3 }))!
    expect(seed.verdict).toBe('at_or_over')
    expect(seed.threshold).toBe(2)
    expect(assess(input({ crop: 'canola', stage: 'bud_bloom', count: 3 }))!.verdict).toBe('do_not_spray')
  })

  it('counts alfalfa seed lygus per single sweep', () => {
    expect(unitFor('Lygus bugs', 'alfalfa_seed')).toBe('per_sweep')
  })

  it('loosens the alfalfa seed threshold after bloom', () => {
    expect(assess(input({ crop: 'alfalfa_seed', stage: 'bud_bloom', count: 3 }))!.verdict).toBe('at_or_over')
    expect(assess(input({ crop: 'alfalfa_seed', stage: 'late_flower', count: 3 }))!.verdict).toBe('below')
    expect(assess(input({ crop: 'alfalfa_seed', stage: 'late_flower', count: 4 }))!.verdict).toBe('at_or_over')
  })

  it('has nothing to say before bud', () => {
    expect(assess(input({ crop: 'alfalfa_seed', stage: 'early', count: 9 }))!.verdict).toBe('wrong_stage')
  })
})

describe('the other alfalfa seed pests', () => {
  it('holds the alfalfa plant bug at 2 then 5 per sweep', () => {
    const at = (stage: PestInput['stage'], count: number) =>
      assess(input({ pest: 'Alfalfa plant bug', crop: 'alfalfa_seed', stage, count }))!.verdict
    expect(at('bud_bloom', 2)).toBe('at_or_over')
    expect(at('late_flower', 4)).toBe('below')
    expect(at('late_flower', 5)).toBe('at_or_over')
  })

  it('takes 150 pea aphids and 20 weevils per sweep', () => {
    const v = (pest: string, count: number) => assess(input({ pest, crop: 'alfalfa_seed', count }))!
    expect(v('Pea aphid', 149).verdict).toBe('below')
    expect(v('Pea aphid', 150).verdict).toBe('at_or_over')
    expect(v('Alfalfa weevil', 19).verdict).toBe('below')
    expect(v('Alfalfa weevil', 20).verdict).toBe('at_or_over')
  })
})

describe('cabbage seedpod weevil', () => {
  it('is carried as provisional, on the paper’s own say-so', () => {
    const a = assess(input({ pest: 'Cabbage seedpod weevil', count: 5 }))!
    expect(a.provisional).toBe(true)
    expect(a.verdict).toBe('at_or_over')
    expect(a.reasons.join(' ')).toMatch(/not verified by empirical research/)
  })

  it('warns that the unit itself is ambiguous in the source', () => {
    expect(assess(input({ pest: 'Cabbage seedpod weevil', count: 1 }))!.reasons.join(' ')).toMatch(/tenfold/)
  })
})

describe('usesStage', () => {
  it('is true where the stage changes the answer', () => {
    expect(usesStage('Lygus bugs', 'canola')).toBe(true)
    expect(usesStage('Lygus bugs', 'alfalfa_seed')).toBe(true)
    expect(usesStage('Wheat midge', 'wheat')).toBe(true)
  })

  it('is false for sawfly, which has no spray to time, and psyllid, which has no threshold', () => {
    expect(usesStage('Wheat stem sawfly', 'wheat')).toBe(false)
    expect(usesStage('Potato psyllid', 'potato')).toBe(false)
  })

  it('is false for a pest it does not know', () => {
    expect(usesStage('Grasshoppers', 'wheat')).toBe(false)
  })
})

describe('an empty box', () => {
  it('does not read as "under the threshold" before anything is counted', () => {
    const a = assess(input({ count: null, costPerHa: 26, pricePerTonne: 260 }))!
    expect(a.verdict).toBe('uncounted')
    // The threshold is still worked out, so the screen can say what to aim at.
    expect(a.threshold).toBe(14)
    expect(a.reasons.join(' ')).toMatch(/Enter what you counted/)
  })

  it('is uncounted for every pest that compares a number', () => {
    for (const [pest, crop] of [
      ['Lygus bugs', 'alfalfa_seed'],
      ['Alfalfa plant bug', 'alfalfa_seed'],
      ['Pea aphid', 'alfalfa_seed'],
      ['Alfalfa weevil', 'alfalfa_seed'],
      ['Cabbage seedpod weevil', 'canola'],
      ['Wheat midge', 'wheat'],
    ] as const) {
      expect(assess(input({ pest, crop, stage: 'late_flower', count: null }))!.verdict, `${pest} in ${crop}`).toBe('uncounted')
    }
  })
})

describe('wheat midge', () => {
  const midge = (over: Partial<PestInput>) => assess(input({ pest: 'Wheat midge', crop: 'wheat', ...over }))!

  it('counts down: fewer heads per midge is worse', () => {
    expect(midge({ count: 3 }).verdict).toBe('at_or_over')
    expect(midge({ count: 4 }).verdict).toBe('at_or_over')
    expect(midge({ count: 12 }).verdict).toBe('below')
  })

  it('is stricter when the crop is being grown for a No. 1 grade', () => {
    expect(midge({ count: 8, gradeTarget: false }).verdict).toBe('below')
    expect(midge({ count: 8, gradeTarget: true }).verdict).toBe('at_or_over')
    expect(midge({ count: 8, gradeTarget: true }).threshold).toBe(9)
    expect(midge({ count: 8, gradeTarget: false }).threshold).toBe(4)
  })

  it('tells you the yield cost of leaving it', () => {
    expect(midge({ count: 4 }).reasons.join(' ')).toMatch(/15%/)
  })

  it('carries the spray timing, because the product decides it', () => {
    expect(midge({ count: 4 }).reasons.join(' ')).toMatch(/within 24 hours.*four days/s)
  })

  it('refuses once flowering is past, to spare the parasite', () => {
    const a = midge({ stage: 'preharvest', count: 2 })
    expect(a.verdict).toBe('do_not_spray')
    expect(a.reasons.join(' ')).toMatch(/Macroglenes penetrans/)
  })

  it('waits for heading', () => {
    expect(midge({ stage: 'early', count: 2 }).verdict).toBe('wrong_stage')
  })
})

describe('wheat stem sawfly', () => {
  const sawfly = (count: number | null) => assess(input({ pest: 'Wheat stem sawfly', crop: 'wheat', stage: 'preharvest', count }))!

  it('is never a spray', () => {
    for (const count of [null, 5, 12, 40]) expect(sawfly(count).verdict).toBe('not_a_spray')
  })

  it('sends you to the swather above 15% of stems', () => {
    expect(sawfly(40).reasons.join(' ')).toMatch(/[Ss]wath rather than straight cut/)
  })

  it('changes next year’s variety between 10 and 15%', () => {
    expect(sawfly(12).reasons.join(' ')).toMatch(/solid-stem variety next year/)
    expect(sawfly(4).reasons.join(' ')).toMatch(/below the 10%/)
  })
})

describe('where nothing is published', () => {
  it('says so for potato psyllid, and says what to do instead', () => {
    const a = assess(input({ pest: 'Potato psyllid', crop: 'potato', count: 30 }))!
    expect(a.verdict).toBe('none')
    expect(a.threshold).toBeNull()
    expect(a.reasons.join(' ')).toMatch(/bugs\.r\.us@gov\.ab\.ca/)
  })

  it('stays silent rather than guessing for a pest or crop it does not know', () => {
    expect(assess(input({ pest: 'Flea beetles' }))).toBeNull()
    expect(assess(input({ pest: 'Kochia', crop: 'other' }))).toBeNull()
    expect(assess(input({ pest: 'Wheat midge', crop: 'potato' }))).toBeNull()
    expect(hasThreshold('Grasshoppers', 'wheat')).toBe(false)
    expect(unitFor('Grasshoppers', 'wheat')).toBeNull()
  })

  it('every pest it lists can actually be assessed', () => {
    for (const [crop, pests] of Object.entries(THRESHOLD_PESTS)) {
      for (const pest of pests) {
        expect(hasThreshold(pest, crop as PestInput['crop']), `${pest} in ${crop}`).toBe(true)
        expect(assess(input({ pest, crop: crop as PestInput['crop'], count: 1 })), `${pest} in ${crop}`).not.toBeNull()
      }
    }
  })

  it('names a source on every answer it gives', () => {
    for (const [crop, pests] of Object.entries(THRESHOLD_PESTS)) {
      for (const pest of pests) {
        const a = assess(input({ pest, crop: crop as PestInput['crop'], count: 2, costPerHa: 26, pricePerTonne: 260 }))!
        expect(a.sources.length, `${pest} in ${crop}`).toBeGreaterThan(0)
        expect(a.reasons.length, `${pest} in ${crop}`).toBeGreaterThan(0)
      }
    }
  })
})

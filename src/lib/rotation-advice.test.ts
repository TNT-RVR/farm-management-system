import { describe, expect, it } from 'vitest'
import {
  adviseCell,
  adviseCrop,
  rankCrops,
  repeatQuestion,
  type AdviceInput,
} from './rotation-advice'
import { buildSuccessionMap, buildSuccessionNotes, type CropInfo } from './rotation'

const crop = (id: string, name: string, extra: Partial<CropInfo> = {}): CropInfo => ({
  id,
  name,
  min_return_years: 0,
  max_in_a_row: 1,
  stand_max_years: null,
  color: null,
  ...extra,
})

const canola = crop('canola', 'Canola', { min_return_years: 4 })
const wheat = crop('wheat', 'Durum Wheat', { min_return_years: 1 })
const corn = crop('corn', 'Grain Corn')
const sainfoin = crop('sainfoin', 'Sainfoin')
const crops = [canola, wheat, corn, sainfoin]
const cropMap = new Map(crops.map((c) => [c.id, c]))

const rules = [
  {
    prev_crop_id: 'wheat',
    next_crop_id: 'canola',
    preference: 'recommended',
    notes: 'Cereal then oilseed.',
    source: 'farm',
  },
  {
    prev_crop_id: 'wheat',
    next_crop_id: 'corn',
    preference: 'possible',
    notes: null,
    source: 'farm',
  },
  {
    prev_crop_id: 'canola',
    next_crop_id: 'canola',
    preference: 'no_go',
    notes: 'Clubroot.',
    source: 'farm',
  },
] as unknown as Parameters<typeof buildSuccessionMap>[0]

const input = (sets: [number, string[]][], over: Partial<AdviceInput> = {}): AdviceInput => ({
  year: 2027,
  cropSets: new Map(sets.map(([y, ids]) => [y, new Set(ids)])),
  crops,
  cropMap,
  succession: buildSuccessionMap(rules),
  notes: buildSuccessionNotes(rules),
  ...over,
})

describe('what the app makes of one crop', () => {
  it('recommends the sheet’s own answer after last year', () => {
    const a = adviseCrop('canola', input([[2026, ['wheat']]]))
    expect(a.verdict).toBe('recommended')
    expect(a.reasons[0]).toContain('recommends it after Durum Wheat')
    expect(a.reasons[0]).toContain('Cereal then oilseed.')
  })

  it('refuses what the sheet says never', () => {
    const a = adviseCrop('canola', input([[2026, ['canola']]]))
    expect(a.verdict).toBe('no_go')
    expect(a.reasons.some((r) => r.includes('never after Canola'))).toBe(true)
  })

  it('counts the seasons since the field carried it', () => {
    const a = adviseCrop(
      'canola',
      input([
        [2024, ['canola']],
        [2026, ['wheat']],
      ]),
    )
    expect(a.sinceGrown).toBe(3)
    expect(a.reasons.some((r) => r.includes('3 seasons ago'))).toBe(true)
  })

  it('says so when the field has not carried it at all', () => {
    const a = adviseCrop('sainfoin', input([[2026, ['wheat']]]))
    expect(a.sinceGrown).toBeNull()
    expect(a.reasons.some((r) => r.includes('not carried it'))).toBe(true)
  })

  it('says when there is nothing to follow', () => {
    const a = adviseCrop('corn', input([]))
    expect(a.reasons.some((r) => r.includes('nothing for it to follow'))).toBe(true)
  })
})

describe('ranking the crops for a field-year', () => {
  it('puts the recommended one first', () => {
    const ranked = rankCrops(input([[2026, ['wheat']]]))
    expect(ranked[0].cropId).toBe('canola')
  })

  it('drops a crop back when its own return interval is not up', () => {
    // Canola is recommended after wheat, but it was here two years ago and
    // its return interval is four, so it is no longer the first answer.
    const ranked = rankCrops(
      input([
        [2026, ['wheat']],
        [2025, ['canola']],
      ]),
    )
    expect(ranked[0].cropId).not.toBe('canola')
    expect(ranked.find((a) => a.cropId === 'canola')!.verdict).not.toBe('recommended')
  })

  it('breaks a tie on the longest since the field carried it', () => {
    const ranked = rankCrops(
      input([
        [2026, ['sainfoin']],
        [2025, ['corn']],
      ]),
    )
    const names = ranked.map((a) => a.cropId)
    // Corn was here two years ago, wheat and canola never: both beat corn.
    expect(names.indexOf('corn')).toBeGreaterThan(names.indexOf('wheat'))
  })
})

describe('the advice behind a cell', () => {
  it('judges what is ticked and offers a better one that is not', () => {
    const a = adviseCell(['corn'], input([[2026, ['wheat']]]))
    expect(a.picked).toHaveLength(1)
    expect(a.bestPicked?.cropId).toBe('corn')
    expect(a.alsoConsider?.cropId).toBe('canola')
  })

  it('offers nothing when the ticked crop is already the best', () => {
    const a = adviseCell(['canola'], input([[2026, ['wheat']]]))
    expect(a.alsoConsider).toBeNull()
  })

  it('offers one when nothing is ticked at all', () => {
    const a = adviseCell([], input([[2026, ['wheat']]]))
    expect(a.bestPicked).toBeNull()
    expect(a.alsoConsider?.cropId).toBe('canola')
  })

  it('never offers a crop that breaks a rule', () => {
    const a = adviseCell([], input([[2026, ['canola']]]))
    expect(a.alsoConsider?.cropId).not.toBe('canola')
  })
})

describe('the same crop two years running', () => {
  it('asks when the rules say no', () => {
    const q = repeatQuestion(
      'canola',
      input([
        [2026, ['canola']],
        [2025, ['wheat']],
      ]),
    )
    expect(q?.cropName).toBe('Canola')
    expect(q?.run).toBe(2)
    expect(q?.allowedInARow).toBe(1)
    expect(q?.fix).toBe('in_a_row')
    expect(q?.breaks.length).toBeGreaterThan(0)
  })

  it('says nothing when the crop is not on top of itself', () => {
    expect(repeatQuestion('canola', input([[2026, ['wheat']]]))).toBeNull()
  })

  it('says nothing when the rules already allow the repeat', () => {
    const repeatable = { ...corn, max_in_a_row: 3 }
    const over = {
      crops: [repeatable, wheat, canola, sainfoin],
      cropMap: new Map([repeatable, wheat, canola, sainfoin].map((c) => [c.id, c])),
    }
    expect(repeatQuestion('corn', input([[2026, ['corn']]], over))).toBeNull()
  })

  it('points at the pairing when a never-after rule is the only thing broken', () => {
    // Corn has no return interval, so "never corn on corn" is what fires.
    const cornRules = [
      ...(rules as unknown as Record<string, unknown>[]),
      {
        prev_crop_id: 'corn',
        next_crop_id: 'corn',
        preference: 'no_go',
        notes: 'Rootworm.',
        source: 'farm',
      },
    ] as unknown as Parameters<typeof buildSuccessionMap>[0]
    const q = repeatQuestion(
      'corn',
      input([[2026, ['corn']]], {
        succession: buildSuccessionMap(cornRules),
        notes: buildSuccessionNotes(cornRules),
      }),
    )
    expect(q?.fix).toBe('succession')
  })

  it('offers the in-a-row rule when that is what stops it', () => {
    const q = repeatQuestion(
      'canola',
      input([
        [2026, ['canola']],
        [2025, ['wheat']],
      ]),
    )
    expect(q?.fix).toBe('in_a_row')
  })
})

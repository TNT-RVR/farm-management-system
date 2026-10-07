import { describe, expect, it } from 'vitest'
import { animalClasses, byYearAndClass, type CattleSale } from './cattleMarkets'

const sale = (o: Partial<CattleSale>): CattleSale =>
  ({
    id: Math.random().toString(),
    crop_year: 2024,
    ranch: 'Home Ranch',
    animal_class: 'heifers',
    head: 10,
    avg_weight_lb: 450,
    total_lb: null,
    price_per_lb: 2,
    buyer: null,
    sale_date: null,
    delivery_date: null,
    notes: null,
    ...o,
  }) as CattleSale

describe('animalClasses', () => {
  it('lists what was actually sold, commonest first', () => {
    const out = animalClasses([
      sale({ animal_class: 'bulls' }),
      sale({ animal_class: 'bulls' }),
      sale({ animal_class: 'heifers' }),
    ])
    expect(out).toEqual(['bulls', 'heifers'])
  })

  it('keeps a class that appears once', () => {
    // "runts" is a single 2024 lot. A hard-coded list would have dropped it off
    // the chart with no sign it had ever been there.
    expect(animalClasses([sale({ animal_class: 'runts' })])).toEqual(['runts'])
  })

  it('ignores a lot with no class rather than inventing one', () => {
    // The column is nullable in the database even though the type narrows it.
    expect(animalClasses([sale({ animal_class: undefined })])).toEqual([])
  })
})

describe('byYearAndClass', () => {
  it('weights by pounds, not by lot', () => {
    // 100 head at $2 and 10 head at $3 is not $2.50.
    const out = byYearAndClass(
      [sale({ head: 100, price_per_lb: 2 }), sale({ head: 10, price_per_lb: 3 })],
      ['heifers'],
    )
    expect(out[0].heifers).toBeCloseTo((100 * 450 * 2 + 10 * 450 * 3) / (110 * 450), 6)
  })

  it('gives a class with no sale that year a null, so the line breaks', () => {
    const out = byYearAndClass(
      [sale({ crop_year: 2023, animal_class: 'bulls' }), sale({ crop_year: 2024 })],
      ['bulls', 'heifers'],
    )
    expect(out.find((r) => r.year === 2024)!.bulls).toBeNull()
    expect(out.find((r) => r.year === 2023)!.heifers).toBeNull()
  })

  it('sorts years oldest to newest', () => {
    const out = byYearAndClass(
      [sale({ crop_year: 2024 }), sale({ crop_year: 2010 }), sale({ crop_year: 2018 })],
      ['heifers'],
    )
    expect(out.map((r) => r.year)).toEqual([2010, 2018, 2024])
  })

  it('ignores an unpriced lot instead of counting it as zero', () => {
    const out = byYearAndClass(
      [sale({ price_per_lb: null }), sale({ price_per_lb: 2 })],
      ['heifers'],
    )
    expect(out[0].heifers).toBeCloseTo(2, 6)
  })
})

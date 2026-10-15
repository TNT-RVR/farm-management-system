import { describe, expect, it } from 'vitest'
import { findPriceMatches, type MatchableProduct } from './product-match'

let n = 0
const p = (o: Partial<MatchableProduct> & { name: string }): MatchableProduct => ({
  id: `p${++n}`,
  unit: 'L',
  price_per_unit: null,
  pmra_registration: null,
  category: 'chemical',
  ...o,
})

describe('findPriceMatches', () => {
  it('matches a packaging variant to the product already priced', () => {
    const matches = findPriceMatches([
      p({ name: 'Authority 480', price_per_unit: 92.5 }),
      p({ name: 'Authority 480 3.79L Jug' }),
    ])
    expect(matches).toHaveLength(1)
    expect(matches[0].reason).toBe('name')
    expect(matches[0].unpriced.name).toBe('Authority 480 3.79L Jug')
    expect(matches[0].priced.price_per_unit).toBe(92.5)
  })

  it('matches on the registration even when the names do not look alike', () => {
    // The same registered product bought under two trade spellings. The
    // registration number is what the number is for.
    const matches = findPriceMatches([
      p({ name: 'Roundup WeatherMax', price_per_unit: 8.4, pmra_registration: '27487' }),
      p({ name: 'Glyphosate 540 (bulk)', pmra_registration: '27487' }),
    ])
    expect(matches).toHaveLength(1)
    expect(matches[0].reason).toBe('registration')
  })

  it('prefers the registration over a name that happens to match something else', () => {
    const matches = findPriceMatches([
      p({ name: 'Titan', price_per_unit: 5, pmra_registration: '11111' }),
      p({ name: 'Something Else', price_per_unit: 9, pmra_registration: '22222' }),
      p({ name: 'Titan 10L Jug', pmra_registration: '22222' }),
    ])
    expect(matches).toHaveLength(1)
    expect(matches[0].reason).toBe('registration')
    expect(matches[0].priced.name).toBe('Something Else')
  })

  it('ignores a trailing word that says what a product is, not which one', () => {
    // Off an invoice line it is "Viper ADV Herbicide"; typed by whoever was
    // spraying it is "Viper ADV 8.1L". One product.
    const matches = findPriceMatches([
      p({ name: 'Viper ADV 8.1L', price_per_unit: 40.99 }),
      p({ name: 'Viper ADV Herbicide' }),
    ])
    expect(matches).toHaveLength(1)
    expect(matches[0].reason).toBe('name')
  })

  it('does not let the type word collapse two different products together', () => {
    // Viper and Viper ADV are not the same chemical, and stripping "Herbicide"
    // must not bring them any closer.
    expect(
      findPriceMatches([p({ name: 'Viper ADV', price_per_unit: 40 }), p({ name: 'Viper Herbicide' })]),
    ).toEqual([])
  })

  it('will not pair two chemicals whose names merely look similar', () => {
    // Assure and Assert are different chemicals; Titan and Triton are different
    // chemicals. Any edit-distance matching pairs both, which is why there is
    // none.
    const matches = findPriceMatches([
      p({ name: 'Assure II', price_per_unit: 40 }),
      p({ name: 'Assert 300' }),
      p({ name: 'Titan', price_per_unit: 5 }),
      p({ name: 'Triton' }),
    ])
    expect(matches).toEqual([])
  })

  it('flags a unit mismatch instead of offering to copy the price', () => {
    // $/L copied onto a product sold by the kilogram is a wrong number that
    // looks entirely reasonable.
    const matches = findPriceMatches([
      p({ name: 'Express SG', unit: 'kg', price_per_unit: 300 }),
      p({ name: 'Express SG 300g', unit: 'L' }),
    ])
    expect(matches).toHaveLength(1)
    expect(matches[0].unitMismatch).toBe(true)
  })

  it('does not match across categories', () => {
    const matches = findPriceMatches([
      p({ name: 'Nitrogen', category: 'fertilizer', price_per_unit: 0.8 }),
      p({ name: 'Nitrogen', category: 'chemical' }),
    ])
    expect(matches).toEqual([])
  })

  it('never matches a name that normalises away to nothing', () => {
    // A row that was only ever a pack size must not become every other empty
    // name's twin.
    const matches = findPriceMatches([p({ name: '10 L Jug', price_per_unit: 4 }), p({ name: '20L Jug' })])
    expect(matches).toEqual([])
  })

  it('leaves an unpriced product alone when nothing accounts for it', () => {
    expect(findPriceMatches([p({ name: 'Odyssey Ultra' })])).toEqual([])
  })

  it('does not propose anything when every product is priced', () => {
    expect(
      findPriceMatches([
        p({ name: 'Authority 480', price_per_unit: 92.5 }),
        p({ name: 'Authority 480 3.79L Jug', price_per_unit: 92.5 }),
      ]),
    ).toEqual([])
  })

  it('puts the certain matches first', () => {
    const matches = findPriceMatches([
      p({ name: 'Aim EC', price_per_unit: 100 }),
      p({ name: 'Aim EC 1L' }),
      p({ name: 'Buctril M', price_per_unit: 20, pmra_registration: '33333' }),
      p({ name: 'Bromoxynil mix', pmra_registration: '33333' }),
    ])
    expect(matches.map((m) => m.reason)).toEqual(['registration', 'name'])
  })
})

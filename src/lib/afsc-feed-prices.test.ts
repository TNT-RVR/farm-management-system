import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { latestListUrl, listDate, parseFeedGrain, parseForage } from '../../netlify/shared/afsc-feed-prices'
import { parsePolicyBookRates } from '../../netlify/shared/smrid-rates'

const fx = (f: string) => readFileSync(new URL(`./__fixtures__/${f}`, import.meta.url), 'utf8')

describe('AFSC forage price list', () => {
  const text = fx('afsc-forage-2026-08-20.txt')
  it('reads the South region’s newest quarter, $/lb turned into $/tonne', () => {
    const p = parseForage(text)
    const by = new Map(p.map((x) => [x.item, x]))
    expect(by.get('Grass Hay - 1st Cut')).toEqual({ item: 'Grass Hay - 1st Cut', perTonne: 194.23, period: 'Apr–Jun' })
    expect(by.get('Alfalfa Hay - 1st Cut')!.perTonne).toBe(215.83)
    expect(by.get('Greenfeed')!.perTonne).toBe(144.84)
    expect(by.get('Straw')!.perTonne).toBe(100.09)
    // Silage is quoted per tonne already; the per-ton line is skipped.
    expect(by.get('Silage (60% Moisture)')!.perTonne).toBe(85)
    expect(p).toHaveLength(7)
  })
  it('keeps regions apart', () => {
    expect(parseForage(text, 'Peace').find((x) => x.item === 'Straw')!.perTonne).toBe(95.02)
  })
  it('reads the date printed on the list', () => {
    expect(listDate(text)).toBe('2026-08-20')
  })
})

describe('AFSC feed grain price list', () => {
  it('reads Lethbridge’s newest month', () => {
    const p = parseFeedGrain(fx('afsc-feed-grain-2026-07-08.txt'))
    expect(p).toEqual([
      { item: 'Feed Wheat', perTonne: 309.5, period: 'June' },
      { item: 'Feed Oats', perTonne: 252.5, period: 'June' },
      { item: 'Feed Barley', perTonne: 312.75, period: 'June' },
    ])
  })
  it('finds nothing for a station not on the list', () => {
    expect(parseFeedGrain(fx('afsc-feed-grain-2026-07-08.txt'), 'Taber')).toEqual([])
  })
})

describe('the price-lists page', () => {
  it('picks the newest year’s list of each kind', () => {
    const html = [
      '<a href="https://afsc.ca/wp-content/uploads/2025/05/2025-Forage-Price-List.pdf">',
      '<a href="https://afsc.ca/wp-content/uploads/2026/06/2026-Forage-Price-List.pdf">',
      '<a href="https://afsc.ca/wp-content/uploads/2022/05/2022-Forage-Seed.pdf">',
      '<a href="https://afsc.ca/wp-content/uploads/2026/06/2026-Feed-Grain-Price-List.pdf">',
    ].join('\n')
    expect(latestListUrl(html, 'Forage')).toEqual({ url: 'https://afsc.ca/wp-content/uploads/2026/06/2026-Forage-Price-List.pdf', year: 2026 })
    expect(latestListUrl(html, 'Feed-Grain')!.year).toBe(2026)
  })
})

describe('SMRID Policy Book rates', () => {
  it('reads the year, the rate an acre and the parcel minimum', () => {
    expect(parsePolicyBookRates(fx('smrid-policy-book-2026-rates.txt'))).toEqual({ year: 2026, ratePerAcre: 38, minPerParcel: 760 })
  })
  it('finds nothing in text without the rate line', () => {
    expect(parsePolicyBookRates('Annual Agreement Rate $190.00/acre')).toBeNull()
  })
})

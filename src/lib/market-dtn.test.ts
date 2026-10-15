import { describe, expect, it } from 'vitest'
import { articleDate, fertilizerArticles, parsePrices } from '../../netlify/shared/market-dtn'

describe('parsePrices', () => {
  // The sentences as DTN wrote them on 16 Sep 2026.
  const text =
    'Six fertilizers were slightly lower compared to a month ago. Potash had an average price of $494/ton, ' +
    'urea $658/ton, 10-34-0 $717/ton, anhydrous $938/ton, UAN28 $430/ton and UAN32 $457/ton. The remaining ' +
    'two nutrients were just slightly more expensive looking back a month. DAP had an average price of ' +
    '$923/ton and MAP $962/ton.'

  it('reads all eight prices out of the running text', () => {
    expect(parsePrices(text)).toEqual({
      dap: 923,
      map: 962,
      potash: 494,
      urea: 658,
      '10-34-0': 717,
      anhydrous: 938,
      uan28: 430,
      uan32: 457,
    })
  })

  it('does not let MAP take DAP’s number or UAN28 take UAN32’s', () => {
    const p = parsePrices('DAP had an average price of $1,000/ton and MAP $900/ton. UAN32 $500/ton, UAN28 $400/ton.')
    expect(p.dap).toBe(1000)
    expect(p.map).toBe(900)
    expect(p.uan28).toBe(400)
    expect(p.uan32).toBe(500)
  })

  it('reads the longer sentence forms too', () => {
    // 1 July 2026 and 22 April 2026, which the first version read 5 and 3 of 8 from.
    const july =
      'Urea was 13% less expensive with an average price of $720/ton. UAN32 was 9% lower compared to last month ' +
      'and had an average price of $534/ton, while UAN28 was 5% less expensive with an average price of $506/ton. ' +
      'DAP had an average price of $910/ton, potash $494/ton and anhydrous $1,076/ton. MAP had an average price ' +
      'of $954/ton, while 10-34-0 is $725/ton.'
    expect(parsePrices(july)).toEqual({
      dap: 910,
      map: 954,
      potash: 494,
      urea: 720,
      '10-34-0': 725,
      anhydrous: 1076,
      uan28: 506,
      uan32: 534,
    })
    const april =
      'Urea was up sharply. The nitrogen fertilizer had an average price of $858/ton. Anhydrous was 6% higher and ' +
      'had an average price of $1,114/ton. UAN32 was also higher and had an average price of $579/ton, with UAN28 ' +
      'up as well with an average price of $520/ton. 10-34-0 was 7% more expensive with an average price of ' +
      '$717/ton. DAP had an average price of $894/ton and MAP $932/ton. Potash had an average price of $491/ton.'
    expect(parsePrices(april)).toEqual({
      dap: 894,
      map: 932,
      potash: 491,
      urea: 858,
      '10-34-0': 717,
      anhydrous: 1114,
      uan28: 520,
      uan32: 579,
    })
  })

  it('works a per-pound-of-nitrogen figure back to the ton when that is all there is', () => {
    // 27 May 2026: urea was given only as $/lb N. 46% N is 920 lb per short ton.
    const text =
      'DAP had an average price of $912/ton, MAP $953/ton, potash $494/ton, 10-34-0 $724/ton, anhydrous ' +
      '$1,118/ton and UAN28 $531/ton. On a price per pound of nitrogen basis, the average urea price was ' +
      '$0.90/lb.N, anhydrous $0.68/lb.N, UAN28 $0.94/lb.N and UAN32 $0.92/lb.N.'
    const p = parsePrices(text)
    expect(p.urea).toBe(828)
    // The $/ton sentence still wins where it exists.
    expect(p.anhydrous).toBe(1118)
    expect(p.uan28).toBe(531)
    // UAN32 had no $/ton sentence in this fragment either.
    expect(p.uan32).toBe(Math.round(0.92 * 640))
  })

  it('leaves out what the article does not say', () => {
    expect(parsePrices('Urea was $700 per ton this week.')).toEqual({ urea: 700 })
  })
})

describe('fertilizerArticles', () => {
  const html = `
    <a href="/agriculture/web/ag/news/world-policy/article/2026/09/22/oil-100">Oil Below $100</a>
    <a href="/agriculture/web/ag/news/crops/article/2026/09/09/6-8-fertilizer-prices-lower-led"><span>6 of 8 Fertilizer Prices Lower, Led by UAN28</span></a>
    <a href="/agriculture/web/ag/news/crops/article/2026/09/16/fertilizer-prices-continue-lower-6-8">Fertilizer Prices Continue Lower for 6 of 8 Major Nutrients</a>
    <a href="/agriculture/web/ag/news/crops/article/2026/09/16/fertilizer-prices-continue-lower-6-8">Fertilizer Prices Continue Lower for 6 of 8 Major Nutrients</a>
  `
  it('keeps the fertilizer articles, newest first, once each', () => {
    const list = fertilizerArticles(html)
    expect(list.map((a) => a.date)).toEqual(['2026-09-16', '2026-09-09'])
    expect(list[0].url).toBe(
      'https://www.dtnpf.com/agriculture/web/ag/news/crops/article/2026/09/16/fertilizer-prices-continue-lower-6-8',
    )
    expect(list[1].title).toBe('6 of 8 Fertilizer Prices Lower, Led by UAN28')
  })
})

describe('articleDate', () => {
  it('reads the week off the path', () => {
    expect(articleDate('https://www.dtnpf.com/agriculture/web/ag/crops/article/2026/07/01/urea-uan')).toBe('2026-07-01')
    expect(articleDate('https://example.com/nope')).toBeNull()
  })
})

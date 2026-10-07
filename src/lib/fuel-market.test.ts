import { describe, expect, it } from 'vitest'
import { costingDiesel, farmFromRetail, parseNrcanFeed } from './fuel-market'

// Trimmed from the real feed, fetched 2 Oct 2026:
// webfeed_e.cfm?priceYear=2026&productID=5&locationID=8,10,11
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Retail Prices</title><description>Diesel</description>
<item>
  <title>Calgary</title>
  <link>http://www2.nrcan.gc.ca/eneene/sources/pripri/prices_bycity_e.cfm?priceYear=2026&amp;productID=5&amp;locationID=8&amp;frequency=W</link>
  <description>$2.406</description>
  <pubDate>Tue, 06 Oct 2026</pubDate>
</item>
<item>
  <title>Lethbridge</title>
  <link>x</link>
  <description>$2.456</description>
  <pubDate>Tue, 06 Oct 2026</pubDate>
</item>
<item>
  <title>Lethbridge</title>
  <link>x</link>
  <description>$1.492</description>
  <pubDate>Tue, 24 Feb 2026</pubDate>
</item>
<item><title>Broken</title><description>n/a</description><pubDate>Tue, 24 Feb 2026</pubDate></item>
</channel></rss>`

describe('parseNrcanFeed', () => {
  it('reads city, week-ending date and $/L, and skips what it cannot read', () => {
    expect(parseNrcanFeed(FEED)).toEqual([
      { city: 'Calgary', on: '2026-10-06', perL: 2.406 },
      { city: 'Lethbridge', on: '2026-10-06', perL: 2.456 },
      { city: 'Lethbridge', on: '2026-02-24', perL: 1.492 },
    ])
  })
})

describe('farmFromRetail', () => {
  it('takes off GST and the 9 cents of Alberta tax marked fuel does not pay', () => {
    // Feb 2026: 13 clear, 4 marked, no fuel charge.
    expect(farmFromRetail(1.492, '2026-02-24', 'diesel')).toBeCloseTo(1.492 / 1.05 - 0.09, 4)
  })

  it('takes off only GST once Alberta suspends its fuel tax on 1 Oct 2026', () => {
    expect(farmFromRetail(2.456, '2026-10-06', 'diesel')).toBeCloseTo(2.456 / 1.05, 4)
  })

  it('takes off the federal fuel charge farm fuel never paid, before April 2025', () => {
    expect(farmFromRetail(1.8, '2025-01-07', 'diesel')).toBeCloseTo(1.8 / 1.05 - 0.09 - 0.2139, 4)
    expect(farmFromRetail(1.5, '2025-01-07', 'gasoline')).toBeCloseTo(1.5 / 1.05 - 0.09 - 0.1761, 4)
  })
})

describe('costingDiesel', () => {
  const invoice = { perL: 1.98, on: '2026-09-30', invoiceNo: '104522' }
  const market = { perL: 2.34, on: '2026-10-06' }
  const typed = { perL: 2.0, on: '2026-10-02', by: 'Sam' }
  const survey = { perL: 1.4083, on: '2026-07-01' }

  it('uses an override above everything', () => {
    expect(costingDiesel({ override: 1.5, invoice, market, typed, survey })).toMatchObject({ perL: 1.5, source: 'override' })
  })
  it('then the newest invoice', () => {
    expect(costingDiesel({ invoice, market, typed, survey })).toMatchObject({ perL: 1.98, source: 'invoice' })
  })
  it('then the market farm figure', () => {
    expect(costingDiesel({ invoice: null, market, typed, survey })).toMatchObject({ perL: 2.34, source: 'market' })
  })
  it('then the typed default', () => {
    const c = costingDiesel({ typed, survey })
    expect(c).toMatchObject({ perL: 2.0, source: 'typed' })
    expect(c.label).toBe('typed default (Sam, 2026-10-02)')
  })
  it('then the Alberta survey, then a round number', () => {
    expect(costingDiesel({ survey })).toMatchObject({ source: 'survey' })
    expect(costingDiesel({})).toMatchObject({ perL: 1.4, source: 'fallback' })
  })
})

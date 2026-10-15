import { describe, expect, it } from 'vitest'
import { MIN_SCORE, parseFeed, scoreItem } from '../../netlify/shared/ag-news-core'

describe('scoreItem', () => {
  it('scores our own crops above the rest of agriculture', () => {
    const canola = scoreItem('Canola market buoyed by fundamentals', '', ['Markets', 'canola'])
    const hogs = scoreItem('Novel diagnostic testing proves useful in pig production', '', ['Hogs'])
    expect(canola.score).toBeGreaterThan(MIN_SCORE)
    expect(hogs.score).toBeLessThan(0)
  })

  it('throws out what we do not farm', () => {
    // Both of these were on one morning's feed alongside a canola story.
    expect(
      scoreItem('Volunteer green thumbs nourish food banks with Vegetable Garden initiative', '', [
        'Fruit/Vegetables',
      ]).score,
    ).toBeLessThan(MIN_SCORE)
    expect(scoreItem('Dairy quota changes announced', '', ['Dairy']).score).toBeLessThan(MIN_SCORE)
  })

  it('still counts the cattle in a story that also mentions hogs', () => {
    // Negative terms subtract rather than filter, so a genuine cattle story is
    // not thrown away for mentioning a hog barn in passing.
    const both = scoreItem('Red Angus feeder prices climb as hog barns close', '', ['Cattle'])
    expect(both.score).toBeGreaterThan(0)
  })

  it('does not let repetition beat relevance', () => {
    // A piece saying "canola" nine times must not outrank one actually about
    // our irrigation, purely on repetition.
    const repeated = scoreItem('Canola canola canola', 'canola canola canola canola', ['canola'])
    const once = scoreItem('Canola market outlook', '', ['Markets'])
    expect(repeated.score).toBeLessThanOrEqual(once.score + 10)
  })

  it('weights the headline above the body', () => {
    const inTitle = scoreItem('Irrigation allocations cut for 2027', '', [])
    const inBody = scoreItem('A general farm story', 'mentions irrigation once', [])
    expect(inTitle.score).toBeGreaterThan(inBody.score)
  })

  it('says which terms earned the score', () => {
    const { matched } = scoreItem('Clubroot found in more Alberta canola fields', '', [])
    expect(matched).toContain('canola')
    expect(matched).toContain('clubroot')
    expect(matched).toContain('alberta')
  })

  it('gives a plain farm story nothing to hang on', () => {
    expect(scoreItem('Annual general meeting announced', '', []).score).toBe(0)
  })
})

describe('parseFeed', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[Canola market buoyed by fundamentals]]></title>
      <link>https://example.com/canola</link>
      <description><![CDATA[<p>Prices held through the week&#8217;s trade.</p>]]></description>
      <pubDate>Tue, 15 Sep 2026 16:51:21 +0000</pubDate>
      <category><![CDATA[Markets]]></category>
      <category>canola</category>
    </item>
    <item>
      <title>No link here</title>
      <description>orphan</description>
    </item>
  </channel></rss>`

  it('reads the fields a meeting needs', () => {
    const [first] = parseFeed(xml, 'Test Feed')
    expect(first.title).toBe('Canola market buoyed by fundamentals')
    expect(first.url).toBe('https://example.com/canola')
    expect(first.categories).toEqual(['Markets', 'canola'])
    expect(first.publishedAt?.startsWith('2026-09-15')).toBe(true)
    expect(first.source).toBe('Test Feed')
  })

  it('strips the HTML and the entities out of a summary', () => {
    // Feeds put markup in descriptions, and a curly apostrophe arrives as a
    // numeric entity. Neither belongs in something read off a screen.
    const [first] = parseFeed(xml, 'Test Feed')
    expect(first.summary).toBe('Prices held through the week’s trade.')
  })

  it('drops an item with no usable link', () => {
    // The url is the identity — it is how a republished story is recognised as
    // one we already have — so an item without one cannot be stored.
    expect(parseFeed(xml, 'Test Feed')).toHaveLength(1)
  })

  it('returns nothing rather than throwing on rubbish', () => {
    expect(parseFeed('not xml at all', 'Test')).toEqual([])
    expect(parseFeed('', 'Test')).toEqual([])
  })
})

describe('summaries', () => {
  const withFurniture = `<rss><channel><item>
    <title>Canola market steady</title>
    <link>https://example.com/a</link>
    <description><![CDATA[Reading Time: 2 minutes Canola prices held through the week. The post Canola market steady appeared first on Alberta Farmer Express.]]></description>
  </item></channel></rss>`

  it('drops the publisher furniture', () => {
    // Glacier FarmMedia opens every description with a reading time and closes
    // it with a "The post … appeared first on …" trailer. Between them they eat
    // most of the two lines the agenda gives a summary.
    const [item] = parseFeed(withFurniture, 'Test')
    expect(item.summary).toBe('Canola prices held through the week.')
  })

  it('leaves a clean summary alone', () => {
    const plain = `<rss><channel><item><title>T</title><link>https://e.com/b</link>
      <description>Just the story.</description></item></channel></rss>`
    expect(parseFeed(plain, 'Test')[0].summary).toBe('Just the story.')
  })
})

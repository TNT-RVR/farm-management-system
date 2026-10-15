import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Farm news, filtered down to what this farm actually does.
 *
 * The feeds are not curated for us. One morning's Alberta Farmer Express
 * carried a canola market piece, a hog diagnostics study and a story about
 * volunteer vegetable gardens — so the scoring is not a nicety, it is the
 * difference between three useful items and three random ones.
 *
 * SCORED ON WORDS WE CHOSE, not on a model's judgement. It has to run weekly
 * without supervision and produce something defensible at a meeting, and a
 * keyword score can be explained — every stored row keeps the terms that
 * matched it, so a bad pick can be looked at and the weights fixed rather than
 * shrugged at.
 */

/** Feeds that actually answer. Several obvious ones sit behind bot protection
 *  and return 403 to anything without a browser: RealAgriculture, Grainews,
 *  The Western Producer and Canadian Cattlemen were all tried and refused. */
export const FEEDS = [
  { name: 'Alberta Farmer Express', url: 'https://www.albertafarmexpress.ca/feed/' },
  { name: 'AgCanada', url: 'https://www.agcanada.com/feed' },
  { name: 'Canadian Cattle Association', url: 'https://www.cattle.ca/feed' },
  { name: 'Beef Research Council', url: 'https://www.beefresearch.ca/feed/' },
]

/**
 * What matters here, and how much.
 *
 * Weighted by how directly a story changes what somebody does on this farm. Our
 * own crops and our own cattle score highest; the wider prairie industry scores
 * something; the rest of agriculture scores nothing and is meant to.
 */
const WEIGHTS: [RegExp, number][] = [
  // Our crops, by name.
  [/\bcanola\b/i, 10],
  [/\b(durum|spring wheat|wheat)\b/i, 8],
  [/\bbarley\b/i, 8],
  [/\b(dry beans?|pinto|black beans?|great northern|navy beans?)\b/i, 10],
  [/\b(field peas?|peas)\b/i, 7],
  [/\b(corn|silage corn)\b/i, 7],
  [/\b(alfalfa|hay|forage)\b/i, 7],
  [/\b(oats|triticale|soybeans?)\b/i, 5],
  [/\bpotato(es)?\b/i, 4],

  // Cattle. Red Angus specifically is worth more than cattle generally.
  [/\b(red angus|angus)\b/i, 10],
  [/\b(cow-calf|cow\/calf|calving|weaning|backgrounding)\b/i, 8],
  [/\b(cattle|beef|feeder|bull|heifer|herd)\b/i, 6],
  [/\b(bse|foot.and.mouth|anaplasmosis|bovine)\b/i, 7],

  // How the work gets done.
  [/\b(irrigation|pivot|water allocation)\b/i, 9],
  [/\b(herbicide|fungicide|insecticide|pesticide|spray(ing)?)\b/i, 8],
  [/\b(resistan\w+|kochia|wild oat|cleavers)\b/i, 9],
  [/\b(grain (storage|bin|drying)|aeration|spoilage)\b/i, 8],
  [/\b(harvest|seeding|swath\w*|desicca\w+)\b/i, 6],
  [/\b(grasshopper|cutworm|flea beetle|wireworm|midge|aphid)\b/i, 8],
  [/\b(clubroot|blackleg|sclerotinia|white mould|fusarium|stripe rust)\b/i, 9],
  [/\b(fertilizer|nitrogen|urea|phosphate|anhydrous)\b/i, 7],
  [/\b(drought|frost|hail|moisture conditions|soil moisture)\b/i, 7],

  // Money.
  [/\b(price|market|basis|futures|carry|contract|tariff|export)\b/i, 5],
  [/\b(afsc|crop insurance|agristability|rebate|grant|program funding)\b/i, 7],

  // Where.
  [/\b(alberta|southern alberta|lethbridge|taber|medicine hat)\b/i, 6],
  [/\b(prairie|saskatchewan|western canada)\b/i, 3],

  // Not us. Negative rather than a filter, so a story about cattle AND hogs
  // still scores on the cattle.
  //
  // PLURALS MATTER HERE. "food bank" with a trailing word boundary does not
  // match "food banks", and on a real feed a volunteer-gardening piece came
  // SECOND at 32 points on the strength of "Alberta", "corn" and "harvest"
  // because of exactly that. The weights are heavier than they look for the
  // same reason: they have to beat a pile of incidental matches, not merely
  // offset one.
  [/\b(hogs?|pigs?|swine|poultry|chickens?|turkeys?|dairy|milk quota)\b/i, -12],
  [/\b(vertical farm\w*|urban (farm|garden)\w*|food banks?|community gardens?|vegetable gardens?)\b/i, -12],
]

export type ScoredItem = {
  source: string
  title: string
  url: string
  summary: string | null
  publishedAt: string | null
  categories: string[]
  score: number
  matched: string[]
}

/**
 * Score one item.
 *
 * The title counts double and the categories one and a half times: a feed's own
 * tags are a better statement of what a piece is about than the first paragraph
 * of it, and the headline is what somebody is going to read out.
 */
export function scoreItem(
  title: string,
  summary: string,
  categories: string[],
): { score: number; matched: string[] } {
  const fields: [string, number][] = [
    [title, 2],
    [categories.join(' '), 1.5],
    [summary, 1],
  ]
  let score = 0
  const matched = new Set<string>()
  for (const [pattern, weight] of WEIGHTS) {
    // The strongest place this term appears, or nothing if it does not.
    //
    // Tracked as the MULTIPLIER rather than as the product, so the same
    // arithmetic works for the negative weights. Taking a maximum of
    // `weight * multiplier` never got below zero, so every negative term
    // scored nothing and a hog story came out neutral instead of rejected.
    let bestMultiplier = 0
    for (const [text, multiplier] of fields) {
      const hit = pattern.exec(text)
      if (!hit) continue
      // Counted ONCE per term, wherever it counts for most. Otherwise a piece
      // that says "canola" nine times outranks one actually about our
      // irrigation, purely on repetition.
      if (multiplier > bestMultiplier) bestMultiplier = multiplier
      if (weight > 0) matched.add(hit[0].toLowerCase())
    }
    score += bestMultiplier * weight
  }
  return { score: Math.round(score), matched: [...matched] }
}

const unescape = (s: string) =>
  s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The publisher's furniture, which is not the story.
 *
 * Glacier FarmMedia descriptions open with "Reading Time: 2 minutes" and close
 * with "The post … appeared first on …". Neither says anything at a meeting,
 * and between them they eat most of the two lines the agenda gives a summary.
 */
const stripBoilerplate = (s: string) =>
  s
    .replace(/^\s*Reading Time:\s*[<\d]+[^.]*?minutes?\s*/i, '')
    .replace(/\s*The post .*? appeared first on .*$/i, '')
    .replace(/\s*Read More\s*$/i, '')
    .trim()

const tag = (block: string, name: string): string => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  return m ? unescape(m[1]) : ''
}

/**
 * Items out of an RSS document.
 *
 * A hand-rolled reader rather than a dependency: an RSS item is four fields
 * inside a tag, the feeds here are all RSS 2.0, and the failure mode of a bad
 * parse is a missing news item rather than a wrong number.
 */
export function parseFeed(xml: string, source: string): ScoredItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []
  const out: ScoredItem[] = []
  for (const block of blocks) {
    const title = tag(block, 'title')
    const url = tag(block, 'link') || tag(block, 'guid')
    if (!title || !url.startsWith('http')) continue
    const summary = stripBoilerplate(tag(block, 'description')).slice(0, 600)
    const categories = [...block.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)]
      .map((m) => unescape(m[1]))
      .filter(Boolean)
    const date = tag(block, 'pubDate')
    const parsed = date ? new Date(date) : null
    const { score, matched } = scoreItem(title, summary, categories)
    out.push({
      source,
      title,
      url,
      summary: summary || null,
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
      categories,
      score,
      matched,
    })
  }
  return out
}

/**
 * Below this an item is not worth a meeting's attention.
 *
 * Ten rather than eight: one place name plus a single incidental crop mention
 * clears eight, and those are the items that make the section read as filler.
 */
export const MIN_SCORE = 10

export async function runAgNewsPull(sb: SupabaseClient) {
  const kept: ScoredItem[] = []
  const failed: string[] = []

  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url, {
        headers: {
          // Several of these sit behind bot protection and refuse anything
          // that does not look like a browser.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
        },
      })
      if (!res.ok) {
        failed.push(`${feed.name} ${res.status}`)
        continue
      }
      kept.push(...parseFeed(await res.text(), feed.name).filter((i) => i.score >= MIN_SCORE))
    } catch (e) {
      // One feed going down must not cost the other three.
      failed.push(`${feed.name}: ${(e as Error).message}`)
    }
  }

  let stored = 0
  if (kept.length) {
    const { error } = await sb.from('ag_news').upsert(
      kept.map((i) => ({
        source: i.source,
        title: i.title,
        url: i.url,
        summary: i.summary,
        published_at: i.publishedAt,
        categories: i.categories,
        score: i.score,
        matched: i.matched,
        fetched_at: new Date().toISOString(),
      })),
      { onConflict: 'url' },
    )
    if (error) throw error
    stored = kept.length
  }
  return { stored, failed, feeds: FEEDS.length }
}

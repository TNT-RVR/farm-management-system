import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * This week's retail fertilizer prices, from DTN.
 *
 * The Statistics Canada index is quarterly and six months late, and the
 * Alberta input survey is monthly and weeks late; neither says what urea
 * costs THIS week, which is the question when deciding whether to book the
 * fall tonnes. DTN gathers bids from US retailers every week and publishes
 * the eight averages every Wednesday in a short article. That article is
 * the only free weekly retail series there is, so this reads it.
 *
 * Read from the author's article list, not a fixed URL: the slug changes
 * every week. The newest article with "fertilizer" in its title is the
 * one, and its sentences are as regular as a table: "Potash had an average
 * price of $494/ton, urea $658/ton, ... DAP had an average price of
 * $923/ton and MAP $962/ton."
 *
 * US Midwest, US dollars per short ton. Alberta retail runs above it by
 * freight and exchange but moves with it, so the page shows the US number
 * with a Canadian-dollar-per-tonne equivalent from the Bank of Canada rate
 * beside it, and says which is which.
 */
const AUTHOR_PAGE = 'https://www.dtnpf.com/agriculture/web/ag/news/author?authorFullName=Russ++Quinn'
const SITE = 'https://www.dtnpf.com'

export const DTN_PRODUCTS: { key: string; code: string; name: string; commodity: string; aliases: RegExp }[] = [
  { key: 'dap', code: 'dtn.dap', name: 'DAP 18-46-0 — US retail', commodity: 'DAP', aliases: /\bDAP\b/i },
  { key: 'map', code: 'dtn.map', name: 'MAP 11-52-0 — US retail', commodity: 'MAP', aliases: /\bMAP\b/i },
  { key: 'potash', code: 'dtn.potash', name: 'Potash 0-0-60 — US retail', commodity: 'Potash', aliases: /\bpotash\b/i },
  { key: 'urea', code: 'dtn.urea', name: 'Urea 46-0-0 — US retail', commodity: 'Urea', aliases: /\burea\b/i },
  { key: '10-34-0', code: 'dtn.10-34-0', name: '10-34-0 — US retail', commodity: '10-34-0', aliases: /\b10-34-0\b/ },
  { key: 'anhydrous', code: 'dtn.anhydrous', name: 'Anhydrous 82-0-0 — US retail', commodity: 'Anhydrous', aliases: /\banhydrous\b/i },
  { key: 'uan28', code: 'dtn.uan28', name: 'UAN 28-0-0 — US retail', commodity: 'UAN28', aliases: /\bUAN\s?28\b/i },
  { key: 'uan32', code: 'dtn.uan32', name: 'UAN 32-0-0 — US retail', commodity: 'UAN32', aliases: /\bUAN\s?32\b/i },
]

export const DTN_UNIT = 'USD/ton'

/** Article links on the author page whose title says fertilizer, newest first. */
export function fertilizerArticles(html: string): { url: string; title: string; date: string | null }[] {
  const out: { url: string; title: string; date: string | null }[] = []
  // Anchors with an article path; the title is the anchor text. The date is
  // the yyyy/mm/dd in the path, which is more reliable than any date text.
  const re = /<a[^>]+href="([^"]*\/article\/(\d{4})\/(\d{2})\/(\d{2})\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  const seen = new Set<string>()
  while ((m = re.exec(html))) {
    const [, href, y, mo, d, inner] = m
    const title = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (!/fertili[sz]er/i.test(title)) continue
    const url = href.startsWith('http') ? href : `${SITE}${href}`
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ url, title, date: `${y}-${mo}-${d}` })
  }
  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

/** The eight prices out of the article's text, by product. */
export function parsePrices(text: string): Record<string, number> {
  const found: Record<string, number> = {}
  // "urea $658/ton", "DAP had an average price of $923/ton", "UAN28 $430/ton".
  // Each product word is followed within a few words by a dollar figure and
  // "/ton"; the first such pairing after the word wins.
  // Between the product word and its figure there can be a clause — "was 13%
  // less expensive with an average price of" — but never another product's
  // name: the gap may run to a sentence or so as long as no other product is
  // named inside it, which is what stops MAP reading DAP's price.
  const anyProduct = DTN_PRODUCTS.map((q) => q.aliases.source).join('|')
  for (const p of DTN_PRODUCTS) {
    const re = new RegExp(
      `${p.aliases.source}(?:(?!(?:${anyProduct}))[^$\\n]){0,160}?\\$([\\d,]+(?:\\.\\d+)?)\\s*(?:per|/)\\s*ton`,
      'i',
    )
    const m = re.exec(text)
    if (m) found[p.key] = Number(m[1].replace(/,/g, ''))
  }
  // Some weeks DTN gives a nitrogen product only as dollars per pound of N
  // ("the average urea price was $0.90/lb.N"). A short ton of urea at 46% N
  // carries 920 lb of N, so the per-ton figure follows; likewise anhydrous
  // at 82%, UAN28 and UAN32. Used only where the $/ton sentence is missing.
  const LB_N_PER_TON: Record<string, number> = { urea: 920, anhydrous: 1640, uan28: 560, uan32: 640 }
  for (const [key, lbN] of Object.entries(LB_N_PER_TON)) {
    if (found[key] != null) continue
    const word = DTN_PRODUCTS.find((p) => p.key === key)!.aliases.source
    const re = new RegExp(`${word}(?:(?!(?:${anyProduct}))[^$\\n]){0,60}?\\$(\\d+(?:\\.\\d+)?)\\s*(?:per|/)\\s*lb\\.?\\s*N`, 'i')
    const m = re.exec(text)
    if (m) found[key] = Math.round(Number(m[1]) * lbN)
  }
  return found
}

/** The week the prices are for, out of the article: its own date is close enough. */
export function articleDate(url: string): string | null {
  const m = /\/article\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(url)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

const stripHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RVR Management price reader; +https://your-farm.netlify.app)',
      Accept: 'text/html',
    },
  })
  if (!res.ok) throw new Error(`${res.status} from ${url}`)
  return res.text()
}

/** Bank of Canada's daily USD→CAD, for the equivalent beside the US number. */
export async function fetchUsdCad(): Promise<{ on: string; rate: number } | null> {
  try {
    const res = await fetch('https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1')
    if (!res.ok) return null
    const j = (await res.json()) as { observations?: { d: string; FXUSDCAD?: { v: string } }[] }
    const o = j.observations?.[0]
    const v = o?.FXUSDCAD?.v ? Number(o.FXUSDCAD.v) : NaN
    return o && Number.isFinite(v) ? { on: o.d, rate: v } : null
  } catch {
    return null
  }
}

async function upsertSeries(
  sb: SupabaseClient,
  row: { code: string; kind: string; name: string; commodity: string; unit: string; region: string; source: string; notes: string },
): Promise<string> {
  const { data, error } = await sb.from('market_series').upsert(row, { onConflict: 'code' }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'series upsert returned nothing')
  return data.id as string
}

/**
 * Read the newest article (or several, for a backfill) and store the prices.
 *
 * `urls` overrides discovery, for loading past weeks by hand.
 */
export async function runDtnFertilizerSync(
  sb: SupabaseClient,
  opts: { urls?: string[]; take?: number } = {},
): Promise<{ ok: boolean; articles: number; points: number; latest: string | null; detail: string }> {
  const failures: string[] = []
  let points = 0
  let latest: string | null = null
  let articles: { url: string; title: string; date: string | null }[] = []

  try {
    if (opts.urls?.length) {
      articles = opts.urls.map((url) => ({ url, title: '', date: articleDate(url) }))
    } else {
      const html = await fetchText(AUTHOR_PAGE)
      articles = fertilizerArticles(html).slice(0, opts.take ?? 1)
      if (!articles.length) failures.push('no fertilizer article found on the author page')
    }
  } catch (e) {
    failures.push(`author page: ${(e as Error).message.slice(0, 80)}`)
  }

  const ids = new Map<string, string>()
  for (const p of DTN_PRODUCTS) {
    try {
      ids.set(
        p.key,
        await upsertSeries(sb, {
          code: p.code,
          kind: 'fertilizer',
          name: p.name,
          commodity: p.commodity,
          unit: DTN_UNIT,
          region: 'US Midwest',
          source: 'dtn',
          notes:
            'DTN Retail Fertilizer Trends: average of retailer bids gathered weekly, US dollars per short ton, published Wednesdays. Not an Alberta price; Alberta runs above it by freight and exchange and moves with it.',
        }),
      )
    } catch (e) {
      failures.push(`${p.code}: ${(e as Error).message.slice(0, 60)}`)
    }
  }

  for (const a of articles) {
    try {
      const text = stripHtml(await fetchText(a.url))
      const prices = parsePrices(text)
      const on = a.date ?? articleDate(a.url)
      const keys = Object.keys(prices)
      if (!on || keys.length < 6) {
        failures.push(`${a.url.split('/').pop()}: read ${keys.length} of 8 prices`)
        continue
      }
      const rows = keys
        .filter((k) => ids.has(k))
        .map((k) => ({ series_id: ids.get(k) as string, observed_on: on, value: prices[k], source_url: a.url }))
      const { error } = await sb.from('market_prices').upsert(rows, { onConflict: 'series_id,observed_on' })
      if (error) throw new Error(error.message)
      points += rows.length
      if (!latest || on > latest) latest = on
    } catch (e) {
      failures.push(`${a.url.split('/').pop()}: ${(e as Error).message.slice(0, 60)}`)
    }
  }

  // The exchange rate, as its own series, so the page can show CAD/tonne
  // beside the US figure without baking today's rate into history.
  try {
    const fx = await fetchUsdCad()
    if (fx) {
      const id = await upsertSeries(sb, {
        code: 'fx.usdcad',
        kind: 'fx',
        name: 'US dollar in Canadian dollars',
        commodity: 'USD/CAD',
        unit: 'CAD per USD',
        region: 'Canada',
        source: 'boc',
        notes: 'Bank of Canada daily average rate (Valet API, series FXUSDCAD).',
      })
      const { error } = await sb
        .from('market_prices')
        .upsert({ series_id: id, observed_on: fx.on, value: fx.rate }, { onConflict: 'series_id,observed_on' })
      if (error) throw new Error(error.message)
    }
  } catch (e) {
    failures.push(`fx: ${(e as Error).message.slice(0, 60)}`)
  }

  const ok = failures.length === 0 && points > 0
  const detail =
    `${articles.length} article(s), ${points} prices` +
    (latest ? ` · week of ${latest}` : '') +
    (failures.length ? ` · ${failures.join('; ')}` : '')

  await sb.rpc('record_integration_heartbeat', {
    p_key: 'dtn_fertilizer',
    p_detail: detail,
    p_data_at: latest ? `${latest}T00:00:00Z` : null,
  })

  return { ok, articles: articles.length, points, latest, detail }
}

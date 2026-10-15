import './pdf-polyfills.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractText, getDocumentProxy } from 'unpdf'

/**
 * Feed prices from AFSC's AgriStability commodity price lists (Sam, 7 Oct
 * 2026: "set it up so that those prices update from that price list whenever
 * there is an update").
 *
 * AFSC publishes one PDF a year per commodity group on its price-lists page
 * and re-uploads it as the year fills in: the Forage list by quarter and
 * region (hay, greenfeed and straw in $/lb, silage in $/tonne), the Feed Grain
 * list by month and station (wheat, oats, barley in $/tonne, farm gate). The
 * farm reads the South region and the Lethbridge station. The newest filled
 * column is the price.
 *
 * Only feeds priced from the list (price_source 'afsc', or none yet) are
 * written: a price typed by hand stays until it is cleared.
 */

export const AFSC_LISTS_PAGE = 'https://afsc.ca/income-stabilization/agristability/agristability-price-lists/'
const LB_PER_TONNE = 2204.62
const QUARTERS = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const FORAGE_REGIONS = ['Peace', 'Northwest', 'Northeast', 'Central', 'South']

export type ListPrice = { item: string; perTonne: number; period: string }

/** The newest year's PDF of one kind ("Forage", "Feed-Grain") linked from the price-lists page. */
export function latestListUrl(html: string, kind: 'Forage' | 'Feed-Grain'): { url: string; year: number } | null {
  const re = new RegExp(`href="(https://afsc\\.ca/wp-content/uploads/\\d{4}/\\d{2}/(\\d{4})-${kind}(?:-Price-List)?\\.pdf)"`, 'gi')
  let best: { url: string; year: number } | null = null
  for (const m of html.matchAll(re)) {
    const year = Number(m[2])
    if (!best || year > best.year || (year === best.year && m[1] > best.url)) best = { url: m[1], year }
  }
  return best
}

/** The date printed on the list ("August 20, 2026"), as YYYY-MM-DD. */
export function listDate(text: string): string | null {
  const m = /\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (20\d{2})\b/.exec(text)
  if (!m) return null
  return `${m[3]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

/** One region's forage prices, $/tonne, from the newest quarter filled in. */
export function parseForage(text: string, region = 'South'): ListPrice[] {
  const lines = text.split('\n').map((l) => l.trim())
  const start = lines.findIndex((l) => new RegExp(`^${region}\\s+\\$\\s*/`).test(l))
  if (start < 0) return []
  const out: ListPrice[] = []
  for (const line of lines.slice(start + 1)) {
    if (FORAGE_REGIONS.some((r) => new RegExp(`^${r}\\s+\\$\\s*/`).test(line)) || line.startsWith('*')) break
    const m = /^(.+?)\s+(lb|tonne)\s+([\d.\s]+)$/.exec(line)
    if (!m) continue
    const nums = m[3].trim().split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n > 0)
    if (!nums.length) continue
    const last = nums[nums.length - 1]
    out.push({
      item: m[1].trim(),
      perTonne: Math.round((m[2] === 'lb' ? last * LB_PER_TONNE : last) * 100) / 100,
      period: QUARTERS[nums.length - 1] ?? `column ${nums.length}`,
    })
  }
  return out
}

/** One station's feed grain prices, $/tonne farm gate, from the newest month filled in. */
export function parseFeedGrain(text: string, station = 'Lethbridge'): ListPrice[] {
  const lines = text.split('\n').map((l) => l.trim())
  const start = lines.findIndex((l) => l === station)
  if (start < 0) return []
  let latest: { month: string; nums: number[] } | null = null
  for (const line of lines.slice(start + 1)) {
    const m = /^(January|February|March|April|May|June|July|August|September|October|November|December)\b\s*([\d.\s]*)$/.exec(line)
    if (!m) {
      if (/^\$\//.test(line)) continue
      break
    }
    const nums = m[2].trim() ? m[2].trim().split(/\s+/).map(Number) : []
    if (nums.length >= 6) latest = { month: m[1], nums }
    if (m[1] === 'December') break
  }
  if (!latest) return []
  // Columns: wheat $/t, $/bu, oats $/t, $/bu, barley $/t, $/bu.
  return [
    { item: 'Feed Wheat', perTonne: latest.nums[0], period: latest.month },
    { item: 'Feed Oats', perTonne: latest.nums[2], period: latest.month },
    { item: 'Feed Barley', perTonne: latest.nums[4], period: latest.month },
  ]
}

async function pdfText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (RVR-Management feed prices)' } })
  if (!r.ok) throw new Error(`${r.status} from ${url}`)
  const pdf = await getDocumentProxy(new Uint8Array(await r.arrayBuffer()))
  return String((await extractText(pdf, { mergePages: true })).text)
}

/** Read both lists and price every feed that follows them. */
export async function syncAfscFeedPrices(sb: SupabaseClient): Promise<{ updated: string[]; seen: string }> {
  const page = await fetch(AFSC_LISTS_PAGE, { headers: { 'user-agent': 'Mozilla/5.0 (RVR-Management feed prices)' } })
  if (!page.ok) throw new Error(`${page.status} from AFSC's price-lists page`)
  const html = await page.text()
  const forage = latestListUrl(html, 'Forage')
  const grain = latestListUrl(html, 'Feed-Grain')
  if (!forage && !grain) throw new Error('No Forage or Feed Grain price list linked on AFSC’s page')

  const prices = new Map<string, ListPrice & { url: string; listed: string | null; list: string }>()
  for (const [list, ref, parse] of [
    ['Forage', forage, (t: string) => parseForage(t)],
    ['Feed Grain', grain, (t: string) => parseFeedGrain(t)],
  ] as const) {
    if (!ref) continue
    const text = await pdfText(ref.url)
    const listed = listDate(text)
    for (const p of parse(text)) prices.set(p.item.toLowerCase(), { ...p, url: ref.url, listed, list: `${ref.year} ${list}` })
  }
  if (!prices.size) throw new Error('The price lists were read but no South / Lethbridge prices were found in them')

  const { data: types, error } = await sb.from('feed_types').select('id, name, afsc_item, price_per_tonne, price_source').not('afsc_item', 'is', null)
  if (error) throw error
  const updated: string[] = []
  for (const t of types ?? []) {
    if (t.price_source && t.price_source !== 'afsc') continue
    const p = prices.get(String(t.afsc_item).toLowerCase())
    if (!p) continue
    const note = `AFSC ${p.list} price list${p.listed ? ` (${p.listed})` : ''}, ${p.list.includes('Forage') ? 'South region' : 'Lethbridge, farm gate'}, ${p.period}: ${p.item}.`
    const same = t.price_per_tonne != null && Math.abs(Number(t.price_per_tonne) - p.perTonne) < 0.005
    const { error: e } = await sb
      .from('feed_types')
      .update({ price_per_tonne: p.perTonne, price_source: 'afsc', price_as_of: p.listed, price_note: note })
      .eq('id', t.id)
    if (e) throw e
    if (!same) updated.push(`${t.name} $${p.perTonne.toFixed(0)}/t`)
  }
  return { updated, seen: [...prices.values()].map((p) => `${p.item} ${p.perTonne.toFixed(0)} (${p.period})`).join('; ') }
}

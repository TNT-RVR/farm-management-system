import './pdf-polyfills.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractText, getDocumentProxy } from 'unpdf'

/**
 * Alberta Farm Input Prices, loaded without leaving the function.
 *
 * The bulk backfill is scripts/import-ab-input-prices.mjs, which shells out to
 * PyMuPDF. That cannot run in a Netlify function, so the monthly top-up reads
 * the PDF with unpdf instead — these are one-page text PDFs and it manages them
 * where it chokes on the ICI invoices.
 *
 * The two readers see different shapes and the parsing differs accordingly:
 * PyMuPDF puts every cell on its own line, unpdf keeps a row on one line with
 * its three figures at the end. Both take only the third figure, which is the
 * current month — the other two are last month and the same month a year ago,
 * and they are loaded when their own months are read.
 */

const CKAN = 'https://open.alberta.ca/api/3/action'

const CATEGORIES: [string, RegExp][] = [
  ['fertilizer', /^fertilizer\b/],
  ['seed', /^seed,/],
  ['fuel', /^(marked gasoline|diesel fuel|propane|natural gas|electricity|oil, for)/],
  ['feed', /^(calf|feedlot|hog|swine|broiler|cattle mineral|feed barley|feed wheat|feed oats|hay)\b/],
  ['livestock', /^(ivermectin|vitamin a|vaccine|antibiotic)/],
  ['chemical', /containing\s+\w+.*(concentrate|liquid|granul|solution)/],
  ['machinery', /^(tractor|combine|air drill|sprayer|round baler|double disc|3\/4 ton truck|truck tires|storage battery|antifreeze|mechanical repairs|baler twine)/],
  ['building', /^(construction|rough grade|sheathing|fence posts|ready-mix|nails|pipe|rods|barbed wire|grain bin|grain bag)/],
  ['labour', /^general farm labour/],
]

function categorise(item: string): string {
  const low = item.toLowerCase()
  for (const [name, pattern] of CATEGORIES) if (pattern.test(low)) return name
  return 'other'
}

/** "1,285.00" → 1285. "110,309,40" → 110309.40, repairing the survey's typo. */
function toNumber(raw: string): number | null {
  const text = raw.trim().replace(/,(\d{2})$/, '.$1').replace(/,/g, '')
  if (!text || text === '-') return null
  const n = Number(text)
  return Number.isFinite(n) && n > 0 ? n : null
}

function slug(item: string): string {
  return item
    .toLowerCase()
    .replace(/\*+/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/** The trailing clause naming the unit: "tonne", "100 litres", "22.7 kg". */
function unitOf(item: string): string | null {
  const parts = item.split(',').map((p) => p.trim())
  return parts.length > 1 ? parts[parts.length - 1] : null
}

export type ParsedRow = {
  item: string
  item_key: string
  category: string
  unit: string | null
  observed_on: string
  price: number
}

// A row: description, then three figures. The description is non-greedy and the
// figures are anchored to the end, because descriptions are full of numbers of
// their own — "2x6", "9.6 mm", "LT285-70R-17" — and a greedy match eats them.
const ROW = /^(.*?[A-Za-z].*?)\s+(-|[\d,]+(?:[.,]\d{2})?)\s+(-|[\d,]+(?:[.,]\d{2})?)\s+(-|[\d,]+(?:[.,]\d{2})?)\s*$/

export function parseText(text: string, observedOn: string): ParsedRow[] {
  const rows: ParsedRow[] = []
  const seen = new Set<string>()

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length < 12) continue
    const m = ROW.exec(line)
    if (!m) continue

    const item = m[1].replace(/\s*\*+\s*$/, '').trim()
    const price = toNumber(m[4])
    if (!price || item.length < 9) continue

    const key = slug(item)
    // A repeated key in one month means a description was paired with somebody
    // else's figures. Keep the first and let the caller's floor catch it.
    if (!key || seen.has(key)) continue
    seen.add(key)

    rows.push({
      item,
      item_key: key,
      category: categorise(item),
      unit: unitOf(item),
      observed_on: observedOn,
      price,
    })
  }
  return rows
}

/** The month a resource covers, from its filename. */
export function monthOf(url: string): string | null {
  const m = /(\d{4})-(\d{2})\.pdf$/i.exec(url)
  return m ? `${m[1]}-${m[2]}-01` : null
}

export async function runAbInputPricesPull(
  sb: SupabaseClient,
): Promise<{ checked: number; loaded: string[]; skipped: string[] }> {
  const res = await fetch(`${CKAN}/package_search?q=title:"Alberta farm input prices"&rows=2`)
  if (!res.ok) throw new Error(`CKAN ${res.status}`)
  const body = (await res.json()) as {
    result?: { results?: { resources?: { url?: string; format?: string }[] }[] }
  }

  const resources: { url: string; month: string }[] = []
  for (const d of body.result?.results ?? [])
    for (const r of d.resources ?? []) {
      if (!/pdf/i.test(r.format ?? '') || !r.url) continue
      const month = monthOf(r.url)
      if (month) resources.push({ url: r.url, month })
    }

  const { data: existing } = await sb.from('ab_input_prices').select('observed_on')
  const have = new Set((existing ?? []).map((r) => r.observed_on as string))

  const missing = resources
    .filter((r) => !have.has(r.month))
    .sort((a, b) => a.month.localeCompare(b.month))

  const loaded: string[] = []
  const skipped: string[] = []

  for (const r of missing) {
    const pdfRes = await fetch(r.url)
    if (!pdfRes.ok) {
      skipped.push(`${r.month}: download ${pdfRes.status}`)
      continue
    }
    let rows: ParsedRow[]
    try {
      const pdf = await getDocumentProxy(new Uint8Array(await pdfRes.arrayBuffer()))
      const { text } = await extractText(pdf, { mergePages: true })
      rows = parseText(text, r.month)
    } catch (e) {
      skipped.push(`${r.month}: could not read — ${(e as Error).message.slice(0, 80)}`)
      continue
    }

    // A month that reads as almost nothing means the layout changed. Loading it
    // would leave a hole in the series that looks like data.
    if (rows.length < 20) {
      skipped.push(`${r.month}: only ${rows.length} item(s) read — layout may have changed`)
      continue
    }

    const { error } = await sb.from('ab_input_prices').upsert(
      rows.map((row) => ({ ...row, source_file: r.url.split('/').pop() })),
      { onConflict: 'item_key,observed_on' },
    )
    if (error) {
      skipped.push(`${r.month}: ${error.message.slice(0, 80)}`)
      continue
    }
    loaded.push(`${r.month} (${rows.length})`)
  }

  return { checked: resources.length, loaded, skipped }
}

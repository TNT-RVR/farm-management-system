import './pdf-polyfills.ts'
// Alberta's Weekly Livestock and Crop Market Reviews.
//
// Both are published by Alberta Agriculture's Statistics and Data Development
// Section as a PDF a week, free, with a real text layer. Between them they carry
// almost everything a Prairie farm needs and nobody else gives away: feeder
// cattle by weight class at the Alberta auction markets, the CME live and feeder
// futures curves, the Canadian dollar futures curve, elevator bids by region,
// ICE canola, and the US grain futures.
//
// ── Why this is parsed with regular expressions and not a language model ─────
//
// The chemical-label pipeline hands PDFs to Claude because a label is prose and
// every manufacturer writes it differently. These are neither: they are a fixed
// table, published to the same template every Friday, and the numbers must be
// right rather than plausible. A deterministic parse either matches or does not,
// and when it does not this refuses to write anything — which is the behaviour
// you want from something that feeds a selling decision.
//
// The catch is that the PDF is multi-column, so flattening it interleaves
// unrelated tables on one line. A single physical line really does read:
//
//   AUG 231.70 -0.05 AUG 351.65 +3.63 CLYDE N/A 520.00 - 618.00 450.00 - 530.00 ...
//   └ live futures ┘ └ feeder futures ┘ └──── 700-800 lb feeder steers ──────┘
//
// So each field is anchored on its own distinctive shape rather than on a column
// position, and the weight-class headers are tracked as the scan moves down.

const CKAN = 'https://open.alberta.ca/api/3/action/package_show'
export const LIVESTOCK_PACKAGE = '90297161-7a1c-4de6-b192-16f6eea98bbf'
export const CROP_PACKAGE = 'b23eeb3f-8059-4dce-b23b-cf552736dc61'

export type Quote = {
  code: string
  name: string
  commodity: string
  unit: string
  region: string | null
  value: number | null
  low: number | null
  high: number | null
  derived?: boolean
}

export type FuturesQuote = {
  code: string
  name: string
  commodity: string
  unit: string
  /** First of the contract month. */
  contractMonth: string
  value: number
}

export type ReviewParse = {
  /** The date the issue is "as of", from its own headings. */
  observedOn: string | null
  quotes: Quote[]
  futures: FuturesQuote[]
  warnings: string[]
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}

/**
 * A futures month label to a real date.
 *
 * The reports write only "DEC", so the year is inferred: a contract month at or
 * after the issue's month is this year, otherwise it has rolled into next. That
 * is what makes a January contract quoted in August land in the right year.
 */
export function contractDate(label: string, issued: Date): string | null {
  const m = MONTHS[label.toUpperCase()]
  if (!m) return null
  const year = m >= issued.getUTCMonth() + 1 ? issued.getUTCFullYear() : issued.getUTCFullYear() + 1
  return `${year}-${String(m).padStart(2, '0')}-01`
}

/** "Aug07/2026" or "Aug07/26" as an ISO date. */
export function parseIssueDate(text: string): string | null {
  const m = text.match(/\b([A-Z][a-z]{2})\s?(\d{1,2})\/(\d{2,4})\b/)
  if (!m) return null
  const month = MONTHS[m[1].toUpperCase()]
  if (!month) return null
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  return `${year}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

const num = (s: string | undefined): number | null => {
  if (!s || /^n\/a$/i.test(s.trim())) return null
  const v = Number(s.replace(/,/g, ''))
  return Number.isFinite(v) ? v : null
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// ── Livestock ───────────────────────────────────────────────────────────────

/** The auction markets the review quotes, plus Ontario for comparison. */
const MARKETS = ['CLYDE', 'PONOKA', 'STRATHMORE', 'ONTARIO']

const WEIGHT_CLASS = /(\d{3})-(\d{3})\s+LB\s+FEEDER\s+(STEERS|HEIFERS)/g

/**
 * Feeder cattle by weight class and auction market.
 *
 * Each market line carries three range columns — this week, last week, a year
 * ago — and only the first is taken. The other two are the same numbers this
 * function already stored on earlier runs, and trusting a report's memory over
 * our own would let a typo in one issue rewrite history.
 */
export function parseFeederQuotes(text: string): { quotes: Quote[]; warnings: string[] } {
  const quotes: Quote[] = []
  const warnings: string[] = []

  // Where each weight-class header sits in the flattened text, so a market line
  // can be attributed to the header most recently above it.
  const headers: { at: number; lo: number; hi: number; sex: string }[] = []
  for (const m of text.matchAll(WEIGHT_CLASS)) {
    headers.push({
      at: m.index ?? 0,
      lo: Number(m[1]),
      hi: Number(m[2]),
      sex: m[3].toLowerCase(),
    })
  }
  if (headers.length === 0) {
    warnings.push('no feeder weight-class headings found')
    return { quotes, warnings }
  }

  const marketRow = new RegExp(
    `\\b(${MARKETS.join('|')})\\s+((?:N/A|[\\d.]+\\s*-\\s*[\\d.]+))\\s+((?:N/A|[\\d.]+\\s*-\\s*[\\d.]+))`,
    'g',
  )
  for (const m of text.matchAll(marketRow)) {
    const at = m.index ?? 0
    // The header governing this row is the last one that starts before it.
    const head = [...headers].reverse().find((h) => h.at < at)
    if (!head) continue
    const range = m[2].trim()
    if (/^n\/a$/i.test(range)) continue
    const [lo, hi] = range.split(/\s*-\s*/).map((x) => num(x))
    if (lo == null || hi == null) continue
    const market = m[1]
    quotes.push({
      code: `ab.feeder.${head.sex}.${head.lo}-${head.hi}.${slug(market)}`,
      name: `${head.lo}-${head.hi} lb feeder ${head.sex} — ${market[0]}${market.slice(1).toLowerCase()}`,
      commodity: `Feeder ${head.sex} ${head.lo}-${head.hi} lb`,
      // The review heads this block "$/CWT" and the numbers are hundreds of
      // dollars — a 550 lb steer at $700/cwt is $3,850, which is the right
      // order for 2026. Recorded as quoted; the UI converts to $/lb.
      unit: '$/cwt',
      region: market[0] + market.slice(1).toLowerCase(),
      value: (lo + hi) / 2,
      low: lo,
      high: hi,
    })
  }
  if (quotes.length === 0) warnings.push('weight-class headings found but no market rows parsed')
  return { quotes, warnings }
}

/**
 * The CME live and feeder curves, and the Canadian dollar curve.
 *
 * All three are laid out as MONTH VALUE CHANGE, and on the same physical lines
 * as each other. They are told apart by magnitude, which is not a trick so much
 * as a fact: cattle trade in the hundreds and the dollar near 0.7, and there is
 * no overlap to be confused about.
 */
export function parseCattleFutures(
  text: string,
  issued: Date,
): { futures: FuturesQuote[]; warnings: string[] } {
  const futures: FuturesQuote[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  const triple = /\b([A-Z]{3})\s+(\d+\.\d+)\s+([+-]\d+\.\d+)/g
  // Only the block between the cattle-futures heading and the hog indicators
  // carries these; the hog curve uses the same shape and must not be mistaken
  // for cattle.
  const start = text.search(/CATTLE FUTURES/)
  const body = start >= 0 ? text.slice(start) : text

  for (const m of body.matchAll(triple)) {
    const month = contractDate(m[1], issued)
    const value = num(m[2])
    if (!month || value == null) continue

    let spec: { code: string; name: string; commodity: string; unit: string } | null = null
    if (value > 0.5 && value < 1.2) {
      spec = { code: 'cme.cad', name: 'Canadian dollar futures', commodity: 'CAD/USD', unit: 'USD per CAD' }
    } else if (value >= 250 && value <= 600) {
      spec = { code: 'cme.feeder', name: 'CME feeder cattle futures', commodity: 'Feeder cattle', unit: 'USD/cwt' }
    } else if (value >= 150 && value < 250) {
      spec = { code: 'cme.live', name: 'CME live cattle futures', commodity: 'Live cattle', unit: 'USD/cwt' }
    }
    // Lean hogs sit at 70-100 and match none of the above, which is the point.
    if (!spec) continue
    const key = `${spec.code}|${month}`
    if (seen.has(key)) continue
    seen.add(key)
    futures.push({ ...spec, contractMonth: month, value })
  }

  for (const code of ['cme.feeder', 'cme.live', 'cme.cad']) {
    if (!futures.some((f) => f.code === code)) warnings.push(`no ${code} contracts parsed`)
  }
  return { futures, warnings }
}

/** The spot Canadian dollar, quoted in US cents at the top of the review. */
export function parseSpotFx(text: string): Quote | null {
  const m = text.match(/CAN\/US\s*\$\s*[A-Z][a-z]{2}\s?\d{1,2}\/\d{2}\s+(\d{2}\.\d+)/)
  const cents = num(m?.[1])
  if (cents == null) return null
  return {
    code: 'ab.fx.cadusd',
    name: 'Canadian dollar — spot',
    commodity: 'CAD/USD',
    unit: 'USD per CAD',
    region: null,
    value: cents / 100,
    low: null,
    high: null,
  }
}

export function parseLivestockReview(text: string): ReviewParse {
  const observedOn = parseIssueDate(text)
  const issued = observedOn ? new Date(`${observedOn}T12:00:00Z`) : new Date()
  const feeders = parseFeederQuotes(text)
  const fut = parseCattleFutures(text, issued)
  const fx = parseSpotFx(text)
  return {
    observedOn,
    quotes: [...feeders.quotes, ...(fx ? [fx] : [])],
    futures: fut.futures,
    warnings: [
      ...feeders.warnings,
      ...fut.warnings,
      ...(observedOn ? [] : ['could not read the issue date']),
      ...(fx ? [] : ['no spot exchange rate found']),
    ],
  }
}

// ── Fetching ────────────────────────────────────────────────────────────────

/** The newest issue's PDF URL, and the date in its filename. */
export async function latestIssueUrl(packageId: string): Promise<string | null> {
  const res = await fetch(`${CKAN}?id=${packageId}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) return null
  const body = (await res.json()) as {
    result?: { resources?: { url?: string; format?: string }[] }
  }
  const pdf = body.result?.resources?.find((r) => (r.format ?? '').toUpperCase() === 'PDF' && r.url)
  return pdf?.url ?? null
}

/** "FEED WHEAT" -> "Feed wheat". Written without a word-boundary escape on
 * purpose: a word-boundary escape has been mangled into a literal backspace by this project's
 * tooling four times now, and the last one shipped. */
function titleCase(s: string): string {
  const lower = s.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

// ── Crops ───────────────────────────────────────────────────────────────────

/**
 * A CBOT price like "6.59 1/2".
 *
 * Grain futures are quoted in cents and eighths of a cent, so the fraction is
 * hundredths of a dollar: 6.59 1/2 is $6.595 a bushel, not $6.59 and a half
 * bushel. Reading it as 6.59 would be wrong by half a cent on every contract,
 * which is small money on a bushel and real money on a crop.
 */
export function parseFraction(s: string): number | null {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)(?:\s+(\d)\/(\d))?$/)
  if (!m) return null
  const base = Number(m[1])
  if (!Number.isFinite(base)) return null
  if (!m[2]) return base
  return base + Number(m[2]) / Number(m[3]) / 100
}

/**
 * Elevator bids, delivered, in CDN $/tonne.
 *
 * The line that matters most on this page: "DURUM -South 278.23" is the bid in
 * Prairie Creek's own region, not a provincial average. Only the first figure is
 * taken — the second is last week's, which we already stored last week.
 */
export function parseElevatorBids(text: string): { quotes: Quote[]; warnings: string[] } {
  const quotes: Quote[] = []
  // Deliberately NOT anchored to the line: the PDF's columns flatten so that a
  // bid can land mid-line behind unrelated text ("CANOLA -SASK NOV26 FEED OATS
  // -*Central 233.43 233.43"). The commodity is capped at two words so the
  // leftover from the column to its left is not swallowed into the name.
  const row = /\b([A-Z]{2,}(?:\s+[A-Z]{2,})?)\s+-(\*?[A-Za-z]+)\s+(\d+\.\d{2})\s+(\d+\.\d{2})\b/g
  for (const m of text.matchAll(row)) {
    const commodity = m[1].trim()
    const region = m[2].replace(/^\*/, '')
    const value = num(m[3])
    if (value == null) continue
    quotes.push({
      code: `ab.elevator.${slug(commodity)}.${slug(region)}`,
      name: `${commodity} elevator bid — ${region}`,
      commodity: titleCase(commodity),
      unit: '$/tonne',
      region,
      value,
      low: null,
      high: null,
    })
  }
  return {
    quotes,
    warnings: quotes.length === 0 ? ['no elevator bids parsed'] : [],
  }
}

/** Which US exchange a contract traded on, spelled as the review spells it. */
const US_EXCHANGES = ['CBT', 'MINN', 'KANS']

/**
 * US grain futures, in US $/bushel.
 *
 * Worth more here than it looks: StatCan publishes no Alberta corn price at
 * all, so CBOT corn is the only forward view this farm has on a crop it grows.
 *
 * A continuation line carries no commodity — "-CBT DEC26" follows "CORN -CBT
 * SEP26" — so the last named commodity carries forward, which is exactly how a
 * person reads the page.
 */
export function parseUsFutures(text: string): { futures: FuturesQuote[]; warnings: string[] } {
  const futures: FuturesQuote[] = []
  const start = text.search(/U\.S\. FUTURES/)
  if (start < 0) return { futures, warnings: ['no US futures block found'] }

  // Backslashes are DOUBLED because this is a template literal, not a regex
  // literal: `\s` inside backticks is the letter s, and the pattern silently
  // becomes nonsense that matches nothing.
  const row = new RegExp(
    `(?:^|\\n)\\s*([A-Z]+)?\\s*-(${US_EXCHANGES.join('|')})\\s+([A-Z]{3})(\\d{2})\\s+(\\d+\\.\\d{2}(?:\\s+\\d\\/\\d)?)`,
    'g',
  )
  let commodity = ''
  for (const m of text.slice(start).matchAll(row)) {
    if (m[1]) commodity = m[1]
    if (!commodity) continue
    const value = parseFraction(m[5])
    // The year is written out here ("SEP26"), so unlike the cattle report there
    // is nothing to infer.
    const month = MONTHS[m[3].toUpperCase()]
    if (value == null || !month) continue
    futures.push({
      code: `us.${slug(commodity)}.${slug(m[2])}`,
      name: `${commodity[0]}${commodity.slice(1).toLowerCase()} futures — ${m[2]}`,
      commodity: commodity[0] + commodity.slice(1).toLowerCase(),
      unit: 'USD/bu',
      contractMonth: `20${m[4]}-${String(month).padStart(2, '0')}-01`,
      value,
    })
  }
  return { futures, warnings: futures.length === 0 ? ['no US futures parsed'] : [] }
}

/**
 * ICE canola futures — the one series this page will not give up easily.
 *
 * The PDF's columns flatten out of order: the contract labels ("CANOLA -SASK
 * NOV26") land near the top and their HIGH/LOW/CLOSE/CHANGE rows are orphaned
 * at the very bottom, with nothing tying the two together.
 *
 * So they are paired by position, but only after checking that the count of
 * labels matches the count of orphan rows in canola's price band. If the layout
 * shifts and those disagree, this returns nothing rather than pairing a
 * November price onto a March contract — a wrong futures curve is worse than no
 * futures curve, because you would act on it.
 */
export function parseIceCanola(text: string): { futures: FuturesQuote[]; warnings: string[] } {
  const labels = [...text.matchAll(/-SASK\s+([A-Z]{3})(\d{2})/g)]
  const rows = [...text.matchAll(/^(\d{3}\.\d{2})\s+(\d{3}\.\d{2})\s+(\d{3}\.\d{2})\s+([+-]\d+\.\d{2})\s*$/gm)]
    // Canola trades in the 600-1000 band; nothing else quoted in four columns
    // on this page comes near it.
    .filter((m) => Number(m[3]) >= 600 && Number(m[3]) <= 1000)

  if (labels.length === 0) return { futures: [], warnings: ['no ICE canola contracts listed'] }
  if (labels.length !== rows.length) {
    return {
      futures: [],
      warnings: [
        `ICE canola: ${labels.length} contracts but ${rows.length} price rows — not paired`,
      ],
    }
  }
  const futures = labels.map((l, i) => {
    const month = MONTHS[l[1].toUpperCase()]
    return {
      code: 'ice.canola',
      name: 'ICE canola futures',
      commodity: 'Canola',
      unit: '$/tonne',
      contractMonth: `20${l[2]}-${String(month).padStart(2, '0')}-01`,
      // The third column is the close.
      value: Number(rows[i][3]),
    }
  })
  return { futures, warnings: [] }
}

/** The exchange rate the review itself used that week. */
export function parseCropFx(text: string): Quote | null {
  const m = text.match(/US \$ in CANADA \$\s+(\d\.\d+)\s+(\d\.\d+)/)
  const cadPerUsd = num(m?.[1])
  if (cadPerUsd == null) return null
  return {
    code: 'ab.fx.usdcad',
    name: 'US dollar in Canadian dollars',
    commodity: 'USD/CAD',
    unit: 'CAD per USD',
    region: null,
    value: cadPerUsd,
    low: null,
    high: null,
  }
}

export function parseCropReview(text: string): ReviewParse {
  const observedOn = parseIssueDate(text)
  const bids = parseElevatorBids(text)
  const us = parseUsFutures(text)
  const ice = parseIceCanola(text)
  const fx = parseCropFx(text)
  return {
    observedOn,
    quotes: [...bids.quotes, ...(fx ? [fx] : [])],
    futures: [...us.futures, ...ice.futures],
    warnings: [
      ...bids.warnings,
      ...us.warnings,
      ...ice.warnings,
      ...(observedOn ? [] : ['could not read the issue date']),
      ...(fx ? [] : ['no exchange rate found']),
    ],
  }
}

// ── Ingestion ───────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import { extractText, getDocumentProxy } from 'unpdf'

/** Fetch the newest issue and read its text layer. */
export async function fetchReviewText(packageId: string): Promise<string | null> {
  const url = await latestIssueUrl(packageId)
  if (!url) return null
  const res = await fetch(url)
  if (!res.ok) return null
  const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()))
  const { text } = await extractText(pdf, { mergePages: true })
  return text
}

async function seriesId(
  sb: SupabaseClient,
  q: { code: string; name: string; commodity: string; unit: string; region?: string | null; derived?: boolean },
  kind: 'cattle' | 'crop' | 'fx',
  source: 'ab-cattle' | 'ab-crop',
): Promise<string | null> {
  const { data } = await sb
    .from('market_series')
    .upsert(
      {
        code: q.code,
        kind,
        name: q.name,
        commodity: q.commodity,
        unit: q.unit,
        region: q.region ?? null,
        source,
        derived: q.derived ?? false,
        notes: 'Alberta Agriculture, Weekly Market Review.',
      },
      { onConflict: 'code' },
    )
    .select('id')
    .single()
  return (data?.id as string) ?? null
}

/** Pull the newest crop review into the price tables. */
export async function runAlbertaCropSync(
  sb: SupabaseClient,
): Promise<{ ok: boolean; quotes: number; futures: number; detail: string }> {
  const text = await fetchReviewText(CROP_PACKAGE)
  if (!text) return { ok: false, quotes: 0, futures: 0, detail: 'could not fetch the review PDF' }
  const parsed = parseCropReview(text)
  return writeReview(sb, parsed, 'crop', 'ab-crop')
}

export async function runAlbertaLivestockSync(
  sb: SupabaseClient,
): Promise<{ ok: boolean; quotes: number; futures: number; detail: string }> {
  const text = await fetchReviewText(LIVESTOCK_PACKAGE)
  if (!text) return { ok: false, quotes: 0, futures: 0, detail: 'could not fetch the review PDF' }

  return writeReview(sb, parseLivestockReview(text), 'cattle', 'ab-cattle')
}

/**
 * Store a parsed issue.
 *
 * Writes nothing at all when the parse came back empty. A layout change should
 * show up as a stale chart and a warning in the sync detail, never as a row of
 * plausible-looking numbers nobody can trace.
 */
async function writeReview(
  sb: SupabaseClient,
  parsed: ReviewParse,
  kind: 'cattle' | 'crop',
  source: 'ab-cattle' | 'ab-crop',
): Promise<{ ok: boolean; quotes: number; futures: number; detail: string }> {
  if (!parsed.observedOn || (parsed.quotes.length === 0 && parsed.futures.length === 0)) {
    return {
      ok: false,
      quotes: 0,
      futures: 0,
      detail: `nothing parsed — ${parsed.warnings.join('; ') || 'unknown layout'}`,
    }
  }

  let quotes = 0
  for (const q of parsed.quotes) {
    const id = await seriesId(sb, q, q.code.startsWith('ab.fx') ? 'fx' : kind, source)
    if (!id) continue
    const { error } = await sb
      .from('market_prices')
      .upsert(
        { series_id: id, observed_on: parsed.observedOn, value: q.value, low: q.low, high: q.high },
        { onConflict: 'series_id,observed_on' },
      )
    if (!error) quotes++
  }

  let futures = 0
  const ids = new Map<string, string>()
  for (const f of parsed.futures) {
    let id = ids.get(f.code)
    if (!id) {
      id = (await seriesId(sb, f, f.code === 'cme.cad' ? 'fx' : kind, source)) ?? ''
      if (!id) continue
      ids.set(f.code, id)
    }
    const { error } = await sb.from('market_futures').upsert(
      {
        series_id: id,
        quote_on: parsed.observedOn,
        contract_month: f.contractMonth,
        value: f.value,
      },
      { onConflict: 'series_id,quote_on,contract_month' },
    )
    if (!error) futures++
  }

  const detail =
    `issue ${parsed.observedOn}: ${quotes} quotes, ${futures} futures` +
    (parsed.warnings.length ? ` · ${parsed.warnings.join('; ')}` : '')
  return { ok: true, quotes, futures, detail }
}

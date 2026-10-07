// Reading the four auction markets' reports into price rows.
//
// Pure — no fetching, no database — so every rule here is tested against the
// real reports saved in src/lib/__fixtures__. The I/O is cattle-auctions.ts.
//
//   Medicine Hat (MHFC)   a scanned PDF a sale, no text layer: read by Claude
//                         (see cattle-auctions.ts) into the JSON validated here.
//   Lethbridge (Perlich)  a public JSON API behind their market-report page.
//   Calgary Stockyards    an HTML table on their home page, replaced weekly.
//   Team online           a static HTML report, replaced weekly.
//
// Every price is $/cwt, as the markets quote it. The tab converts to $/lb.

import {
  commodityFor,
  normaliseBand,
  seriesCode,
  seriesName,
  marketByKey,
  type AuctionClass,
  type Band,
  type MarketKey,
} from '../../src/lib/auction-markets.ts'

export type AuctionRow = {
  code: string
  name: string
  commodity: string
  market: MarketKey
  /** The headline: the market's own average, or the middle of its range when it prints none. */
  value: number
  low: number | null
  high: number | null
  head: number | null
  avgWeightLb: number | null
  weightMinLb: number | null
  weightMaxLb: number | null
  /** Perlich's "sales to": the top single sale, above the quoted range. */
  top: number | null
  /** The class as the market printed it, before any mapping. */
  classLabel: string
}

export type ParsedReport = {
  market: MarketKey
  reportKey: string
  saleDate: string
  url: string
  title: string | null
  totalHead: number | null
  comment: string | null
  rows: AuctionRow[]
  /** Classes the report carried that are not stored (priced per head, dairy, unknown). */
  skipped: string[]
}

const round2 = (v: number) => Math.round(v * 100) / 100

function row(
  market: MarketKey,
  cls: AuctionClass,
  kind: string,
  band: Band | null,
  r: Omit<AuctionRow, 'code' | 'name' | 'commodity' | 'market'>,
): AuctionRow {
  const parts = { cls, kind, band, market }
  return { ...r, code: seriesCode(parts), name: seriesName(parts), commodity: commodityFor(parts), market }
}

/**
 * Two rows for the same series on the same day become one, weighted by head.
 *
 * Medicine Hat now and then posts two reports for one sale date (a regular
 * sale and a cow/calf sale). market_prices holds one observation per series a
 * day, so the second must be merged rather than overwrite the first.
 */
export function combineSameDay(rows: AuctionRow[]): AuctionRow[] {
  const by = new Map<string, AuctionRow>()
  for (const r of rows) {
    const cur = by.get(r.code)
    if (!cur) {
      by.set(r.code, { ...r })
      continue
    }
    const ha = cur.head ?? 1
    const hb = r.head ?? 1
    const w = (a: number | null, b: number | null) =>
      a == null ? b : b == null ? a : round2((a * ha + b * hb) / (ha + hb))
    by.set(r.code, {
      ...cur,
      value: w(cur.value, r.value) as number,
      low: cur.low == null || r.low == null ? (cur.low ?? r.low) : Math.min(cur.low, r.low),
      high: cur.high == null || r.high == null ? (cur.high ?? r.high) : Math.max(cur.high, r.high),
      head: cur.head == null && r.head == null ? null : ha + hb,
      avgWeightLb: w(cur.avgWeightLb, r.avgWeightLb),
      weightMinLb: cur.weightMinLb == null || r.weightMinLb == null ? (cur.weightMinLb ?? r.weightMinLb) : Math.min(cur.weightMinLb, r.weightMinLb),
      weightMaxLb: cur.weightMaxLb == null || r.weightMaxLb == null ? (cur.weightMaxLb ?? r.weightMaxLb) : Math.max(cur.weightMaxLb, r.weightMaxLb),
      top: cur.top == null || r.top == null ? (cur.top ?? r.top) : Math.max(cur.top, r.top),
      classLabel: cur.classLabel === r.classLabel ? cur.classLabel : `${cur.classLabel}; ${r.classLabel}`,
    })
  }
  return [...by.values()]
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** "September 30, 2026" → "2026-09-30". */
export function parseLongDate(s: string): string | null {
  const m = /^\s*([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})\s*$/.exec(s)
  if (!m) return null
  const month = MONTHS[m[1].toLowerCase()]
  return month ? iso(Number(m[3]), month, Number(m[2])) : null
}

/**
 * A day and month with no year ("October 2nd") as the most recent such date
 * on or before `today` — give or take three days for a report dated ahead.
 */
export function dateWithoutYear(month: number, day: number, today: string): string {
  const y = Number(today.slice(0, 4))
  const cand = iso(y, month, day)
  const ahead = (Date.parse(`${cand}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000
  return ahead > 3 ? iso(y - 1, month, day) : cand
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;|&emsp;|&ensp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
const text = (html: string) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()

const price = (s: string | null | undefined): number | null => {
  if (s == null) return null
  const t = String(s).replace(/[$,\s]/g, '')
  if (!t || /^n\/?a$/i.test(t)) return null
  const v = Number(t)
  return Number.isFinite(v) && v > 0 ? v : null
}

// ── Medicine Hat Feeder Co-op ───────────────────────────────────────────────

export type MhfcListing = {
  /** The number before the underscore in the file name — MHFC's own id, rising over time. */
  reportId: number
  saleDate: string
  url: string
  title: string
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png'
}

/** The report list page: one row per report, newest first, back to 2014. */
export function parseMhfcListing(html: string): MhfcListing[] {
  const out: MhfcListing[] = []
  for (const tr of html.split(/<tr[\s>]/i).slice(1)) {
    const date = /<td[^>]*>([^<]*)<\/td>/i.exec(tr)?.[1]
    const link = /href="([^"]*\/uploads\/reports\/(\d+)_[^"]*\.(pdf|jpe?g|png))"[^>]*>([^<]*)</i.exec(tr)
    if (!date || !link) continue
    const saleDate = parseLongDate(decode(date))
    if (!saleDate) continue
    const ext = link[3].toLowerCase()
    out.push({
      reportId: Number(link[2]),
      saleDate,
      url: link[1].startsWith('http') ? link[1] : `https://mhfc.ca${link[1]}`,
      title: text(link[4]),
      mediaType: ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg',
    })
  }
  return out
}

/** The prompt Claude reads each scanned report with. The reply is validated, not trusted. */
export const MHFC_PROMPT = `This is a market report from Medicine Hat Feeder Co-op, a cattle auction in Medicine Hat, Alberta. It is a scan. Transcribe every table on it exactly.

Return ONLY this JSON — no prose, no code fence:
{"sale_date":"YYYY-MM-DD","total_head":number|null,"sections":[{"class":string,"price_unit":"cwt"|"head","rows":[{"weight_class":string,"class_lo":number,"class_hi":number,"lot_min":number|null,"lot_max":number|null,"low":number,"high":number,"head":number,"avg":number,"avg_weight":number}]}],"unreadable":string[],"notes":string[]}

Rules:
- One section per class heading, in page order. "class" is the heading exactly as printed, e.g. "SLAUGHTER HEIFER", "YR STEER", "BULL CALF". Older reports have no headings and print the class in a DESCRIPTION column instead ("FEEDER HEIFERS 400 TO 499"): then "class" is the words ("FEEDER HEIFERS") and weight_class the weights ("400 TO 499"), one section per class.
- weight_class is the row label as printed ("501 to 600 lbs"); class_lo and class_hi are its two numbers (501 and 600). For "less than 200 lbs", "under 200" or "0 TO 1099", class_lo is 0.
- lot_min and lot_max are the two numbers in the WEIGHT column ("572-592"). Some reports print a single weight there instead of a range: then lot_min and lot_max are null and that single figure is avg_weight.
- low, high and avg are the LOW, HIGH and AVG $ columns; head is HEAD; avg_weight is AVG WT.
- price_unit is "cwt" when the prices are dollars per hundredweight (tens or hundreds of dollars), "head" when they are dollars per animal (bred cows, pairs — thousands).
- total_head is the final, overall total head sold printed at the foot (when several TOTAL SOLD figures are printed — e.g. one before a last class — use the last, grand total); null if none is printed. sale_date is the date printed at the top.
- Copy every number exactly as printed. Do not round, correct or work anything out.
- If any figure cannot be read with certainty, do not guess it: name the class and row in unreadable. unreadable is ONLY for figures or headings you cannot read; differences in layout (no lot range, two totals, no headings) are not unreadable — describe them in notes.`

export type MhfcRow = {
  weight_class: string
  class_lo: number
  class_hi: number
  /** Null on reports that print one average weight a row, not a lot range. */
  lot_min: number | null
  lot_max: number | null
  low: number
  high: number
  head: number
  avg: number
  avg_weight: number
}
export type MhfcSection = { class: string; price_unit: 'cwt' | 'head'; rows: MhfcRow[] }
export type MhfcReply = { sale_date: string; total_head: number | null; sections: MhfcSection[]; unreadable: string[]; notes?: string[] }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Whether a transcription can be stored — all of it, or none of it.
 *
 * The checks are the ones a person makes reading a sale report: the average
 * sits inside its own range, the lot weights sit inside their class, one head
 * means one price and one weight, and the rows add up to the printed total. A
 * misread digit almost always breaks one of them. Anything that fails is
 * logged and skipped; a half-read report is never written.
 */
export function validateMhfcReply(
  raw: unknown,
  listedDate: string,
): { ok: true; reply: MhfcReply } | { ok: false; problems: string[] } {
  const problems: string[] = []
  const r = raw as Partial<MhfcReply> | null
  if (!r || typeof r !== 'object') return { ok: false, problems: ['reply is not an object'] }
  if (typeof r.sale_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.sale_date)) {
    problems.push('no sale date')
  } else {
    const gap = Math.abs(Date.parse(`${r.sale_date}T12:00:00Z`) - Date.parse(`${listedDate}T12:00:00Z`)) / 86_400_000
    if (gap > 3) problems.push(`printed date ${r.sale_date} is not the listed ${listedDate}`)
  }
  if (r.total_head != null && !(isNum(r.total_head) && r.total_head > 0)) problems.push('total head is not a number')
  if (!Array.isArray(r.unreadable)) problems.push('unreadable is missing')
  else if (r.unreadable.length) problems.push(`could not read: ${r.unreadable.map(String).join('; ')}`)
  if (!Array.isArray(r.sections) || r.sections.length === 0) {
    problems.push('no sections')
    return { ok: false, problems }
  }

  let headSum = 0
  for (const s of r.sections) {
    const name = typeof s?.class === 'string' ? s.class.trim() : ''
    if (!name) {
      problems.push('a section has no class')
      continue
    }
    if (s.price_unit !== 'cwt' && s.price_unit !== 'head') problems.push(`${name}: price unit is ${String(s.price_unit)}`)
    if (!Array.isArray(s.rows) || s.rows.length === 0) {
      problems.push(`${name}: no rows`)
      continue
    }
    // Buybacks (lots that did not sell, printed at $0) and the "other" bucket
    // only count toward the total head; there is no price in them to check or
    // store. Per-head sections (pairs, bred cows) often print no weight.
    const countOnly = /BUYBACK|NO SALE|PASS(ED)?$|^OTHER$/i.test(name)
    for (const x of s.rows) {
      const at = `${name} ${x?.weight_class ?? '?'}`
      if (countOnly || s.price_unit === 'head') {
        if (isNum(x?.head) && Number.isInteger(x.head) && x.head >= 0) headSum += x.head
        else problems.push(`${at}: head is not a count`)
        continue
      }
      const fields = ['class_lo', 'class_hi', 'low', 'high', 'head', 'avg', 'avg_weight'] as const
      const bad = fields.filter((f) => !isNum(x?.[f]))
      // A lot range is either both numbers or both null (a report that prints one weight a row).
      const hasLots = isNum(x?.lot_min) && isNum(x?.lot_max)
      if (!hasLots && !(x?.lot_min == null && x?.lot_max == null)) bad.push('lot_min, lot_max' as never)
      if (bad.length) {
        problems.push(`${at}: ${bad.join(', ')} not a number`)
        continue
      }
      headSum += x.head
      const eps = 0.01
      if (!(x.class_lo >= 0 && x.class_lo < x.class_hi)) problems.push(`${at}: class ${x.class_lo}-${x.class_hi} runs backwards`)
      if (!(x.low <= x.avg + eps && x.avg <= x.high + eps)) problems.push(`${at}: average ${x.avg} is outside ${x.low}-${x.high}`)
      if (hasLots) {
        const lo = x.lot_min as number
        const hi = x.lot_max as number
        if (!(lo <= hi)) problems.push(`${at}: weights ${lo}-${hi} run backwards`)
        if (lo < x.class_lo - 1 || hi > x.class_hi + 1) problems.push(`${at}: weights ${lo}-${hi} are outside the class`)
        if (!(lo - 1 <= x.avg_weight && x.avg_weight <= hi + 1)) problems.push(`${at}: average weight ${x.avg_weight} is outside ${lo}-${hi}`)
      } else if (x.avg_weight < x.class_lo - 1 || x.avg_weight > x.class_hi + 1) {
        problems.push(`${at}: average weight ${x.avg_weight} is outside the class`)
      }
      if (!(Number.isInteger(x.head) && x.head > 0)) problems.push(`${at}: head ${x.head} is not a count`)
      if (x.head === 1 && (Math.abs(x.low - x.high) > eps || Math.abs(x.avg - x.low) > eps || (hasLots && x.lot_min !== x.lot_max)))
        problems.push(`${at}: one head but more than one price or weight`)
      if (s.price_unit === 'cwt' && (x.low < 1 || x.high > 2500)) problems.push(`${at}: ${x.low}-${x.high} is not a $/cwt price`)
    }
  }
  if (isNum(r.total_head) && headSum !== r.total_head)
    problems.push(`rows add to ${headSum} head, the report's total is ${r.total_head}`)
  return problems.length ? { ok: false, problems } : { ok: true, reply: r as MhfcReply }
}

/**
 * Which of the app's classes a Medicine Hat section is.
 *
 * Read by heading AND weight, because MHFC's headings do not mean what the
 * same words mean elsewhere:
 *
 *  - "SLAUGHTER HEIFER" covers every heifer at the regular sale. The rows up
 *    to 900 lb are priced like feeder heifers ($440-550/cwt), not like
 *    slaughter cattle, so they are stored as YEARLING heifers — never as feeder
 *    calves, where a September 500-600 lb row at $439 would sit beside $600+
 *    heifer calves and drag the headline down. Over 900 lb is slaughter.
 *  - "STEER" / "HEIFER" at a regular sale are mostly fed cattle (900 lb and
 *    up, $360/cwt in January 2026). Only rows up to 900 lb count as feeders.
 *  - "YR STEER" are yearlings — their own series, not calves.
 *
 * The heading as printed is kept on every row (class_label), so the mapping
 * can be revisited without reading the scans again.
 */
export function mhfcClass(printed: string, band: Band): { cls: AuctionClass; kind: string } | null {
  const h = printed.toUpperCase().replace(/\s+/g, ' ').trim()
  const top = band.hi ?? Infinity
  if (/^(YR|YEARLING) STEERS?$/.test(h)) return { cls: 'yearling', kind: 'steers' }
  if (/^(YR|YEARLING) HEIFERS?$/.test(h)) return { cls: 'yearling', kind: 'heifers' }
  if (/^SLAUGHTER HEIFERS?$/.test(h)) return top <= 900 ? { cls: 'yearling', kind: 'heifers' } : { cls: 'slaughter', kind: 'heifers' }
  if (/^SLAUGHTER STEERS?$/.test(h)) return { cls: 'slaughter', kind: 'steers' }
  if (/^STEERS?( CALF| CALVES)?$/.test(h)) return top <= 900 || /CALF|CALVES/.test(h) ? { cls: 'feeder', kind: 'steers' } : { cls: 'slaughter', kind: 'steers' }
  if (/^HEIFERS?( CALF| CALVES)?$/.test(h)) return top <= 900 || /CALF|CALVES/.test(h) ? { cls: 'feeder', kind: 'heifers' } : { cls: 'slaughter', kind: 'heifers' }
  if (/^BULL CALF|^BULL CALVES/.test(h)) return { cls: 'feeder', kind: 'bulls' }
  // Older reports (to mid-2025) print "FEEDER STEERS 400 TO 499" etc.: feeders at every weight.
  if (/^FEEDER STEERS?$/.test(h)) return { cls: 'feeder', kind: 'steers' }
  if (/^FEEDER HEIFERS?$/.test(h)) return { cls: 'feeder', kind: 'heifers' }
  if (/^FEEDER BULLS?$/.test(h)) return top <= 1100 ? { cls: 'feeder', kind: 'bulls' } : { cls: 'bulls', kind: 'mature' }
  if (/^FEEDER COWS?$/.test(h)) return { cls: 'cows', kind: 'feeder' }
  if (/^(YR|YEARLING) BULLS?$/.test(h)) return { cls: 'bulls', kind: 'yearling' }
  if (/^BULLS?$/.test(h)) return { cls: 'bulls', kind: 'mature' }
  if (/^(SLAUGHTER |BUTCHER |D[1-4] )?COWS?$/.test(h)) return { cls: 'cows', kind: 'slaughter' }
  if (/^HEIFERETTES?$/.test(h)) return { cls: 'heiferettes', kind: 'all' }
  return null
}

/** A validated Medicine Hat transcription as price rows. */
export function mhfcRows(reply: MhfcReply): { rows: AuctionRow[]; skipped: string[] } {
  const rows: AuctionRow[] = []
  const skipped: string[] = []
  for (const s of reply.sections) {
    if (s.price_unit !== 'cwt') {
      skipped.push(`${s.class} (priced per head)`)
      continue
    }
    for (const x of s.rows) {
      const band = normaliseBand(x.class_lo, x.class_hi)
      const c = mhfcClass(s.class, band)
      if (!c) {
        skipped.push(`${s.class} ${x.weight_class}`)
        continue
      }
      rows.push(
        row('medicine-hat', c.cls, c.kind, band, {
          value: x.avg,
          low: x.low,
          high: x.high,
          head: x.head,
          avgWeightLb: x.avg_weight,
          weightMinLb: x.lot_min,
          weightMaxLb: x.lot_max,
          top: null,
          classLabel: `${s.class.trim()} ${x.weight_class.trim()}`,
        }),
      )
    }
  }
  return { rows: combineSameDay(rows), skipped: [...new Set(skipped)] }
}

/** Pull the JSON object out of a reply that may carry a stray word or fence around it. */
export function jsonFromReply(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

// ── Perlich Bros, Lethbridge ────────────────────────────────────────────────

export type PerlichReport = { id: number; name: string; starts_at: string; ends_at: string; published_at: string | null }
export type PerlichEntry = {
  market_report_category: { id: number; name: string; parent?: { name: string } | null }
  min: string | null
  max: string | null
  sales_to: string | null
}
export type PerlichComment = { market_report_category?: { name: string } | null; comment: string | null }

/**
 * A weekly report's date: the day it was published, held inside the week it
 * covers. A report keyed in late (some 2021 weeks were entered months after)
 * still lands on its own week.
 */
export function perlichSaleDate(r: PerlichReport): string {
  const from = r.starts_at.slice(0, 10)
  const to = r.ends_at.slice(0, 10)
  const pub = (r.published_at ?? r.ends_at).slice(0, 10)
  return pub < from ? from : pub > to ? to : pub
}

/**
 * Perlich's entries as price rows.
 *
 * They quote a range (min-max) and the top single sale, but no average and no
 * head count, so the stored value is the middle of the range.
 *
 * Their Calves / Yearlings split is not reliable — in November 2025 the
 * 400-500 lb calves were filed under Yearlings — so a Yearlings row is ALSO
 * stored as the feeder price for its weight when the same week has no Calves
 * row for it. It keeps its own yearling series as well.
 */
export function perlichRows(entries: PerlichEntry[]): { rows: AuctionRow[]; skipped: string[] } {
  const rows: AuctionRow[] = []
  const skipped: string[] = []
  const feederFromCalves = new Set<string>()
  const yearlingRows: { sex: string; band: Band; base: Omit<AuctionRow, 'code' | 'name' | 'commodity' | 'market'> }[] = []

  for (const e of entries) {
    const cat = e.market_report_category
    const parent = cat.parent?.name?.trim() ?? ''
    const name = cat.name.trim()
    const lo = price(e.min)
    const hi = price(e.max)
    if (lo == null || hi == null) continue
    const label = parent ? `${parent} / ${name}` : name
    const base = {
      value: round2((lo + hi) / 2),
      low: Math.min(lo, hi),
      high: Math.max(lo, hi),
      head: null,
      avgWeightLb: null,
      weightMinLb: null,
      weightMaxLb: null,
      top: price(e.sales_to),
      classLabel: label,
    }

    // "600 - 700 - Steers", "+1000 - Steers"
    const sexed = /^(\+?)(\d{3,4})(?:\s*-\s*(\d{3,4}))?\s*-\s*(Steers|Heifers)$/i.exec(name)
    if (sexed && (parent === 'Calves' || parent === 'Yearlings')) {
      const band = normaliseBand(Number(sexed[2]), sexed[1] || !sexed[3] ? null : Number(sexed[3]))
      const sex = sexed[4].toLowerCase()
      if (parent === 'Calves') {
        rows.push(row('lethbridge', 'feeder', sex, band, base))
        feederFromCalves.add(`${sex}|${band.lo}`)
      } else {
        rows.push(row('lethbridge', 'yearling', sex, band, base))
        yearlingRows.push({ sex, band, base })
      }
      continue
    }

    const cow = /^(D1 - D2|D3 - D4|Grain Fed|Feeder|Holstein) Cows$/i.exec(name)
    if (cow) {
      const grade = cow[1].toLowerCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, '-')
      rows.push(row('lethbridge', 'cows', grade, null, base))
      continue
    }
    if (/^Heiferettes$/i.test(name)) {
      rows.push(row('lethbridge', 'heiferettes', 'all', null, base))
      continue
    }
    // "Bulls 1901+", "Bulls 1301-1900", "Bulls 901-1300"
    const bull = /^Bulls\s+(\d{3,4})(?:\s*-\s*(\d{3,4})|\+)$/i.exec(name)
    if (bull) {
      rows.push(row('lethbridge', 'bulls', 'mature', normaliseBand(Number(bull[1]), bull[2] ? Number(bull[2]) : null), base))
      continue
    }
    // Bred cows and pairs are priced per head; Holstein feeders are not this
    // farm's market. Recorded as skipped so a new category is noticed.
    skipped.push(label)
  }

  for (const y of yearlingRows) {
    if (!feederFromCalves.has(`${y.sex}|${y.band.lo}`)) rows.push(row('lethbridge', 'feeder', y.sex, y.band, y.base))
  }
  return { rows, skipped: [...new Set(skipped)] }
}

/** Their free-text notes for the week ("Too few calves to quote this week…"), joined. */
export function perlichComment(comments: PerlichComment[]): string | null {
  const parts = comments
    .map((c) => {
      const body = (c.comment ?? '').trim()
      if (!body) return null
      const cat = c.market_report_category?.name?.trim()
      return cat ? `${cat}: ${body}` : body
    })
    .filter((s): s is string => !!s)
  return parts.length ? parts.join('\n\n') : null
}

// ── Calgary Stockyards ──────────────────────────────────────────────────────

/** The table cells of every row in a block of HTML, as text. Empty cells stay empty. */
function tableRows(html: string): string[][] {
  const out: string[][] = []
  for (const tr of html.split(/<tr[\s>]/i).slice(1)) {
    const body = tr.split(/<\/tr>/i)[0]
    const cells = [...body.matchAll(/<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => text(m[2]))
    if (cells.length) out.push(cells)
  }
  return out
}

/** "400-499", "900+", "1000 and over", "300 - 399" → a band, or null. */
function weightCell(s: string): Band | null {
  const plus = /^(\d{3,4})\s*(\+|and over|& over)$/i.exec(s)
  if (plus) return normaliseBand(Number(plus[1]), null)
  const r = /^(\d{3,4})\s*-\s*(\d{3,4})$/.exec(s)
  return r ? normaliseBand(Number(r[1]), Number(r[2])) : null
}

/**
 * The weekly report on Calgary Stockyards' home page.
 *
 * A five-column table — class, weight range, low, high, average — where the
 * class is written only on the first row of its group. A weight class nobody
 * sold that week is a row of empty cells, which is skipped, not read as zero.
 * There is no archive: the page is replaced each week, so the history is what
 * this has collected since it started reading it.
 */
export function parseCalgaryStockyards(html: string, today: string): ParsedReport | { problem: string } {
  const page = text(html)
  const we = /Week Ending:?\s*([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?/i.exec(page)
  const month = we ? MONTHS[we[1].toLowerCase()] : undefined
  if (!we || !month) return { problem: 'no "Week Ending" date on the page' }
  const saleDate = dateWithoutYear(month, Number(we[2]), today)
  const totalHead = Number(/Total Head Sold:?\s*([\d,]+)/i.exec(page)?.[1]?.replace(/,/g, '')) || null

  const start = html.search(/Wght Rng/i)
  if (start < 0) return { problem: 'no market table (no "Wght Rng" heading)' }
  const tableStart = html.lastIndexOf('<table', start)
  const tableEnd = html.indexOf('</table>', start)
  const cells = tableRows(html.slice(tableStart, tableEnd + 8))

  const rows: AuctionRow[] = []
  const skipped: string[] = []
  let group = ''
  for (const c of cells) {
    if (c.length < 5 || /Wght Rng/i.test(c[1])) continue
    if (c[0]) group = c[0]
    const [, weight, lowS, highS, avgS] = c
    const low = price(lowS)
    const high = price(highS)
    const avg = price(avgS)
    if (avg == null) continue // nothing sold in this class this week
    const g = group.toLowerCase()
    const base = {
      value: avg,
      low,
      high,
      head: null,
      avgWeightLb: null,
      weightMinLb: null,
      weightMaxLb: null,
      top: null,
      classLabel: `${group} ${weight}`.trim(),
    }
    if (g === 'steers' || g === 'heifers') {
      const band = weightCell(weight)
      if (!band) {
        skipped.push(base.classLabel)
        continue
      }
      rows.push(row('calgary', 'feeder', g, band, base))
    } else if (g === 'cows') {
      const grade = /D1\s*D2/i.test(weight) ? 'd1-d2' : /D3\s*D4/i.test(weight) ? 'd3-d4' : null
      if (grade) rows.push(row('calgary', 'cows', grade, null, base))
      else skipped.push(base.classLabel)
    } else if (g === 'bulls') {
      rows.push(row('calgary', 'bulls', 'mature', weightCell(weight), base))
    } else {
      skipped.push(base.classLabel)
    }
  }
  if (rows.length === 0) return { problem: 'the market table had no priced rows' }
  return {
    market: 'calgary',
    reportKey: `week-ending-${saleDate}`,
    saleDate,
    url: marketByKey('calgary')!.url,
    title: `Weekly market report, week ending ${saleDate}`,
    totalHead,
    comment: null,
    rows,
    skipped,
  }
}

// ── Team Auction Sales, online ──────────────────────────────────────────────

export const TEAM_REPORT_URL = 'https://s3.amazonaws.com/uploads.liveauctiongroup.net/sites/173_teamauctionsales/marketreport.html'

/** The Friday on or before a date — Team's feeder sale day. */
export function fridayOnOrBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  const back = (d.getUTCDay() - 5 + 7) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

/**
 * Team's weekly market report: the page their "View market report" link
 * frames, a static file replaced each week.
 *
 * Only the FEEDER block is read (FOB ranch, $/cwt live). FINISHED is a rail
 * (dressed-weight) price and the bred block is per head; neither is
 * comparable with an auction's live $/cwt. The report says when it was
 * updated, usually the weekend after the Friday sale, so it is dated to that
 * Friday — a correction on the Monday then lands on the same week rather
 * than as a second one.
 */
export function parseTeamReport(html: string): ParsedReport | { problem: string } {
  const up = /Updated:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(html)
  if (!up) return { problem: 'no "Updated" date on the report' }
  const updated = iso(Number(up[3]), Number(up[1]), Number(up[2]))
  const saleDate = fridayOnOrBefore(updated)
  const totalHead = Number(/Head sold<\/label>\s*([\d,]+)/i.exec(html)?.[1]?.replace(/,/g, '')) || null

  const feeder = html.search(/<h2>\s*FEEDER/i)
  if (feeder < 0) return { problem: 'no FEEDER section' }
  const next = html.slice(feeder + 5).search(/<h2|<table style/i)
  const block = next < 0 ? html.slice(feeder) : html.slice(feeder, feeder + 5 + next)

  const rows: AuctionRow[] = []
  for (const table of block.split(/<table/i).slice(1)) {
    const sex = /colspan='?"?3'?"?>\s*(Steers|Heifers)/i.exec(table)?.[1]?.toLowerCase()
    if (!sex) continue
    for (const c of tableRows(`<table${table}`)) {
      if (c.length < 3) continue
      const band = weightCell(c[0])
      const avg = price(c[2])
      if (!band || avg == null) continue
      const range = c[1].split(/\s*-\s*/).map((x) => price(x))
      const low = range[0] ?? avg
      const high = range[1] ?? range[0] ?? avg
      rows.push(
        row('team-online', 'feeder', sex, band, {
          value: avg,
          low,
          high,
          head: null,
          avgWeightLb: null,
          weightMinLb: null,
          weightMaxLb: null,
          top: null,
          classLabel: `Feeder ${sex} ${c[0]}`,
        }),
      )
    }
  }
  if (rows.length === 0) return { problem: 'the FEEDER tables had no priced rows' }
  const comments = [...html.matchAll(/<label>Comments:<\/label>([\s\S]*?)<\/fieldset>/gi)].map((m) => text(m[1]))
  return {
    market: 'team-online',
    reportKey: saleDate,
    saleDate,
    url: TEAM_REPORT_URL,
    title: `Team market report, updated ${updated}`,
    totalHead,
    // The second comment is the feeder one; the first is about finished cattle.
    comment: comments.at(-1) || null,
    rows,
    skipped: [],
  }
}

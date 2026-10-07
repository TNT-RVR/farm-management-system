// Written with the file extension, unlike the rest of src, so that plain node
// can load this module: scripts/import-rx.mjs runs the parser outside Vite and
// extensionless specifiers do not resolve there.
import type { TextItem } from './hail-report.ts'
import { toRows } from './hail-report.ts'

/**
 * Reading a Farm at Hand "RX Rates" report.
 *
 * One field per page — sometimes two pages, when the zone table pushes the
 * product table onto a second sheet. Each carries the crop plan, the
 * recommendation, a NUTRIENT ACTUALS table giving N/P/K/S per management zone,
 * and a PRODUCT RATES table giving pounds of blend per zone. The zones are
 * bands of a fertility index computed off the soil map, so this one document is
 * the soil map and the prescription together.
 *
 * Positional, like the hail report, and for a sharper reason: the columns are
 * not fixed. A corn field carries a Micro Zn column that an alfalfa field does
 * not, and the Total row omits the fertility index entirely. So the header row
 * is read first and every cell below is assigned to the nearest column — which
 * makes a missing cell a missing cell instead of shifting every value after it
 * one column to the left.
 */

export type RxZone = {
  zone: number
  /** The fertility-index band this zone covers, e.g. "61.19 - 84.00". */
  index: string | null
  acres: number | null
  yieldGoal: number | null
  n: number | null
  p2o5: number | null
  k2o: number | null
  s: number | null
  /** Micronutrients and anything else the report chose to print. */
  extra: Record<string, number>
  /** Product analysis to lb/ac on this zone. */
  products: Record<string, number>
}

export type RxProduct = {
  /** What the retailer called it: "NH3", "33-19.3-0-0- or 77-45-0-0". */
  label: string
  /** The analysis actually costed: "82-0-0", "33-19.3-0-0". */
  analysis: string
  avgRate: number | null
  totalLbs: number | null
}

export type RxField = {
  fieldLabel: string | null
  legal: string | null
  cropType: string | null
  variety: string | null
  acres: number | null
  yieldGoal: number | null
  yieldUnit: string | null
  /** "Spring", "NO RX" — which recommendation this page is. */
  description: string | null
  /** The crop the recommendation was written against, if it differs. */
  recCropType: string | null
  recYieldGoal: number | null
  zones: RxZone[]
  products: RxProduct[]
  /** The report's own Total row, kept to check the zones against. */
  totalAcres: number | null
  /** 1-based page the field starts on, for pointing back at the source. */
  page: number
}

const num = (s: string | null | undefined): number | null => {
  if (s == null) return null
  const n = Number(String(s).replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const SECTIONS = ['Crop Plan', 'Recommendation', 'Nutrient Actuals', 'Product Rates'] as const
type Section = (typeof SECTIONS)[number]

const cellsOf = (row: TextItem[]): string[] => row.map((t) => t.s.trim()).filter(Boolean)

/** Rows belonging to a section: below its heading, above the next heading. */
function sectionRows(rows: TextItem[][], name: Section): TextItem[][] {
  const isHeading = (r: TextItem[]) =>
    r.length === 1 && (SECTIONS as readonly string[]).includes(r[0].s.trim())
  const start = rows.findIndex((r) => isHeading(r) && r[0].s.trim() === name)
  if (start === -1) return []
  const rest = rows.slice(start + 1)
  const end = rest.findIndex(isHeading)
  return end === -1 ? rest : rest.slice(0, end)
}

/** The value printed to the right of a label, within one section. */
function labelled(rows: TextItem[][], label: string): string | null {
  const want = label.toLowerCase()
  for (const row of rows) {
    const at = row.findIndex((t) => t.s.trim().toLowerCase() === want)
    if (at === -1) continue
    const rest = cellsOf(row.slice(at + 1))
    if (rest.length) return rest[0]
  }
  return null
}

/**
 * Each cell to the column it sits under.
 *
 * Numbers are drawn a few points right of their heading and the headings are
 * far enough apart that nearest-x is unambiguous. Matching by position in the
 * row would be shorter and would silently mis-read every Total row, which
 * prints six values under eight headings.
 */
function byColumn(row: TextItem[], columns: { key: string; x: number }[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of row) {
    const s = t.s.trim()
    if (!s) continue
    let best = columns[0]
    for (const c of columns) if (Math.abs(c.x - t.x) < Math.abs(best.x - t.x)) best = c
    // Joined rather than overwritten: two fragments landing in one column are a
    // split string, not a second value.
    out[best.key] = out[best.key] ? out[best.key] + ' ' + s : s
  }
  return out
}

/** Printed heading to the field it fills. Unlisted headings are kept as extras. */
function zoneKey(label: string): string {
  const l = label.toLowerCase().replace(/\s+/g, ' ').trim()
  if (l === 'zone') return 'zone'
  if (l === 'fertility index') return 'index'
  if (l === 'yield goal') return 'yieldGoal'
  if (l === 'acres') return 'acres'
  if (l === 'n') return 'n'
  if (l.startsWith('p ')) return 'p2o5'
  if (l.startsWith('k ')) return 'k2o'
  if (l === 's') return 's'
  return label.trim()
}

const KNOWN = new Set(['zone', 'index', 'yieldGoal', 'acres', 'n', 'p2o5', 'k2o', 's'])

/** A units row — "(ac)", "(lbs/ac)" — carries no data. */
const isUnits = (row: TextItem[]) => cellsOf(row).every((c) => /^\(.*\)$/.test(c))

function parseZoneTable(rows: TextItem[][]): { zones: RxZone[]; totalAcres: number | null } {
  const headerAt = rows.findIndex((r) => {
    const c = cellsOf(r)
    return c[0] === 'Zone' && c.includes('Fertility Index')
  })
  if (headerAt === -1) return { zones: [], totalAcres: null }
  const columns = rows[headerAt].map((t) => ({ key: zoneKey(t.s), x: t.x }))

  const zones: RxZone[] = []
  let totalAcres: number | null = null
  for (const row of rows.slice(headerAt + 1)) {
    if (isUnits(row)) continue
    const rec = byColumn(row, columns)
    if (/^total$/i.test(rec.zone ?? '')) {
      totalAcres = num(rec.acres)
      continue
    }
    if (!/^\d{1,2}$/.test(rec.zone ?? '')) continue
    const extra: Record<string, number> = {}
    for (const [k, v] of Object.entries(rec)) {
      if (KNOWN.has(k)) continue
      const n = num(v)
      if (n != null) extra[k] = n
    }
    zones.push({
      zone: Number(rec.zone),
      index: rec.index ?? null,
      acres: num(rec.acres),
      yieldGoal: num(rec.yieldGoal),
      n: num(rec.n),
      p2o5: num(rec.p2o5),
      k2o: num(rec.k2o),
      s: num(rec.s),
      extra,
      products: {},
    })
  }
  return { zones, totalAcres }
}

/**
 * The product table, whose heading is two lines deep.
 *
 * The first line is the column as the retailer wrote it — "NH3", or
 * "33-19.3-0-0- or 77-45-0-0" where two blends were interchangeable. The second
 * is the one actually priced. Both are kept: the label is what a person will
 * recognise on the invoice, the analysis is what the nutrient arithmetic needs.
 */
function parseProductTable(rows: TextItem[][], zones: RxZone[]): RxProduct[] {
  const headerAt = rows.findIndex((r) => {
    const c = cellsOf(r)
    return c[0] === 'Zone' && !c.includes('Fertility Index')
  })
  if (headerAt === -1) return []

  const heads = rows[headerAt].filter((t) => t.s.trim() !== 'Zone')
  if (heads.length === 0) return []
  const columns = [
    { key: 'zone', x: rows[headerAt][0].x },
    ...heads.map((t, i) => ({ key: 'p' + i, x: t.x })),
  ]

  // Continuation lines sit between the heading and the units row.
  const unitsAt = rows.slice(headerAt + 1).findIndex(isUnits)
  const contRows = unitsAt === -1 ? [] : rows.slice(headerAt + 1, headerAt + 1 + unitsAt)
  const analyses = heads.map((t, i) => {
    for (const r of contRows) {
      const v = byColumn(r, columns)['p' + i]
      if (v) return v
    }
    return t.s.trim()
  })

  const products: RxProduct[] = heads.map((t, i) => ({
    label: t.s.trim(),
    analysis: analyses[i],
    avgRate: null,
    totalLbs: null,
  }))

  const body = unitsAt === -1 ? rows.slice(headerAt + 1) : rows.slice(headerAt + 1 + unitsAt + 1)
  for (const row of body) {
    const rec = byColumn(row, columns)
    const first = (rec.zone ?? '').toLowerCase()
    if (first.startsWith('avg rate')) {
      for (let i = 0; i < products.length; i++) products[i].avgRate = num(rec['p' + i])
      continue
    }
    if (first === 'total') {
      // The tonnes line follows on its own row and lands in the same column;
      // only the first Total value is pounds.
      for (let i = 0; i < products.length; i++) {
        if (products[i].totalLbs == null) products[i].totalLbs = num(rec['p' + i])
      }
      continue
    }
    if (!/^\d{1,2}$/.test(rec.zone ?? '')) continue
    const z = zones.find((x) => x.zone === Number(rec.zone))
    if (!z) continue
    for (let i = 0; i < products.length; i++) {
      const rate = num(rec['p' + i])
      if (rate != null) z.products[products[i].analysis] = rate
    }
  }
  return products
}

/** Field name and legal description from the page's title line. */
export function splitTitle(line: string): { label: string; legal: string | null } {
  const m = line.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (!m) return { label: line.trim(), legal: null }
  // Some titles carry the legal twice behind a stray comma:
  // "(, N 35 71 11, N 35 71 11 W4)". Take the last, fullest spelling.
  const inner = m[2]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return { label: m[1].trim(), legal: inner.length ? inner[inner.length - 1] : null }
}

// The fraction is a share of the quarter — "(3/4 NE 9 70 14 W4, NE 9 70 14 W4)"
// is three quarters of one. It says how much of the ground, not which ground,
// and without allowing for it that page has no title and the whole field is
// dropped from the import with nothing to say it went missing.
const TITLE_RE = /\(\s*,?\s*(?:\d\/\d\s+)?(?:Sec\s+)?[NSEWC]{0,2}\s?\d{1,2}[\s-]\d{1,3}[\s-]\d{1,2}/i

/** The title row, or null on a page that is only a continuation table. */
function titleOf(rows: TextItem[][]): string | null {
  for (const row of rows) {
    const joined = cellsOf(row).join(' ')
    if (TITLE_RE.test(joined)) return joined
  }
  return null
}

/**
 * Every field in the report.
 *
 * `pages` is the positioned text of each page. A page without a Nutrient
 * Actuals section is a continuation of the field before it, and its product
 * table is folded into that field rather than dropped — which is what happens
 * to three of the twenty-three fields in the 2026 report.
 */
export function parseRxDocument(pages: TextItem[][]): RxField[] {
  const fields: RxField[] = []
  pages.forEach((items, i) => {
    const rows = toRows(items)
    const nutrients = sectionRows(rows, 'Nutrient Actuals')
    const productRows = sectionRows(rows, 'Product Rates')

    if (nutrients.length === 0) {
      const prev = fields[fields.length - 1]
      if (prev && productRows.length) {
        prev.products.push(...parseProductTable(productRows, prev.zones))
      }
      return
    }

    const title = titleOf(rows)
    const { label, legal } = title ? splitTitle(title) : { label: '', legal: null }
    const plan = sectionRows(rows, 'Crop Plan')
    const rec = sectionRows(rows, 'Recommendation')

    const goal = labelled(plan, 'agronomic yield goal')
    const goalMatch = goal?.match(/^([\d.]+)\s*(.*)$/)
    const { zones, totalAcres } = parseZoneTable(nutrients)

    fields.push({
      fieldLabel: label || null,
      legal,
      cropType: labelled(plan, 'crop type'),
      variety: labelled(plan, 'variety'),
      acres: num(labelled(plan, 'acres')),
      yieldGoal: goalMatch ? Number(goalMatch[1]) : null,
      yieldUnit: goalMatch?.[2]?.trim() || null,
      description: labelled(rec, 'description'),
      recCropType: labelled(rec, 'crop type'),
      recYieldGoal: num(labelled(rec, 'agronomic yield goal')),
      zones,
      products: parseProductTable(productRows, zones),
      totalAcres,
      page: i + 1,
    })
  })
  return fields
}

/**
 * Is this a real variable rate, or one number written across every zone?
 *
 * The distinction the whole feature turns on, and it needs no flag: a
 * prescription whose zones all carry the same rate IS a blanket application,
 * whatever the map underneath it looks like. Several fields here are split into
 * five fertility bands and then given 50-40-40-10 on all five.
 *
 * Judged per nutrient, because a plan can vary nitrogen by zone and hold
 * phosphate flat, and calling the whole thing blanket would be wrong.
 */
export function rateVaries(zones: RxZone[], key: 'n' | 'p2o5' | 'k2o' | 's'): boolean {
  const vals = zones.map((z) => z[key]).filter((v): v is number => v != null)
  if (vals.length < 2) return false
  return new Set(vals).size > 1
}

/** Variable where any nutrient or product rate differs between zones. */
export function applicationKind(zones: RxZone[]): 'variable' | 'blanket' | 'unknown' {
  if (zones.length === 0) return 'unknown'
  if (zones.length === 1) return 'blanket'
  const nutrients = (['n', 'p2o5', 'k2o', 's'] as const).some((k) => rateVaries(zones, k))
  if (nutrients) return 'variable'
  const names = new Set(zones.flatMap((z) => Object.keys(z.products)))
  for (const name of names) {
    const rates = zones.map((z) => z.products[name]).filter((v) => v != null)
    if (rates.length > 1 && new Set(rates).size > 1) return 'variable'
  }
  return 'blanket'
}

/**
 * A prescription of nothing: every rate on every zone is zero.
 *
 * Read from the rates and NOT from the description, which says "NO RX" on
 * seven of the twenty fields — four of which got nothing, and three of which
 * got 570 lb/ac of 38.8-10.8-0-0. The phrase means no variable-rate file was
 * written for the applicator, not that no fertiliser went on, and believing it
 * would report three fields of corn as unfertilised.
 */
export function isNoRx(f: RxField): boolean {
  if (f.zones.length === 0) return false
  return f.zones.every(
    (z) =>
      !z.n &&
      !z.p2o5 &&
      !z.k2o &&
      !z.s &&
      Object.values(z.extra).every((v) => !v) &&
      Object.values(z.products).every((v) => !v),
  )
}

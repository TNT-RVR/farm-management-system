/**
 * Reading a Fuel supplier invoice's text into fuel purchases.
 *
 * Checked against real invoices on 13 Oct 2026 (the PDFs attached to their
 * bills in QuickBooks, 2022 to 2026). Fuel supplier bills from QuickBooks
 * Online, so every invoice is the same printed table:
 *
 *   INVOICE <number>
 *   DATE <date>   TERMS Net 30   DUE DATE <date>
 *   DATE ACTIVITY DESCRIPTION QTY RATE AMOUNT
 *   <date> <activity> [<description>] <qty> <rate> <amount>
 *   ...
 *   SUBTOTAL / GST @ 5% / TOTAL / BALANCE DUE
 *
 * What the real ones taught:
 *
 * - A row's words wrap over several lines in the text layer, and the
 *   activity is often printed twice (activity, then the same words as the
 *   description). A row ends at the line that ends in qty, rate, amount; a
 *   tax row may carry no date of its own.
 * - Per-litre fuel taxes come as their own rows naming the fuel ("Federal
 *   Excise Tax Dyed Diesel", "Provincial Tax Dyed Gas"), with the same litres
 *   as the fuel row. They are part of what a litre costs the farm, so they
 *   are added to that fuel line: the $/L kept is the delivered price before
 *   GST (the farm claims GST back), the same basis the market farm figure is
 *   worked out on.
 * - The printed rate is rounded (often to the cent), so $/L is the amount ÷
 *   litres, not the printed rate.
 * - Dates switched from day-first to month-first between 2024 and 2025. The
 *   due date (date + the Net terms) settles which, and a date to compare with
 *   (the QuickBooks bill's) settles the rest.
 * - Lubricants, DEF, pails and jugs share the invoice; they are not fuel.
 *
 * An invoice in any other layout (a different supplier, or Fuel supplier moving
 * off QuickBooks) still goes through the old forgiving reading: a line naming
 * a fuel, and the litres × $/L = amount triple near it.
 *
 * Only made-up text in the tests (fuel-supplier-invoice.test.ts).
 */

/** Bump when the reading changes, so the QuickBooks reader reads every invoice again. */
export const FUEL_SUPPLIER_PARSER_VERSION = 2

export type FuelProduct = 'farm_diesel' | 'clear_diesel' | 'gasoline' | 'farm_gasoline' | 'other'

export const FUEL_PRODUCT_LABEL: Record<FuelProduct, string> = {
  farm_diesel: 'Farm (dyed) diesel',
  clear_diesel: 'Clear diesel',
  gasoline: 'Gasoline',
  farm_gasoline: 'Farm (marked) gasoline',
  other: 'Other',
}

export type FuelLine = {
  /** 1, 2, … in the order the fuel rows are printed: with the invoice number, what a re-read is matched on. */
  lineNo: number
  product: FuelProduct
  description: string
  litres: number
  /** Delivered $/L before GST: the fuel and its per-litre taxes, over the litres. */
  perL: number
  /** The fuel and its per-litre taxes, before GST. */
  amount: number
  /** The fuel alone, before its taxes (equal to `amount` when there are none). */
  fuelAmount: number
  /** The per-litre taxes added in, as printed ("Federal Excise Tax Dyed Diesel"). */
  taxes: { name: string; amount: number }[]
  /** True when litres × $/L matched an amount on the invoice (and, in the table layout, the rows add up to the subtotal). */
  checked: boolean
}

/** One printed row of the item table, whatever it is. */
export type InvoiceRow = {
  date: string | null
  text: string
  qty: number | null
  rate: number | null
  amount: number
  kind: 'fuel' | 'fuel_tax' | 'other'
  product: FuelProduct | null
}

export type FuelInvoice = {
  invoiceNo: string | null
  invoiceDate: string | null
  dueDate: string | null
  lines: FuelLine[]
  /** Every row of the item table (the table layout only). */
  rows: InvoiceRow[]
  subtotal: number | null
  gst: number | null
  total: number | null
  /** 'table' = the QuickBooks-printed layout; 'loose' = the old forgiving reading. */
  layout: 'table' | 'loose'
  /** Things a person should know: a row that did not add up, rows not matching the subtotal. */
  warnings: string[]
}

const FUEL_WORD = /(diesel|dyed|marked|ulsd|gasoline|unleaded|regular gas|premium gas|mid-?grade|\bgas\b)/i
// A tax or fee line names a fuel too ("Fuel tax — diesel"); it is not a purchase.
const NOT_A_PURCHASE = /(gst|hst|pst|fuel tax|carbon|levy|excise|surcharge|delivery fee|subtotal|total|balance|tank rental|discount)/i
/** A per-litre tax row on a fuel. */
const FUEL_TAX = /(tax|excise|levy|carbon|fuel charge)/i
/** Not fuel even when a fuel is named: oils, fluids, DEF, packs ("Delo diesel engine oil", "DEF JUG 9.46L"). */
const NOT_FUEL = /(\boil\b|fluid|(^|[^a-z])def([^a-z]|$)|exhaust|lube|grease|filter|additive|conditioner|treatment|anti-?gel|\bjug\b|\bpail\b|\bdrum\b|\btote\b|\bcase\b|(^|[^\d.,])\d{1,2}(\.\d+)?\s*l\b)/i

/** Diesel said to be clear (road) diesel; any other diesel the farm buys is dyed (Sam, 13 Oct 2026). */
const CLEAR_DIESEL = /(clear|undyed|un-dyed|on[- ]?road|road diesel)/
const SAYS_FARM = /(dyed|marked|coloured|colored|farm|purple|red diesel)/

/**
 * Which fuel a description is. Diesel is dyed unless it says clear, undyed or
 * on-road: almost all the diesel the farm buys is dyed (Sam, 13 Oct 2026).
 * Gasoline is clear unless it says dyed or marked.
 */
export function classifyFuel(desc: string): FuelProduct {
  const d = desc.toLowerCase()
  const diesel = /(diesel|ulsd|d-?2|d2)/.test(d)
  const gas = /(gasoline|unleaded|regular|premium|mid-?grade|(^|[^a-z])gas([^a-z]|$))/.test(d)
  if (diesel) return CLEAR_DIESEL.test(d) ? 'clear_diesel' : 'farm_diesel'
  if (gas) return SAYS_FARM.test(d) ? 'farm_gasoline' : 'gasoline'
  return 'other'
}

/** Diesel taken as dyed although the words do not say dyed or marked. */
export const dieselAssumedDyed = (desc: string | null | undefined): boolean => {
  const d = (desc ?? '').toLowerCase()
  return classifyFuel(d) === 'farm_diesel' && !SAYS_FARM.test(d)
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}
const iso = (y: number, m: number, d: number) =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y < 2100
    ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    : null

type SlashOrder = 'mdy' | 'dmy'

/** A date in any of the ways an invoice prints one. Slashes are month-first unless `order` says otherwise or only day-first can be a date. */
export function parseDate(s: string, order: SlashOrder = 'mdy'): string | null {
  let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = /(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]+(\d{4})/.exec(s)
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1])
  m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s)
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2])
  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (m) {
    const mdy = iso(+m[3], +m[1], +m[2])
    const dmy = iso(+m[3], +m[2], +m[1])
    return order === 'dmy' ? (dmy ?? mdy) : (mdy ?? dmy)
  }
  return null
}

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

/**
 * Whether this invoice prints slashed dates day-first or month-first. A date
 * only one way can be read decides; then the due date being the date plus the
 * Net terms; then the date nearest `hint` (the QuickBooks bill's date); then
 * month-first.
 */
function slashOrder(dateText: string | null, dueText: string | null, netDays: number | null, hint: string | null): SlashOrder {
  const m = dateText ? /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(dateText) : null
  if (!m) return 'mdy'
  const cand = (o: SlashOrder) => (o === 'mdy' ? iso(+m[3], +m[1], +m[2]) : iso(+m[3], +m[2], +m[1]))
  const mdy = cand('mdy')
  const dmy = cand('dmy')
  if (!mdy || !dmy) return mdy ? 'mdy' : 'dmy'
  if (mdy === dmy) return 'mdy'
  if (dueText && netDays != null) {
    const ok = (o: SlashOrder, d: string) => {
      const due = parseDate(dueText, o)
      return due != null && days(d, due) === netDays
    }
    if (ok('mdy', mdy) && !ok('dmy', dmy)) return 'mdy'
    if (ok('dmy', dmy) && !ok('mdy', mdy)) return 'dmy'
  }
  if (hint) return Math.abs(days(hint, dmy)) < Math.abs(days(hint, mdy)) ? 'dmy' : 'mdy'
  return 'mdy'
}

const toNum = (s: string) => Number(s.replace(/[$,\s]/g, ''))
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d

const numbersIn = (s: string): number[] =>
  [...s.matchAll(/-?\$?\s?\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => toNum(m[0]))
    .filter((n) => Number.isFinite(n))

/** The decimals a number was printed with, for telling $1.879/L from 1,879 L. */
const decimalsIn = (s: string): Map<number, number> => {
  const out = new Map<number, number>()
  for (const m of s.matchAll(/\d[\d,]*\.(\d+)/g)) out.set(Number(m[0].replace(/,/g, '')), m[1].length)
  return out
}

/* ------------------------------------------------------------ the table */

const TABLE_HEADER = /\bqty\b.*\brate\b.*\bamount\b/i
/** Where the item table ends. */
const TABLE_END = /^(subtotal|total\b|balance due|gst\b|hst\b|for credit card)/i
/** Page furniture a multi-page invoice repeats inside the table. */
const FURNITURE = /^(page \d+ of \d+|overdue accounts|invoice$|bill to$)/i
const NUM = String.raw`-?\$?[\d,]*\d(?:\.\d+)?`
/** qty, rate, amount at the end of a line; the amount always has cents. */
const TRIPLE = new RegExp(String.raw`(${NUM})\s+(${NUM})\s+(-?\$?[\d,]*\d\.\d{2})$`)
/** A dated row with only an amount (a fee, a charge). */
const AMOUNT_ONLY = /(-?\$?[\d,]*\d\.\d{2})$/
const LEADING_DATE = /^(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\s*/

/** "Dyed Diesel Dyed Diesel" (activity, then the same description) → "Dyed Diesel". */
function tidy(s: string): string {
  const w = s.replace(/\s+/g, ' ').trim()
  const words = w.split(' ')
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, k) => x.toLowerCase() === b[k].toLowerCase())
  for (let n = Math.floor(words.length / 2); n >= 1; n--) {
    if (same(words.slice(0, n), words.slice(n, 2 * n))) return tidy(words.slice(n).join(' '))
  }
  return w
}

function rowKind(text: string): Pick<InvoiceRow, 'kind' | 'product'> {
  if (!FUEL_WORD.test(text) || NOT_FUEL.test(text)) return { kind: 'other', product: null }
  const product = classifyFuel(text)
  if (product === 'other') return { kind: 'other', product: null }
  return { kind: FUEL_TAX.test(text) ? 'fuel_tax' : 'fuel', product }
}

function readTable(lines: string[], start: number, order: SlashOrder): { rows: InvoiceRow[]; warnings: string[] } {
  const rows: InvoiceRow[] = []
  const warnings: string[] = []
  let parts: string[] = []
  for (let i = start; i < lines.length; i++) {
    const l = lines[i]
    if (TABLE_END.test(l)) break
    if (TABLE_HEADER.test(l) || FURNITURE.test(l)) {
      parts = []
      continue
    }
    parts.push(l)
    const t = TRIPLE.exec(l)
    const dated = LEADING_DATE.test(parts[0])
    const lone = !t && dated ? AMOUNT_ONLY.exec(l) : null
    if (!t && !lone) continue
    let text = parts.join(' ')
    const dm = LEADING_DATE.exec(text)
    const date = dm ? parseDate(dm[1], order) : null
    if (dm) text = text.slice(dm[0].length)
    const tail = (t ?? lone)!
    text = text.slice(0, text.length - tail[0].length).trim()
    parts = []
    const amount = toNum(t ? t[3] : lone![1])
    const qty = t ? toNum(t[1]) : null
    const rate = t ? toNum(t[2]) : null
    if (qty != null && rate != null) {
      // The printed rate is rounded; half a cent a litre either way is the printing, more is a misread.
      const off = Math.abs(qty * rate - amount)
      if (off > Math.max(0.02, Math.abs(qty) * 0.005 + 0.01)) {
        warnings.push(`A row did not add up (qty × rate ≠ amount): "${tidy(text).slice(0, 60)}"`)
      }
    }
    rows.push({ date, text: tidy(text), qty, rate, amount, ...rowKind(text) })
  }
  return { rows, warnings }
}

/** Fuel rows with the per-litre taxes on the same fuel added in. */
function fuelLines(rows: InvoiceRow[], warnings: string[], tableChecked: boolean): FuelLine[] {
  const fuel = rows.filter((r) => r.kind === 'fuel' && r.qty != null && r.qty > 0 && r.amount > 0)
  const lines: FuelLine[] = fuel.map((r, k) => ({
    lineNo: k + 1,
    product: r.product!,
    description: r.text.slice(0, 120),
    litres: r.qty!,
    perL: 0,
    amount: r.amount,
    fuelAmount: r.amount,
    taxes: [],
    checked: tableChecked && Math.abs(r.qty! * (r.rate ?? 0) - r.amount) <= Math.max(0.02, r.qty! * 0.005 + 0.01),
  }))
  for (const t of rows.filter((r) => r.kind === 'fuel_tax')) {
    const same = lines.filter((l) => l.product === t.product)
    if (!same.length) {
      warnings.push(`A fuel tax with no fuel of its kind on the invoice: "${t.text.slice(0, 60)}"`)
      continue
    }
    // The fuel row with the same litres; failing that, shared over the fuel's rows by litres.
    const exact = t.qty != null ? same.filter((l) => Math.abs(l.litres - t.qty!) < 0.5) : []
    const onto = exact.length === 1 ? exact : same
    const litres = onto.reduce((s, l) => s + l.litres, 0)
    for (const l of onto) {
      const part = onto.length === 1 ? t.amount : round((t.amount * l.litres) / litres, 2)
      l.taxes.push({ name: t.text.slice(0, 60), amount: part })
      l.amount = round(l.amount + part, 2)
    }
  }
  for (const l of lines) l.perL = round(l.amount / l.litres, 4)
  // A delivered price outside anything fuel has cost is a misread, not a price.
  return lines.filter((l) => {
    if (l.perL >= 0.3 && l.perL <= 4) return true
    warnings.push(`A fuel row priced at $${l.perL}/L was left out as a misread: "${l.description.slice(0, 60)}"`)
    return false
  })
}

/* ---------------------------------------------------- the loose reading */

function readWindow(text: string): { litres: number; perL: number; amount: number; checked: boolean } | null {
  const nums = numbersIn(text).map(Math.abs).filter((n) => n > 0)
  const decimals = decimalsIn(text)
  const prices = nums.filter((n) => n >= 0.5 && n <= 4)
  // The triple first: litres × price = amount, to a cent per hundred litres.
  for (const p of prices) {
    for (const q of nums) {
      if (q === p || q < 1) continue
      const want = q * p
      const a = nums.find((n) => n !== q && n !== p && Math.abs(n - want) <= Math.max(0.02, want * 0.0005))
      if (a != null) return { litres: q, perL: p, amount: a, checked: true }
    }
  }
  // Then a price printed like one (three or four decimals) beside a litres figure.
  const p = prices.find((n) => (decimals.get(n) ?? 0) >= 3)
  if (p != null) {
    const q = nums.filter((n) => n !== p && n >= 1).sort((a, b) => b - a)[0]
    if (q != null) return { litres: q, perL: p, amount: Math.round(q * p * 100) / 100, checked: false }
  }
  return null
}

function looseLines(lines: string[]): FuelLine[] {
  const out: FuelLine[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!FUEL_WORD.test(l) || NOT_A_PURCHASE.test(l)) continue
    const window = [l]
    for (let j = i + 1; j < Math.min(lines.length, i + 9); j++) {
      if (FUEL_WORD.test(lines[j]) || NOT_A_PURCHASE.test(lines[j])) break
      window.push(lines[j])
    }
    const got = readWindow(window.join(' '))
    if (!got) continue
    out.push({
      lineNo: out.length + 1,
      product: classifyFuel(l),
      description: l.replace(/\s+/g, ' ').slice(0, 120),
      ...got,
      fuelAmount: got.amount,
      taxes: [],
    })
  }
  return out
}

/* --------------------------------------------------------------- reading */

/** The figure on a labelled line ("SUBTOTAL 1,234.00"), or on the line after it. */
function figure(lines: string[], label: RegExp): number | null {
  let out: number | null = null
  for (let i = 0; i < lines.length; i++) {
    if (!label.test(lines[i]) || /registration/i.test(lines[i])) continue
    const after = lines[i].replace(label, '')
    const n = numbersIn(after.replace(/@\s*\d+(\.\d+)?\s*%/, '')).filter((x) => x > 0)
    const next = numbersIn(lines[i + 1] ?? '').filter((x) => x > 0)
    if (n.length) out = n[n.length - 1]
    else if (next.length) out = next[next.length - 1]
  }
  return out
}

/**
 * Read one invoice. `hintDate` (yyyy-mm-dd, the QuickBooks bill's date) helps
 * when the printed date could be read day-first or month-first.
 */
export function parseFuelSupplierInvoice(text: string, opts: { hintDate?: string | null } = {}): FuelInvoice {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const warnings: string[] = []

  const invoiceNo =
    /^invoice[ \t]*(?:#|no\.?|number)?[ \t]*:?[ \t]*([A-Z]{0,4}-?\d{3,})[ \t]*$/im.exec(text)?.[1] ??
    /invoice\s*(?:#|no\.?|number|num)?\s*[:#]?\s*([A-Z]{0,4}-?\d{3,})/i.exec(text)?.[1] ??
    null

  // QuickBooks prints "DATE …" and "DUE DATE …" on lines of their own.
  const dateLine = lines.find((l) => /^(invoice\s+)?date\b/i.test(l) && !/due/i.test(l) && !TABLE_HEADER.test(l)) ?? null
  const dueLine = lines.find((l) => /^due\s*date\b/i.test(l)) ?? null
  const net = /\bnet\s*(\d{1,3})\b/i.exec(text)
  const order = slashOrder(dateLine, dueLine, net ? Number(net[1]) : null, opts.hintDate ?? null)

  // The date nearest the word "date" (invoice date, not a due date); else the first date anywhere.
  let invoiceDate: string | null = null
  for (let i = 0; i < lines.length && !invoiceDate; i++) {
    if (/(invoice\s*date|^date|\sdate:)/i.test(lines[i]) && !/due/i.test(lines[i]) && !TABLE_HEADER.test(lines[i])) {
      invoiceDate = parseDate(lines[i], order) ?? parseDate(lines[i + 1] ?? '', order)
    }
  }
  if (!invoiceDate) {
    for (const l of lines) {
      if (/due/i.test(l)) continue
      invoiceDate = parseDate(l, order)
      if (invoiceDate) break
    }
  }
  const dueDate = dueLine ? parseDate(dueLine, order) : null

  const subtotal = figure(lines, /^sub\s*-?total\b/i)
  const gst = figure(lines, /^(gst|hst)\b/i)
  let total: number | null = null
  // The last "total" wins (subtotals come first); its figure may sit on the next line.
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/(^|\s)(invoice\s+)?total/i.test(l) && !/sub\s*-?total/i.test(l)) {
      const n = numbersIn(l).filter((x) => x > 0)
      const next = numbersIn(lines[i + 1] ?? '').filter((x) => x > 0)
      if (n.length) total = n[n.length - 1]
      else if (next.length) total = next[next.length - 1]
    }
  }

  const header = lines.findIndex((l) => TABLE_HEADER.test(l))
  if (header >= 0) {
    const t = readTable(lines, header + 1, order)
    warnings.push(...t.warnings)
    const sum = round(t.rows.reduce((s, r) => s + r.amount, 0), 2)
    const adds = subtotal != null && Math.abs(sum - subtotal) <= 0.02
    if (subtotal != null && !adds) warnings.push(`The rows add to ${sum.toFixed(2)}, the subtotal says ${subtotal.toFixed(2)}`)
    if (subtotal != null && gst != null && total != null && Math.abs(subtotal + gst - total) > 0.02) {
      warnings.push('Subtotal + GST is not the total')
    }
    const lines_ = fuelLines(t.rows, warnings, subtotal == null || adds)
    return { invoiceNo, invoiceDate, dueDate, lines: lines_, rows: t.rows, subtotal, gst, total, layout: 'table', warnings }
  }

  return { invoiceNo, invoiceDate, dueDate, lines: looseLines(lines), rows: [], subtotal, gst, total, layout: 'loose', warnings }
}

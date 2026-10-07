/**
 * Reading a Fuel supplier invoice's text into fuel purchases.
 *
 * NOT YET CHECKED AGAINST A REAL INVOICE. None was reachable when this was
 * written (2 Oct 2026): no Fuel supplier mail in the Gmail account the tools
 * could read, and none in Drive. So it reads the way fuel invoices are laid
 * out in general rather than this supplier's layout in particular, and is
 * deliberately forgiving about where things sit:
 *
 * - The text layer of a PDF does not keep columns on one line — quantity,
 *   price and amount often land on the lines after the description. So a line
 *   naming a fuel opens a window that runs until the next fuel line (or eight
 *   lines), and the numbers are looked for anywhere in it.
 * - Within the window the line is the triple where litres × $/L = amount to
 *   within a cent a hundred litres. That arithmetic is what makes the reading
 *   trustworthy without knowing the layout: an order number or a tank size
 *   will not happen to multiply out. Failing a triple, a $/L-shaped number
 *   (0.50–4.00 with three or four decimals) beside a litres figure is taken,
 *   and marked `checked: false` so the importer says so.
 *
 * The first real invoice through `import-fuel-supplier.mjs --dry` is the test;
 * if it misreads, the fix belongs here and the fixture in the test file should
 * become that invoice's text.
 */

export type FuelProduct = 'farm_diesel' | 'clear_diesel' | 'gasoline' | 'farm_gasoline' | 'other'

export const FUEL_PRODUCT_LABEL: Record<FuelProduct, string> = {
  farm_diesel: 'Farm (dyed) diesel',
  clear_diesel: 'Clear diesel',
  gasoline: 'Gasoline',
  farm_gasoline: 'Farm (marked) gasoline',
  other: 'Other',
}

export type FuelLine = {
  product: FuelProduct
  description: string
  litres: number
  perL: number
  amount: number
  /** True when litres × $/L matched an amount on the invoice. */
  checked: boolean
}

export type FuelInvoice = {
  invoiceNo: string | null
  invoiceDate: string | null
  lines: FuelLine[]
  total: number | null
}

const FUEL_WORD = /(diesel|dyed|marked|ulsd|gasoline|unleaded|regular gas|premium gas|mid-?grade|\bgas\b)/i
// A tax or fee line names a fuel too ("Fuel tax — diesel"); it is not a purchase.
const NOT_A_PURCHASE = /(gst|hst|pst|fuel tax|carbon|levy|excise|surcharge|delivery fee|subtotal|total|balance|tank rental|discount)/i

/** Which fuel a description is. Dyed/marked/farm first, since "dyed diesel" is also "diesel". */
export function classifyFuel(desc: string): FuelProduct {
  const d = desc.toLowerCase()
  const farm = /(dyed|marked|coloured|colored|farm|purple|red diesel)/.test(d)
  const diesel = /(diesel|ulsd|d-?2|d2)/.test(d)
  const gas = /(gasoline|unleaded|regular|premium|mid-?grade|(^|[^a-z])gas([^a-z]|$))/.test(d)
  if (diesel) return farm ? 'farm_diesel' : 'clear_diesel'
  if (gas) return farm ? 'farm_gasoline' : 'gasoline'
  return 'other'
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}
const iso = (y: number, m: number, d: number) =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y < 2100
    ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    : null

/** A date in any of the ways an invoice prints one. Canadian day-first slashes are ambiguous, so yyyy-mm-dd and words are preferred. */
export function parseDate(s: string): string | null {
  let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = /(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]+(\d{4})/.exec(s)
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1])
  m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s)
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2])
  // 30/09/2026 or 09/30/2026: whichever half cannot be a month decides; if
  // both could be, month-first (most North American billing software).
  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    return a > 12 ? iso(+m[3], b, a) : iso(+m[3], a, b)
  }
  return null
}

const numbersIn = (s: string): number[] =>
  [...s.matchAll(/-?\$?\s?\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => Number(m[0].replace(/[$,\s]/g, '')))
    .filter((n) => Number.isFinite(n))

/** The decimals a number was printed with, for telling $1.879/L from 1,879 L. */
const decimalsIn = (s: string): Map<number, number> => {
  const out = new Map<number, number>()
  for (const m of s.matchAll(/\d[\d,]*\.(\d+)/g)) out.set(Number(m[0].replace(/,/g, '')), m[1].length)
  return out
}

function readWindow(text: string): Omit<FuelLine, 'product' | 'description'> | null {
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

export function parseFuelSupplierInvoice(text: string): FuelInvoice {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  const invoiceNo =
    /invoice\s*(?:#|no\.?|number|num)?\s*[:#]?\s*([A-Z]{0,4}-?\d{3,})/i.exec(text)?.[1] ?? null

  // The date nearest the word "date" (invoice date, not a due date); else the first date anywhere.
  let invoiceDate: string | null = null
  for (let i = 0; i < lines.length && !invoiceDate; i++) {
    if (/(invoice\s*date|^date|\sdate:)/i.test(lines[i]) && !/due/i.test(lines[i])) {
      invoiceDate = parseDate(lines[i]) ?? parseDate(lines[i + 1] ?? '')
    }
  }
  if (!invoiceDate) {
    for (const l of lines) {
      if (/due/i.test(l)) continue
      invoiceDate = parseDate(l)
      if (invoiceDate) break
    }
  }

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
    out.push({ product: classifyFuel(l), description: l.replace(/\s+/g, ' ').slice(0, 120), ...got })
  }

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

  return { invoiceNo, invoiceDate, lines: out, total }
}

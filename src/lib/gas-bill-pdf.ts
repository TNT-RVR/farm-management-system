import { groupRows, type Word } from './ici-invoice-pdf.ts'
import { endMoney, longDate } from './power-bill-pdf.ts'

/**
 * Natural gas bills read straight off their PDF's text, no model (Sam, 13
 * Oct 2026: "Yes build a gas reader for Direct Energy too").
 *
 * The farm's gas is ATCO Gas (the wires) sold by Direct Energy Regulated
 * Services (the gas), billed in GJ. What the bookkeeper attaches in
 * QuickBooks is of four kinds, and this tells them apart:
 *
 * - **The classic bill** (to late 2023): a summary page, a page of terms,
 *   then a page per site with its retailer charges (the GJ by billing cycle,
 *   administration fee, cost of gas, riders) and its distributor charges
 *   (the period, fixed and variable delivery, rate riders, carbon tax). The
 *   site pages are set in two columns: a chart and the meter on the left, the
 *   charges on the right, so the right column is read for the charges.
 * - **The 2026 bill** ("Your account statement"): one column, a site per
 *   section ("Natural gas charges for site ID … | legal land"), dates m/d/yyyy,
 *   and cancel/rebill lines when an estimate was corrected (the site's
 *   charges are already net of those).
 * - **A notice**: Direct Energy's "your bill is available" email, forwarded
 *   and printed. The amount and the date; no sites.
 * - **Anything else**: not read here.
 *
 * Every site is checked against its own subtotals and totals, and the sites
 * against the bill's. A budget-plan bill bills the plan's amount, not the
 * charges: there the sites are the gas actually used, and the check is the
 * GST instead.
 *
 * The figures in this file and its tests are made up.
 */

/** Raise to read every gas bill PDF again after the reading changes. */
export const GAS_BILL_PARSER_VERSION = 1

export type GasSection = 'retail' | 'distribution'
export type GasCharge = { section: GasSection; label: string; amount: number }

export type ParsedGasSite = {
  site_id: string
  address: string | null
  legal_land: string | null
  meter_number: string | null
  distributor: string | null
  period_start: string | null
  period_end: string | null
  gj: number | null
  conversion_factor: number | null
  meter_reading: number | null
  /** The gas itself: "Cost of Gas". */
  energy_charge: number | null
  /** The retailer's administration fee. */
  admin_fee: number | null
  delivery_fixed: number | null
  delivery_variable: number | null
  /** Rate riders, the retailer's and the distributor's. */
  riders: number | null
  /** The federal carbon tax, where the bill has it. */
  carbon_levy: number | null
  /** Everything else before GST (a franchise fee, a credit). */
  other_charges: number | null
  retail_subtotal: number | null
  distribution_subtotal: number | null
  /**
   * A classic "CORRECTED BILL" cancels days an earlier bill charged on an
   * estimate and bills them again here: those days, and what was cancelled
   * (before GST, negative). This bill's GJ include the days again.
   */
  rebilled_start: string | null
  rebilled_end: string | null
  rebilled_charges: number | null
  /** Net of anything cancelled. */
  gst: number | null
  /** The site's charges incl. GST. */
  total: number | null
  /** Every charge line, as printed. */
  lines: GasCharge[]
}

export type ParsedGasBill = {
  kind: 'bill'
  layout: 'classic' | '2026'
  retailer: string
  account_number: string | null
  invoice_number: string | null
  bill_date: string | null
  period_start: string | null
  period_end: string | null
  /** What the bill asks for this period: the current charges (on a budget plan, the plan's amount). */
  total: number | null
  /** On a budget plan: `total` is the plan's amount, the sites are the charges. */
  budget: boolean
  /** Direct Energy's "ADJUSTED INVOICE": it re-bills an estimate. */
  adjusted: boolean
  gst: number | null
  sites: ParsedGasSite[]
  warnings: string[]
}

export type ParsedGasNotice = {
  kind: 'notice'
  what: 'ebill' | 'receipt'
  retailer: string | null
  account_number: string | null
  /** The day of the email. */
  bill_date: string | null
  total: number | null
  due_date: string | null
}

export type ParsedGasOther = { kind: 'other'; looksLikeGas: boolean }

export type GasPdfReading = ParsedGasBill | ParsedGasNotice | ParsedGasOther

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')
const monthOf = (m: string) => MONTHS.indexOf(m.slice(0, 3).toLowerCase()) + 1
const iso = (y: number, m: number, d: number) => (y > 1990 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null)
const round2 = (v: number) => Math.round(v * 100) / 100
const round3 = (v: number) => Math.round(v * 1000) / 1000
const num = (t: string) => Number(t.replace(/[$,]/g, ''))
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol
const MONEY = String.raw`-?\$?-?[\d,]*\d\.\d{2}`

/** m/d/yyyy → yyyy-mm-dd (the 2026 bill's dates are month first). */
export function mdyDate(t: string): string | null {
  const m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(t)
  return m ? iso(Number(m[3]), Number(m[1]), Number(m[2])) : null
}

const LEGAL = /\b(NE|NW|SE|SW)[\s-]+(\d{1,2})[\s-]+(\d{1,3})[\s-]+(\d{1,2})(?:\s*-?\s*W\s*(\d))?(?![\d])/i

/** "NE 1 31 15 W4" or "NE 1 31 15W4" → "NE 1-31-15 W4", the way the farm writes its land. */
export function gasLegalLand(t: string | null): string | null {
  const m = t ? LEGAL.exec(t) : null
  return m ? `${m[1].toUpperCase()} ${Number(m[2])}-${Number(m[3])}-${Number(m[4])}${m[5] ? ` W${m[5]}` : ''}` : null
}

/** One printed row: all of it, and its two halves either side of the classic bill's column split. */
type Line = { full: string; left: string; right: string }

/** The classic bill's site pages: chart and meter left of this X (points), charges right of it. */
const SPLIT = 205

export function pageLines(pages: Word[][], split = SPLIT): Line[] {
  const out: Line[] = []
  for (const page of pages)
    for (const r of groupRows(page)) {
      const words = r.w
      const join = (ws: [number, string][]) => ws.map(([, t]) => t).join(' ').replace(/\s+/g, ' ').trim()
      out.push({ full: join(words), left: join(words.filter(([x]) => x < split)), right: join(words.filter(([x]) => x >= split)) })
    }
  return out
}

type Cancel = { start: string | null; end: string | null; amount: number; gst: number }
type Open = ParsedGasSite & { retailGj: number | null; retailTotal: number | null; distTotal: number | null; gstParts: number[]; cancels: Cancel[] }

const blank = (site_id: string): Open => ({
  site_id,
  address: null,
  legal_land: null,
  meter_number: null,
  distributor: null,
  period_start: null,
  period_end: null,
  gj: null,
  conversion_factor: null,
  meter_reading: null,
  energy_charge: null,
  admin_fee: null,
  delivery_fixed: null,
  delivery_variable: null,
  riders: null,
  carbon_levy: null,
  other_charges: null,
  retail_subtotal: null,
  distribution_subtotal: null,
  rebilled_start: null,
  rebilled_end: null,
  rebilled_charges: null,
  gst: null,
  total: null,
  lines: [],
  retailGj: null,
  retailTotal: null,
  distTotal: null,
  gstParts: [],
  cancels: [],
})

type Kind = 'energy' | 'admin' | 'delivery_fixed' | 'delivery_variable' | 'rider' | 'carbon' | 'other'

/** What a charge line is, by its section and label. */
export function chargeKind(section: GasSection, label: string): Kind {
  if (/carbon/i.test(label)) return 'carbon'
  if (/rider/i.test(label)) return 'rider'
  if (section === 'retail') return /cost of gas/i.test(label) ? 'energy' : /administration/i.test(label) ? 'admin' : 'other'
  if (/delivery charge\s*-\s*fixed/i.test(label)) return 'delivery_fixed'
  if (/delivery charge\s*-\s*variable/i.test(label)) return 'delivery_variable'
  return 'other'
}

/** A charge's label is words, not a date range or a GJ × rate sum. */
const isLabel = (t: string) => /[A-Za-z]{3,}/.test(t) && !/^\d/.test(t) && !/^[A-Za-z]{3} \d{1,2} [A-Za-z]{3} \d{1,2}$/.test(t)

/** Close a site: its charges into their kinds, and every check that it adds up. */
function finishSite(s: Open, n: number, warnings: string[]): ParsedGasSite {
  const name = `Site ${n} (${s.site_id.slice(-4)})`
  const sum = (f: (c: GasCharge) => boolean) => round2(s.lines.filter(f).reduce((a, c) => a + c.amount, 0))
  const of = (k: Kind) => {
    const hits = s.lines.filter((c) => chargeKind(c.section, c.label) === k)
    return hits.length ? round2(hits.reduce((a, c) => a + c.amount, 0)) : null
  }
  const retail = sum((c) => c.section === 'retail')
  const dist = sum((c) => c.section === 'distribution')
  if (s.retail_subtotal != null && !near(retail, s.retail_subtotal)) warnings.push(`${name}: retailer lines ${retail.toFixed(2)} ≠ sub-total ${s.retail_subtotal.toFixed(2)}`)
  if (s.distribution_subtotal != null && !near(dist, s.distribution_subtotal)) warnings.push(`${name}: distributor lines ${dist.toFixed(2)} ≠ sub-total ${s.distribution_subtotal.toFixed(2)}`)
  const cancelled = round2(s.cancels.reduce((a, c) => a + c.amount - c.gst, 0))
  const cancelledWithGst = round2(s.cancels.reduce((a, c) => a + c.amount, 0))
  const gstAll = [...s.gstParts, ...s.cancels.map((c) => c.gst)]
  const gst = gstAll.length ? round2(gstAll.reduce((a, v) => a + v, 0)) : null
  const before = (s.retail_subtotal ?? retail) + (s.distribution_subtotal ?? dist) + cancelled
  if (s.total == null) warnings.push(`${name}: no total`)
  else if (!near(before + (gst ?? 0), s.total)) warnings.push(`${name}: ${before.toFixed(2)} + GST ${(gst ?? 0).toFixed(2)} ≠ total ${s.total.toFixed(2)}`)
  if (s.retailTotal != null && s.distTotal != null && s.total != null && !near(s.retailTotal + s.distTotal + cancelledWithGst, s.total))
    warnings.push(`${name}: retailer ${s.retailTotal.toFixed(2)} + distributor ${s.distTotal.toFixed(2)}${s.cancels.length ? ` + cancelled ${cancelledWithGst.toFixed(2)}` : ''} ≠ total ${s.total.toFixed(2)}`)
  const starts = s.cancels.map((c) => c.start).filter((d): d is string => !!d)
  const ends = s.cancels.map((c) => c.end).filter((d): d is string => !!d)
  if (s.gj == null) warnings.push(`${name}: no GJ`)
  else if (s.retailGj != null && !near(s.retailGj, s.gj)) warnings.push(`${name}: retailer GJ ${s.retailGj} ≠ distributor GJ ${s.gj}`)
  const named = ['energy', 'admin', 'delivery_fixed', 'delivery_variable', 'rider', 'carbon'] as const
  const other = s.lines.filter((c) => !(named as readonly string[]).includes(chargeKind(c.section, c.label)))
  return {
    site_id: s.site_id,
    address: s.address,
    legal_land: gasLegalLand(s.address),
    meter_number: s.meter_number,
    distributor: s.distributor,
    period_start: s.period_start,
    period_end: s.period_end,
    gj: s.gj,
    conversion_factor: s.conversion_factor,
    meter_reading: s.meter_reading,
    energy_charge: of('energy'),
    admin_fee: of('admin'),
    delivery_fixed: of('delivery_fixed'),
    delivery_variable: of('delivery_variable'),
    riders: of('rider'),
    carbon_levy: of('carbon'),
    other_charges: other.length ? round2(other.reduce((a, c) => a + c.amount, 0)) : null,
    retail_subtotal: s.retail_subtotal ?? (s.lines.some((c) => c.section === 'retail') ? retail : null),
    distribution_subtotal: s.distribution_subtotal ?? (s.lines.some((c) => c.section === 'distribution') ? dist : null),
    rebilled_start: starts.length ? starts.sort()[0] : null,
    rebilled_end: ends.length ? ends.sort().at(-1)! : null,
    rebilled_charges: s.cancels.length ? cancelled : null,
    gst,
    total: s.total,
    lines: s.lines,
  }
}

/** The bill's own checks: the sites against its charges, and its GST. */
function finishBill(b: Omit<ParsedGasBill, 'sites' | 'period_start' | 'period_end'>, sites: ParsedGasSite[]): ParsedGasBill {
  const warnings = b.warnings
  const siteSum = round2(sites.reduce((a, s) => a + (s.total ?? 0), 0))
  const gstSum = round2(sites.reduce((a, s) => a + (s.gst ?? 0), 0))
  if (!sites.length) warnings.push('No sites found')
  if (!b.bill_date) warnings.push('No statement date')
  if (b.total == null) warnings.push('No current charges')
  else if (sites.length && !b.budget && !near(siteSum, b.total, 0.05)) warnings.push(`Sites ${siteSum.toFixed(2)} ≠ current charges ${b.total.toFixed(2)}`)
  if (b.gst != null && sites.length && !near(gstSum, b.gst, 0.05)) warnings.push(`Sites' GST ${gstSum.toFixed(2)} ≠ the bill's GST ${b.gst.toFixed(2)}`)
  const starts = sites.map((s) => s.period_start).filter((d): d is string => !!d)
  const ends = sites.map((s) => s.period_end).filter((d): d is string => !!d)
  return { ...b, period_start: starts.length ? starts.sort()[0] : null, period_end: ends.length ? ends.sort().at(-1)! : null, sites, warnings }
}

/** The amount on a line's right half, or on the next line's when this one is a label alone (the classic bill wraps them). */
function amountAt(lines: Line[], k: number, side: 'right' | 'full'): { value: number; label: string; used: number } | null {
  const here = endMoney(lines[k][side])
  if (here) return { ...here, used: 0 }
  const next = lines[k + 1]?.[side] ?? ''
  if (new RegExp(`^${MONEY}(\\s+CR)?$`).test(next)) {
    const v = endMoney(next)
    if (v) return { value: v.value, label: lines[k][side], used: 1 }
  }
  return null
}

/** Is this text Direct Energy's classic bill? */
export const isClassicGasBill = (text: string) => /RETAILER CHARGES\s+Natural Gas Site ID/i.test(text) && /Statement Date:/i.test(text)
/** Is this text Direct Energy's 2026 bill? */
export const isGasBill2026 = (text: string) => /Natural gas charges for site ID\s*\d/i.test(text) && /Account number\s*\d/i.test(text)

/** Direct Energy's classic bill, from its words. */
export function parseClassicGasBill(pages: Word[][]): ParsedGasBill {
  const lines = pageLines(pages)
  const warnings: string[] = []
  let account: string | null = null
  let billDate: string | null = null
  let total: number | null = null
  let gst: number | null = null
  let budget = false
  const sites = new Map<string, Open>()
  let cur: Open | null = null
  let section: GasSection = 'retail'
  let collecting = false
  let wantAddress = false

  // The period has no year: it is the statement's, less one where the month
  // comes after the statement's (a December period on a January bill), and
  // the start's less one again where it comes after the end's.
  const endYear = (endMonth: number): number | null => {
    if (!billDate) return null
    const y = Number(billDate.slice(0, 4))
    return endMonth > Number(billDate.slice(5, 7)) ? y - 1 : y
  }
  const period = (sMon: string, sDay: string, eMon: string, eDay: string): [string | null, string | null] => {
    const sm = monthOf(sMon)
    const em = monthOf(eMon)
    const ey = em > 0 ? endYear(em) : null
    if (!ey || sm < 1) return [null, null]
    return [iso(sm > em ? ey - 1 : ey, sm, Number(sDay)), iso(ey, em, Number(eDay))]
  }

  for (let k = 0; k < lines.length; k++) {
    const { full, left, right } = lines[k]
    let m: RegExpExecArray | null

    if (!account && (m = /Account Number:\s*(\d{6,})/i.exec(full))) account = m[1]
    if (!billDate && (m = /Statement Date:\s*(.+)$/i.exec(full))) billDate = longDate(m[1])
    if (total == null && (m = new RegExp(`^CURRENT NATURAL GAS CHARGES\\s+(${MONEY})`, 'i').exec(full))) total = endMoney(m[1])?.value ?? null
    if (/^BUDGET (AMOUNT DUE|REQUEST)\b/i.test(full)) budget = true
    if (gst == null && (m = /^TOTAL GST AMOUNT\s+\$?(-?[\d,]*\d\.\d{2})/i.exec(full))) gst = num(m[1])

    if ((m = /^(RETAILER|DISTRIBUTOR AND GOVERNMENT) CHARGES\s+Natural Gas Site ID\s+(\d{6,})/i.exec(full))) {
      const id = m[2]
      cur = sites.get(id) ?? blank(id)
      sites.set(id, cur)
      section = /^RETAILER/i.test(m[1]) ? 'retail' : 'distribution'
      collecting = false
      wantAddress = true
      continue
    }
    if (!cur) continue
    // The row under a site's heading is its address (unless the bill left it out).
    if (wantAddress) {
      wantAddress = false
      if (!/^(From|Distribution services)\b/i.test(full)) {
        cur.address ??= full
        continue
      }
    }

    if ((m = /^Total Charges for Site\s+(\d{6,})\s+(-?[\d,]*\d\.\d{2})/i.exec(full))) {
      const s = sites.get(m[1]) ?? cur
      s.total = num(m[2])
      collecting = false
      continue
    }

    // The left column: the meter and how its reading becomes GJ.
    if (!cur.meter_number && (m = /Meter:\s*([A-Z0-9][\w-]{3,})/i.exec(left))) cur.meter_number = m[1]
    if (cur.conversion_factor == null && (m = /Conversion Factor\s+(\d+\.\d+)/i.exec(left))) cur.conversion_factor = Number(m[1])
    if ((m = /^Actual\s+[A-Za-z]{3}\s+\d{1,2}\s+([\d,]+)$/i.exec(left))) cur.meter_reading = num(m[1])
    if (!cur.distributor && section === 'distribution' && (m = /^(ATCO Gas(?: South| North)?)\b/i.exec(left))) cur.distributor = m[1]

    if (!right) continue
    // "Feb 15 Cancel For Dec 30 -Jan 11 (Inc GST of $1.00) 21.00 CR": an earlier bill's days, cancelled.
    if ((m = /Cancel For ([A-Za-z]{3}) (\d{1,2}) ?- ?([A-Za-z]{3}) (\d{1,2}) \(Inc GST of \$?(-?[\d,]*\d\.\d{2})\)/i.exec(right))) {
      const v = endMoney(right)
      if (v) {
        const [start, end] = period(m[1], m[2], m[3], m[4])
        const sign = v.value < 0 ? -1 : 1
        cur.cancels.push({ start, end, amount: v.value, gst: sign * num(m[5]) })
      }
      collecting = false
      continue
    }
    if (/^Current (Energy|Distributor) Charges$/i.test(right)) {
      collecting = true
      continue
    }
    // "Jan 11 Feb 09 10.00": a billing cycle's GJ (the retailer's by cycle, the distributor's for the period).
    if ((m = /^([A-Za-z]{3}) (\d{1,2}) ([A-Za-z]{3}) (\d{1,2}) (-?[\d,]+\.\d+)$/.exec(right)) && !collecting) {
      const gj = num(m[5])
      if (section === 'retail') cur.retailGj = round3((cur.retailGj ?? 0) + gj)
      else {
        cur.gj = round3((cur.gj ?? 0) + gj)
        const [start, end] = period(m[1], m[2], m[3], m[4])
        if (start && (!cur.period_start || start < cur.period_start)) cur.period_start = start
        if (end && (!cur.period_end || end > cur.period_end)) cur.period_end = end
      }
      continue
    }
    if (/^Sub-?Total\b/i.test(right)) {
      const a = amountAt(lines, k, 'right')
      if (a) {
        if (section === 'retail') cur.retail_subtotal = a.value
        else cur.distribution_subtotal = a.value
        k += a.used
      }
      collecting = false
      continue
    }
    if (/^GST\b/i.test(right)) {
      const a = amountAt(lines, k, 'right')
      if (a) {
        cur.gstParts.push(a.value)
        k += a.used
      }
      continue
    }
    if ((m = /^CURRENT (ENERGY|DISTRIBUTOR) BILLING\b/i.exec(right))) {
      const a = amountAt(lines, k, 'right')
      if (a) {
        if (/ENERGY/i.test(m[1])) cur.retailTotal = a.value
        else cur.distTotal = a.value
        k += a.used
      }
      collecting = false
      continue
    }
    if (collecting) {
      const a = amountAt(lines, k, 'right')
      if (a && isLabel(a.label)) {
        cur.lines.push({ section, label: a.label, amount: a.value })
        k += a.used
      }
    }
  }

  const out = [...sites.values()].map((s, k) => finishSite(s, k + 1, warnings))
  return finishBill({ kind: 'bill', layout: 'classic', retailer: 'Direct Energy Regulated Services', account_number: account, invoice_number: null, bill_date: billDate, total, budget, adjusted: false, gst, warnings }, out)
}

/** Direct Energy's 2026 bill, from its words. */
export function parseGasBill2026(pages: Word[][]): ParsedGasBill {
  const lines = pageLines(pages, 0)
  const warnings: string[] = []
  let account: string | null = null
  let invoice: string | null = null
  let billDate: string | null = null
  let total: number | null = null
  let gst: number | null = null
  let retailAll: number | null = null
  let distAll: number | null = null
  let adjusted = false
  let budget = false
  const sites: Open[] = []
  let cur: Open | null = null
  let section: GasSection = 'retail'
  let collecting = false
  let gjNext = false

  for (let k = 0; k < lines.length; k++) {
    const line = lines[k].full
    let m: RegExpExecArray | null

    if (!account && (m = /Account number\s+(\d{6,})/i.exec(line))) account = m[1]
    if (!invoice && (m = /^Invoice number\s+(\d{6,})/i.exec(line))) invoice = m[1]
    if (!billDate && (m = /^Statement Date\s+(.+)$/i.exec(line))) billDate = longDate(m[1])
    if (!billDate && (m = /Billing date:\s*(.+)$/i.exec(line))) billDate = longDate(m[1])
    if (/^ADJUSTED INVOICE$/i.test(line)) adjusted = true
    if (/\b(average billing|budget) (plan )?amount\b/i.test(line)) budget = true
    if (total == null && (m = new RegExp(`^Current charges\\s+(${MONEY})$`, 'i').exec(line))) total = endMoney(m[1])?.value ?? null
    if (gst == null && (m = /^Total GST Amount\s+\$?(-?[\d,]*\d\.\d{2})/i.exec(line))) gst = num(m[1])
    if (retailAll == null && (m = new RegExp(`^Total retailer gas charges\\b.*?\\s(${MONEY})$`, 'i').exec(line))) retailAll = endMoney(m[1])?.value ?? null
    if (distAll == null && (m = new RegExp(`^Total distribution gas charges\\b.*?\\s(${MONEY})$`, 'i').exec(line))) distAll = endMoney(m[1])?.value ?? null

    if ((m = /^Natural gas charges for site ID\s+(\d{6,})\s*(?:\|\s*(.+))?$/i.exec(line))) {
      cur = blank(m[1])
      cur.address = m[2]?.trim() || null
      sites.push(cur)
      section = 'retail'
      collecting = false
      continue
    }
    if (!cur) continue

    if ((m = /^Consumption period\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+To\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(line))) {
      cur.period_start = mdyDate(m[1])
      cur.period_end = mdyDate(m[2])
      continue
    }
    if ((m = /charged by\s+(.+?)\s*\|\s*Meter number\s+([A-Z0-9][\w-]{3,})/i.exec(line))) {
      cur.distributor = m[1]
      cur.meter_number = m[2]
      continue
    }
    if (!cur.meter_number && (m = /Meter number\s+([A-Z0-9][\w-]{3,})/i.exec(line))) cur.meter_number = m[1]
    if (/^Current energy\b.*\bMeter reading\b/i.test(line)) {
      gjNext = true
      continue
    }
    // "10.00 02/09/2030 1.020000000 500 02/09/2030": GJ, read date, conversion factor, last reading, its date.
    if (gjNext && (m = /^(-?[\d,]+\.\d+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d+\.\d+)\s+([\d,]+)\s+(\d{1,2}\/\d{1,2}\/\d{4})$/.exec(line))) {
      cur.gj = num(m[1])
      cur.conversion_factor = Number(m[3])
      cur.meter_reading = num(m[4])
      gjNext = false
      continue
    }
    if (/^Retailer charges\b/i.test(line)) {
      section = 'retail'
      collecting = false
      continue
    }
    if (/^Current energy charges$/i.test(line)) {
      section = 'retail'
      collecting = true
      continue
    }
    if (/^Current distributor and government charges$/i.test(line)) {
      section = 'distribution'
      collecting = true
      continue
    }
    if (/^Cancel\/rebill\b/i.test(line)) {
      collecting = false
      continue
    }
    if ((m = new RegExp(`^Total current charges for site\\s+(\\d{6,})\\s+(${MONEY})$`, 'i').exec(line))) {
      const s = sites.find((x) => x.site_id === m![1]) ?? cur
      s.total = endMoney(m[2])?.value ?? null
      collecting = false
      continue
    }
    if (new RegExp(`^Sub-?total\\s+${MONEY}(\\s+CR)?$`, 'i').test(line)) {
      const v = endMoney(line)!.value
      if (section === 'retail') cur.retail_subtotal = v
      else cur.distribution_subtotal = v
      collecting = false
      continue
    }
    if (new RegExp(`^GST\\s+${MONEY}(\\s+CR)?$`, 'i').test(line)) {
      cur.gstParts.push(endMoney(line)!.value)
      continue
    }
    if (new RegExp(`^Total gas charges\\s+${MONEY}(\\s+CR)?$`, 'i').test(line)) {
      cur.retailTotal = endMoney(line)!.value
      collecting = false
      continue
    }
    if (new RegExp(`^Total distributor and government charges\\s+${MONEY}(\\s+CR)?$`, 'i').test(line)) {
      cur.distTotal = endMoney(line)!.value
      collecting = false
      continue
    }
    if (collecting) {
      const v = endMoney(line)
      if (v && isLabel(v.label) && !/^\d{1,2}\/\d{1,2}\/\d{4}/.test(v.label)) cur.lines.push({ section, label: v.label, amount: v.value })
    }
  }

  const out = sites.map((s, k) => finishSite(s, k + 1, warnings))
  const r = finishBill({ kind: 'bill', layout: '2026', retailer: 'Direct Energy Regulated Services', account_number: account, invoice_number: invoice, bill_date: billDate, total, budget, adjusted, gst, warnings }, out)
  const retailSum = round2(sites.reduce((a, s) => a + (s.retailTotal ?? 0), 0))
  const distSum = round2(sites.reduce((a, s) => a + (s.distTotal ?? 0), 0))
  if (retailAll != null && out.length && !near(retailSum, retailAll, 0.05)) warnings.push(`Sites' retailer charges ${retailSum.toFixed(2)} ≠ the bill's ${retailAll.toFixed(2)}`)
  if (distAll != null && out.length && !near(distSum, distAll, 0.05)) warnings.push(`Sites' distribution charges ${distSum.toFixed(2)} ≠ the bill's ${distAll.toFixed(2)}`)
  return r
}

/**
 * Direct Energy's emailed "your bill is available" (or a payment receipt),
 * forwarded and printed. Null if the text is not one.
 */
export function parseGasNotice(text: string): ParsedGasNotice | null {
  const t = text.replace(/[ \t]+/g, ' ')
  if (!/Forwarded message|^From:|^Subject:/im.test(t)) return null
  if (!/direct\s*energy/i.test(t)) return null
  const sent = /^Date:\s*(.+)$/im.exec(t)?.[1] ?? ''
  const sentDate = longDate(sent.replace(/^[A-Za-z]{3},\s*/, ''))
  const amount =
    /(?:Total Amount Due|Amount Now Due|Bill Amount|Payment Amount|Amount Paid)[\s\S]{0,80}?\$\s*(-?[\d,]*\d\.\d{2})/i.exec(t) ?? /(?:Total Amount Due|Amount Now Due)\s*:?\s*(-?[\d,]*\d\.\d{2})/i.exec(t)
  if (!amount) return null
  const after = t.slice((amount.index ?? 0) + amount[0].length)
  const receipt = /\breceipt\b|payment (?:has been |was )?received|thank you for your payment/i.test(t)
  return {
    kind: 'notice',
    what: receipt ? 'receipt' : 'ebill',
    retailer: 'Direct Energy Regulated Services',
    account_number: /Account Number:?\s*(\d{6,})/i.exec(t)?.[1] ?? null,
    bill_date: sentDate,
    total: num(amount[1]),
    due_date: receipt ? null : longDate(after.slice(0, 120)),
  }
}

/** One gas bill PDF, from its words and its text. */
export function readGasBillText(pages: Word[][], text: string): GasPdfReading {
  if (isClassicGasBill(text)) return parseClassicGasBill(pages)
  if (isGasBill2026(text)) return parseGasBill2026(pages)
  const notice = parseGasNotice(text)
  if (notice) return notice
  return { kind: 'other', looksLikeGas: /natural gas|\bGJ\b/i.test(text) }
}

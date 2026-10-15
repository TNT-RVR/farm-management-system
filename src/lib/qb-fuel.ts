/**
 * Fuel supplier bills as QuickBooks holds them, read into fuel prices.
 *
 * The bookkeeper enters these as account lines (Fuel & Oil), not item lines:
 * no quantity and no unit price, only a description and an amount before GST.
 * The description is what says what was bought, and only sometimes how much:
 *
 *   "Dyed Diesel"          a fuel, no litres        → a bill, no $/L
 *   "8,000L Dyed Diesel"   a fuel and its litres    → $/L = amount ÷ litres
 *   "DEF JUG 9.46L BO"     a jug size, not litres bought, and not fuel
 *   (blank)                most bills               → not described
 *
 * So from the books alone a price per litre exists only when the litres are
 * written into the line (or a "$1.789/L" is). The invoice PDF attached to each
 * bill has them: netlify/shared/fuel-supplier-qb-read.ts reads it into
 * fuel_purchases, and withInvoiceReadings() lays those lines over the bills.
 * Everything else is still listed, so the latest bill per fuel can be shown
 * and its invoice PDF opened from QuickBooks.
 *
 * Read by the Fuel page and by the costing price (fuel-data.ts), through the
 * fuel_supplier_qb_lines function: qb_lines itself is finance-only, but a fuel
 * price must cost the same for everyone who opens a page.
 */
import { classifyFuel, dieselAssumedDyed, type FuelProduct } from './fuel-supplier-invoice'

/** What a QuickBooks line bought: a fuel the costs use, or something they do not. */
export type QbFuelKind = FuelProduct | 'def' | 'propane' | 'mixed' | 'unknown'

/** The four fuels a price is kept for. */
export type QbPricedFuel = Exclude<FuelProduct, 'other'>

export const QB_FUEL_KIND_LABEL: Record<Exclude<QbFuelKind, QbPricedFuel>, string> = {
  other: 'Other',
  def: 'DEF',
  propane: 'Propane',
  mixed: 'Diesel and gas on one line',
  unknown: 'Fuel, not described',
}

/** One line as the fuel_supplier_qb_lines function (or a finance read of qb_lines) returns it. */
export type QbFuelLineRow = {
  entity: string
  qb_id: string
  line_no: number | null
  txn_date: string | null
  doc_number: string | null
  description: string | null
  amount: number | string | null
  account_name?: string | null
  attachable_id?: string | null
}

/** One fuel on one bill: its lines summed. */
export type QbFuelBill = {
  /** entity:qb_id:kind — unique. */
  key: string
  entity: string
  qbId: string
  docNumber: string | null
  on: string
  kind: QbFuelKind
  description: string | null
  /** Before GST, as QuickBooks books it. */
  amount: number
  litres: number | null
  perL: number | null
  /** The line says only "diesel", which is taken as dyed (Sam: almost all the farm's diesel is). */
  assumedDyed: boolean
  attachableId: string | null
  /** The litres and $/L came from the invoice PDF (read into fuel_purchases), not the QuickBooks line. */
  fromInvoice?: boolean
}

const FUEL_PRODUCTS: QbPricedFuel[] = ['farm_diesel', 'clear_diesel', 'gasoline', 'farm_gasoline']
export const isFuelProduct = (k: QbFuelKind): k is QbPricedFuel => (FUEL_PRODUCTS as QbFuelKind[]).includes(k)

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** What a line's description bought. DEF names diesel ("diesel exhaust fluid"), so it is caught first. */
export function qbFuelKind(desc: string | null | undefined): QbFuelKind {
  const d = clean(desc).toLowerCase()
  if (!d) return 'unknown'
  if (/(^|[^a-z])def([^a-z]|$)|exhaust fluid|bluedef|adblue/.test(d)) return 'def'
  if (/propane/.test(d)) return 'propane'
  const diesel = /(diesel|ulsd)/.test(d)
  const gas = /(gasoline|unleaded|(^|[^a-z])gas([^a-z]|$))/.test(d)
  if (diesel && gas) return 'mixed'
  const p = classifyFuel(d)
  // "Fuel for spring": fuel, but which one the line does not say.
  if (p === 'other') return /fuel/.test(d) ? 'unknown' : 'other'
  return p
}

/**
 * Litres bought, when the line says so: "10,000L", "4500 litres", "3,200.5 ltr".
 * Under 100 L is a pack size (a jug, a pail, a drum), never a delivery.
 */
export function litresIn(desc: string | null | undefined): number | null {
  const d = clean(desc)
  const m = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(?:l|lt|ltr|ltrs|litres?|liters?)(?![a-z])/i.exec(d)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, '') + (m[2] ?? ''))
  return Number.isFinite(n) && n >= 100 ? n : null
}

/** A price per litre written into the line: "$1.789/L", "1.65 per litre", "@ 1.7234". */
export function perLIn(desc: string | null | undefined): number | null {
  const d = clean(desc)
  const m =
    /\$?\s?(\d\.\d{2,4})\s*(?:\/\s*l(?:itre|iter|tr)?|per\s*l(?:itre|iter|tr)?)(?![a-z])/i.exec(d) ?? /@\s*\$?\s?(\d\.\d{2,4})(?!\d)/.exec(d)
  const n = m ? Number(m[1]) : NaN
  return Number.isFinite(n) && n >= 0.5 && n <= 4 ? n : null
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

/**
 * Lines into bills, one per fuel per bill, newest first.
 *
 * - Vendor credits are left out: a credit is not a price paid.
 * - A bill's lines of the same fuel are summed. QuickBooks often carries a
 *   few cents on a second, zero-rated line of the same bill; summed, it stays
 *   part of the delivery it belongs to.
 * - A $/L needs litres in the line (or a $/L written there). With a written
 *   $/L and no litres, the litres are worked back from the amount.
 */
export function readQbFuelBills(rows: QbFuelLineRow[]): QbFuelBill[] {
  const by = new Map<string, QbFuelBill & { texts: string[] }>()
  for (const r of rows) {
    if (r.entity === 'VendorCredit' || !r.txn_date) continue
    const amount = num(r.amount)
    if (amount <= 0) continue
    const text = clean(r.description)
    let kind = qbFuelKind(text)
    // A blank line booked to shop supplies is washer fluid, not fuel.
    if (kind === 'unknown' && r.account_name && !/fuel/i.test(r.account_name)) kind = 'other'
    if (kind === 'other') continue
    const key = `${r.entity}:${r.qb_id}:${kind}`
    const had = by.get(key)
    if (had) {
      had.amount += amount
      if (text && !had.texts.includes(text)) had.texts.push(text)
      had.attachableId ??= r.attachable_id ?? null
      continue
    }
    by.set(key, {
      key,
      entity: r.entity,
      qbId: r.qb_id,
      docNumber: r.doc_number ?? null,
      on: r.txn_date,
      kind,
      description: text || null,
      amount,
      litres: null,
      perL: null,
      assumedDyed: false,
      attachableId: r.attachable_id ?? null,
      texts: text ? [text] : [],
    })
  }

  const out: QbFuelBill[] = []
  for (const { texts, ...b } of by.values()) {
    b.amount = Math.round(b.amount * 100) / 100
    b.description = texts.join(' · ') || null
    if (isFuelProduct(b.kind)) {
      const litres = texts.map(litresIn).find((n) => n != null) ?? null
      const written = texts.map(perLIn).find((n) => n != null) ?? null
      if (litres != null) {
        b.litres = litres
        b.perL = Math.round((b.amount / litres) * 10000) / 10000
      } else if (written != null) {
        b.perL = written
        b.litres = Math.round((b.amount / written) * 10) / 10
      }
      // A price outside anything fuel has cost is a misread (a tank size, a
      // ticket number), not a price.
      if (b.perL != null && (b.perL < 0.5 || b.perL > 4)) {
        b.perL = null
        b.litres = null
      }
      b.assumedDyed = b.kind === 'farm_diesel' && dieselAssumedDyed(b.description)
    }
    out.push(b)
  }
  return out.sort((a, b) => (a.on === b.on ? b.qbId.localeCompare(a.qbId) : a.on < b.on ? 1 : -1))
}

/** A fuel_purchases line read from a bill's invoice PDF, as the bills list needs it. */
export type InvoiceReadLine = {
  qb_txn_ref: string | null
  product: FuelProduct
  description: string | null
  litres: number
  price_per_l: number
  amount: number | null
  invoice_no: string | null
  invoice_date: string
}

/**
 * The bills with what their invoice PDFs say (netlify/shared/fuel-supplier-qb-read.ts
 * reads them into fuel_purchases). A bill whose PDF gave fuel lines is shown
 * as those lines, one per fuel, with the invoice's litres and delivered $/L
 * and its date (the bookkeeper's date can be a slip); its DEF, propane or
 * other lines stay as QuickBooks has them. Bills not read yet are unchanged.
 */
export function withInvoiceReadings(bills: QbFuelBill[], lines: InvoiceReadLine[]): QbFuelBill[] {
  const byRef = new Map<string, InvoiceReadLine[]>()
  for (const l of lines) if (l.qb_txn_ref) byRef.set(l.qb_txn_ref, [...(byRef.get(l.qb_txn_ref) ?? []), l])
  if (!byRef.size) return bills
  const out: QbFuelBill[] = []
  const done = new Set<string>()
  for (const b of bills) {
    const ref = `${b.entity}:${b.qbId}`
    const read = byRef.get(ref)
    const replaced = read && (isFuelProduct(b.kind) || b.kind === 'unknown' || b.kind === 'mixed')
    if (!replaced) {
      out.push(b)
      continue
    }
    if (done.has(ref)) continue
    done.add(ref)
    const byFuel = new Map<FuelProduct, InvoiceReadLine[]>()
    for (const l of read) byFuel.set(l.product, [...(byFuel.get(l.product) ?? []), l])
    for (const [product, ls] of byFuel) {
      const litres = ls.reduce((s, l) => s + l.litres, 0)
      const amount = Math.round(ls.reduce((s, l) => s + (l.amount ?? l.litres * l.price_per_l), 0) * 100) / 100
      const description = [...new Set(ls.map((l) => l.description).filter(Boolean))].join(' · ') || null
      out.push({
        ...b,
        key: `${ref}:${product}`,
        kind: product,
        on: ls[0].invoice_date,
        docNumber: ls[0].invoice_no ?? b.docNumber,
        description,
        amount,
        litres,
        perL: litres > 0 ? Math.round((amount / litres) * 10000) / 10000 : null,
        assumedDyed: product === 'farm_diesel' && dieselAssumedDyed(description),
        fromInvoice: true,
      })
    }
  }
  return out.sort((a, b) => (a.on === b.on ? b.qbId.localeCompare(a.qbId) : a.on < b.on ? 1 : -1))
}

/** The newest bill per fuel that gives a $/L. */
export function latestQbPrices(bills: QbFuelBill[]): Map<FuelProduct, QbFuelBill> {
  const m = new Map<FuelProduct, QbFuelBill>()
  for (const b of bills) if (isFuelProduct(b.kind) && b.perL != null && !m.has(b.kind)) m.set(b.kind, b)
  return m
}

/** The newest bill per fuel, priced or not. */
export function latestQbBills(bills: QbFuelBill[]): Map<QbFuelKind, QbFuelBill> {
  const m = new Map<QbFuelKind, QbFuelBill>()
  for (const b of bills) if (!m.has(b.kind)) m.set(b.kind, b)
  return m
}

/** "Fuel supplier invoice 12345 via QuickBooks" — the source line a price is shown with. */
export function qbInvoiceLabel(b: Pick<QbFuelBill, 'docNumber'>): string {
  return `Fuel supplier invoice${b.docNumber ? ` ${b.docNumber}` : ''} via QuickBooks`
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildLine, normaliseProductName, parseHeader, productDisplayName, purchaseCategory, type InvoiceLine } from '../../src/lib/ici-invoice.ts'
import { FERT_SUM, readIciPages, type NoteItem } from '../../src/lib/ici-invoice-pdf.ts'
import { fieldLines, fieldMatcher, type FieldRef } from '../../src/lib/ici-field-lines.ts'
import { chunks, pdfWords, runAttachmentReader, type Reading, type ReaderOptions, type ReaderResult, type ReaderSpec } from './qb-attachments.ts'

/**
 * ICI's invoice PDFs, read out of QuickBooks (Sam, 13 Oct 2026: the
 * QuickBooks PDF reader is good "for the invoices from ICI instead of looking
 * through an email list").
 *
 * The email path — a Gmail filer saving ICI's emailed PDFs to Drive, and
 * scripts/ici-auto-import.mjs loading them on Sam's machine — went blind for
 * a year when ICI changed email domain, and every chemical price froze. The
 * bookkeeper attaches the same invoice to its bill in QuickBooks, so reading it
 * from there needs no mailbox and no machine left on.
 *
 * For each your retailer bill or purchase PDF not yet read at this
 * reading (ICI_PARSER_VERSION), through the shared QuickBooks attachment
 * reader (netlify/shared/qb-attachments.ts):
 *
 * - the positioned text (src/lib/ici-invoice-pdf.ts — the same rules as the
 *   email path's Python readers, plus the online layout most 2024–2025
 *   QuickBooks copies are in) and the header (src/lib/ici-invoice.ts);
 * - the lines into product_purchases exactly as scripts/import-ici-invoice.mjs
 *   writes them, matched to products by the same normalised name and aliases;
 *   the PDF itself into the invoices bucket, as scripts/upload-invoices.mjs files it;
 * - the notes under each line into ici_field_lines, as
 *   scripts/import-ici-field-lines.mjs writes them (src/lib/ici-field-lines.ts);
 * - then, as scripts/create-products-from-purchases.mjs does, a product for
 *   each line that matched none, and the price from its newest line.
 *
 * Never overwrites. An invoice whose number is already in product_purchases —
 * loaded from email, or typed — is left wholly to what is there (status
 * 'already_in' / 'typed'); lines are inserted with ON CONFLICT DO NOTHING on
 * the table's own key (supplier, invoice, description, quantity, unit price),
 * so the email path loading the same invoice at the same moment cannot double
 * it either; field lines likewise. The email importer in turn skips any invoice
 * number already loaded, so whichever path gets there first owns the invoice.
 *
 * Statements, payment receipts and Dext's history sheets are attached to the
 * same bills; they have no invoice lines and are noted as 'no_lines'.
 *
 * Runs nightly at the end of quickbooks-sync-background, on demand by
 * ici-invoices-background, and locally by scripts/read-ici-invoices.mjs
 * (which has a --dry mode). Reports to integration_health 'ici_qb_invoices'.
 */

export const READER = 'ici'
export const HEALTH_KEY = 'ici_qb_invoices'
/** Raise to read every ICI PDF again after the reading changes. */
export const ICI_PARSER_VERSION = 1
const SUPPLIER = 'your retailer'
const BUCKET = 'invoices'

export type IciStatus = 'lines' | 'no_lines' | 'unreadable' | 'already_in' | 'typed' | 'duplicate' | 'failed'
const STATUSES: readonly IciStatus[] = ['lines', 'no_lines', 'unreadable', 'already_in', 'typed', 'duplicate', 'failed']

export type IciInvoice = {
  invoiceNo: string
  invoiceDate: string
  total: number | null
  layout: 'printed' | 'online'
  lines: InvoiceLine[]
  notes: NoteItem[]
}

export type IciReading = Reading<IciStatus> & {
  invoice: IciInvoice | null
  /** The PDF, held from reading to saving a new invoice so it can be filed; dropped after. */
  pdf?: Uint8Array
}

export type IciReadResult = ReaderResult<IciStatus, IciReading> & {
  /** Invoice lines read from PDFs whose invoices were new. */
  newLines: number
}

type Product = { id: string; name: string; unit: string | null }

/** What a PDF that is not an invoice says it is. */
function notAnInvoice(text: string): string | null {
  if (/^\s*STATEMENT\b/m.test(text)) return 'A statement, not an invoice'
  if (/Payment Receipt/i.test(text)) return 'A payment receipt, not an invoice'
  if (/DEXT HISTORY/i.test(text)) return "Dext's history sheet, not an invoice"
  return null
}

/** The purchase-line key the table is unique on. */
const lineKey = (no: string, l: Pick<InvoiceLine, 'description' | 'quantity' | 'unitPrice'>) => [no, l.description, l.quantity, l.unitPrice].join('|')

/** Every row of a table, past PostgREST's page size. */
async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

/** Products by normalised name, with merged names (aliases) landing on the product they were folded into. */
async function productIndex(sb: SupabaseClient): Promise<Map<string, Product>> {
  const products = await all<Product>((a, b) => sb.from('jd_products').select('id, name, unit').order('id').range(a, b))
  const byName = new Map(products.map((p) => [normaliseProductName(p.name), p]))
  const aliases = await all<{ deere_name: string; product_id: string }>((a, b) =>
    sb.from('jd_product_aliases').select('deere_name, product_id').not('product_id', 'is', null).eq('ignored', false).order('deere_name').range(a, b),
  )
  const byId = new Map(products.map((p) => [p.id, p]))
  for (const a of aliases) {
    const key = normaliseProductName(a.deere_name)
    if (key && !byName.has(key) && byId.has(a.product_id)) byName.set(key, byId.get(a.product_id)!)
  }
  return byName
}

export async function readIciInvoices(sb: SupabaseClient, opts: ReaderOptions): Promise<IciReadResult> {
  let byName = new Map<string, Product>()
  /** Invoice numbers already in product_purchases → whether any line was typed (no source file). */
  const have = new Map<string, boolean>()
  /** Claimed by a PDF in this run: a bill with the invoice attached twice reads it once. */
  const claimed = new Set<string>()
  let matchField: (text: string) => string | null = () => null
  const written: string[] = []

  const spec: ReaderSpec<IciStatus, IciReading> = {
    reader: READER,
    healthKey: HEALTH_KEY,
    parserVersion: ICI_PARSER_VERSION,
    vendor: 'independent crop input%',
    // From 2022 on (Sam, 13 Oct 2026): the 2021 bills would only add old products.
    since: '2022-01-01',
    // A bill can carry several invoices, or an invoice and a statement.
    perBill: 'all',
    statuses: STATUSES,
    prepare: async () => {
      byName = await productIndex(sb)
      const rows = await all<{ invoice_no: string | null; source_file: string | null }>((a, b) =>
        sb.from('product_purchases').select('invoice_no, source_file').eq('supplier', SUPPLIER).order('id').range(a, b),
      )
      for (const r of rows) {
        if (!r.invoice_no) continue
        const no = r.invoice_no.trim().toUpperCase()
        have.set(no, (have.get(no) ?? false) || r.source_file == null)
      }
      const fields = await all<FieldRef>((a, b) => sb.from('fields').select('id, name, lld:legal_land_description').order('id').range(a, b))
      matchField = fieldMatcher(fields)
    },
    failed: (base, message) => ({ ...base, status: 'failed', invoice: null, detail: message }),
    read: async (_t, pdf: Uint8Array, base) => {
      const { pages, text } = await pdfWords(pdf)
      if (text.length < 100) return { ...base, status: 'unreadable', invoice: null, detail: 'No text layer (a scan?)' }
      const other = notAnInvoice(text)
      if (other) return { ...base, status: 'no_lines', invoice: null, detail: other }
      const head = parseHeader(text)
      const read = readIciPages(pages)
      if (!head.invoiceNo || !head.invoiceDate || !read) {
        return { ...base, status: 'no_lines', invoice: null, detail: !read ? 'No invoice table found' : 'No invoice number or date found' }
      }
      const invoice: IciInvoice = {
        invoiceNo: head.invoiceNo.toUpperCase(),
        invoiceDate: head.invoiceDate,
        total: head.total,
        layout: read.layout,
        lines: read.items.map((raw) => {
          const l = buildLine(raw)
          // A blend sum whose tickets could not be read is money, not a price.
          return FERT_SUM.test(l.description) ? { ...l, isProduct: false, pack: null, pricePerCanonical: null } : l
        }),
        notes: read.notes,
      }
      const no = invoice.invoiceNo
      if (!invoice.lines.length) return { ...base, status: 'no_lines', invoice, detail: `${no}: no lines read` }
      if (have.has(no)) {
        return have.get(no)
          ? { ...base, status: 'typed', invoice, detail: `${no} has lines typed by hand; left to them` }
          : { ...base, status: 'already_in', invoice, detail: `${no} already loaded (from email); left as it is` }
      }
      if (claimed.has(no)) return { ...base, status: 'duplicate', invoice, detail: `${no} is attached twice; read once` }
      claimed.add(no)
      const unpriced = invoice.lines.filter((l) => l.isProduct && l.pricePerCanonical == null).length
      const sums = invoice.lines.filter((l) => FERT_SUM.test(l.description)).length
      return {
        ...base,
        status: 'lines',
        invoice,
        pdf,
        detail:
          `${no} (${invoice.layout} layout): ${invoice.lines.length} line(s)` +
          (unpriced ? `, ${unpriced} with no pack size to price by` : '') +
          (sums ? `, ${sums} blend total(s) whose tickets could not be read — not priced` : ''),
      }
    },
    save: async (t, r) => {
      const inv = r.invoice
      const pdf = r.pdf
      delete r.pdf
      if (r.status !== 'lines' || !inv) return
      const no = inv.invoiceNo
      const storagePath = await filePdf(sb, pdf, no)

      const rows = inv.lines.map((l) => {
        const product = l.isProduct ? byName.get(normaliseProductName(l.description)) : undefined
        return {
          key: lineKey(no, l),
          row: {
            product_id: product?.id ?? null,
            supplier: SUPPLIER,
            invoice_no: no,
            invoice_date: inv.invoiceDate,
            description: l.description,
            ref_no: l.refNo,
            quantity: l.quantity,
            pack_unit: l.packUnit,
            unit_price: l.unitPrice,
            amount: l.amount,
            pack_size: l.pack?.size ?? null,
            canonical_unit: l.pack?.unit ?? null,
            price_per_canonical: l.pricePerCanonical,
            is_product: l.isProduct,
            source_file: t.fileName,
            storage_path: storagePath,
          },
        }
      })
      // An invoice can list the same line twice; the table keeps one, as the email path does.
      const unique = [...new Map(rows.map((x) => [x.key, x.row])).values()]
      const { error } = await sb
        .from('product_purchases')
        .upsert(unique, { onConflict: 'supplier,invoice_no,description,quantity,unit_price', ignoreDuplicates: true })
      if (error) throw new Error(`product_purchases: ${error.message}`)

      // The notes under each line, tied to fields.
      const year = Number(inv.invoiceDate.slice(0, 4))
      const { rows: lines } = fieldLines(inv.notes, matchField)
      if (inv.layout === 'online') {
        // No LOT numbers to carry a blend's field to its Edge and delivery
        // lines; where every blend on the invoice went on one field, they did too.
        const fields = new Set(lines.filter((l) => (l.kind === 'blend' || l.kind === 'fertilizer') && l.field_id).map((l) => l.field_id))
        const one = fields.size === 1 ? lines.find((l) => l.field_id) : undefined
        if (one) for (const l of lines) if (!l.field_id && (l.kind === 'edge' || l.kind === 'floating' || l.kind === 'delivery')) Object.assign(l, { field_id: one.field_id, field_text: l.field_text ?? one.field_text, crop_text: l.crop_text ?? one.crop_text })
      }
      const fieldRows = [
        ...new Map(
          lines.map((l) => [[l.ref_no, l.description, l.amount].join('|'), { ...l, crop_year: year, invoice_no: no, invoice_date: inv.invoiceDate }]),
        ).values(),
      ]
      if (fieldRows.length) {
        const { error: e } = await sb.from('ici_field_lines').upsert(fieldRows, { onConflict: 'invoice_no,ref_no,description,amount', ignoreDuplicates: true })
        if (e) throw new Error(`ici_field_lines: ${e.message}`)
      }
      written.push(no)
    },
    logRow: (r) => ({
      invoice_no: r.invoice?.invoiceNo ?? null,
      invoice_date: r.invoice?.invoiceDate ?? null,
      total: r.invoice?.total ?? null,
      line_count: r.invoice?.lines.length ?? 0,
    }),
    finish: async () => (written.length ? await makeProducts(sb, written) : null),
    summary: (readings, s) =>
      `${readings.length} PDF(s) read: ${s.lines} new invoice(s) (${newLinesOf(readings)} line(s)), ${s.already_in} already loaded` +
      (s.typed ? `, ${s.typed} typed by hand` : '') +
      (s.duplicate ? `, ${s.duplicate} attached twice` : '') +
      `, ${s.no_lines} not invoices` +
      (s.unreadable ? `, ${s.unreadable} scans` : '') +
      (s.failed ? `, ${s.failed} failed` : ''),
  }

  const r = await runAttachmentReader(sb, spec, opts)
  // A dry run never saves, so its readings still hold their PDFs.
  for (const x of r.readings) delete x.pdf
  return { ...r, newLines: newLinesOf(r.readings) }
}

const newLinesOf = (readings: IciReading[]) => readings.reduce((n, r) => n + (r.status === 'lines' ? (r.invoice?.lines.length ?? 0) : 0), 0)

/**
 * The PDF into the invoices bucket at ici/<invoice>.pdf, as
 * scripts/upload-invoices.mjs names it, so the price can be checked against
 * the paper. A file already there is kept. A failed upload is not a failed
 * read: the line is still worth having without its paper.
 */
async function filePdf(sb: SupabaseClient, pdf: Uint8Array | undefined, invoiceNo: string): Promise<string | null> {
  if (!pdf) return null
  const path = `ici/${invoiceNo}.pdf`
  const { error } = await sb.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false })
  if (!error || /exists|duplicate/i.test(error.message)) return path
  console.log('[ici-qb-read] invoice PDF not filed:', error.message)
  return null
}

/**
 * scripts/create-products-from-purchases.mjs, for the invoices just loaded: a
 * product for each line that matched none (fertiliser the insert trigger has
 * not already made), named off the newest description with its packaging
 * taken off; then those lines tied to it and its price from its newest line.
 * A line with no canonical unit is skipped: nothing to price against.
 */
export async function makeProducts(sb: SupabaseClient, invoiceNos: string[]): Promise<string> {
  type Line = { id: string; description: string; pack_unit: string | null; canonical_unit: string | null; invoice_date: string }
  const lines: Line[] = []
  for (const part of chunks(invoiceNos)) {
    const { data, error } = await sb
      .from('product_purchases')
      .select('id, description, pack_unit, canonical_unit, invoice_date')
      .eq('supplier', SUPPLIER)
      .in('invoice_no', part)
      .eq('is_product', true)
      .is('product_id', null)
    if (error) throw new Error(`product_purchases: ${error.message}`)
    lines.push(...((data ?? []) as Line[]))
  }
  if (!lines.length) return 'every line matched a product'

  let byName = await productIndex(sb)
  const wanted = new Map<string, { name: string; unit: string; category: 'fertilizer' | 'chemical' }>()
  for (const l of [...lines].sort((a, b) => b.invoice_date.localeCompare(a.invoice_date))) {
    const key = normaliseProductName(l.description)
    if (!key || !l.canonical_unit || byName.has(key) || wanted.has(key)) continue
    wanted.set(key, { name: productDisplayName(l.description), unit: l.canonical_unit, category: purchaseCategory(l.description, l.pack_unit) })
  }
  if (wanted.size) {
    const { error } = await sb.from('jd_products').upsert([...wanted.values()], { onConflict: 'name', ignoreDuplicates: true })
    if (error) throw new Error(`jd_products: ${error.message}`)
    byName = await productIndex(sb)
  }

  // Tie each line to its product, never replacing one already set.
  const linked = new Set<string>()
  let tied = 0
  for (const l of lines) {
    const p = byName.get(normaliseProductName(l.description))
    if (!p) continue
    const { error } = await sb.from('product_purchases').update({ product_id: p.id }).eq('id', l.id).is('product_id', null)
    if (error) throw new Error(`product_purchases: ${error.message}`)
    linked.add(p.id)
    tied++
  }

  // Price from the newest priced line, as the importer's last statement does.
  let priced = 0
  for (const part of chunks([...linked])) {
    const { data, error } = await sb.from('product_latest_price').select('product_id, invoice_date, invoice_no, price_per_canonical').in('product_id', part)
    if (error) throw new Error(`product_latest_price: ${error.message}`)
    for (const l of data ?? []) {
      const { data: done, error: e } = await sb
        .from('jd_products')
        .update({ price_per_unit: l.price_per_canonical, price_updated_on: l.invoice_date, price_source: `ICI ${l.invoice_no ?? ''}`, updated_at: new Date().toISOString() })
        .eq('id', l.product_id)
        .or(`price_updated_on.is.null,price_updated_on.lte.${l.invoice_date}`)
        .select('id')
      if (e) throw new Error(`jd_products: ${e.message}`)
      priced += done?.length ?? 0
    }
  }
  const left = lines.length - tied
  return `${wanted.size} product(s) made, ${tied} line(s) tied to one, ${priced} price(s) set` + (left ? `, ${left} line(s) matched no product` : '')
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { FUEL_SUPPLIER_PARSER_VERSION, parseFuelSupplierInvoice, type FuelInvoice, type FuelLine } from '../../src/lib/fuel-supplier-invoice.ts'
import { pdfText, runAttachmentReader, type AttachmentTodo, type QbBill, type Reading, type ReaderSpec } from './qb-attachments.ts'

export { downloadAttachment, pdfText } from './qb-attachments.ts'

/**
 * Fuel supplier's invoice PDFs, read out of QuickBooks into fuel_purchases
 * (Sam, 13 Oct 2026: "build a reader for the invoice PDFs already attached
 * in QuickBooks").
 *
 * The bookkeeper books each Fuel supplier bill as one dollar line, so the books
 * hold no litres. The invoice PDF attached to the bill has them. For each
 * Fuel supplier bill or purchase whose PDF has not been read by the current
 * reading (FUEL_SUPPLIER_PARSER_VERSION): its text layer,
 * src/lib/fuel-supplier-invoice.ts, and one fuel_purchases row per fuel line —
 * litres, delivered $/L before GST, amount — with source 'invoice' and the
 * bill and file it came from.
 *
 * Listing, downloading, the qb_attachment_reads log and the health report are
 * the shared QuickBooks attachment reader's (netlify/shared/qb-attachments.ts).
 * Every PDF looked at is noted (fuel, no fuel, a scan, typed by hand, or
 * failed), so a nightly run downloads only what is new; a failed download is
 * tried again next time.
 *
 * - Idempotent: rows are keyed on (supplier, invoice number, line number). A
 *   re-read rewrites its own lines and drops any it no longer finds.
 * - Typed rows are never touched. An invoice someone has already typed in by
 *   its number is left to the typed lines, so its litres are not counted twice.
 *
 * Run nightly at the end of quickbooks-sync-background, on demand by
 * fuel-supplier-invoices-background, and locally by
 * scripts/read-fuel-supplier-invoices.mjs (which has a --dry mode).
 */

export const READER = 'fuel_supplier'
export const HEALTH_KEY = 'fuel_supplier_qb_invoices'
const SUPPLIER = 'Fuel supplier'

export type ReadStatus = 'fuel' | 'no_fuel' | 'unreadable' | 'typed' | 'failed'
const STATUSES: readonly ReadStatus[] = ['fuel', 'no_fuel', 'unreadable', 'typed', 'failed']

export type InvoiceReading = Reading<ReadStatus> & { invoice: FuelInvoice | null }

export type FuelSupplierReadResult = {
  ok: boolean
  dry: boolean
  /** Fuel supplier bills and purchases with a PDF attached. */
  withPdf: number
  /** Of those, read before by this reading and left alone. */
  alreadyRead: number
  read: number
  byStatus: Record<ReadStatus, number>
  fuelLines: number
  /** Readings with something a person should look at (a row not adding up, rows ≠ subtotal). */
  withWarnings: number
  /** Not reached before the deadline; the next run carries on. */
  notReached: number
  detail: string
  readings: InvoiceReading[]
}

/** "Dyed Diesel 1.2345/L + Provincial Tax Dyed Diesel 0.0500/L, before GST" — how a delivered $/L was made up. */
export function lineNote(l: FuelLine): string {
  const per = (amount: number) => (amount / l.litres).toFixed(4)
  const taxes = l.taxes.map((t) => ` + ${t.name} ${per(t.amount)}/L`).join('')
  return `${l.description} ${per(l.fuelAmount)}/L${taxes}, before GST`
}

/** The fuel_purchases rows for one read invoice. */
export function purchaseRows(t: Pick<AttachmentTodo, 'attachableId' | 'fileName' | 'txnRef'> & { bill: QbBill }, inv: FuelInvoice) {
  const invoiceNo = inv.invoiceNo ?? t.bill.doc_number ?? t.txnRef
  const date = inv.invoiceDate ?? t.bill.txn_date
  return inv.lines.map((l) => ({
    supplier: SUPPLIER,
    invoice_no: invoiceNo,
    line_no: l.lineNo,
    invoice_date: date,
    product: l.product,
    description: l.description,
    litres: l.litres,
    price_per_l: l.perL,
    amount: l.amount,
    checked: l.checked && inv.warnings.length === 0,
    source: 'invoice' as const,
    source_file: t.fileName,
    notes: lineNote(l),
    qb_txn_ref: t.txnRef,
    qb_attachable_id: t.attachableId,
  }))
}

const fuelLinesOf = (readings: InvoiceReading[]) => readings.reduce((s, r) => s + (r.status === 'fuel' ? (r.invoice?.lines.length ?? 0) : 0), 0)
const warningsOf = (readings: InvoiceReading[]) => readings.filter((r) => (r.invoice?.warnings.length ?? 0) > 0).length

export async function readFuelSupplierInvoices(
  sb: SupabaseClient,
  opts: { deadline: number; dry?: boolean; reread?: boolean; limit?: number; concurrency?: number },
): Promise<FuelSupplierReadResult> {
  // Invoice numbers someone typed in by hand: those invoices are theirs.
  const typed = new Set<string>()

  const spec: ReaderSpec<ReadStatus, InvoiceReading> = {
    reader: READER,
    healthKey: HEALTH_KEY,
    parserVersion: FUEL_SUPPLIER_PARSER_VERSION,
    vendor: 'power fuel%',
    perBill: 'newest',
    statuses: STATUSES,
    prepare: async () => {
      const { data: typedRows } = await sb.from('fuel_purchases').select('invoice_no').eq('source', 'typed').ilike('supplier', 'power fuel%').not('invoice_no', 'is', null)
      for (const r of typedRows ?? []) typed.add(String(r.invoice_no).trim())
    },
    failed: (base, message) => ({ ...base, status: 'failed', invoice: null, detail: message }),
    read: async (t, pdf, base) => {
      const text = await pdfText(pdf)
      if (text.length < 100) return { ...base, status: 'unreadable', invoice: null, detail: 'No text layer (a scan?)' }
      const inv = parseFuelSupplierInvoice(text, { hintDate: t.bill.txn_date })
      const no = inv.invoiceNo ?? t.bill.doc_number
      if (inv.lines.length && no && typed.has(no)) return { ...base, status: 'typed', invoice: inv, detail: 'Typed in by hand already; left to the typed lines' }
      return { ...base, status: inv.lines.length ? 'fuel' : 'no_fuel', invoice: inv, detail: inv.warnings.join('; ').slice(0, 500) || null }
    },
    save: async (t, r) => {
      if (r.status !== 'fuel' || !r.invoice) return
      const rows = purchaseRows(t, r.invoice)
      const { error: e } = await sb.from('fuel_purchases').upsert(rows, { onConflict: 'supplier,invoice_no,line_no' })
      if (e) throw new Error(`fuel_purchases: ${e.message}`)
      // Lines a re-read no longer finds.
      const { error: d } = await sb
        .from('fuel_purchases')
        .delete()
        .eq('source', 'invoice')
        .eq('qb_attachable_id', t.attachableId)
        .gt('line_no', rows.length)
      if (d) throw new Error(`fuel_purchases: ${d.message}`)
    },
    logRow: (r) => {
      const inv = r.invoice
      return {
        invoice_no: inv?.invoiceNo ?? null,
        invoice_date: inv?.invoiceDate ?? null,
        fuel_lines: inv?.lines.length ?? 0,
        subtotal: inv?.subtotal ?? null,
        gst: inv?.gst ?? null,
        total: inv?.total ?? null,
        checked: inv ? inv.warnings.length === 0 : null,
      }
    },
    summary: (readings, byStatus) => {
      const fuelLines = fuelLinesOf(readings)
      const withWarnings = warningsOf(readings)
      return (
        `${readings.length} PDF(s) read: ${byStatus.fuel} with fuel (${fuelLines} line(s)), ${byStatus.no_fuel} no fuel` +
        (byStatus.typed ? `, ${byStatus.typed} already typed` : '') +
        (byStatus.unreadable ? `, ${byStatus.unreadable} scans` : '') +
        (byStatus.failed ? `, ${byStatus.failed} failed to download` : '') +
        (withWarnings ? `, ${withWarnings} to check` : '')
      )
    },
  }

  const r = await runAttachmentReader(sb, spec, opts)
  return { ...r, fuelLines: fuelLinesOf(r.readings), withWarnings: warningsOf(r.readings) }
}

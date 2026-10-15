import { supabase } from '@/lib/supabase'
import { zipStore } from '@/lib/geo/shp-write'
import { fetchAll, fileOf, longDate, num, pick, reportCsv, type Cell, type GatherContext, type Made, type ParamValues, type ReportData } from './framework'

/**
 * Supplier invoice copies: the original PDFs filed in the private invoices
 * bucket (scripts/upload-invoices.mjs puts them there, one per invoice, and
 * product_purchases.storage_path points at it), for a supplier and a range
 * of invoice dates. ZIP is the PDFs themselves with index.csv beside them;
 * CSV and PDF are that index alone — date, supplier, invoice, lines, total
 * and the file's name in the zip — so the accountant can see what is coming.
 *
 * The zip is stored rather than deflated: the PDFs are compressed already.
 */

export type InvoiceLine = { invoice_no: string | null; invoice_date: string | null; supplier: string | null; amount: unknown; storage_path: string | null }

export type InvoiceCopy = {
  invoiceNo: string
  date: string | null
  supplier: string
  lines: number
  total: number
  storagePath: string | null
  /** Its name in the zip; null when no PDF was uploaded. */
  fileName: string | null
}

/** A file name every unzip tool and Windows will take: plain letters, no slashes or colons. */
export function safeFileName(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'invoice'
  )
}

/** Invoice lines rolled up to invoices, oldest first, each with a unique name in the zip. */
export function invoiceCopies(lines: InvoiceLine[]): InvoiceCopy[] {
  const by = new Map<string, InvoiceCopy>()
  for (const l of lines) {
    if (!l.invoice_no) continue
    const supplier = l.supplier?.trim() || 'Supplier unknown'
    const key = `${supplier}|${l.invoice_no}`
    const c = by.get(key) ?? { invoiceNo: l.invoice_no, date: l.invoice_date, supplier, lines: 0, total: 0, storagePath: null, fileName: null }
    c.lines++
    c.total += num(l.amount) ?? 0
    c.storagePath ??= l.storage_path
    if (!c.date || (l.invoice_date && l.invoice_date < c.date)) c.date = l.invoice_date ?? c.date
    by.set(key, c)
  }
  const list = [...by.values()].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.invoiceNo.localeCompare(b.invoiceNo))
  // Date first so the folder sorts the way the invoices came in.
  const used = new Set<string>()
  for (const c of list) {
    if (!c.storagePath) continue
    const base = safeFileName(`${c.date ?? 'undated'} ${c.supplier} ${c.invoiceNo}`)
    let name = `${base}.pdf`
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i}).pdf`
    used.add(name.toLowerCase())
    c.fileName = name
  }
  return list
}

/** The index: a row an invoice, and what became of its file. */
export function invoiceIndex(copies: InvoiceCopy[], missing: Set<string> = new Set()): Pick<ReportData, 'columns' | 'groups' | 'totals'> {
  const rows: Cell[][] = copies.map((c) => [
    c.date,
    c.supplier,
    c.invoiceNo,
    c.lines,
    Math.round(c.total * 100) / 100,
    c.fileName == null ? 'not uploaded' : missing.has(c.invoiceNo) ? `${c.fileName} (could not be read)` : c.fileName,
  ])
  return {
    columns: [{ label: 'Date' }, { label: 'Supplier' }, { label: 'Invoice' }, { label: 'Lines', decimals: 0 }, { label: 'Total', decimals: 2, money: true }, { label: 'File' }],
    groups: [{ title: '', rows }],
    totals: ['Total', `${copies.length} invoices`, null, copies.reduce((n, c) => n + c.lines, 0), Math.round(copies.reduce((t, c) => t + c.total, 0) * 100) / 100, `${copies.filter((c) => c.fileName).length} PDFs`],
  }
}

/** Fetch the files a few at a time: one at a time is slow, all at once trips the browser's limit. */
async function fetchFiles(copies: InvoiceCopy[]): Promise<{ files: { name: string; data: Uint8Array }[]; missing: Set<string> }> {
  const want = copies.filter((c) => c.storagePath && c.fileName)
  const files: { name: string; data: Uint8Array }[] = []
  const missing = new Set<string>()
  let next = 0
  const worker = async () => {
    while (next < want.length) {
      const c = want[next++]
      const { data, error } = await supabase.storage.from('invoices').download(c.storagePath!)
      if (error || !data) missing.add(c.invoiceNo)
      else files.push({ name: c.fileName!, data: new Uint8Array(await data.arrayBuffer()) })
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, want.length) }, worker))
  // In the index's order, not the order the downloads finished.
  const order = new Map(want.map((c, i) => [c.fileName!, i]))
  files.sort((a, b) => order.get(a.name)! - order.get(b.name)!)
  return { files, missing }
}

export async function gatherInvoiceCopies(p: ParamValues, ctx: GatherContext): Promise<Made> {
  const supplier = pick(p, 'supplier')
  const from = p.from || `${ctx.today.slice(0, 4)}-01-01`
  const to = p.to || ctx.today
  if (from > to) throw new Error('The start date is after the end date.')
  const lines = await fetchAll<InvoiceLine>((a, b) => {
    let q = supabase.from('product_purchases').select('invoice_no, invoice_date, supplier, amount, storage_path').gte('invoice_date', from).lte('invoice_date', to)
    if (supplier) q = q.eq('supplier', supplier)
    return q.order('id').range(a, b)
  })
  const copies = invoiceCopies(lines)
  if (!copies.length) throw new Error(`No invoices${supplier ? ` from ${supplier}` : ''} between ${longDate(from)} and ${longDate(to)}.`)

  const who = supplier ?? 'All suppliers'
  const filename = safeFileName(`Invoices ${who} ${from} to ${to}`)
  let missing = new Set<string>()
  let files: { name: string; data: Uint8Array }[] = []
  if (ctx.format === 'ZIP') {
    if (!copies.some((c) => c.fileName)) throw new Error('None of these invoices has its PDF uploaded yet (scripts/upload-invoices.mjs files them).')
    ;({ files, missing } = await fetchFiles(copies))
    if (!files.length) throw new Error('The invoice PDFs could not be read. Try again, or open one from Fertilizer → Pricing.')
  }

  const report: ReportData = {
    title: 'Supplier invoice copies',
    subtitle: `${who} · ${longDate(from)} to ${longDate(to)}`,
    meta: [
      ['Invoices', copies.length],
      ['With the PDF', copies.filter((c) => c.fileName).length],
      ['Not uploaded', copies.filter((c) => !c.fileName).length],
    ],
    summary: ['Every invoice in the range, from the lines read off it. The ZIP download carries each uploaded PDF under the name in the File column, with this list as index.csv.'],
    ...invoiceIndex(copies, missing),
    filename,
  }
  if (ctx.format !== 'ZIP') return report
  const zip = zipStore([...files, { name: 'index.csv', data: new TextEncoder().encode(reportCsv(report)) }])
  return fileOf(zip, `${filename}.zip`, 'application/zip')
}

import './pdf-polyfills.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractText, getDocumentProxy } from 'unpdf'
import { qbAccess, qbGet, type QbAccount } from '../functions/_quickbooks.mts'
import { groupRows, wordsFromFragments, type Fragment, type Word } from '../../src/lib/ici-invoice-pdf.ts'

/**
 * Reading the PDFs attached to a supplier's bills in QuickBooks — the shared
 * part (Sam, 13 Oct 2026: the Fuel supplier reader "will be good for some other
 * applications including the invoices from ICI").
 *
 * A reader names a vendor and says what to do with one PDF; this does the rest:
 *
 * - lists the vendor's Bills and Purchases (a credit is not a price paid) from
 *   the synced books (qb_entities), and the PDFs attached to them;
 * - skips the ones this reader has already read at its current parser version
 *   (qb_attachment_reads, keyed by reader + attachable id; a failed download
 *   is tried again next run);
 * - downloads each through a fresh TempDownloadUri (it expires in minutes, so
 *   it is never stored), newest bill first, a few at a time, until the deadline;
 * - hands the reader the bytes, saves what it read (unless dry), notes the PDF
 *   in qb_attachment_reads, and reports to integration_health under the
 *   reader's own key.
 *
 * The QuickBooks token comes from qbAccess, the same as the sync: it refreshes
 * (and saves the rotated refresh token) when it must. Calls to it go one at a
 * time, so two downloads never refresh at once and lose the rotated token.
 *
 * Readers: netlify/shared/fuel-supplier-qb-read.ts, netlify/shared/ici-qb-read.ts,
 * netlify/shared/power-bills-qb-read.ts.
 */

const MAX_PDF = 10_000_000

export type QbBill = { entity: string; qb_id: string; txn_date: string | null; doc_number: string | null }
export type AttachmentTodo = { attachableId: string; fileName: string; txnRef: string; bill: QbBill }

/** What every reading carries, whatever the reader. */
export type ReadingBase = {
  attachableId: string
  txnRef: string
  txnDate: string | null
  docNumber: string | null
  fileName: string
}
export type Reading<S extends string> = ReadingBase & { status: S; detail: string | null }

export type ReaderSpec<S extends string, R extends Reading<S>> = {
  /** The qb_attachment_reads.reader name. */
  reader: string
  /** The integration_health.source_key it reports to. */
  healthKey: string
  /** A newer reading reads every PDF again. */
  parserVersion: number
  /** The vendor, as an ilike pattern on the party name: 'power fuel%'; or several, any of which. */
  vendor: string | readonly string[]
  /** 'newest': one PDF per bill, the newest file; 'all': every PDF on it. */
  perBill: 'newest' | 'all'
  /** Only bills dated on or after this (YYYY-MM-DD); absent, every year. */
  since?: string
  /** Every status, for the counts; must include 'failed'. */
  statuses: readonly S[]
  /** Loaded once the PDFs to read are known, before the first is read. */
  prepare?: () => Promise<void>
  /** One downloaded PDF into a reading. Throwing makes it 'failed'. */
  read: (t: AttachmentTodo, pdf: Uint8Array, base: ReadingBase) => Promise<R>
  /** The reading for a PDF that could not be downloaded (or read). */
  failed: (base: ReadingBase, message: string) => R
  /** Write what was read into the reader's own tables. Not called when dry. */
  save?: (t: AttachmentTodo, r: R) => Promise<void>
  /** The reader's own qb_attachment_reads columns (invoice_no, total, …). */
  logRow: (r: R) => Record<string, unknown>
  /** After every PDF is read and saved (not when dry): a follow-on step. Its return goes in the detail. */
  finish?: (readings: R[]) => Promise<string | null>
  /** "12 PDF(s) read: …" — the middle of the run's detail line. */
  summary: (readings: R[], byStatus: Record<S, number>) => string
}

export type ReaderResult<S extends string, R extends Reading<S>> = {
  ok: boolean
  dry: boolean
  /** The vendor's bills and purchases' PDFs (one per bill where perBill is 'newest'). */
  withPdf: number
  /** Of those, read before by this reading and left alone. */
  alreadyRead: number
  read: number
  byStatus: Record<S, number>
  /** Not reached before the deadline; the next run carries on. */
  notReached: number
  detail: string
  readings: R[]
}

export type ReaderOptions = { deadline: number; dry?: boolean; reread?: boolean; limit?: number; concurrency?: number }

export const chunks = <T>(xs: T[], n = 150) => Array.from({ length: Math.ceil(xs.length / n) }, (_, k) => xs.slice(k * n, k * n + n))

/** One caller at a time: a token refresh rotates the refresh token, and two at once could lose it. */
export function oneAtATime<T>(f: () => Promise<T>): () => Promise<T> {
  let last: Promise<unknown> = Promise.resolve()
  return () => {
    const next = last.then(f, f)
    last = next.catch(() => undefined)
    return next
  }
}

/** The PDF's text layer, or '' for a scan. */
export async function pdfText(pdf: Uint8Array): Promise<string> {
  try {
    return String((await extractText(await getDocumentProxy(pdf), { mergePages: true })).text ?? '').trim()
  } catch {
    return ''
  }
}

/**
 * The PDF's words with their positions, one array per page (Y top-down), and
 * the text laid out row by row from them. Empty for a scan.
 *
 * Takes a COPY of the bytes: pdf.js hands the buffer to its worker and
 * detaches it, and the caller may still want the PDF afterwards.
 */
export async function pdfWords(pdf: Uint8Array): Promise<{ pages: Word[][]; text: string }> {
  try {
    const doc = await getDocumentProxy(new Uint8Array(pdf))
    const pages: Word[][] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const height = page.getViewport({ scale: 1 }).height
      const content = await page.getTextContent()
      const frags: Fragment[] = []
      for (const it of content.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
        if (!it.str || !it.transform) continue
        const h = it.height || Math.abs(it.transform[3]) || 10
        // pdf.js gives the baseline from the bottom; the readers want the top from the top.
        frags.push({ str: it.str, x: it.transform[4], y: height - it.transform[5] - h, width: it.width ?? 0, height: h })
      }
      pages.push(wordsFromFragments(frags))
    }
    const text = pages
      .map((p) =>
        groupRows(p)
          .map((r) => r.w.map(([, t]) => t).join(' '))
          .join('\n'),
      )
      .join('\n')
      .trim()
    return { pages, text }
  } catch {
    return { pages: [], text: '' }
  }
}

/** Download one attachment: a fresh TempDownloadUri from QuickBooks every time. */
export async function downloadAttachment(a: QbAccount, attachableId: string): Promise<Uint8Array> {
  const meta = await qbGet<{ Attachable?: { TempDownloadUri?: string; Size?: number } }>(a, `attachable/${attachableId}`)
  const link = meta.Attachable?.TempDownloadUri
  if (!link || !/^https:\/\//.test(link)) throw new Error('QuickBooks gave no download link')
  if ((meta.Attachable?.Size ?? 0) > MAX_PDF) throw new Error('PDF over 10 MB')
  const res = await fetch(link, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`download ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length > MAX_PDF) throw new Error('PDF over 10 MB')
  return buf
}

/** A vendor's Bills and Purchases in the synced books, and the PDFs attached to them. */
export async function vendorPdfs(
  sb: SupabaseClient,
  realm: string,
  vendor: string | readonly string[],
  perBill: 'newest' | 'all',
  since?: string,
): Promise<{ pdfs: AttachmentTodo[]; error: null } | { pdfs: null; error: string }> {
  const patterns = typeof vendor === 'string' ? [vendor] : [...vendor]
  let q = sb.from('qb_entities').select('entity, qb_id, txn_date, doc_number').eq('realm_id', realm).in('entity', ['Bill', 'Purchase'])
  // Several vendors: any of them (each pattern quoted, for its spaces).
  q = patterns.length === 1 ? q.ilike('party_name', patterns[0]) : q.or(patterns.map((p) => `party_name.ilike."${p.replace(/["\\]/g, '')}"`).join(','))
  if (since) q = q.gte('txn_date', since)
  const { data: bills, error } = await q
  if (error) return { pdfs: null, error: error.message }
  const byRef = new Map(((bills ?? []) as QbBill[]).map((b) => [`${b.entity}:${b.qb_id}`, b]))
  const files: { qb_id: string; name: string | null; refs: string[] | null; raw: { ContentType?: string } | null }[] = []
  for (const part of chunks([...byRef.keys()])) {
    const { data, error: e } = await sb.from('qb_entities').select('qb_id, name, refs, raw').eq('realm_id', realm).eq('entity', 'Attachable').overlaps('refs', part)
    if (e) return { pdfs: null, error: e.message }
    files.push(...((data ?? []) as typeof files))
  }
  const pdfs: AttachmentTodo[] = [...new Map(files.map((f) => [String(f.qb_id), f])).values()]
    .filter((f) => /pdf/i.test(f.raw?.ContentType ?? '') || /\.pdf$/i.test(f.name ?? ''))
    .flatMap((f) => {
      const ref = (f.refs ?? []).find((r) => byRef.has(r))
      return ref ? [{ attachableId: String(f.qb_id), fileName: f.name ?? `${f.qb_id}.pdf`, txnRef: ref, bill: byRef.get(ref)! }] : []
    })
    // By bill, the newest file (highest id) first. (Ids pass 2^53, so they are compared as BigInts.)
    .sort((a, b) => (a.txnRef !== b.txnRef ? a.txnRef.localeCompare(b.txnRef) : BigInt(b.attachableId) > BigInt(a.attachableId) ? 1 : -1))
  // One PDF per bill, where the reader wants it: the newest if a bill has two.
  return { pdfs: perBill === 'newest' ? pdfs.filter((p, k, all) => k === 0 || all[k - 1].txnRef !== p.txnRef) : pdfs, error: null }
}

/** Run a reader over its vendor's PDFs. */
export async function runAttachmentReader<S extends string, R extends Reading<S>>(
  sb: SupabaseClient,
  spec: ReaderSpec<S, R>,
  opts: ReaderOptions,
): Promise<ReaderResult<S, R>> {
  const dry = opts.dry === true
  const byStatus = Object.fromEntries(spec.statuses.map((s) => [s, 0])) as Record<S, number>
  const result = (ok: boolean, detail: string, extra: Partial<ReaderResult<S, R>> = {}): ReaderResult<S, R> => ({
    ok,
    dry,
    withPdf: 0,
    alreadyRead: 0,
    read: 0,
    byStatus,
    notReached: 0,
    detail,
    readings: [],
    ...extra,
  })
  const failHealth = async (detail: string) => {
    if (dry) return
    const now = new Date().toISOString()
    await sb.from('integration_health').update({ status: 'error', detail: detail.slice(0, 300), last_checked_at: now, updated_at: now }).eq('source_key', spec.healthKey)
  }

  const access = oneAtATime(() => qbAccess(sb))
  let realm: string
  try {
    realm = (await access()).realmId
  } catch (e) {
    await failHealth((e as Error).message)
    return result(false, (e as Error).message)
  }

  const listed = await vendorPdfs(sb, realm, spec.vendor, spec.perBill, spec.since)
  if (listed.error != null) return result(false, listed.error)
  const pdfs = listed.pdfs

  const done = new Set<string>()
  if (!opts.reread) {
    for (const part of chunks(pdfs.map((p) => p.attachableId))) {
      const { data, error: e } = await sb
        .from('qb_attachment_reads')
        .select('attachable_id, status, parser_version')
        .eq('reader', spec.reader)
        .in('attachable_id', part)
      // A dry run before the migration has landed reads everything.
      if (e && dry) break
      if (e) return result(false, `qb_attachment_reads: ${e.message}`)
      for (const r of data ?? []) if (r.status !== 'failed' && Number(r.parser_version) >= spec.parserVersion) done.add(String(r.attachable_id))
    }
  }
  // Newest first, so a short run reads what matters now.
  let todo = pdfs.filter((p) => !done.has(p.attachableId)).sort((a, b) => String(b.bill.txn_date).localeCompare(String(a.bill.txn_date)))
  if (opts.limit != null) todo = todo.slice(0, opts.limit)

  await spec.prepare?.()

  const readings: R[] = []
  let next = 0
  let notReached = 0
  let writeError: string | null = null

  const one = async (t: AttachmentTodo): Promise<R> => {
    const base: ReadingBase = { attachableId: t.attachableId, txnRef: t.txnRef, txnDate: t.bill.txn_date, docNumber: t.bill.doc_number, fileName: t.fileName }
    let pdf: Uint8Array
    try {
      pdf = await downloadAttachment(await access(), t.attachableId)
    } catch (e) {
      return spec.failed(base, (e as Error).message.slice(0, 300))
    }
    try {
      return await spec.read(t, pdf, base)
    } catch (e) {
      return spec.failed(base, `Could not read: ${(e as Error).message}`.slice(0, 300))
    }
  }

  const save = async (t: AttachmentTodo, r: R) => {
    await spec.save?.(t, r)
    const { error: e } = await sb.from('qb_attachment_reads').upsert(
      {
        ...spec.logRow(r),
        reader: spec.reader,
        realm_id: realm,
        attachable_id: t.attachableId,
        txn_ref: t.txnRef,
        txn_date: t.bill.txn_date,
        file_name: t.fileName,
        status: r.status,
        detail: r.detail,
        parser_version: spec.parserVersion,
        read_at: new Date().toISOString(),
      },
      { onConflict: 'reader,attachable_id' },
    )
    if (e) throw new Error(`qb_attachment_reads: ${e.message}`)
  }

  const worker = async () => {
    while (next < todo.length) {
      const t = todo[next++]
      if (Date.now() > opts.deadline || writeError) {
        notReached++
        continue
      }
      const r = await one(t)
      if (!dry) {
        try {
          await save(t, r)
        } catch (e) {
          // A write failing (a missing column, a constraint) fails them all: stop, do not read on.
          writeError = (e as Error).message
          notReached++
          continue
        }
      }
      byStatus[r.status]++
      readings.push(r)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker))

  let after: string | null = null
  if (!dry && !writeError && spec.finish) {
    try {
      after = await spec.finish(readings)
    } catch (e) {
      writeError = (e as Error).message
    }
  }

  const detail =
    (writeError ? `Stopped: ${writeError}. ` : '') +
    spec.summary(readings, byStatus) +
    (after ? `; ${after}` : '') +
    (notReached ? `; ${notReached} left for the next run` : '') +
    `; ${done.size} read before`
  const failed = (byStatus as Record<string, number>).failed ?? 0
  const ok = !writeError && !(readings.length > 0 && failed === readings.length)
  if (!dry) {
    if (ok) await sb.rpc('record_integration_heartbeat', { p_key: spec.healthKey, p_detail: detail.slice(0, 300), p_data_at: null })
    else await failHealth(detail)
  }
  return result(ok, detail, { withPdf: pdfs.length, alreadyRead: done.size, read: readings.length, notReached, readings })
}

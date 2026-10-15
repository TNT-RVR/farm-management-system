import './pdf-polyfills.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractText, getDocumentProxy } from 'unpdf'
import { matchField, parseHailReport, type HailReport, type TextItem } from '../../src/lib/hail-report.ts'

/**
 * Turning an emailed AFSC inspection summary into a hail record.
 *
 * The parsing lives in src/lib/hail-report.ts, pure and tested against the real
 * document. This is the part with the database and the network in it: pull the
 * positioned text out of the PDF, find the field the legal description names,
 * and write it down.
 *
 * An EXACT quarter-section match from an allow-listed sender records itself.
 * Anything less does not: a section-only match means our own record never said
 * which quarter, two fields can share a section, and a hail claim landing on the
 * wrong one is the failure this whole design is arranged around. Those wait for
 * a person, as does anything unmatched.
 */

/**
 * Positioned text from page 1, which is where the summary table lives.
 *
 * Takes a COPY of the bytes. pdf.js hands the underlying ArrayBuffer to its
 * worker and detaches it, so a buffer that has been parsed once is empty the
 * next time and the second call dies with "Cannot transfer object of
 * unsupported type" — which names neither the buffer nor the first read, and is
 * exactly what the first emailed report hit.
 */
export async function itemsFromPdf(buf: Uint8Array): Promise<TextItem[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buf))
  const page = await pdf.getPage(1)
  const content = await page.getTextContent()
  return (content.items as { str?: string; transform?: number[] }[])
    .filter((i) => i.str && i.str.trim() && i.transform)
    .map((i) => ({
      x: Math.round(i.transform![4]),
      y: Math.round(i.transform![5]),
      s: i.str!.trim(),
    }))
}

/**
 * Whole-document text. Copies for the same reason as above.
 *
 * No longer used by the email path: telling an AFSC report from anything else
 * is what parsing already does — a PDF with no inspection number and no land
 * location is not one — and doing it separately meant reading every attachment
 * twice for an answer we were about to get anyway.
 */
export async function looksLikeHailReport(buf: Uint8Array): Promise<boolean> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    const { text } = await extractText(pdf, { mergePages: true })
    const t = String(text).toLowerCase()
    return t.includes('inspection summary report') && t.includes('hail')
  } catch {
    return false
  }
}

export type IngestResult = {
  ok: boolean
  inspectionNumber: string | null
  fieldId: string | null
  fieldName: string | null
  confidence: 'exact' | 'section' | null
  status: 'pending' | 'applied' | 'duplicate' | 'unmatched' | 'skipped' | 'unreadable'
  detail: string
  report: HailReport | null
}

/**
 * Parse one PDF and record it.
 *
 * `source` is where it came from — an email address, or the name of whoever
 * uploaded it — and is kept, because the first question about an automatic
 * record is always where it came from.
 */
export async function ingestHailPdf(
  sb: SupabaseClient,
  buf: Uint8Array,
  source: string,
  /**
   * Record an exact match without waiting for anybody.
   *
   * Only ever set by the inbound-email path, and only after the sender has
   * cleared the allow-list and the shared secret. The upload button does not
   * pass it — somebody is already standing there, so the tap costs nothing.
   */
  opts: { autoApplyExact?: boolean } = {},
): Promise<IngestResult> {
  const base: IngestResult = {
    ok: false,
    inspectionNumber: null,
    fieldId: null,
    fieldName: null,
    confidence: null,
    status: 'unreadable',
    detail: '',
    report: null,
  }

  let report: HailReport
  try {
    report = parseHailReport(await itemsFromPdf(buf))
  } catch (e) {
    return { ...base, detail: `could not read the PDF: ${(e as Error).message}` }
  }

  if (!report.inspectionNumber || !report.landLocation) {
    // Read fine, just not one of these. ok:true because nothing went wrong —
    // a bank statement in the mailbox is not a failure to report.
    return {
      ...base,
      report,
      ok: true,
      status: 'skipped',
      detail: 'not an AFSC inspection summary — no inspection number or land location',
    }
  }

  // The inspection number is AFSC's own key and they resend the same report,
  // so this is what stops a forwarded email creating a second claim.
  const { data: existing } = await sb
    .from('hail_inspections')
    .select('id, status')
    .eq('inspection_number', report.inspectionNumber)
    .maybeSingle()
  if (existing) {
    return {
      ...base,
      report,
      inspectionNumber: report.inspectionNumber,
      ok: true,
      status: 'duplicate',
      detail: `inspection ${report.inspectionNumber} is already on file`,
    }
  }

  const { data: fields } = await sb
    .from('fields')
    .select('id, name, legal_land_description')
  const match = matchField(fields ?? [], report.landLocation)

  const row = {
    inspection_number: report.inspectionNumber,
    field_id: match?.field.id ?? null,
    match_confidence: match?.confidence ?? null,
    land_location: report.landLocation,
    crop_label: report.crop,
    damage_date: report.damageDate,
    report_date: report.reportDate,
    loss_notice_date: report.lossNoticeDate,
    adjuster: report.adjuster,
    acres: report.totalAcres,
    loss_pct: report.lossPct,
    bands: report.bands,
    source,
    status: 'pending' as const,
  }

  const { data: inserted, error } = await sb
    .from('hail_inspections')
    .insert(row)
    .select('id')
    .single()
  if (error || !inserted) {
    return { ...base, report, detail: `could not save: ${error?.message ?? 'no row returned'}` }
  }

  let status: IngestResult['status'] = match ? 'pending' : 'unmatched'
  let applyNote = ''
  if (match?.confidence === 'exact' && opts.autoApplyExact) {
    const { error: applyErr } = await sb.rpc('fn_apply_hail_inspection_system', {
      p_id: inserted.id,
    })
    // A failure here leaves the row pending, which is the safe end to fail
    // towards: the report is still on file and somebody can press the button.
    if (applyErr) applyNote = ` (could not record it automatically: ${applyErr.message})`
    else {
      status = 'applied'
      applyNote = ' — recorded'
    }
  }

  return {
    ok: true,
    report,
    inspectionNumber: report.inspectionNumber,
    fieldId: match?.field.id ?? null,
    fieldName: match?.field.name ?? null,
    confidence: match?.confidence ?? null,
    status,
    detail: match
      ? `${report.landLocation} → ${match.field.name} (${match.confidence}), ${report.lossPct ?? '?'}% on ${report.totalAcres ?? '?'} ac${applyNote}`
      : `no field matches ${report.landLocation}`,
  }
}

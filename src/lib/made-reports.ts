import { supabase } from './supabase'
import { localToday } from './today'
import type { Json } from './database.types'

/**
 * Every report somebody makes is kept in the documents library under "Made
 * reports" (Sam, 23 Nov 2026: "Each time someone builds a report though it
 * should save to the documents under made reports").
 *
 * The copy records who made it (added_by, the database fills it), when, which
 * report and the options chosen. `access` carries the report's own rule, so a
 * copy of the lender review is no easier to read than the report was to make;
 * the maker can always read their own.
 *
 * Saving never stands in the way of the download: the file is already in the
 * person's hands, and a copy that fails to save is logged, not shown as an error.
 */

export const MADE_REPORTS_AREA = 'reports'
export const MADE_REPORTS_LINK = `/documents?area=${MADE_REPORTS_AREA}`

export type MadeReportAccess = 'all' | 'manager' | 'finance' | 'admin'

export type MadeReport = {
  /** The report's id in the catalogue, or the page's own name for one made there ("handling-plan"). */
  reportId: string
  /** What it is: "Bin sensor report · BASF canola bin monitoring". */
  name: string
  blob: Blob
  /** The file name as downloaded, extension included. */
  filename: string
  format?: string
  /** The choices as stored (ids), and as read (labels): `{ "Crop year": "2026", "Bin": "Bin 12 · Yard" }`. */
  params?: Record<string, string>
  labels?: Record<string, string>
  /** The combined entry it was made from, when it was one ("bin-sensor"). */
  family?: string
  /** Who it is going to, when the form asked. */
  party?: string | null
  cropYear?: number | null
  access?: MadeReportAccess
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
  md: 'text/markdown',
}

/** The file's name made safe for a storage key: letters, digits, a few marks. */
export function storageSafe(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9._ -]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'report'
  )
}

/** "Crop year: 2026 · Bin: 12 · Excel": what the summary line of the copy says. */
export function optionsLine(labels: Record<string, string> | undefined, format?: string): string {
  const parts = Object.entries(labels ?? {})
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}: ${v}`)
  if (format) parts.push(format === 'XLSX' ? 'Excel' : format)
  return parts.join(' · ')
}

/** A crop year from the choices, when one was made. */
export function cropYearOf(params: Record<string, string> | undefined): number | null {
  for (const k of ['year', 'planYear', 'winter']) {
    const n = Number(params?.[k])
    if (Number.isInteger(n) && n > 1990 && n < 2200) return n
  }
  return null
}

export async function saveMadeReport(r: MadeReport): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return null
  const today = localToday()
  const ext = (r.filename.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? '').toLowerCase()
  const path = `made-reports/${uid}/${today}/${Date.now()}-${storageSafe(r.filename)}`
  const mime = r.blob.type || MIME[ext] || 'application/octet-stream'
  const summary = optionsLine(r.labels, r.format)

  // The row first, then the file: the file is readable only once its row is,
  // and a row whose upload failed is taken back out.
  const { data: row, error } = await supabase
    .from('documents')
    .insert({
      area: MADE_REPORTS_AREA,
      source: 'report',
      doc_type: 'Made report',
      title: r.name,
      party: r.party ?? null,
      doc_date: today,
      crop_year: r.cropYear ?? cropYearOf(r.params),
      storage_bucket: 'documents',
      storage_path: path,
      filename: r.filename,
      mime,
      bytes: r.blob.size,
      summary: summary || null,
      tags: [r.reportId, ...(r.family ? [r.family] : []), ...(r.format ? [r.format.toLowerCase()] : [])],
      added_by: uid,
      report_id: r.reportId,
      report_options: { report: r.reportId, family: r.family ?? null, format: r.format ?? null, params: r.params ?? {}, labels: r.labels ?? {} } as Json,
      access: r.access ?? 'all',
    })
    .select('id')
    .single()
  if (error) throw error
  const up = await supabase.storage.from('documents').upload(path, r.blob, { contentType: mime, upsert: false })
  if (up.error) {
    await supabase.from('documents').delete().eq('id', row.id)
    throw up.error
  }
  return row.id
}

/** Save without holding anything up: the download has already happened. */
export function keepMadeReport(r: MadeReport): void {
  saveMadeReport(r).catch((e: unknown) => console.warn('Could not keep a copy under Made reports:', e))
}

/** The access a catalogue report's copy carries: its own rule. */
export function accessOf(r: { adminOnly?: boolean; managerOnly?: boolean; financeOnly?: boolean }): MadeReportAccess {
  if (r.financeOnly) return 'finance'
  if (r.adminOnly) return 'admin'
  if (r.managerOnly) return 'manager'
  return 'all'
}

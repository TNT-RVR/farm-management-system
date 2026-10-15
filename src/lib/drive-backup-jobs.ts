import type { BuiltReport, ReportEntry, ReportFormat } from './reports/catalogue'
import { driveName } from './drive-backup'

/**
 * What a backup run makes: every report the person may make, as a CSV and a
 * PDF where it offers them, with the choices the Reports page starts from
 * (this crop year, all fields, the default dates). A report that must be
 * made for one thing picked from a list (one bin, one supplier) has no
 * single file to keep, so it is listed as skipped with that reason.
 */
export type BackupJob = { report: BuiltReport; format: Extract<ReportFormat, 'CSV' | 'PDF'>; sectionTitle: string }
export type BackupSkip = { report: string; why: string }

const NEEDS_ONE = new Set(['field', 'crop', 'ranch', 'bin', 'lookup'])

export function backupJobs(reports: ReportEntry[], sectionTitle: (key: string) => string): { jobs: BackupJob[]; skipped: BackupSkip[] } {
  const jobs: BackupJob[] = []
  const skipped: BackupSkip[] = []
  for (const r of reports) {
    if (r.mode !== 'build') continue
    const one = r.params.find((p) => NEEDS_ONE.has(p.kind) && !('allLabel' in p && p.allLabel))
    if (one) {
      skipped.push({ report: r.name, why: `made for one ${one.label?.toLowerCase() ?? one.kind} at a time` })
      continue
    }
    const formats = r.formats.filter((f): f is 'CSV' | 'PDF' => f === 'CSV' || f === 'PDF')
    if (!formats.length) {
      skipped.push({ report: r.name, why: `makes ${r.formats.join(' / ')} only` })
      continue
    }
    for (const format of formats) jobs.push({ report: r, format, sectionTitle: sectionTitle(r.section) })
  }
  return { jobs, skipped }
}

/** Where a job's file goes: the section folder, the report's folder, the file. */
export function jobPaths(j: BackupJob) {
  const name = driveName(j.report.name)
  return {
    section: { key: `section:${j.report.section}`, name: driveName(j.sectionTitle) },
    report: { key: `report:${j.report.id}`, name },
    file: { key: `file:${j.report.id}:${j.format.toLowerCase()}`, name: `${name}.${j.format.toLowerCase()}` },
  }
}

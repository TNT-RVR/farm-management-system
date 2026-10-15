/**
 * The one CSV export implementation for the whole app (SPEC §7).
 * Every list view calls this; a second implementation means stop and refactor.
 * PDFs all go through src/lib/table-report.ts, which writes its CSV with the
 * same cell rule from here.
 */
export type ExportColumn<Row> = {
  key: string
  label: string
  value: (row: Row) => string | number | null | undefined
}

/** RFC 4180: quote a field only when it needs it. */
export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Rows to CSV text: a header line, a line a row, and a byte-order mark so
 * Excel opens UTF-8 (degree signs, dashes) correctly.
 */
export function toCsv<Row>(rows: Row[], columns: ExportColumn<Row>[]): string {
  const header = columns.map((c) => csvCell(c.label)).join(',')
  const lines = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(','))
  return '﻿' + [header, ...lines].join('\r\n')
}

/** Hand a CSV to the browser as a download. */
export function downloadCsv(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = (filename.endsWith('.csv') ? filename : `${filename}.csv`).replace(/[\\/:*?"<>|]/g, '-')
  a.click()
  URL.revokeObjectURL(url)
}

export function useExport() {
  function exportCsv<Row>(rows: Row[], columns: ExportColumn<Row>[], filename: string) {
    downloadCsv(toCsv(rows, columns), filename)
  }

  return { exportCsv }
}

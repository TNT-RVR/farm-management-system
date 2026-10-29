import { downloadCsv, toCsv, type ExportColumn } from '@/hooks/useExport'
import { downloadBlob, tableReportToPdf, type Cell, type TableReport } from '@/lib/table-report'

/**
 * A list on screen, handed over as a file (Sam, 29 Oct 2026: the export
 * button should offer a PDF as well as a CSV).
 *
 * Both formats are made from the same rows and the same columns, so the two
 * cannot disagree about what is in the list. The CSV goes through
 * hooks/useExport and the PDF through lib/table-report, which is the only PDF
 * writer in the app — it puts the farm's name and logo on it, repeats the
 * green header row on every page and turns the page landscape when the table
 * is too wide to fit upright.
 */

/** "fields-active-2026" -> "Fields active 2026", for the title on the PDF. */
export function titleFromFilename(filename: string): string {
  const words = filename.replace(/[-_]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'List'
}

export function tableReportOf<Row>(
  rows: Row[],
  columns: ExportColumn<Row>[],
  o: { title: string; subtitle?: string },
): TableReport {
  return {
    title: o.title,
    subtitle: o.subtitle,
    meta: [['Rows', rows.length]],
    sections: [
      {
        title: '',
        head: columns.map((c) => c.label),
        // A value that is neither a number nor text (undefined from a column
        // that does not apply to this row) prints as an empty cell, not as
        // the word "undefined".
        rows: rows.map((r) => columns.map((c) => (c.value(r) ?? null) as Cell)),
        empty: 'Nothing in this list.',
      },
    ],
  }
}

/** Hand the list over in the format asked for. */
export async function exportTable<Row>(
  format: 'CSV' | 'PDF',
  rows: Row[],
  columns: ExportColumn<Row>[],
  o: { filename: string; title?: string; subtitle?: string },
): Promise<void> {
  if (format === 'CSV') {
    downloadCsv(toCsv(rows, columns), o.filename)
    return
  }
  const report = tableReportOf(rows, columns, {
    title: o.title ?? titleFromFilename(o.filename),
    subtitle: o.subtitle,
  })
  downloadBlob(await tableReportToPdf(report), `${o.filename}.pdf`)
}

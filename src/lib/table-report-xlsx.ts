import type { Borders, Cell as XCell, Fill, Font, Worksheet } from 'exceljs'
import { autoAlign, type Cell, type TableReport } from './table-report'

/**
 * A table report as a formatted Excel sheet — the spreadsheet version of the
 * PDF (Sam, 26 Oct 2026: a CSV can't carry column widths or coloured
 * headings). Same report object as the PDF and CSV, so the three never
 * disagree about what is in it; only the look is Excel's.
 *
 * One sheet: the title, the meta block, then each section as its own table
 * with a green heading row, striped rows and its totals in bold. Every column
 * is sized to its longest text.
 */

const GREEN = 'FF15803D' // brand-700, the PDF's heading band
const GREEN_DARK = 'FF14532D' // brand-900
const GREEN_PALE = 'FFDCFCE7' // brand-100, totals
const ZEBRA = 'FFF7FAF8'
const GREY_TEXT = 'FF6B7280'
const RULE = 'FFE5E7EB'

const solid = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const thin: Partial<Borders> = {
  top: { style: 'thin', color: { argb: RULE } },
  bottom: { style: 'thin', color: { argb: RULE } },
  left: { style: 'thin', color: { argb: RULE } },
  right: { style: 'thin', color: { argb: RULE } },
}

/** A width in Excel's characters for a value, roomier for bold heading text. */
const textWidth = (v: Cell, bold = false) => {
  if (v == null) return 0
  const s = typeof v === 'number' ? v.toLocaleString('en-CA') : String(v)
  const longestLine = Math.max(...s.split('\n').map((l) => l.length))
  return longestLine * (bold ? 1.1 : 1)
}

/** The widest a column gets before its text wraps instead. */
const MAX_WIDTH = 60

export async function tableReportToXlsx(r: TableReport, opts: { sheetName?: string } = {}): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'RVR Management'
  wb.created = new Date()
  const ws = wb.addWorksheet((opts.sheetName ?? r.title).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  })

  // Widest text seen in each column, for sizing at the end.
  const widths: number[] = []
  const seen = (col: number, w: number) => {
    widths[col] = Math.max(widths[col] ?? 8, Math.min(MAX_WIDTH, w + 2))
  }
  const style = (c: XCell, s: { font?: Partial<Font>; fill?: Fill; align?: 'left' | 'right' | 'center'; border?: boolean; wrap?: boolean }) => {
    if (s.font) c.font = { name: 'Calibri', size: 10, ...s.font }
    if (s.fill) c.fill = s.fill
    if (s.border) c.border = thin
    c.alignment = { vertical: 'top', horizontal: s.align ?? 'left', wrapText: s.wrap ?? false }
  }

  // Title, subtitle, and the facts block. Titles don't size the columns: they
  // run across the empty cells beside them.
  const title = ws.addRow([r.title])
  style(title.getCell(1), { font: { size: 16, bold: true, color: { argb: GREEN_DARK } } })
  title.height = 24
  if (r.subtitle) style(ws.addRow([r.subtitle]).getCell(1), { font: { size: 11, color: { argb: GREEN } } })
  ws.addRow([])
  for (const [k, v] of r.meta) {
    const row = ws.addRow([k, v])
    style(row.getCell(1), { font: { bold: true, color: { argb: GREY_TEXT } } })
    style(row.getCell(2), { font: {} })
    seen(0, textWidth(k, true))
  }

  for (const s of r.sections) {
    ws.addRow([])
    const head = ws.addRow([s.title])
    style(head.getCell(1), { font: { size: 12, bold: true, color: { argb: GREEN_DARK } } })
    head.height = 18
    if (s.note) style(ws.addRow([s.note]).getCell(1), { font: { italic: true, color: { argb: GREY_TEXT } } })

    const auto = autoAlign(s.head, s.rows)
    const align = s.head.map((_, i) => s.align?.[i] ?? auto[i])
    const h = ws.addRow(s.head)
    s.head.forEach((t, i) => {
      style(h.getCell(i + 1), { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: solid(GREEN), align: align[i] ?? 'left', border: true, wrap: true })
      seen(i, textWidth(t, true))
    })

    if (!s.rows.length) {
      const e = ws.addRow([s.empty ?? 'None in this range'])
      style(e.getCell(1), { font: { italic: true, color: { argb: GREY_TEXT } } })
    }
    s.rows.forEach((cells, n) => {
      const row = ws.addRow(cells.map((v) => (v === '' ? null : v)))
      for (let i = 0; i < s.head.length; i++) {
        style(row.getCell(i + 1), { font: {}, fill: n % 2 ? solid(ZEBRA) : undefined, align: align[i] ?? 'left', border: true, wrap: textWidth(cells[i] ?? null) > MAX_WIDTH })
        seen(i, textWidth(cells[i] ?? null))
        if (typeof cells[i] === 'number' && !Number.isInteger(cells[i])) row.getCell(i + 1).numFmt = '#,##0.0##'
        else if (typeof cells[i] === 'number' && Math.abs(cells[i] as number) >= 1000) row.getCell(i + 1).numFmt = '#,##0'
      }
    })
    if (s.foot) {
      const f = ws.addRow(s.foot)
      for (let i = 0; i < s.head.length; i++) {
        style(f.getCell(i + 1), { font: { bold: true }, fill: solid(GREEN_PALE), align: align[i] ?? 'left', border: true })
        seen(i, textWidth(s.foot[i] ?? null, true))
      }
    }
  }

  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })
  ws.headerFooter.oddFooter = `&L${r.title}&RPage &P of &N`

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/** For tests: how wide each column came out. */
export async function columnWidths(r: TableReport): Promise<number[]> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await (await tableReportToXlsx(r)).arrayBuffer())
  const ws: Worksheet = wb.worksheets[0]
  return (ws.columns ?? []).map((c) => c.width ?? 0)
}

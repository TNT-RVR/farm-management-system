import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { columnWidths, tableReportToXlsx } from './table-report-xlsx'
import type { TableReport } from './table-report'

const report: TableReport = {
  title: 'Main Yard- #20',
  subtitle: 'Bin records · 2026-04-26 to 2026-10-26',
  meta: [['Site', 'Main Yard']],
  sections: [
    {
      title: 'Loads weighed in',
      head: ['Date', 'Field', 'Net kg'],
      rows: [
        ['2026-10-19', 'Moreau W Half SE 9-40-26', 37040],
        ['2026-10-20', 'A', 12.5],
      ],
    },
    { title: 'Moisture tests', head: ['Date', 'Moisture %'], rows: [] },
  ],
}

describe('table report as Excel', () => {
  it('sizes each column to its longest text', async () => {
    const w = await columnWidths(report)
    expect(w[1]).toBeGreaterThanOrEqual('Moreau W Half SE 9-40-26'.length)
    expect(w[1]).toBeLessThan(40)
  })

  it('colours the heading row and says when a table is empty', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await (await tableReportToXlsx(report)).arrayBuffer())
    const ws = wb.worksheets[0]
    let headRow = 0
    let empty = false
    ws.eachRow((row, n) => {
      if (row.getCell(1).value === 'Date' && !headRow) headRow = n
      if (row.getCell(1).value === 'None in this range') empty = true
    })
    const fill = ws.getRow(headRow).getCell(1).fill as { fgColor?: { argb?: string } }
    expect(fill.fgColor?.argb).toBe('FF15803D')
    expect(ws.getRow(headRow).getCell(1).font?.bold).toBe(true)
    expect(ws.getRow(headRow + 1).getCell(3).value).toBe(37040)
    expect(empty).toBe(true)
  })

  it('puts a table that names a sheet on its own, and sizes that sheet’s columns alone', async () => {
    const split: TableReport = {
      ...report,
      sections: [
        { title: 'Fields', sheet: 'Fields', head: ['Field', 'Acres'], rows: [['Home Quarter', 160]] },
        {
          title: 'Notes',
          sheet: 'Notes',
          head: ['Field', 'Note'],
          rows: [['Home Quarter', 'Sample the south half separately, the saline corner came back high last time.']],
        },
      ],
    }
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await (await tableReportToXlsx(split)).arrayBuffer())
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Fields', 'Notes'])
    // The note is on the other sheet, so Acres stays a narrow column of numbers.
    expect(wb.getWorksheet('Fields')!.getColumn(2).width).toBeLessThan(12)
    // Longer than a sentence: the column stops growing and the text wraps.
    expect(wb.getWorksheet('Notes')!.getColumn(2).width).toBeLessThanOrEqual(38)
    // The heading row stays put, with filter arrows over the rows under it.
    expect(wb.getWorksheet('Notes')!.autoFilter).toBeTruthy()
  })
})

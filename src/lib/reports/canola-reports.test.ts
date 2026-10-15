import { describe, expect, it } from 'vitest'
import { tableReportPdfDoc, tableReportToCsv, type PdfBrand } from '@/lib/table-report'
import { fieldHistoryReport } from './canola-reports'

const brand: PdfBrand = { farmName: 'Prairie Creek Farm', appName: 'RVR Management', logo: null }

const report = () =>
  fieldHistoryReport({
    company: 'Corteva',
    notes: null,
    fromYear: 2023,
    toYear: 2024,
    fields: [
      {
        name: 'Whitfield SE',
        legal: null,
        acres: 152.4,
        lastSeedCanola: null,
        years: [
          { year: 2023, crop: 'Wheat', variety: null, yield: null, acres: 1520.4, from: 'history' },
          { year: 2024, crop: 'Canola', variety: null, yield: null, acres: null, from: 'plan' },
        ],
      },
    ],
  })

describe('fieldHistoryReport', () => {
  it('prints years as 2023, never 2,023, in the PDF table and the CSV', async () => {
    const doc = await tableReportPdfDoc(report(), { brand, now: new Date('2026-10-13T12:00:00Z') })
    const body = (doc as unknown as { lastAutoTable: { body: { cells: Record<number, { text: string[] }> }[] } }).lastAutoTable.body
    expect(body.map((row) => row.cells[0].text.join(''))).toEqual(['2023', '2024'])
    // Real numbers keep their grouping.
    expect(body[0].cells[3].text.join('')).toBe('1,520.4')

    const lines = tableReportToCsv(report()).split('\r\n')
    expect(lines).toContain('2023,Wheat,,1520.4,,Crop history')
    expect(lines).toContain('2024,Canola,,,,Crop plan')
  })
})

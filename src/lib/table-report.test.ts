import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { autoAlign, pdfSafe, tableReportPdfDoc, tableReportToCsv, type PdfBrand, type TableReport } from './table-report'

// Any real PNG will do; the app icon exists in every edition of the app, the farm's own logo does not.
const logo = `data:image/png;base64,${readFileSync(new URL('../../public/pwa-192.png', import.meta.url)).toString('base64')}`
const brand: PdfBrand = { farmName: 'Prairie Creek Farm', appName: 'RVR Management', logo }
const now = new Date('2026-10-02T15:30:00Z')

/** Set REPORT_PDF_OUT to a folder to write the sample PDFs there and look at them. */
const out = process.env.REPORT_PDF_OUT
const save = (name: string, doc: { output: (t: 'arraybuffer') => ArrayBuffer }) => {
  if (out) writeFileSync(join(out, name), Buffer.from(doc.output('arraybuffer')))
}

const sprayLike = (): TableReport => ({
  title: 'Spray records',
  subtitle: 'Crop year 2026 | All fields',
  meta: [
    ['Passes', 42],
    ['Products', 118],
    ['Fields', 14],
    ['Area sprayed', '3,412.6 ac'],
    ['Unmatched names', 2],
  ],
  lead: ['Every application pass John Deere logged, product by product, with the PCP number from the price book.'],
  sections: Array.from({ length: 6 }, (_, f) => ({
    title: `Field ${f + 1} - Whitfield SE 12-70-13`,
    head: ['Date', 'Crop', 'Product', 'PCP', 'Rate', 'Unit', 'Area (ac)', 'Total', 'Operator', 'Wind (km/h)', 'Temp (°C)'],
    rows: Array.from({ length: 9 + f * 4 }, (_, i) => [
      `2026-06-${String(1 + i).padStart(2, '0')}`,
      'Canola – BASF',
      i % 3 ? 'Liberty 150 SN' : 'Centurion “Adv”',
      i % 3 ? '33213' : null,
      (0.81 + i / 10).toFixed(2),
      'L/ac',
      (120.4 + i).toFixed(1),
      (98.2 * (i + 1)).toLocaleString('en-CA', { maximumFractionDigits: 1 }),
      'Doug',
      12 + i,
      21.5,
    ]),
    foot: ['Total', '', '', '', '', '', '1,204.0', '9,820.0', '', '', ''],
  })),
})

describe('tableReportToPdf', () => {
  it('builds a branded report with many columns and pages', async () => {
    const doc = await tableReportPdfDoc(sprayLike(), { brand, now })
    expect(doc.getNumberOfPages()).toBeGreaterThan(1)
    // Eleven columns do not fit a portrait page.
    expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight())
    save('sample-spray.pdf', doc)
  })

  it('stays portrait for a narrow table, and copes with no logo and empty sections', async () => {
    const doc = await tableReportPdfDoc(
      {
        title: 'Grant applications and deadlines',
        subtitle: 'Open grants',
        meta: [['Grants', 3], ['Next deadline', '2026-10-15']],
        sections: [
          { title: 'Applying', head: ['Grant', 'Funder', 'Amount', 'Deadline'], rows: [['On-Farm Climate Action Fund', 'AAFC', '$75,000', '2026-10-15']], foot: ['Total', '', '$75,000', ''] },
          { title: 'Submitted', head: ['Grant', 'Funder', 'Amount', 'Deadline'], rows: [] },
        ],
      },
      { brand: { ...brand, logo: null }, now },
    )
    expect(doc.internal.pageSize.getWidth()).toBeLessThan(doc.internal.pageSize.getHeight())
    save('sample-portrait.pdf', doc)
  })

  it('takes a picture and lead lines, as the AIMM report does', async () => {
    const doc = await tableReportPdfDoc(
      {
        title: 'Field 7 - Root zone moisture',
        meta: [['Crop', 'Corn'], ['Units', 'in'], ['Printed', '2 Oct 2026']],
        image: { dataUrl: logo, width: 315, height: 200 },
        lead: ['Status today: ok.', 'Water use: 0.21 in/day.'],
        sections: [{ title: 'Irrigation applied 2026', head: ['Date', 'Gross (in)', 'Net (in)', 'From'], rows: [['2026-07-01', '1.00', '0.85', 'FieldNET']] }],
      },
      { brand, now },
    )
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)
    save('sample-image.pdf', doc)
  })
})

describe('the PDF helpers', () => {
  it('right-aligns columns of numbers only', () => {
    expect(autoAlign(['Field', 'Acres', 'Yield', 'Note'], [['A', 12, '1,204.5', 'ok'], ['B', null, '45%', '']])).toEqual(['left', 'right', 'right', 'left'])
  })

  it('swaps characters the built-in fonts cannot print', () => {
    expect(pdfSafe('Canola – BASF “Adv” ≥ 5 · 2…')).toBe('Canola - BASF "Adv" >= 5 | 2...')
    expect(pdfSafe('21 °C')).toBe('21 °C')
  })
})

describe('tableReportToCsv', () => {
  it('writes the subtitle, each section and its totals', () => {
    const csv = tableReportToCsv({
      title: 'T',
      subtitle: '2026',
      meta: [['Rows', 1]],
      sections: [{ title: 'S', head: ['a', 'b'], rows: [['x, y', 2]], foot: ['Total', 2] }],
    })
    expect(csv.split('\r\n')).toEqual(['﻿T', '2026', 'Rows,1', '', 'S', 'a,b', '"x, y",2', 'Total,2', ''])
  })
})

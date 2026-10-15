import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tableReportPdfDoc, tableReportToCsv, type PdfBrand } from '@/lib/table-report'
import { blankReturn, toDisposition, type Disposition, type StockReturn } from '@/lib/grazing-leases'
import { CLIENT_ADMIN_EMAIL, SPARE_ROWS, WORKSHEET_TITLE, stockReturnReport, stockReturnSections } from './stock-return'

/**
 * The stock return worksheet's layout. With REPORT_PDF_OUT set to a folder,
 * a sample PDF of a filled return and a blank one is written there to look at.
 */

const brand: PdfBrand = { farmName: 'Prairie Creek Farm', appName: 'Farm Management', logo: null }
const now = new Date('2026-10-05T15:30:00Z')

const lease: Disposition = {
  ...toDisposition({ id: 'd1', disposition_no: 'GRL-10002', ranch_id: 'r1' }),
  holder_name: 'PRAIRIE CATTLE LTD.',
  holder_address: 'Box 100\nSomewhere, AB T0K 0A0',
  expiry_date: '2033-08-31',
  key_land: 'W4-10-080-22-09',
  billable_aum: 58,
  capacity_aum: 58,
  return_to: 'A District\nForestry and Parks\nRangeland Management Branch',
  return_phone: '(403) 555-0100',
  return_fax: 'N/A',
  pasture_unit: 'Combined with 10001',
  calving_months: 'March - April',
  signer_name: 'Pat Holder',
  brands: [
    { owner: 'Prairie Cattle', description: 'P 1/4 circle', location: 'Right Rib', livestock: 'Cattle' },
    { owner: 'Prairie Cattle', description: 'Y bar', location: 'Right Hip', livestock: 'Cattle' },
  ],
  other_lands: [
    { land_type: 'Private/Rented Native Grassland Pasture', acres: 1800, quarter: 'SE', section: '35', township: '080', range: '11', meridian: 'W4' },
    { land_type: 'Private/Rented Tame Pasture', acres: 600, quarter: 'NE', section: '35', township: '080', range: '11', meridian: 'W4' },
  ],
}

const filed: StockReturn = {
  ...blankReturn('d1', 2025),
  grazed: true,
  livestock: [
    { pasture_unit: 'Combined with 10001', livestock_class: 'Cattle Cow', count: 118, date_in: '2025-06-09', date_out: '2025-11-03' },
    { pasture_unit: 'Combined with 10001', livestock_class: 'Cattle Bull', count: 5, date_in: '2025-06-09', date_out: '2025-11-03' },
  ],
  weights: [
    { livestock_class: 'Cattle Cow', weight: 1100, unit: 'Pounds' },
    { livestock_class: 'Cattle Bull', weight: 2000, unit: 'Pounds' },
  ],
  owned: true,
  hay_cut: false,
  feed_supplied: false,
  other_fenced: true,
  had_losses: false,
  declared: true,
  status: 'filed',
}

const titles = (f: Parameters<typeof stockReturnSections>[0]) => stockReturnSections(f).map((s) => s.title).filter(Boolean)

describe('the stock return worksheet', () => {
  it("follows the form's order: header, return to, the ten parts, the collection notice", () => {
    expect(titles({ disposition: lease, ret: filed })).toEqual([
      'Grazing disposition GRL-10002',
      'Return to',
      '1. Livestock grazed',
      '2. Livestock weight and type',
      '3. Whose livestock',
      '4. Calving',
      '5. Registered brands',
      '6. Hay',
      '7. Additional feed',
      '8. Other lands fenced with the disposition',
      '9. Missing and/or dead livestock (optional)',
      '10. Declaration',
      'Collection of information',
    ])
  })

  it('fills the header and the livestock as the form does', () => {
    const s = stockReturnSections({ disposition: lease, ret: filed })
    expect(s[0].rows).toEqual([
      ['Year', '2025', 'Due date', 'January 31, 2026'],
      ['Name', 'PRAIRIE CATTLE LTD.', 'Disposition', 'GRL-10002'],
      ['Address', 'Box 100, Somewhere, AB T0K 0A0', 'Expiry date', '2033/08/31'],
      [null, null, 'Key land', 'W4-10-080-22-09'],
      [null, null, 'Billable AUM', 58],
      [null, null, 'Grazing capacity AUM', 58],
    ])
    expect(s[0].answerColumns).toEqual([1, 3])
    const livestock = s[3]
    expect(s[2].rows).toEqual([['Did you graze livestock on the disposition this year?', 'YES']])
    expect(livestock.head).toEqual(['Pasture unit', 'Livestock class', 'Count', 'Date in', 'Date out'])
    expect(livestock.rows).toEqual([
      ['Combined with 10001', 'Cattle Cow', 118, '2025/06/09', '2025/11/03'],
      ['Combined with 10001', 'Cattle Bull', 5, '2025/06/09', '2025/11/03'],
    ])
    expect(livestock.answerColumns).toEqual([0, 1, 2, 3, 4])
    const other = s.find((x) => x.head.includes('Meridian'))!
    expect(other.rows[0]).toEqual(['Private/Rented Native Grassland Pasture', '1800.0', 'SE', '35', '080', '11', 'W4'])
  })

  it('prints a no as NO, a blank as a line to fill, and a no-hay table as one blank row', () => {
    const s = stockReturnSections({ disposition: lease, ret: filed })
    const hayQ = s.find((x) => x.title === '6. Hay')!
    expect(hayQ.rows[0][1]).toBe('NO')
    const hay = s[s.indexOf(hayQ) + 1]
    expect(hay.rows).toEqual([['', '', '']])
    // "If no, explain" is not asked on a yes.
    const owned = s.find((x) => x.title === '3. Whose livestock')!
    expect(owned.rows[1]).toEqual(['If no, explain', null])
  })

  it('pads an empty return with spare lines and leaves every answer blank', () => {
    const blank = blankReturn('d1', 2026)
    const bare = { ...toDisposition({ id: 'd1', disposition_no: 'GRL-10002' }) }
    const s = stockReturnSections({ disposition: bare, ret: blank })
    const livestock = s[3]
    expect(livestock.rows).toHaveLength(SPARE_ROWS)
    expect(livestock.rows.every((r) => r.every((c) => c === ''))).toBe(true)
    expect(s[2].rows[0][1]).toBe('')
    expect(s[0].rows[1]).toEqual(['Name', '', 'Disposition', 'GRL-10002'])
  })

  it('says on a draft which parts the app filled, and nothing once filed', () => {
    const draft: StockReturn = { ...filed, status: 'draft', prefilled: { livestock: 'from the Herd tab (whole ranch)', calving: 'from the app' } }
    const s = stockReturnSections({ disposition: lease, ret: draft })
    expect(s[2].note).toBe('Filled from the Herd tab (whole ranch) - check before filing.')
    expect(s.find((x) => x.title === '4. Calving')!.note).toBe('Filled from the app - check before filing.')
    const done = stockReturnSections({ disposition: lease, ret: { ...draft, status: 'filed' } })
    expect(done[2].note).toBeUndefined()
  })

  it('makes a CSV of the same sections in order, blanks left blank', () => {
    const report = stockReturnReport({ disposition: lease, ret: filed, ranchName: 'East Ranch' })
    expect(report.title).toBe(WORKSHEET_TITLE)
    expect(report.subtitle).toBe('GRL-10002 · 2025 grazing year · East Ranch')
    expect(report.filename).toBe('Stock return GRL-10002 2025')
    const csv = tableReportToCsv(report)
    // A byte-order mark first, for Excel; then the lines.
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    // CRLF line ends, spelled without escapes (tooling here mangles them).
    const lines = csv.slice(1).split(String.fromCharCode(13, 10))
    expect(lines[0]).toBe(WORKSHEET_TITLE)
    expect(lines).toContain('Disposition,GRL-10002')
    expect(lines).toContain('Combined with 10001,Cattle Cow,118,2025/06/09,2025/11/03')
    expect(lines).toContain('Cattle Bull,2000,Pounds')
    expect(lines).toContain(`Stock return client administration,${CLIENT_ADMIN_EMAIL}`)
    const at = (t: string) => lines.indexOf(t)
    expect(at('1. Livestock grazed')).toBeLessThan(at('5. Registered brands'))
    expect(at('5. Registered brands')).toBeLessThan(at('10. Declaration'))
    expect(csv).not.toContain('___')
  })

  it('lists what is still to answer on a draft, not on a filed return', () => {
    const draft = stockReturnReport({ disposition: lease, ret: { ...filed, status: 'draft', declared: false } })
    expect(draft.lead).toEqual(['Still to answer: 10. declaration.'])
    expect(draft.meta).toContainEqual(['Status', 'Draft'])
    const done = stockReturnReport({ disposition: lease, ret: filed })
    expect(done.lead).toBeUndefined()
    expect(done.meta).toContainEqual(['Status', 'Filed'])
  })

  it('draws as a portrait PDF', async () => {
    const out = process.env.REPORT_PDF_OUT
    const filledDoc = await tableReportPdfDoc(stockReturnReport({ disposition: lease, ret: filed }), { brand, now })
    expect(filledDoc.internal.pageSize.getWidth()).toBeLessThan(filledDoc.internal.pageSize.getHeight())
    const blankDoc = await tableReportPdfDoc(stockReturnReport({ disposition: toDisposition({ id: 'd2', disposition_no: 'GRL-10003' }), ret: blankReturn('d2', 2026) }), { brand, now })
    expect(blankDoc.getNumberOfPages()).toBeGreaterThan(0)
    if (out) {
      writeFileSync(join(out, 'stock-return-filled.pdf'), Buffer.from(filledDoc.output('arraybuffer')))
      writeFileSync(join(out, 'stock-return-blank.pdf'), Buffer.from(blankDoc.output('arraybuffer')))
    }
  })
})

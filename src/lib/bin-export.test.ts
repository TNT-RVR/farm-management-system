import { describe, expect, it } from 'vitest'
import { csvCell, defaultRange, reportToCsv, reportToPdf, type BinReport } from './bin-export'

describe('bin export', () => {
  it('defaults to the last six months', () => {
    expect(defaultRange(new Date(2026, 8, 25))).toEqual({ from: '2026-03-25', to: '2026-09-25' })
  })

  it('quotes only what needs quoting', () => {
    expect(csvCell('Bin 9')).toBe('Bin 9')
    expect(csvCell('a, b')).toBe('"a, b"')
    expect(csvCell('say "dry"')).toBe('"say ""dry"""')
    expect(csvCell(null)).toBe('')
    expect(csvCell(12.5)).toBe('12.5')
  })

  it('writes a header block and every section, saying when one is empty', () => {
    const r: BinReport = {
      bin: { name: 'Main Yard - #9', site: 'Main Yard', capacity_bu: 4519, usual_contents: 'grain', notes: null },
      from: '2026-03-25',
      to: '2026-09-25',
      generatedAt: '2026-09-25',
      sections: [
        { title: 'Loads weighed in', head: ['Date', 'Net kg'], rows: [['2026-09-20', 40580]] },
        { title: 'Moisture tests', head: ['Date', 'Moisture %'], rows: [] },
      ],
    }
    const csv = reportToCsv(r)
    expect(csv.startsWith('﻿Main Yard - #9\r\nBin records · 2026-03-25 to 2026-09-25\r\nSite,Main Yard\r\n')).toBe(true)
    expect(csv).toContain('Loads weighed in\r\nDate,Net kg\r\n2026-09-20,40580\r\n')
    expect(csv).toContain('Moisture tests\r\nDate,Moisture %\r\n(none in this range)')
  })
})

describe('bin export PDF', () => {
  it('builds a real PDF, degree signs and all', async () => {
    const r: BinReport = {
      bin: { name: 'Main Yard - #21', site: 'Main Yard', capacity_bu: 5800, usual_contents: 'grain', notes: null },
      from: '2026-03-25',
      to: '2026-09-25',
      generatedAt: '2026-09-25',
      sections: [
        { title: 'Sensor cable readings (level 1 = top)', head: ['Date', 'L1 °C / RH / moist.'], rows: [['2026-09-25', '12.5° / 55%RH / 7.9%']] },
        { title: 'Moisture tests', head: ['Date', 'Moisture %'], rows: [] },
      ],
    }
    const blob = await reportToPdf(r)
    const head = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5))
    expect(head).toBe('%PDF-')
    expect(blob.size).toBeGreaterThan(1000)
  })
})

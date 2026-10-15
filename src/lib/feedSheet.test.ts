import { describe, expect, it } from 'vitest'
import {
  SHEET_HEADER,
  feedRecordsToRows,
  groupByYear,
  normalisePrivateKey,
  tabForRecord,
  type SheetRecord,
} from '../../netlify/shared/feed-sheet'

const feb: SheetRecord = {
  ranch: 'East Ranch',
  herdGroup: 'Cows',
  periodStart: '2025-02-01',
  periodEnd: '2025-02-28',
  headCount: 167,
  notes: null,
  lines: [
    { feedTypeName: 'Silage', quantity: 233_100, unit: 'lb', lbPerBale: null, purpose: 'feed' },
    { feedTypeName: 'Green feed', quantity: 38_550, unit: 'lb', lbPerBale: null, purpose: 'feed' },
    { feedTypeName: '2nd Cut Alfalfa', quantity: 4_500, unit: 'lb', lbPerBale: null, purpose: 'feed' },
    { feedTypeName: 'Grain Corn', quantity: 11_900, unit: 'lb', lbPerBale: null, purpose: 'feed' },
    {
      feedTypeName: 'Straw for Bedding',
      quantity: 8,
      unit: 'big_square',
      lbPerBale: null,
      purpose: 'bedding',
    },
  ],
}

const col = (rows: (string | number)[][], name: string) => {
  const i = SHEET_HEADER.indexOf(name)
  return rows.slice(1).map((r) => r[i])
}

describe('feedRecordsToRows', () => {
  it('leads with a header', () => {
    expect(feedRecordsToRows([])).toEqual([SHEET_HEADER])
  })

  it('writes one row per feed line', () => {
    const rows = feedRecordsToRows([feb])
    expect(rows).toHaveLength(1 + feb.lines.length)
  })

  it('carries the period figures onto every line of that period', () => {
    // 61.5 in his margin. Repeated per row so a sorted or filtered sheet still
    // says what each row belongs to.
    const rows = feedRecordsToRows([feb])
    expect(new Set(col(rows, 'lb per head per day'))).toEqual(new Set([61.6]))
    expect(new Set(col(rows, 'Period lb fed'))).toEqual(new Set([288_050]))
  })

  it('leaves Pounds empty for a bale of unknown weight, never nought', () => {
    // A nought would sum into the period total and understate what was fed.
    const rows = feedRecordsToRows([feb])
    const pounds = col(rows, 'Pounds')
    expect(pounds[4]).toBe('')
    expect(pounds[0]).toBe(233_100)
  })

  it('converts a bale count once a weight is known', () => {
    const rows = feedRecordsToRows([
      {
        ...feb,
        lines: [
          {
            feedTypeName: 'Sainfoin',
            quantity: 5,
            unit: 'round',
            lbPerBale: 1300,
            purpose: 'self_feeder',
          },
        ],
      },
    ])
    expect(col(rows, 'Pounds')).toEqual([6_500])
    expect(col(rows, 'Purpose')).toEqual(['Self-feeder'])
  })

  it('keeps bedding out of the period total but still on the sheet', () => {
    const rows = feedRecordsToRows([
      {
        ...feb,
        lines: [
          { feedTypeName: 'Silage', quantity: 1000, unit: 'lb', lbPerBale: null, purpose: 'feed' },
          {
            feedTypeName: 'Straw',
            quantity: 2,
            unit: 'round',
            lbPerBale: 1500,
            purpose: 'bedding',
          },
        ],
      },
    ])
    expect(new Set(col(rows, 'Period lb fed'))).toEqual(new Set([1000]))
    expect(col(rows, 'Pounds')).toEqual([1000, 3000])
  })

  it('counts both ends of the period', () => {
    const rows = feedRecordsToRows([feb])
    expect(new Set(col(rows, 'Days'))).toEqual(new Set([28]))
  })

  it('writes an empty cell rather than a wrong average with no head count', () => {
    const rows = feedRecordsToRows([{ ...feb, headCount: null }])
    expect(new Set(col(rows, 'lb per head per day'))).toEqual(new Set(['']))
  })
})

describe('one tab per year', () => {
  const at = (periodStart: string, periodEnd: string): SheetRecord => ({
    ...feb,
    periodStart,
    periodEnd,
  })

  it('files a record by the year it started in', () => {
    expect(tabForRecord({ periodStart: '2025-02-01' })).toBe('2025')
    expect(tabForRecord({ periodStart: '2026-01-01' })).toBe('2026')
  })

  it('keeps a period that crosses new year whole, on the year it began', () => {
    // Splitting it would produce two averages that are each about nothing —
    // the same reason the periods are shaped the way the manager writes them.
    expect(tabForRecord({ periodStart: '2025-12-15' })).toBe('2025')
  })

  it('groups the records into a tab each, oldest year first', () => {
    const g = groupByYear([at('2026-01-01', '2026-01-31'), at('2025-02-01', '2025-02-28')])
    expect([...g.keys()]).toEqual(['2025', '2026'])
    expect(g.get('2025')).toHaveLength(1)
    expect(g.get('2026')).toHaveLength(1)
  })

  it('gives every year its own header row', () => {
    const g = groupByYear([at('2025-02-01', '2025-02-28'), at('2026-02-01', '2026-02-28')])
    for (const forYear of g.values()) {
      expect(feedRecordsToRows(forYear)[0]).toEqual(SHEET_HEADER)
    }
  })
})

describe('normalisePrivateKey', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nabc\ndef\n-----END PRIVATE KEY-----'

  it('takes a PEM as it comes out of the JSON file', () => {
    expect(normalisePrivateKey(pem)).toBe(pem)
  })

  it('unescapes the newlines a dashboard stores', () => {
    // A literal backslash-n, which is how the value survives most env-var UIs.
    expect(normalisePrivateKey(pem.replace(/\n/g, String.raw`\n`))).toBe(pem)
  })

  it('decodes base64, which is how it gets past a CLI that reads a dash as an option', () => {
    expect(normalisePrivateKey(Buffer.from(pem).toString('base64'))).toBe(pem)
  })

  it('refuses something that is neither rather than signing with rubbish', () => {
    expect(() => normalisePrivateKey('not a key at all')).toThrow(/neither a PEM nor base64/)
  })
})
